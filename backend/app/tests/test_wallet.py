"""Account balance: what credits it, what spends it, and what cannot (BIL-12).

The wallet exists so that value a tenant gives back -- the unused half of a
plan they left, seats they released -- stops being silently discarded. The
load-bearing property is that it is *credit*: it is spent on this
application's invoices and there is no path out of it. Several tests below
exist only to hold that line.
"""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import get_db
from app.main import app
from app.models.enums import WalletEntryKind
from app.models.invoice import Invoice, InvoiceStatus
from app.models.mixins import now_utc
from app.models.subscription import Subscription
from app.models.user import User
from app.services.billing_service import billing_service
from app.services.wallet_service import wallet_service
from app.tests.conftest import add_payment_method, auth_headers, upgrade_plan


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


def _credit(org_id: str, cents: int, *, key: str | None = None) -> None:
    session, generator = _db()
    wallet_service.credit(
        session,
        organization_id=org_id,
        amount_cents=cents,
        kind=WalletEntryKind.platform_grant,
        description="Test grant",
        reason="test",
        idempotency_key=key,
    )
    session.commit()
    generator.close()


def _issue_invoice(org_id: str, cents: int) -> Invoice:
    session, generator = _db()
    invoice = billing_service.issue_invoice(
        session,
        organization_id=org_id,
        amount_cents=cents,
        line_items=[{"description": "Test", "quantity": 1, "unit_cents": cents, "amount_cents": cents}],
    )
    invoice_id = invoice.id
    generator.close()
    session, generator = _db()
    invoice = session.get(Invoice, invoice_id)
    generator.close()
    return invoice


# ---------------------------------------------------------------- the ledger


