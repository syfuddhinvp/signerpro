"""Billing is real: nothing is entitled that has not been paid for.

Every test here drives the actual HTTP surface with ``TestClient``, except the
few that exercise a driver (renewals, dunning) or a provider adapter directly.
Nothing touches the network: the Stripe adapter's transport seam is replaced
with a canned responder, exactly as ``test_webhooks.py`` does for outbound
deliveries.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import hash_password
from app.main import app
from app.models.charge import Charge
from app.models.invoice import Invoice, InvoiceStatus
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.plan import (
    ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT,
    ENTITLEMENT_MAX_STORAGE_BYTES,
    Plan,
)
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.user import User
from app.services.billing_service import (
    BillingProviderMisconfigured,
    InsecureBillingWebhookSecret,
    LiveStripeKeyOutsideProduction,
    NullPaymentProvider,
    ProviderInvoice,
    StripeConfigurationError,
    StripePaymentProvider,
    billing_service,
    get_payment_provider,
    verify_billing_webhook_secret_configured,
    verify_payment_provider_configured,
)
from app.services.entitlement_service import entitlement_service
from app.tests.conftest import add_payment_method, auth_headers, upgrade_plan


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


# ---------------------------------------------------------------------------
# C7 -- an upgrade cannot happen without payment
# ---------------------------------------------------------------------------


def test_upgrade_without_a_payment_method_is_refused(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")

    blocked = client.post(
        "/api/billing/change-plan", json={"plan_code": "enterprise"}, headers=headers
    )
    assert blocked.status_code == 402, blocked.text
    assert blocked.json()["detail"]["error"] == "payment_method_required"

    # The entitlement did not move an inch.
    subscription = client.get("/api/billing/subscription", headers=headers).json()
    assert subscription["plan_code"] == "team"
    assert subscription["entitlements"]["max_documents_per_month"] == 5
    assert subscription["entitlements"]["api_access"] is False
    assert client.get("/api/billing/charges", headers=headers).json() == []


def test_a_declined_card_leaves_the_org_on_the_old_plan(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    add_payment_method(client, headers, decline=True)

    declined = client.post(
        "/api/billing/change-plan", json={"plan_code": "enterprise"}, headers=headers
    )
    assert declined.status_code == 402, declined.text
    detail = declined.json()["detail"]
    assert detail["error"] == "payment_failed"
    assert detail["decline_code"] == "card_declined"

    # Entitled-but-unpaid is the state this whole path exists to prevent.
    assert client.get("/api/billing/subscription", headers=headers).json()["plan_code"] == "team"
    invoices = client.get("/api/invoices", headers=headers).json()
    assert [invoice["status"] for invoice in invoices] == ["past_due"]
    assert [charge["status"] for charge in client.get("/api/billing/charges", headers=headers).json()] == [
        "failed"
    ]


def test_a_paid_upgrade_issues_an_invoice_and_a_charge(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    add_payment_method(client, headers)

    upgraded = client.post(
        "/api/billing/change-plan", json={"plan_code": "business"}, headers=headers
    )
    assert upgraded.status_code == 200, upgraded.text
    assert upgraded.json()["plan_code"] == "business"

    invoices = client.get("/api/invoices", headers=headers).json()
    assert len(invoices) == 1
    assert invoices[0]["status"] == "paid"
    assert invoices[0]["total_cents"] > 0
    assert invoices[0]["number"].startswith("INV-")

    charges = client.get("/api/billing/charges", headers=headers).json()
    assert len(charges) == 1
    assert charges[0]["status"] == "succeeded"
    assert charges[0]["amount_cents"] == invoices[0]["total_cents"]


def test_a_downgrade_needs_no_payment_method(client: TestClient) -> None:
    """Nothing is owed either way -- scheduled costs nothing, immediate credits."""
    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")
    back = client.post(
        "/api/billing/change-plan",
        json={"plan_code": "team", "effective": "immediately"},
        headers=headers,
    )
    assert back.status_code == 200, back.text
    assert back.json()["plan_code"] == "team"


def test_buying_seats_without_an_instrument_is_refused(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    blocked = client.post("/api/billing/seats", json={"delta": 1}, headers=headers)
    assert blocked.status_code == 402, blocked.text
    assert blocked.json()["detail"]["error"] == "payment_method_required"


# ---------------------------------------------------------------------------
# Invoice generation: renewals and dunning
# ---------------------------------------------------------------------------


def _lapse_period(client: TestClient, headers: dict[str, str], org_id: str) -> None:
    client.get("/api/billing/subscription", headers=headers)  # materialises the row
    session, generator = _db()
    subscription = session.scalar(
        select(Subscription).where(Subscription.organization_id == org_id)
    )
    subscription.current_period_start = now_utc() - timedelta(days=31)
    subscription.current_period_end = now_utc() - timedelta(minutes=1)
    session.add(subscription)
    session.commit()
    generator.close()


def test_a_closed_period_actually_issues_an_invoice(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    add_payment_method(client, headers)
    org_id = _org_id(client, headers)
    _lapse_period(client, headers, org_id)

    session, generator = _db()
    report = billing_service.run_renewals(session)
    generator.close()

    assert report["closed"] == 1
    assert report["collected"] == 1
    assert len(report["invoiced"]) == 1

    invoices = client.get("/api/invoices", headers=headers).json()
    assert len(invoices) == 1
    invoice = invoices[0]
    assert invoice["status"] == "paid"
    assert invoice["total_cents"] == 1200  # one seat of Team, one month
    assert invoice["period_start"] is not None and invoice["period_end"] is not None

    # ...and the subscription rolled forward instead of lapsing into expired.
    subscription = client.get("/api/billing/subscription", headers=headers).json()
    assert subscription["status"] == "active"


def test_a_renewal_that_declines_leaves_an_unpaid_invoice_and_past_due(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    add_payment_method(client, headers, decline=True)
    org_id = _org_id(client, headers)
    _lapse_period(client, headers, org_id)

    session, generator = _db()
    report = billing_service.run_renewals(session)
    generator.close()
    assert report["closed"] == 1 and report["failed"] == 1

    invoices = client.get("/api/invoices", headers=headers).json()
    assert [invoice["status"] for invoice in invoices] == ["past_due"]
    assert client.get("/api/billing/subscription", headers=headers).json()["status"] == "past_due"


def test_dunning_retries_a_charge_whose_attempt_has_come_due(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    payment_method_id = add_payment_method(client, headers, decline=True)
    org_id = _org_id(client, headers)
    _lapse_period(client, headers, org_id)

    session, generator = _db()
    billing_service.run_renewals(session)

    # Nothing is due yet: next_attempt_at is three days out.
    assert billing_service.due_dunning_charges(session) == []
    assert billing_service.run_dunning(session)["attempted"] == 0

    charge = session.scalars(select(Charge).where(Charge.status == "failed")).first()
    assert charge.next_attempt_at is not None  # the column dunning never read
    charge.next_attempt_at = now_utc() - timedelta(minutes=1)
    session.add(charge)
    # The customer fixes their card in the meantime.
    from app.models.payment_method import PaymentMethod

    stored = session.get(PaymentMethod, payment_method_id)
    stored.meta = None
    session.add(stored)
    session.commit()

    report = billing_service.run_dunning(session)
    generator.close()

    assert report["attempted"] == 1 and report["recovered"] == 1
    invoices = client.get("/api/invoices", headers=headers).json()
    assert [invoice["status"] for invoice in invoices] == ["paid"]
    assert "recovered" in [
        charge["status"] for charge in client.get("/api/billing/charges", headers=headers).json()
    ]


# ---------------------------------------------------------------------------
# The three sold-but-unenforced feature entitlements
# ---------------------------------------------------------------------------


def test_a_team_org_cannot_create_an_api_key(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    blocked = client.post(
        "/api/api-keys", json={"label": "CI", "scopes": ["documents:read"], "mode": "live"}, headers=headers
    )
    assert blocked.status_code == 402, blocked.text
    detail = blocked.json()["detail"]
    assert detail["error"] == "feature_not_available"
    assert detail["feature"] == "api_access"
    assert detail["plan"] == "team"


def test_custom_branding_is_gated_on_the_entitlement(client: TestClient) -> None:
    """``custom_branding`` is sold on Business and up. The tenant profile PATCH
    accepts ``accent_color``/``logo_url``, so it has to ask."""
    headers = auth_headers(client)
    client.get("/api/billing/plans")

    blocked = client.patch(
        "/api/organizations/me", json={"accent_color": "#1d4ed8"}, headers=headers
    )
    assert blocked.status_code == 402, blocked.text
    detail = blocked.json()["detail"]
    assert detail["error"] == "feature_not_available"
    assert detail["feature"] == "custom_branding"

    blocked_logo = client.patch(
        "/api/organizations/me", json={"logo_url": "https://cdn.example.com/a.png"}, headers=headers
    )
    assert blocked_logo.status_code == 402

    # Non-branding fields on the same endpoint are untouched by the gate.
    assert (
        client.patch("/api/organizations/me", json={"region": "eu-west-1"}, headers=headers).status_code
        == 200
    )

    upgrade_plan(client, headers, "business")
    allowed = client.patch(
        "/api/organizations/me",
        json={"accent_color": "#1d4ed8", "logo_url": "https://cdn.example.com/a.png"},
        headers=headers,
    )
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["accent_color"] == "#1d4ed8"


def test_a_team_org_cannot_register_a_webhook_endpoint(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    blocked = client.post(
        "/api/webhooks",
        json={"url": "https://hooks.example.com/sf", "event_types": ["document.completed"]},
        headers=headers,
    )
    assert blocked.status_code == 402, blocked.text
    assert blocked.json()["detail"]["feature"] == "webhooks"


def test_business_unlocks_both(client: TestClient) -> None:
    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")
    assert (
        client.post(
            "/api/api-keys", json={"label": "CI", "scopes": ["documents:read"], "mode": "live"}, headers=headers
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/webhooks",
            json={"url": "https://hooks.example.com/sf", "event_types": ["document.completed"]},
            headers=headers,
        ).status_code
        == 201
    )


def test_custom_branding_is_checkable(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    session, generator = _db()
    with pytest.raises(HTTPException) as excinfo:
        entitlement_service.check_custom_branding(session, org_id)
    generator.close()
    assert excinfo.value.status_code == 402
    assert excinfo.value.detail["feature"] == "custom_branding"


# ---------------------------------------------------------------------------
# Storage quota and the sequential-recipient bypass
# ---------------------------------------------------------------------------


def _shrink_entitlement(key: str, value) -> None:
    session, generator = _db()
    plan = session.scalar(select(Plan).where(Plan.code == "team"))
    entitlements = dict(plan.entitlements)
    entitlements[key] = value
    plan.entitlements = entitlements
    session.add(plan)
    session.commit()
    generator.close()


def test_storage_quota_is_enforced_on_upload(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    document_id = client.post("/api/documents", json={"title": "Doc"}, headers=headers).json()["id"]

    _shrink_entitlement(ENTITLEMENT_MAX_STORAGE_BYTES, 10)
    blocked = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        files={"upload": ("a.pdf", pdf_bytes, "application/pdf")},
        headers=headers,
    )
    assert blocked.status_code == 402, blocked.text
    assert blocked.json()["detail"]["limit"] == ENTITLEMENT_MAX_STORAGE_BYTES


def test_sequential_single_recipient_adds_cannot_beat_the_cap(client: TestClient) -> None:
    """``check_entitlement`` alone hard-codes ``used = 0`` for this key, so one
    recipient at a time never trips a limit of three. ``check_recipient_capacity``
    counts what is already attached, which is what an incremental add path must
    call."""
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    document_id = client.post("/api/documents", json={"title": "Doc"}, headers=headers).json()["id"]
    for index in range(3):
        created = client.post(
            f"/api/documents/{document_id}/recipients",
            json={"name": f"Signer {index}", "email": f"s{index}@example.com", "role": "sign"},
            headers=headers,
        )
        assert created.status_code == 201, created.text

    session, generator = _db()
    # The old check waves the fourth single add straight through...
    entitlement_service.check_entitlement(
        session, org_id, ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT, amount=1
    )
    # ...the document-aware one does not.
    with pytest.raises(HTTPException) as excinfo:
        entitlement_service.check_recipient_capacity(
            session, org_id, document_id=document_id, additional=1
        )
    generator.close()
    assert excinfo.value.status_code == 402
    assert excinfo.value.detail["limit"] == ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT
    assert excinfo.value.detail["current_usage"] == 0
    assert excinfo.value.detail["requested"] == 4


# ---------------------------------------------------------------------------
# organizations.subscription_status is no longer a stale second copy
# ---------------------------------------------------------------------------


def test_cancelling_writes_through_to_the_organization_row(client: TestClient) -> None:
    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")
    org_id = _org_id(client, headers)

    session, generator = _db()
    org = session.get(Organization, org_id)
    session.refresh(org)
    assert org.subscription_tier == "business"
    assert org.subscription_status == SubscriptionStatus.active
    generator.close()

    client.post("/api/billing/cancel", json={"at_period_end": False}, headers=headers)

    session, generator = _db()
    org = session.get(Organization, org_id)
    session.refresh(org)
    generator.close()
    assert org.subscription_status == SubscriptionStatus.canceled


# ---------------------------------------------------------------------------
# Honest catalogue
# ---------------------------------------------------------------------------


def test_marketing_copy_quotes_the_enforced_entitlement(client: TestClient) -> None:
    plans = {plan["code"]: plan for plan in client.get("/api/billing/plans").json()}
    team = plans["team"]
    envelopes = next(line for line in team["marketing_lines"] if line["label"] == "Envelopes")
    assert "5" in envelopes["value"]
    assert team["entitlements"]["max_documents_per_month"] == 5
    # Nothing rate-limits the public API, so nothing may advertise a rate.
    assert not any(
        "rps" in str(line["value"]).lower()
        for plan in plans.values()
        for line in plan["marketing_lines"] or []
    )


def test_annual_billing_actually_applies_the_advertised_discount(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    client.patch("/api/billing/settings", json={"cycle": "annual"}, headers=headers)
    upcoming = client.get("/api/billing/upcoming-invoice", headers=headers).json()
    assert upcoming["cycle"] == "annual"
    assert upcoming["total_cents"] == round(1200 * 12 * 0.88)
    assert upcoming["total_cents"] < 1200 * 12


# ---------------------------------------------------------------------------
# Provider configuration must fail loudly
# ---------------------------------------------------------------------------


def test_an_unknown_billing_provider_raises_instead_of_disabling_billing(monkeypatch) -> None:
    from app.core import config as config_module

    settings = config_module.get_settings()
    monkeypatch.setattr(settings, "billing_provider", "strpe", raising=False)
    with pytest.raises(BillingProviderMisconfigured):
        get_payment_provider()


def test_production_refuses_the_shipped_webhook_secret(monkeypatch) -> None:
    from app.core import config as config_module

    settings = config_module.get_settings()
    monkeypatch.setattr(settings, "environment", "production", raising=False)
    monkeypatch.setattr(settings, "billing_provider", "stripe", raising=False)
    monkeypatch.setattr(settings, "billing_webhook_secret", "dev-billing-webhook-secret", raising=False)
    with pytest.raises(InsecureBillingWebhookSecret):
        verify_billing_webhook_secret_configured()

    monkeypatch.setattr(settings, "billing_webhook_secret", "x" * 40, raising=False)
    verify_billing_webhook_secret_configured()  # no raise

    monkeypatch.setattr(settings, "billing_provider", "null", raising=False)
    with pytest.raises(BillingProviderMisconfigured):
        verify_billing_webhook_secret_configured()


def test_development_is_left_alone_by_the_guard() -> None:
    verify_billing_webhook_secret_configured()  # ENVIRONMENT=test
    assert isinstance(get_payment_provider(), NullPaymentProvider)


# ---------------------------------------------------------------------------
# The Stripe adapter, driven entirely through its transport seam
# ---------------------------------------------------------------------------


class FakeStripe:
    """Canned Stripe responses. No network, no SDK, no credentials.

    Keys are either a bare path (``/v1/prices``) or a method-qualified one
    (``POST /v1/prices``); the qualified form wins, which is what lets the
    provisioning tests distinguish the list call from the create call on the
    same endpoint. A value may also be a *list* of responses, consumed in
    order, so a resource can be absent on the first read and present on the
    second -- which is exactly what idempotency means here.
    """

    def __init__(self, responses: dict[str, tuple[int, dict] | list[tuple[int, dict]]]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict]] = []

    def __call__(self, method, url, params, headers):
        path = url.split("api.stripe.com", 1)[-1]
        self.calls.append((method, path, params))
        assert headers["Authorization"].startswith("Bearer sk_")
        canned = self.responses.get(f"{method} {path}", self.responses.get(path))
        if canned is None:
            return (200, {"id": "obj_default"})
        if isinstance(canned, list):
            return canned.pop(0) if len(canned) > 1 else canned[0]
        return canned

    def paths(self, method: str | None = None) -> list[str]:
        return [p for m, p, _ in self.calls if method is None or m == method]

    def params_for(self, method: str, path: str) -> dict:
        for m, p, params in self.calls:
            if m == method and p == path:
                return params
        raise AssertionError(f"{method} {path} was never called; got {self.calls}")


@pytest.fixture()
def stripe_provider(monkeypatch):
    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")
    return provider


def test_stripe_requires_a_secret_key(monkeypatch) -> None:
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    with pytest.raises(StripeConfigurationError):
        StripePaymentProvider()


def test_stripe_charges_an_invoice_through_the_transport_seam(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    fake = FakeStripe({"/v1/payment_intents": (200, {"id": "pi_123", "status": "succeeded"})})
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))

    invoice = Invoice(
        id="inv_1",
        organization_id="org_1",
        number="INV-2026-0001",
        currency="USD",
        total_cents=5600,
        amount_paid_cents=0,
    )
    from app.models.payment_method import PaymentMethod

    payment_method = PaymentMethod(
        organization_id="org_1", type="card", label="Visa •••• 4242",
        provider_payment_method_id="pm_abc",
    )
    result = stripe_provider.charge_invoice(invoice=invoice, payment_method=payment_method)
    assert result.succeeded and result.provider_payment_id == "pi_123"
    method, path, params = fake.calls[0]
    assert (method, path) == ("POST", "/v1/payment_intents")
    assert params["amount"] == "5600" and params["payment_method"] == "pm_abc"
    assert params["off_session"] == "true"


def test_stripe_maps_a_decline_to_a_failed_charge(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    fake = FakeStripe(
        {
            "/v1/payment_intents": (
                402,
                {"error": {"code": "card_declined", "message": "Your card was declined."}},
            )
        }
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    from app.models.payment_method import PaymentMethod

    invoice = Invoice(
        id="inv_2",
        organization_id="org_1",
        number="INV-2026-0002",
        currency="USD",
        total_cents=100,
        amount_paid_cents=0,
    )
    result = stripe_provider.charge_invoice(
        invoice=invoice,
        payment_method=PaymentMethod(
            organization_id="org_1", type="card", label="Visa", provider_payment_method_id="pm_x"
        ),
    )
    assert not result.succeeded and result.decline_code == "card_declined"


def test_stripe_webhook_signature_is_verified_with_a_timestamp(
    stripe_provider: StripePaymentProvider,
) -> None:
    body = json.dumps({"id": "evt_1", "type": "invoice.paid", "data": {"object": {}}}).encode()
    timestamp = str(int(now_utc().timestamp()))
    digest = hmac.new(b"whsec_fake", f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()

    assert stripe_provider.verify_webhook(raw_body=body, signature=f"t={timestamp},v1={digest}")
    assert not stripe_provider.verify_webhook(raw_body=body, signature=f"t={timestamp},v1=deadbeef")
    assert not stripe_provider.verify_webhook(raw_body=body, signature=None)
    # A replayed signature outside the tolerance window is rejected.
    stale = str(int(now_utc().timestamp()) - 3600)
    stale_digest = hmac.new(b"whsec_fake", f"{stale}.".encode() + body, hashlib.sha256).hexdigest()
    assert not stripe_provider.verify_webhook(raw_body=body, signature=f"t={stale},v1={stale_digest}")


def test_stripe_events_are_translated_to_the_neutral_shape(
    stripe_provider: StripePaymentProvider,
) -> None:
    payload = {
        "id": "evt_9",
        "type": "customer.subscription.updated",
        "data": {
            "object": {
                "object": "subscription",
                "id": "sub_42",
                "current_period_end": 1800000000,
                "metadata": {"organization_id": "org_7", "plan_code": "business"},
            }
        },
    }
    event = stripe_provider.parse_webhook(raw_body=json.dumps(payload).encode())
    assert event.event_type == "subscription.updated"  # the type _apply_event handles
    assert event.subscription_id == "sub_42"
    assert event.organization_id == "org_7"
    assert event.plan_code == "business"
    assert event.period_end is not None


# ---------------------------------------------------------------------------
# Embedded Checkout, setup mode, and the guard rails around a live key
# ---------------------------------------------------------------------------


def test_embedded_checkout_returns_a_client_secret_and_no_url(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    """Embedded mode is what puts Stripe's iframe inside our own modal.

    It returns a client secret and *no* url — the two are alternatives, and a
    fabricated url would send the browser somewhere that settles nothing.
    """
    fake = FakeStripe(
        {
            "/v1/checkout/sessions": (
                200,
                {
                    "id": "cs_test_embedded",
                    "ui_mode": "embedded",
                    "mode": "subscription",
                    "client_secret": "cs_test_embedded_secret",
                    "customer": "cus_1",
                    "livemode": False,
                },
            )
        }
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))

    plan = Plan(code="business", name="Business", price_cents=2800, external_price_id="price_123")
    session = stripe_provider.create_checkout_session(
        organization_id="org_1",
        plan=plan,
        success_url="https://app.test/billing",
        cancel_url="https://app.test/billing",
        ui_mode="embedded",
        return_url="https://app.test/billing",
    )

    assert session.client_secret == "cs_test_embedded_secret"
    assert session.url is None
    assert session.ui_mode == "embedded" and session.livemode is False

    params = fake.params_for("POST", "/v1/checkout/sessions")
    assert params["ui_mode"] == "embedded"
    # Stripe substitutes the id on the way back, which is how the landing page
    # knows which session to confirm server-side.
    assert params["return_url"] == "https://app.test/billing?session_id={CHECKOUT_SESSION_ID}"
    # Embedded mode rejects these outright.
    assert "success_url" not in params and "cancel_url" not in params
    assert params["subscription_data[metadata][organization_id]"] == "org_1"


def test_hosted_checkout_still_returns_a_url(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    fake = FakeStripe(
        {"/v1/checkout/sessions": (200, {"id": "cs_hosted", "url": "https://checkout.stripe.com/x"})}
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    plan = Plan(code="business", name="Business", price_cents=2800, external_price_id="price_123")

    session = stripe_provider.create_checkout_session(
        organization_id="org_1",
        plan=plan,
        success_url="https://app.test/ok",
        cancel_url="https://app.test/no",
    )
    assert session.url == "https://checkout.stripe.com/x"
    assert session.client_secret is None
    params = fake.params_for("POST", "/v1/checkout/sessions")
    assert params["success_url"] == "https://app.test/ok"
    assert "ui_mode" not in params


def test_a_plan_without_a_stripe_price_id_is_a_409(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(FakeStripe({})))
    plan = Plan(code="business", name="Business", price_cents=2800, external_price_id=None)
    with pytest.raises(HTTPException) as caught:
        stripe_provider.create_checkout_session(
            organization_id="org_1", plan=plan, success_url="u", cancel_url="u"
        )
    assert caught.value.status_code == 409
    assert "provision_stripe_plans" in caught.value.detail


def test_setup_mode_saves_a_card_without_a_purchase(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    """The replacement for the deleted card form: a session that stores an
    instrument and takes no money. Stripe requires a customer for it."""
    fake = FakeStripe(
        {
            "/v1/customers": (200, {"id": "cus_new"}),
            "/v1/checkout/sessions": (
                200,
                {
                    "id": "cs_setup",
                    "ui_mode": "embedded",
                    "mode": "setup",
                    "client_secret": "cs_setup_secret",
                    "customer": "cus_new",
                },
            ),
        }
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))

    session = stripe_provider.create_setup_session(
        organization_id="org_1", customer_id=None, return_url="https://app.test/billing"
    )
    assert session.mode == "setup"
    assert session.client_secret == "cs_setup_secret"
    assert session.customer_id == "cus_new"
    # A customer was created lazily, because there was not one yet.
    assert "/v1/customers" in fake.paths("POST")
    params = fake.params_for("POST", "/v1/checkout/sessions")
    assert params["mode"] == "setup" and params["customer"] == "cus_new"


def test_setup_mode_reuses_the_customer_already_on_the_subscription(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    fake = FakeStripe(
        {"/v1/checkout/sessions": (200, {"id": "cs_2", "ui_mode": "embedded", "mode": "setup", "client_secret": "sec"})}
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))

    stripe_provider.create_setup_session(
        organization_id="org_1", customer_id="cus_existing", return_url="https://app.test/billing"
    )
    # No second customer minted -- otherwise the org's cards scatter across
    # several customers and none of them is the one we charge.
    assert "/v1/customers" not in fake.paths("POST")
    assert fake.params_for("POST", "/v1/checkout/sessions")["customer"] == "cus_existing"


def test_a_setup_intent_webhook_saves_the_payment_method(client: TestClient, monkeypatch) -> None:
    """The end of the add-a-card flow: the instrument the user typed into
    Stripe's iframe shows up on GET /api/billing/payment-methods."""
    headers = auth_headers(client)
    organization_id = _org_id(client, headers)
    assert client.get("/api/billing/payment-methods", headers=headers).json() == []

    fake = FakeStripe(
        {
            "/v1/payment_methods/pm_saved": (
                200,
                {
                    "id": "pm_saved",
                    "customer": "cus_1",
                    "card": {"brand": "visa", "last4": "4242", "exp_month": 12, "exp_year": 2030, "country": "US"},
                },
            )
        }
    )
    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    monkeypatch.setattr(billing_service, "_provider", provider, raising=False)

    payload = json.dumps(
        {
            "id": "evt_setup_1",
            "type": "setup_intent.succeeded",
            "data": {
                "object": {
                    "object": "setup_intent",
                    "id": "seti_1",
                    "payment_method": "pm_saved",
                    "customer": "cus_1",
                    "metadata": {"organization_id": organization_id},
                }
            },
        }
    ).encode()
    timestamp = str(int(now_utc().timestamp()))
    digest = hmac.new(b"whsec_fake", f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()

    accepted = client.post(
        "/api/billing/webhook",
        content=payload,
        headers={"X-Signature": f"t={timestamp},v1={digest}", "content-type": "application/json"},
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "processed"

    stored = client.get("/api/billing/payment-methods", headers=headers).json()
    assert len(stored) == 1
    # The display data is Stripe's, not something this app invented.
    assert stored[0]["brand"] == "Visa" and stored[0]["last4"] == "4242"
    assert stored[0]["exp_year"] == 2030 and stored[0]["is_default"] is True
    # Already attached to the customer by the setup session; re-attaching it
    # (to a freshly minted second customer, no less) would orphan it.
    assert "/v1/payment_methods/pm_saved/attach" not in fake.paths("POST")


def test_the_same_saved_card_arriving_twice_is_stored_once(client: TestClient, monkeypatch) -> None:
    headers = auth_headers(client)
    organization_id = _org_id(client, headers)
    fake = FakeStripe(
        {
            "/v1/payment_methods/pm_saved": (
                200,
                {"id": "pm_saved", "customer": "cus_1", "card": {"brand": "visa", "last4": "4242"}},
            )
        }
    )
    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    monkeypatch.setattr(billing_service, "_provider", provider, raising=False)

    for event_id in ("evt_a", "evt_b"):
        payload = json.dumps(
            {
                "id": event_id,
                "type": "setup_intent.succeeded",
                "data": {
                    "object": {
                        "object": "setup_intent",
                        "payment_method": "pm_saved",
                        "customer": "cus_1",
                        "metadata": {"organization_id": organization_id},
                    }
                },
            }
        ).encode()
        timestamp = str(int(now_utc().timestamp()))
        digest = hmac.new(b"whsec_fake", f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()
        client.post(
            "/api/billing/webhook",
            content=payload,
            headers={"X-Signature": f"t={timestamp},v1={digest}", "content-type": "application/json"},
        )

    # Two deliveries, one card. The user must not be shown the same card twice.
    assert len(client.get("/api/billing/payment-methods", headers=headers).json()) == 1


def test_a_return_url_landing_is_confirmed_with_stripe_not_believed(
    client: TestClient, monkeypatch
) -> None:
    """The browser arriving back is not a receipt. An `open` session stays
    unapplied however many times the user reloads the landing page."""
    headers = auth_headers(client)
    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")
    fake = FakeStripe({"/v1/checkout/sessions/cs_open": (200, {"id": "cs_open", "status": "open", "mode": "setup"})})
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    monkeypatch.setattr(billing_service, "_provider", provider, raising=False)

    response = client.get("/api/billing/checkout/cs_open", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "open" and body["applied"] is False
    assert client.get("/api/billing/payment-methods", headers=headers).json() == []


def test_a_completed_setup_session_stores_the_card_on_confirmation(
    client: TestClient, monkeypatch
) -> None:
    headers = auth_headers(client)
    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")
    fake = FakeStripe(
        {
            "/v1/checkout/sessions/cs_done": (
                200,
                {
                    "id": "cs_done",
                    "status": "complete",
                    "mode": "setup",
                    "customer": "cus_9",
                    "setup_intent": {"id": "seti_9", "payment_method": "pm_9"},
                },
            ),
            "/v1/payment_methods/pm_9": (
                200,
                {"id": "pm_9", "customer": "cus_9", "card": {"brand": "mastercard", "last4": "4444"}},
            ),
        }
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    monkeypatch.setattr(billing_service, "_provider", provider, raising=False)

    body = client.get("/api/billing/checkout/cs_done", headers=headers).json()
    assert body["applied"] is True and body["payment_method_id"]

    stored = client.get("/api/billing/payment-methods", headers=headers).json()
    assert [pm["last4"] for pm in stored] == ["4444"]


def test_a_live_key_in_development_is_refused(monkeypatch) -> None:
    """The one misconfiguration that spends real money by accident."""
    monkeypatch.setenv("ENVIRONMENT", "development")
    with pytest.raises(LiveStripeKeyOutsideProduction) as caught:
        StripePaymentProvider(secret_key="sk_live_definitely_not_a_real_key")
    assert "LIVE key" in str(caught.value)
    # …and a test key in the same environment is fine.
    assert StripePaymentProvider(secret_key="sk_test_ok").mode == "test"


def test_a_key_that_is_not_a_stripe_key_is_refused() -> None:
    with pytest.raises(StripeConfigurationError):
        StripePaymentProvider(secret_key="hunter2")


def test_a_live_key_is_allowed_in_production(monkeypatch) -> None:
    from app.core import config as config_module

    monkeypatch.setattr(config_module, "is_production", lambda env: True)
    import app.services.billing_service as billing_module

    monkeypatch.setattr(billing_module, "is_production", lambda env: True, raising=False)
    # `verify_stripe_key_is_safe_here` imports it locally, so patch the source.
    provider = StripePaymentProvider(secret_key="sk_live_ok")
    assert provider.mode == "live" and provider.is_live_key is True


def test_the_startup_guard_ignores_a_non_stripe_provider(monkeypatch) -> None:
    # BILLING_PROVIDER=null has nothing to check; the guard must not raise.
    verify_payment_provider_configured()


# ---------------------------------------------------------------------------
# Provisioning script
# ---------------------------------------------------------------------------


def _provision_module():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "scripts" / "provision_stripe_plans.py"
    spec = importlib.util.spec_from_file_location("provision_stripe_plans", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_provisioning_writes_price_ids_back_and_is_idempotent(client: TestClient, monkeypatch) -> None:
    """Re-running must find what it made rather than making it again — a
    duplicated price catalogue is the failure mode this guards against."""
    provision = _provision_module()
    db, generator = _db()
    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")

    created_price_calls: list[dict] = []

    class Account:
        """A minimal Stripe: products and prices remembered by their key."""

        def __init__(self) -> None:
            self.products: dict[str, dict] = {}
            self.prices: dict[str, dict] = {}
            self.calls: list[tuple[str, str]] = []

        def __call__(self, method, url, params, headers):
            path = url.split("api.stripe.com", 1)[-1]
            self.calls.append((method, path))
            if method == "GET" and path.startswith("/v1/products/"):
                product_id = path.rsplit("/", 1)[-1]
                if product_id in self.products:
                    return 200, self.products[product_id]
                return 404, {"error": {"message": "No such product", "code": "resource_missing"}}
            if method == "POST" and path == "/v1/products":
                self.products[params["id"]] = {"id": params["id"], "name": params["name"]}
                return 200, self.products[params["id"]]
            if method == "GET" and path == "/v1/prices":
                key = params["lookup_keys[0]"]
                return 200, {"data": [self.prices[key]] if key in self.prices else []}
            if method == "POST" and path == "/v1/prices":
                created_price_calls.append(params)
                key = params["lookup_key"]
                self.prices[key] = {"id": f"price_{key}", "active": True, "lookup_key": key}
                return 200, self.prices[key]
            raise AssertionError(f"unexpected {method} {path}")

    account = Account()
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(account))

    first = provision.provision(db, provider, echo=lambda *a: None)
    assert set(first) >= {"team", "business", "enterprise"}

    plans = {plan.code: plan for plan in db.scalars(select(Plan)).all()}
    for code, price_id in first.items():
        assert plans[code].external_price_id == price_id
        # The per-seat figure, because the Stripe subscription carries the
        # quantity — pricing the whole plan would over-charge every seat.
        assert str(plans[code].seat_price_cents or plans[code].price_cents) in price_id

    made_first_time = len(created_price_calls)
    products_first_time = len(account.products)

    second = provision.provision(db, provider, echo=lambda *a: None)
    assert second == first
    assert len(created_price_calls) == made_first_time  # nothing re-created
    assert len(account.products) == products_first_time
    generator.close()


def test_provisioning_refuses_a_live_key(client: TestClient, monkeypatch) -> None:
    provision = _provision_module()
    import app.services.billing_service as billing_module

    monkeypatch.setattr(billing_module, "verify_stripe_key_is_safe_here", lambda *a, **k: None)
    provider = StripePaymentProvider(secret_key="sk_live_pretend", webhook_secret="whsec_fake")
    db, generator = _db()
    with pytest.raises(provision.LiveAccountRefused):
        provision.provision(db, provider, echo=lambda *a: None)
    generator.close()


def test_provisioning_dry_run_touches_nothing(client: TestClient, monkeypatch) -> None:
    provision = _provision_module()
    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")

    def refuse(*args, **kwargs):
        raise AssertionError("--dry-run must not call Stripe")

    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(refuse))
    db, generator = _db()
    lines: list[str] = []
    assert provision.provision(db, provider, dry_run=True, echo=lines.append) == {}
    assert any("would ensure product" in line for line in lines)
    assert all(plan.external_price_id is None for plan in db.scalars(select(Plan)).all())
    generator.close()


# --------------------------------------------------------------------------
# set_default_payment_method used to be a no-op on the Stripe adapter: the ABC
# signature carried no customer id, so the local default moved and the
# provider's never did. Stripe bills subscription renewals against
# `invoice_settings.default_payment_method`, and this application always names
# the instrument explicitly when *it* charges -- so the divergence stayed
# invisible until something billed on Stripe's side.
def test_stripe_sets_the_customers_default_payment_method(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    fake = FakeStripe({"/v1/customers/cus_123": (200, {"id": "cus_123"})})
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    from app.models.payment_method import PaymentMethod

    stripe_provider.set_default_payment_method(
        organization_id="org_1",
        payment_method=PaymentMethod(
            organization_id="org_1", type="card", label="Visa •••• 4242",
            provider_payment_method_id="pm_abc",
        ),
        customer_id="cus_123",
    )
    params = fake.params_for("POST", "/v1/customers/cus_123")
    assert params["invoice_settings[default_payment_method]"] == "pm_abc"


def test_stripe_default_payment_method_is_a_no_op_without_a_customer(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    """No customer exists until the org has been through checkout.

    The instrument is still persisted locally, and this must not provision a
    Stripe customer as a side effect of a settings change.
    """
    fake = FakeStripe({})
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))
    from app.models.payment_method import PaymentMethod

    stripe_provider.set_default_payment_method(
        organization_id="org_1",
        payment_method=PaymentMethod(
            organization_id="org_1", type="card", label="Visa •••• 4242",
            provider_payment_method_id="pm_abc",
        ),
        customer_id=None,
    )
    assert fake.calls == []


# ---------------------------------------------------------------------------
# The provider's own invoices are mirrored locally
#
# A subscription is billed by the provider, not by us: no local code path runs
# when the customer's card is charged, so `invoices` stayed empty until
# `run_renewals` closed the first period about a month later. The webhook now
# mirrors the provider's invoice, and the backfill recovers the ones that
# settled before it did.
# ---------------------------------------------------------------------------


def _paid_provider_invoice(**overrides) -> ProviderInvoice:
    defaults = dict(
        provider_invoice_id="in_stripe_1",
        currency="USD",
        subtotal_cents=1200,
        tax_cents=0,
        total_cents=1200,
        amount_paid_cents=1200,
        number="C0FFEE-0001",
        status=InvoiceStatus.paid,
        hosted_url="https://invoice.stripe.com/i/in_stripe_1",
        payment_intent_id="pi_stripe_1",
        period_start=now_utc() - timedelta(days=1),
        period_end=now_utc() + timedelta(days=29),
        issued_at=now_utc() - timedelta(days=1),
        paid_at=now_utc() - timedelta(days=1),
        line_items=[
            {"description": "Business (monthly)", "quantity": 1, "unit_cents": 1200, "amount_cents": 1200}
        ],
    )
    defaults.update(overrides)
    return ProviderInvoice(**defaults)  # type: ignore[arg-type]


def _invoice_event(org_id: str, *, event_id: str, invoice: ProviderInvoice, event_type: str = "invoice.paid"):
    from app.services.billing_service import ProviderEvent

    return ProviderEvent(
        event_id=event_id,
        event_type=event_type,
        provider=billing_service.provider.name,
        organization_id=org_id,
        invoice=invoice,
    )


def test_stripe_invoice_object_is_translated_to_the_neutral_shape(
    stripe_provider: StripePaymentProvider,
) -> None:
    """The figures come from Stripe, which is the party that took the money."""
    payload = {
        "id": "evt_inv",
        "type": "invoice.payment_succeeded",
        "data": {
            "object": {
                "object": "invoice",
                "id": "in_1",
                "number": "C0FFEE-0001",
                "currency": "usd",
                "status": "paid",
                "subtotal": 1200,
                "tax": 96,
                "total": 1296,
                "amount_paid": 1296,
                "amount_due": 1296,
                "created": 1757000000,
                "hosted_invoice_url": "https://invoice.stripe.com/i/in_1",
                "payment_intent": "pi_1",
                "status_transitions": {"paid_at": 1757000100},
                "customer": {"id": "cus_1"},
                "metadata": {"organization_id": "org_7"},
                "lines": {
                    "data": [
                        {
                            "description": "Business x 2",
                            "quantity": 2,
                            "amount": 1200,
                            "price": {"unit_amount": 600},
                            "period": {"start": 1757000000, "end": 1759592000},
                            "subscription": "sub_9",
                        }
                    ]
                },
            }
        },
    }
    event = stripe_provider.parse_webhook(raw_body=json.dumps(payload).encode())

    assert event.event_type == "invoice.paid"
    # The invoice object carries no `subscription` of its own in newer API
    # versions -- it hangs off the line item, and losing it would leave the
    # event unattachable to a subscription.
    assert event.subscription_id == "sub_9"

    invoice = event.invoice
    assert invoice is not None
    assert invoice.provider_invoice_id == "in_1"
    assert invoice.number == "C0FFEE-0001"
    assert invoice.currency == "USD"
    assert invoice.status == InvoiceStatus.paid
    assert (invoice.subtotal_cents, invoice.tax_cents, invoice.total_cents) == (1200, 96, 1296)
    assert invoice.amount_paid_cents == 1296
    assert invoice.hosted_url == "https://invoice.stripe.com/i/in_1"
    assert invoice.payment_intent_id == "pi_1"
    assert invoice.customer_id == "cus_1"
    assert invoice.organization_id == "org_7"
    assert invoice.paid_at is not None and invoice.period_start is not None
    assert invoice.line_items == [
        {"description": "Business x 2", "quantity": 2, "unit_cents": 600, "amount_cents": 1200}
    ]


def test_a_paid_provider_invoice_appears_in_the_tenant_invoice_list(client: TestClient) -> None:
    """The regression itself: money moved, so an invoice must exist."""
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    db, generator = _db()

    assert client.get("/api/invoices", headers=headers).json() == []

    billing_service._apply_event(db, _invoice_event(org_id, event_id="evt_p1", invoice=_paid_provider_invoice()))
    db.commit()

    invoices = client.get("/api/invoices", headers=headers).json()
    assert len(invoices) == 1
    invoice = invoices[0]
    assert invoice["status"] == InvoiceStatus.paid
    assert invoice["total_cents"] == 1200
    assert invoice["amount_paid_cents"] == 1200
    assert invoice["amount_due_cents"] == 0
    assert invoice["number"] == "C0FFEE-0001"  # the provider's own number
    assert invoice["hosted_url"] == "https://invoice.stripe.com/i/in_stripe_1"
    assert invoice["provider_payment_intent_id"] == "pi_stripe_1"
    assert invoice["paid_at"] is not None
    assert invoice["period_label"]

    # And a receipt is available, which is only true of a settled invoice.
    receipt = client.get(f"/api/invoices/{invoice['id']}/receipt", headers=headers)
    assert receipt.status_code == 200
    generator.close()


def test_mirroring_the_same_provider_invoice_twice_keeps_one_row(client: TestClient) -> None:
    """Stripe sends both ``invoice.paid`` and ``invoice.payment_succeeded``.

    Two different event ids, so webhook de-duplication does not catch it: the
    guard has to be the provider's invoice id.
    """
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    db, generator = _db()

    open_invoice = _paid_provider_invoice(status=InvoiceStatus.open, amount_paid_cents=0, paid_at=None)
    billing_service._apply_event(db, _invoice_event(org_id, event_id="evt_a", invoice=open_invoice))
    billing_service._apply_event(db, _invoice_event(org_id, event_id="evt_b", invoice=_paid_provider_invoice()))
    db.commit()

    invoices = client.get("/api/invoices", headers=headers).json()
    assert len(invoices) == 1
    # The later state wins: the row settles rather than duplicating.
    assert invoices[0]["status"] == InvoiceStatus.paid
    assert invoices[0]["amount_paid_cents"] == 1200
    generator.close()


def test_a_locally_voided_invoice_is_not_resurrected_by_the_provider(client: TestClient) -> None:
    """Voiding is a deliberate act by an admin and outranks a redelivery."""
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    db, generator = _db()

    billing_service._apply_event(
        db,
        _invoice_event(
            org_id,
            event_id="evt_v1",
            invoice=_paid_provider_invoice(status=InvoiceStatus.open, amount_paid_cents=0, paid_at=None),
        ),
    )
    db.commit()
    row = db.scalar(select(Invoice).where(Invoice.provider_invoice_id == "in_stripe_1"))
    assert row is not None
    row.status = InvoiceStatus.void
    db.add(row)
    db.commit()

    billing_service._apply_event(db, _invoice_event(org_id, event_id="evt_v2", invoice=_paid_provider_invoice()))
    db.commit()

    db.refresh(row)
    assert row.status == InvoiceStatus.void
    generator.close()


def test_backfill_recovers_invoices_that_settled_before_the_mirror_existed(
    monkeypatch, client: TestClient
) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    db, generator = _db()

    subscription = billing_service.get_or_create_subscription(db, org_id)
    subscription.provider_customer_id = "cus_backfill"
    db.add(subscription)
    db.commit()

    remote = [
        _paid_provider_invoice(provider_invoice_id="in_old_1", number="C0FFEE-0001"),
        _paid_provider_invoice(provider_invoice_id="in_old_2", number="C0FFEE-0002"),
        # A draft has not been charged and is not an invoice the tenant owes.
        _paid_provider_invoice(provider_invoice_id="in_draft", number=None, status=InvoiceStatus.draft),
    ]
    monkeypatch.setattr(
        type(billing_service.provider), "list_invoices", lambda self, *, customer_id, limit=100: remote
    )

    report = billing_service.backfill_provider_invoices(db)
    assert (report["organizations"], report["created"], report["skipped"]) == (1, 2, 1)

    numbers = {row["number"] for row in client.get("/api/invoices", headers=headers).json()}
    assert numbers == {"C0FFEE-0001", "C0FFEE-0002"}

    # Re-running reconciles rather than duplicating.
    again = billing_service.backfill_provider_invoices(db)
    assert (again["created"], again["updated"]) == (0, 2)
    assert len(client.get("/api/invoices", headers=headers).json()) == 2
    generator.close()


def test_stripe_list_invoices_pages_through_the_transport_seam(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    page_one = {
        "has_more": True,
        "data": [{"object": "invoice", "id": "in_a", "status": "paid", "total": 1200, "amount_paid": 1200}],
    }
    page_two = {
        "has_more": False,
        "data": [{"object": "invoice", "id": "in_b", "status": "open", "total": 1200, "amount_paid": 0}],
    }
    fake = FakeStripe({"/v1/invoices": [(200, page_one), (200, page_two)]})
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(fake))

    invoices = stripe_provider.list_invoices(customer_id="cus_1")
    assert [invoice.provider_invoice_id for invoice in invoices] == ["in_a", "in_b"]
    assert invoices[0].status == InvoiceStatus.paid and invoices[1].status == InvoiceStatus.open
    assert fake.params_for("GET", "/v1/invoices")["customer"] == "cus_1"
    # The second page is anchored on the last id of the first, not re-read.
    assert fake.calls[1][2]["starting_after"] == "in_a"


# ---------------------------------------------------------------------------
# BIL-12: the two ceilings an invite can hit
# ---------------------------------------------------------------------------


def test_inviting_past_licensed_seats_asks_for_a_seat_not_an_upgrade(
    client: TestClient,
) -> None:
    """Within the plan's cap but out of bought seats: buy a seat.

    The invite path used to check only the plan cap, so an organization could
    quietly take on members it was not paying for.
    """
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    upgrade_plan(client, headers, "business")  # allows 10 users
    # Buy a seat, so the organization has an explicit licensed count. Until it
    # does there is no ceiling to hit -- an org that never bought seats is
    # governed by the plan cap alone, exactly as before.
    bought = client.post("/api/billing/seats", json={"delta": 1}, headers=headers)
    assert bought.status_code == 200, bought.text
    assert bought.json()["seats_licensed"] == 2

    # One user, two seats: the first invite fits.
    first = client.post("/api/invitations/", json={"email": "seated@example.com"}, headers=headers)
    assert first.status_code == 201, first.text
    session, generator = _db()
    session.add(
        User(
            organization_id=_org_id(client, headers),
            name="Seated",
            email="seated@example.com",
            password_hash=hash_password("strong-password"),
            role="sender",
        )
    )
    session.commit()
    generator.close()

    refused = client.post(
        "/api/invitations/", json={"email": "unseated@example.com"}, headers=headers
    )
    assert refused.status_code == 402, refused.text
    detail = refused.json()["detail"]
    assert detail["error"] == "seat_purchase_required"
    assert detail["seats_needed"] == 1
    # A real price, so the client can put a number on the button.
    assert detail["proration_cents"] > 0


def test_inviting_past_the_plan_cap_names_the_plan_that_fits(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    add_payment_method(client, headers)
    # Team allows two users; buy the second seat so the plan cap is what bites.
    client.post("/api/billing/seats", json={"delta": 1}, headers=headers)
    accepted = client.post(
        "/api/invitations/", json={"email": "second@example.com"}, headers=headers
    )
    assert accepted.status_code == 201, accepted.text

    session, generator = _db()
    session.add(
        User(
            organization_id=_org_id(client, headers),
            name="Second",
            email="second@example.com",
            password_hash=hash_password("strong-password"),
            role="sender",
        )
    )
    session.commit()
    generator.close()

    refused = client.post(
        "/api/invitations/", json={"email": "third@example.com"}, headers=headers
    )
    assert refused.status_code == 402, refused.text
    detail = refused.json()["detail"]
    assert detail["error"] == "plan_upgrade_required"
    # Not "upgrade your plan" -- which one.
    assert detail["suggested_plan"] == "business"


# ---------------------------------------------------------------------------
# REV-3: the balance tiles read Stripe, not the local charge ledger
# ---------------------------------------------------------------------------


def _balance_transport(
    *,
    default_currency: str = "usd",
    available: list[dict] | None = None,
    pending: list[dict] | None = None,
    payouts: dict[str, list[dict]] | None = None,
    disputes: list[dict] | None = None,
):
    """A Stripe responder for the four calls ``fetch_balance`` makes.

    ``FakeStripe`` keys on path alone, which cannot distinguish the two
    ``/v1/payouts`` reads (``status=pending`` and ``status=in_transit``), so
    this one dispatches on the query params too.
    """
    calls: list[tuple[str, str, dict]] = []

    def transport(method, url, params, headers):
        path = url.split("api.stripe.com", 1)[-1]
        calls.append((method, path, params))
        if path == "/v1/account":
            return 200, {"id": "acct_platform", "default_currency": default_currency}
        if path == "/v1/balance":
            return 200, {"available": available or [], "pending": pending or []}
        if path == "/v1/payouts":
            # Stripe 400s on any parameter it does not define for this
            # endpoint, and `currency` is one of them -- the reason the live
            # balance card failed with "Received unknown parameter: currency".
            assert set(params) <= {"limit", "status"}, f"unknown payout params: {sorted(params)}"
            return 200, {"data": (payouts or {}).get(params.get("status"), [])}
        if path == "/v1/disputes":
            return 200, {"data": disputes or []}
        raise AssertionError(f"unexpected Stripe call: {method} {path}")

    transport.calls = calls
    return transport


def test_stripe_balance_is_read_from_stripe_not_the_charge_ledger(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    transport = _balance_transport(
        available=[{"amount": 412_55, "currency": "usd"}],
        pending=[{"amount": 98_00, "currency": "usd"}],
        payouts={"pending": [{"amount": 400_00, "arrival_date": 1_800_000_000, "currency": "usd"}]},
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(transport))

    balance = stripe_provider.fetch_balance()

    assert balance.currency == "USD"
    assert balance.available_cents == 412_55
    assert balance.pending_cents == 98_00
    assert balance.next_payout_cents == 400_00
    assert balance.next_payout_at == datetime.fromtimestamp(1_800_000_000, tz=timezone.utc)
    # Pending money cannot leave before the next payout does.
    assert balance.pending_settles_at == balance.next_payout_at


def test_stripe_balance_reports_only_the_default_currency_and_names_the_rest(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    """Summing currencies would invent a number that is true of no account."""
    transport = _balance_transport(
        default_currency="eur",
        available=[{"amount": 100_00, "currency": "eur"}, {"amount": 900_00, "currency": "usd"}],
        pending=[{"amount": 0, "currency": "gbp"}],
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(transport))

    balance = stripe_provider.fetch_balance()

    assert balance.currency == "EUR"
    assert balance.available_cents == 100_00
    # A zero GBP balance is not a currency the account "holds".
    assert balance.other_currencies == ["USD"]


def test_stripe_balance_counts_only_unsettled_disputes(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    transport = _balance_transport(
        disputes=[
            {"amount": 50_00, "currency": "usd", "status": "needs_response"},
            {"amount": 25_00, "currency": "usd", "status": "under_review"},
            # Already decided: money is no longer at risk either way.
            {"amount": 999_00, "currency": "usd", "status": "won"},
            {"amount": 777_00, "currency": "usd", "status": "lost"},
        ],
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(transport))

    balance = stripe_provider.fetch_balance()

    assert balance.dispute_count == 2
    assert balance.disputes_cents == 75_00
    # No denominator Stripe will cheaply give us, so no rate is claimed.
    assert balance.dispute_rate_pct is None


def test_stripe_next_payout_is_the_soonest_across_both_statuses(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    """`in_transit` payouts arrive sooner than `pending` ones and must win."""
    transport = _balance_transport(
        payouts={
            "pending": [{"amount": 300_00, "arrival_date": 1_800_090_000, "currency": "usd"}],
            "in_transit": [{"amount": 120_00, "arrival_date": 1_800_000_000, "currency": "usd"}],
        },
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(transport))

    balance = stripe_provider.fetch_balance()

    assert balance.next_payout_cents == 120_00
    assert balance.next_payout_at == datetime.fromtimestamp(1_800_000_000, tz=timezone.utc)


def test_stripe_balance_with_no_scheduled_payout_is_unscheduled(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    transport = _balance_transport(available=[{"amount": 10_00, "currency": "usd"}])
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(transport))

    balance = stripe_provider.fetch_balance()

    assert balance.next_payout_cents == 0
    assert balance.next_payout_at is None
    assert balance.pending_settles_at is None


def test_null_provider_reports_no_balance_of_its_own() -> None:
    """It never holds money, so the caller must fall back to the ledger."""
    assert NullPaymentProvider().fetch_balance() is None


def test_stripe_next_payout_ignores_other_currencies(
    monkeypatch, stripe_provider: StripePaymentProvider
) -> None:
    """`/v1/payouts` cannot filter by currency, so the rows must be filtered.

    Sending `currency` to that endpoint is a 400, which is what took the whole
    balance card down rather than just this one figure.
    """
    transport = _balance_transport(
        payouts={
            "pending": [
                # Sooner, but denominated in a currency these tiles do not show.
                {"amount": 500_00, "arrival_date": 1_800_000_000, "currency": "eur"},
                {"amount": 70_00, "arrival_date": 1_800_050_000, "currency": "usd"},
            ],
        },
    )
    monkeypatch.setattr(StripePaymentProvider, "transport", staticmethod(transport))

    balance = stripe_provider.fetch_balance()

    assert balance.next_payout_cents == 70_00
    assert balance.next_payout_at == datetime.fromtimestamp(1_800_050_000, tz=timezone.utc)
