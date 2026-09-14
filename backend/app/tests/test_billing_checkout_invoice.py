"""The invoice for a plan bought through the provider's checkout.

A checkout-mode upgrade is charged by the provider, not by us: it raises and
settles its own invoice, and the session the browser comes back with carries no
copy of it. So the plan activated and no invoice existed anywhere the tenant or
the platform admin could look -- unless an `invoice.paid` webhook happened to
reach the install, which for a self-hosted one may be never.

Confirming a checkout now mirrors the provider's invoices for that customer.
What is pinned here is that the invoice lands, that mirroring twice does not
bill twice, and that a provider that cannot answer still leaves the purchase
applied -- the invoice is the record of the charge, not the thing gating it.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.invoice import Invoice, InvoiceStatus
from app.models.mixins import now_utc
from app.models.subscription import Subscription
from app.services import billing_service as billing_module
from app.services.billing_service import (
    CheckoutSessionStatus,
    NullPaymentProvider,
    ProviderInvoice,
    billing_service,
)
from app.tests.conftest import auth_headers


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


def _remote_invoice(provider_invoice_id: str = "in_test_1") -> ProviderInvoice:
    moment = now_utc()
    return ProviderInvoice(
        provider_invoice_id=provider_invoice_id,
        number="STRIPE-0001",
        currency="usd",
        subtotal_cents=4900,
        tax_cents=0,
        total_cents=4900,
        amount_paid_cents=4900,
        status=InvoiceStatus.paid,
        period_start=moment,
        period_end=moment + timedelta(days=30),
        issued_at=moment,
        due_at=moment,
        paid_at=moment,
        line_items=[{"description": "Team — monthly", "quantity": 1, "amount_cents": 4900}],
        hosted_url="https://pay.example.com/in_test_1",
        payment_intent_id="pi_test_1",
    )


class CompletedCheckoutProvider(NullPaymentProvider):
    """A provider that settles the session and holds the invoice for it."""

    name = "stripe"

    def __init__(self, invoices: list[ProviderInvoice] | None = None, *, raises: bool = False) -> None:
        self.invoices = invoices if invoices is not None else [_remote_invoice()]
        self.raises = raises
        self.listed: list[str] = []

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSessionStatus:
        return CheckoutSessionStatus(
            session_id=session_id,
            status="complete",
            mode="subscription",
            customer_id="cus_test_1",
            subscription_id="sub_test_1",
            plan_code="team",
        )

    def list_invoices(self, *, customer_id: str, limit: int = 100) -> list[ProviderInvoice]:
        self.listed.append(customer_id)
        if self.raises:
            raise RuntimeError("provider unreachable")
        return self.invoices


@pytest.fixture()
def provider(monkeypatch) -> CompletedCheckoutProvider:
    stub = CompletedCheckoutProvider()
    monkeypatch.setattr(billing_module.BillingService, "provider", property(lambda self: stub))
    return stub


def _invoices_of(organization_id: str) -> list[Invoice]:
    session, generator = _db()
    try:
        return list(
            session.query(Invoice).filter(Invoice.organization_id == organization_id).all()
        )
    finally:
        generator.close()


def _confirm(client: TestClient, headers: dict[str, str], session_id: str = "cs_test_1"):
    return client.get(f"/api/billing/checkout/{session_id}", headers=headers)


def test_confirming_a_checkout_leaves_the_provider_invoice_behind(
    client: TestClient, provider: CompletedCheckoutProvider
) -> None:
    headers = auth_headers(client)
    billing_service.ensure_default_plans(next(app.dependency_overrides[get_db]()))
    organization_id = _org_id(client, headers)

    response = _confirm(client, headers)
    assert response.status_code == 200, response.text
    assert response.json()["applied"] is True

    invoices = _invoices_of(organization_id)
    assert len(invoices) == 1
    invoice = invoices[0]
    # The provider did the charging, so its figures are the ones kept.
    assert invoice.provider_invoice_id == "in_test_1"
    assert invoice.total_cents == 4900
    assert invoice.status == InvoiceStatus.paid
    assert invoice.hosted_url == "https://pay.example.com/in_test_1"


def test_the_plan_is_active_and_the_invoice_is_for_it(
    client: TestClient, provider: CompletedCheckoutProvider
) -> None:
    headers = auth_headers(client)
    billing_service.ensure_default_plans(next(app.dependency_overrides[get_db]()))
    organization_id = _org_id(client, headers)

    assert _confirm(client, headers).status_code == 200

    session, generator = _db()
    try:
        subscription = session.query(Subscription).filter(
            Subscription.organization_id == organization_id
        ).one()
        assert str(subscription.status) in {"SubscriptionStatus.active", "active"}
    finally:
        generator.close()
    # The tenant's own invoice list is what the billing screen reads.
    listed = client.get("/api/invoices", headers=headers)
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    assert [row["number"] for row in rows] == ["STRIPE-0001"]
    assert [row["total_cents"] for row in rows] == [4900]
    assert [row["status"] for row in rows] == ["paid"]


def test_confirming_twice_does_not_bill_twice(
    client: TestClient, provider: CompletedCheckoutProvider
) -> None:
    headers = auth_headers(client)
    billing_service.ensure_default_plans(next(app.dependency_overrides[get_db]()))
    organization_id = _org_id(client, headers)

    assert _confirm(client, headers).status_code == 200
    assert _confirm(client, headers).status_code == 200

    # Idempotent on the provider's invoice id: one row, not two.
    assert len(_invoices_of(organization_id)) == 1


def test_a_provider_that_cannot_answer_still_applies_the_purchase(
    client: TestClient, monkeypatch
) -> None:
    stub = CompletedCheckoutProvider(raises=True)
    monkeypatch.setattr(billing_module.BillingService, "provider", property(lambda self: stub))
    headers = auth_headers(client)
    billing_service.ensure_default_plans(next(app.dependency_overrides[get_db]()))
    organization_id = _org_id(client, headers)

    response = _confirm(client, headers)
    # The money has already moved; failing the confirmation here would tell the
    # tenant their purchase did not happen. The invoice is picked up later by
    # the webhook or the backfill script.
    assert response.status_code == 200, response.text
    assert response.json()["applied"] is True
    assert _invoices_of(organization_id) == []


def test_a_draft_provider_invoice_is_not_mirrored(client: TestClient, monkeypatch) -> None:
    draft = _remote_invoice("in_draft_1")
    draft.status = InvoiceStatus.draft
    stub = CompletedCheckoutProvider([draft])
    monkeypatch.setattr(billing_module.BillingService, "provider", property(lambda self: stub))
    headers = auth_headers(client)
    billing_service.ensure_default_plans(next(app.dependency_overrides[get_db]()))
    organization_id = _org_id(client, headers)

    assert _confirm(client, headers).status_code == 200
    # A draft is not a bill yet — showing it would invite paying it twice.
    assert _invoices_of(organization_id) == []