def test_the_balance_cache_always_matches_the_ledger(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    _credit(org_id, 1000, key="a")
    _credit(org_id, 250, key="b")

    session, generator = _db()
    check = wallet_service.verify_balance(session, org_id)
    generator.close()
    assert check == {"cached_cents": 1250, "ledger_cents": 1250, "consistent": True}


def test_a_replayed_credit_credits_once(client: TestClient) -> None:
    """Webhook redeliveries and double-clicks are the normal case, not the edge."""
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    _credit(org_id, 500, key="same-key")
    _credit(org_id, 500, key="same-key")

    assert client.get("/api/billing/wallet", headers=headers).json()["balance_cents"] == 500


def test_entries_record_the_balance_they_produced(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    _credit(org_id, 700, key="x")
    _credit(org_id, 300, key="y")

    entries = client.get("/api/billing/wallet", headers=headers).json()["entries"]
    assert [entry["balance_after_cents"] for entry in entries] == [1000, 700]


# ---------------------------------------------------------------- spending


def test_an_invoice_covered_by_balance_is_paid_without_a_provider_call(
    client: TestClient,
) -> None:
    """Autopay keeps working for an organization with balance and no card."""
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    _credit(org_id, 5000, key="cover")
    invoice = _issue_invoice(org_id, 4000)

    session, generator = _db()
    # No payment method exists, so reaching the provider at all would fail.
    paid = billing_service.collect_invoice(session, invoice=session.get(Invoice, invoice.id))
    generator.close()

    assert paid.status == InvoiceStatus.paid
    assert paid.amount_due_cents == 0
    assert paid.payment_method_label == "Account balance"
    assert client.get("/api/billing/wallet", headers=headers).json()["balance_cents"] == 1000


def test_partial_balance_leaves_only_the_remainder_to_the_card(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    add_payment_method(client, headers)
    _credit(org_id, 1500, key="partial")
    invoice = _issue_invoice(org_id, 4000)

    session, generator = _db()
    paid = billing_service.collect_invoice(session, invoice=session.get(Invoice, invoice.id))
    charge_amounts = [
        row.amount_cents
        for row in session.scalars(select(__import__("app.models.charge", fromlist=["Charge"]).Charge))
        if row.invoice_id == invoice.id
    ]
    generator.close()

    assert paid.status == InvoiceStatus.paid
    # The card was asked for 4000 - 1500, not the full total.
    assert charge_amounts == [2500]
    assert client.get("/api/billing/wallet", headers=headers).json()["balance_cents"] == 0


def test_a_draw_cannot_take_the_balance_negative(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    add_payment_method(client, headers)
    _credit(org_id, 1000, key="small")

    first = _issue_invoice(org_id, 800)
    second = _issue_invoice(org_id, 800)
    session, generator = _db()
    billing_service.collect_invoice(session, invoice=session.get(Invoice, first.id))
    billing_service.collect_invoice(session, invoice=session.get(Invoice, second.id))
    check = wallet_service.verify_balance(session, org_id)
    generator.close()

    assert check["cached_cents"] == 0
    assert check["consistent"] is True


def test_balance_has_no_way_out_of_the_application(client: TestClient) -> None:
    """The design is credit, not custody. Nothing here pays a tenant out.

    Asserted against the router rather than by inspection, so adding a payout
    endpoint later has to break this test deliberately.
    """
    schema = app.openapi()
    wallet_paths = {
        path: set(operations)
        for path, operations in schema["paths"].items()
        if "wallet" in path
    }
    # A tenant can read their balance. That is the entire surface.
    assert wallet_paths["/api/billing/wallet"] == {"get"}
    # The only writer is the audited platform grant.
    assert set(wallet_paths) == {
        "/api/billing/wallet",
        "/api/saas/tenants/{org_id}/wallet/credit",
    }


# ------------------------------------------------------------ what credits it


def test_releasing_seats_credits_the_prorated_value(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    client.get("/api/billing/plans")
    # Team caps at two users, so seat headroom needs a plan that has some.
    upgrade_plan(client, headers, "business")

    bought = client.post("/api/billing/seats", json={"delta": 2}, headers=headers)
    assert bought.status_code == 200, bought.text

    released = client.post("/api/billing/seats", json={"delta": -2}, headers=headers)
    assert released.status_code == 200, released.text
    credited = released.json()["wallet_credit_cents"]
    assert credited > 0

    wallet = client.get("/api/billing/wallet", headers=headers).json()
    assert wallet["balance_cents"] == credited
    assert wallet["entries"][0]["kind"] == "seat_reduction"


def test_a_platform_grant_is_attributed_and_audited(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)

    session, generator = _db()
    admin = session.get(User, client.get("/api/auth/me", headers=headers).json()["id"])
    admin.is_platform_admin = True
    session.add(admin)
    session.commit()
    generator.close()

    granted = client.post(
        f"/api/saas/tenants/{org_id}/wallet/credit",
        json={"amount_cents": 2500, "reason": "Goodwill after an outage"},
        headers=headers,
    )
    assert granted.status_code == 200, granted.text
    body = granted.json()
    assert body["balance_cents"] == 2500
    assert body["entries"][0]["kind"] == "platform_grant"
    assert body["entries"][0]["reason"] == "Goodwill after an outage"


def test_a_grant_requires_a_reason(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    session, generator = _db()
    admin = session.get(User, client.get("/api/auth/me", headers=headers).json()["id"])
    admin.is_platform_admin = True
    session.add(admin)
    session.commit()
    generator.close()

    refused = client.post(
        f"/api/saas/tenants/{org_id}/wallet/credit",
        json={"amount_cents": 2500},
        headers=headers,
    )
    assert refused.status_code == 422


def test_a_tenant_cannot_grant_themselves_balance(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    refused = client.post(
        f"/api/saas/tenants/{org_id}/wallet/credit",
        json={"amount_cents": 100000, "reason": "please"},
        headers=headers,
    )
    assert refused.status_code == 403


# -------------------------------------------------------- spent on an upgrade


def test_balance_is_spent_on_the_next_upgrade(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    client.get("/api/billing/plans")
    add_payment_method(client, headers)
    _credit(org_id, 100000, key="big")

    preview = client.get(
        "/api/billing/change-plan/preview", params={"plan_code": "business"}, headers=headers
    ).json()
    assert preview["direction"] == "upgrade"
    assert preview["amount_due_cents"] > 0
    # Balance covers it outright, so nothing reaches a card.
    assert preview["wallet_applied_cents"] == preview["amount_due_cents"]
    assert preview["charge_cents"] == 0

    upgraded = client.post(
        "/api/billing/change-plan", json={"plan_code": "business"}, headers=headers
    )
    assert upgraded.status_code == 200, upgraded.text
    assert upgraded.json()["plan_code"] == "business"

    after = client.get("/api/billing/wallet", headers=headers).json()
    assert after["balance_cents"] == 100000 - preview["amount_due_cents"]


def test_an_overpayment_becomes_balance_instead_of_disappearing(client: TestClient) -> None:
    """A wire that overshoots used to be recorded and then kept.

    `amount_paid_cents > total_cents` showed up nowhere the tenant could see
    and was never applied to anything.
    """
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    invoice = _issue_invoice(org_id, 3000)

    session, generator = _db()
    paid = billing_service.mark_invoice_paid(
        session, invoice=session.get(Invoice, invoice.id), amount_cents=5000
    )
    generator.close()

    assert paid.status == InvoiceStatus.paid
    # The invoice records what it was owed, not what arrived.
    assert paid.amount_paid_cents == 3000

    wallet = client.get("/api/billing/wallet", headers=headers).json()
    assert wallet["balance_cents"] == 2000
    assert wallet["entries"][0]["kind"] == "overpayment"
