"""One organization must never hold more than one provider subscription (BIL-13).

This file exists because of a real incident. A Stripe Checkout Session in
``subscription`` mode *creates* a subscription; it does not modify one. Plan
changes were routed through checkout, so each change started a new remote
subscription and overwrote ``provider_subscription_id`` with its id -- leaving
the previous one active, billing monthly, and unreachable, because the only
handle on it had just been discarded. One customer ended up with four
concurrent subscriptions ($44 + $28 + $12 + $44 per month) while this
application displayed a single $44 plan.

Every existing billing test passed throughout, because they all run against
``NullPaymentProvider``, whose ``change_plan`` and ``cancel_subscription`` are
no-ops -- there was no test anywhere that asserted what the *provider* was
told. These do.
"""

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.subscription import Subscription
from app.services.billing_service import (
    BillingService,
    CheckoutSession,
    NullPaymentProvider,
    ProviderEvent,
)
from app.tests.conftest import auth_headers, upgrade_plan


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


class RecordingProvider(NullPaymentProvider):
    """A provider that remembers what it was asked to do.

    The point of these tests is the instruction sent to the provider, which no
    amount of asserting on local rows can observe.
    """

    name = "recording"

    def __init__(self) -> None:
        self.cancelled: list[str] = []
        self.plan_changes: list[str] = []
        self.sessions_created = 0

    def cancel_subscription(self, *, subscription, at_period_end: bool) -> None:
        if subscription.provider_subscription_id:
            self.cancelled.append(subscription.provider_subscription_id)

    def change_plan(self, *, subscription, plan) -> None:
        self.plan_changes.append(plan.code)

    def create_checkout_session(self, **kwargs) -> CheckoutSession:
        self.sessions_created += 1
        return super().create_checkout_session(**kwargs)


def test_checkout_is_refused_once_a_subscription_exists(client: TestClient) -> None:
    """The whole defect in one assertion.

    Checkout starts a *new* subscription, so an organization that already has
    one must not reach it. Before this, every plan change did.
    """
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)

    # Give the org a provider subscription, as a completed checkout would.
    client.get("/api/billing/subscription", headers=headers)
    session, generator = _db()
    row = session.query(Subscription).filter_by(organization_id=org_id).one()
    row.provider_subscription_id = "sub_existing"
    row.provider_customer_id = "cus_existing"
    session.add(row)
    session.commit()
    generator.close()

    refused = client.post(
        "/api/billing/checkout",
        json={"plan_code": "business", "success_url": "http://x/ok", "cancel_url": "http://x/no"},
        headers=headers,
    )
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["error"] == "subscription_exists"


def test_a_superseded_provider_subscription_is_cancelled_not_orphaned(
    client: TestClient,
) -> None:
    """If an id is ever replaced, the old subscription must be cancelled first.

    The id is the only handle on it; once overwritten, nothing can reach it and
    it bills forever.
    """
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    client.get("/api/billing/subscription", headers=headers)

    session, generator = _db()
    row = session.query(Subscription).filter_by(organization_id=org_id).one()
    row.provider_subscription_id = "sub_old"
    session.add(row)
    session.commit()
    generator.close()

    provider = RecordingProvider()
    service = BillingService(provider=provider)
    session, generator = _db()
    service._apply_event(
        session,
        ProviderEvent(
            event_id="evt_1",
            event_type="subscription.activated",
            provider=provider.name,
            subscription_id="sub_new",
            organization_id=org_id,
            plan_code="business",
        ),
    )
    session.commit()
    row = session.query(Subscription).filter_by(organization_id=org_id).one()
    generator.close()

    assert provider.cancelled == ["sub_old"], "the replaced subscription was left billing"
    assert row.provider_subscription_id == "sub_new"


def test_replacing_an_id_with_the_same_id_cancels_nothing(client: TestClient) -> None:
    """A redelivered webhook must not cancel the subscription it describes."""
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    client.get("/api/billing/subscription", headers=headers)

    session, generator = _db()
    row = session.query(Subscription).filter_by(organization_id=org_id).one()
    row.provider_subscription_id = "sub_same"
    session.add(row)
    session.commit()
    generator.close()

    provider = RecordingProvider()
    service = BillingService(provider=provider)
    session, generator = _db()
    service._apply_event(
        session,
        ProviderEvent(
            event_id="evt_2",
            event_type="invoice.paid",
            provider=provider.name,
            subscription_id="sub_same",
            organization_id=org_id,
        ),
    )
    session.commit()
    generator.close()

    assert provider.cancelled == []


def test_a_plan_change_modifies_the_subscription_rather_than_making_one(
    client: TestClient,
) -> None:
    """The fix, stated positively: one subscription, changed in place."""
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    upgrade_plan(client, headers, "business")

    provider = RecordingProvider()
    service = BillingService(provider=provider)
    session, generator = _db()
    row = session.query(Subscription).filter_by(organization_id=org_id).one()
    row.provider_subscription_id = "sub_live"
    session.add(row)
    session.commit()
    service.change_plan(
        session,
        organization_id=org_id,
        plan_code="enterprise",
        require_payment=False,
    )
    session.commit()
    generator.close()

    assert provider.plan_changes == ["enterprise"]
    # No new subscription was started, so nothing was left behind billing.
    assert provider.sessions_created == 0
    assert provider.cancelled == []
