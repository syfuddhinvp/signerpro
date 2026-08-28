"""Tenant billing, invoice transitions and platform revenue.

Everything asserted here is derived from rows the app already writes, so the
tests seed plans/subscriptions/invoices/charges and check the arithmetic rather
than stubbing the endpoints out.
"""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import hash_password
from app.main import app
from app.models.charge import Charge
from app.models.invoice import Invoice, InvoiceStatus
from app.models.mixins import now_utc
from app.models.payment_method import PaymentMethod
from app.models.subscription import ProcessedWebhookEvent
from app.models.user import User
from app.services.billing_service import DEV_DECLINE_MARKER
from app.tests.conftest import auth_headers


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


def _promote(client: TestClient, headers: dict[str, str]) -> None:
    session, generator = _db()
    user = session.get(User, client.get("/api/auth/me", headers=headers).json()["id"])
    user.is_platform_admin = True
    session.add(user)
    session.commit()
    generator.close()


def _second_org(client: TestClient) -> tuple[dict[str, str], str]:
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Northwind Legal",
            "name": "Nora Admin",
            "email": "nora@northwind.example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    headers = {"Authorization": f"Bearer {response.json()['access_token']}"}
    return headers, _org_id(client, headers)


def _add_users(org_id: str, count: int, *, prefix: str = "member") -> None:
    session, generator = _db()
    for index in range(count):
        session.add(
            User(
                organization_id=org_id,
                name=f"Member {index}",
                email=f"{prefix}{index}@example.com",
                password_hash=hash_password("strong-password"),
                role="sender",
            )
        )
    session.commit()
    generator.close()


def _make_invoice(org_id: str, **overrides) -> Invoice:
    session, generator = _db()
    invoice = Invoice(
        organization_id=org_id,
        number=overrides.pop("number", "INV-BIL-0001"),
        status=overrides.pop("status", InvoiceStatus.open),
        subtotal_cents=2800,
        tax_cents=0,
        total_cents=2800,
        amount_paid_cents=overrides.pop("amount_paid_cents", 0),
        issued_at=now_utc(),
        due_at=overrides.pop("due_at", now_utc() + timedelta(days=14)),
        period_label=overrides.pop("period_label", "Aug 2026"),
        line_items=[{"description": "Business plan", "quantity": 1, "unit_cents": 2800, "amount_cents": 2800}],
        **overrides,
    )
    session.add(invoice)
    session.commit()
    session.refresh(invoice)
    generator.close()
    return invoice


def _decline(payment_method_id: str) -> None:
    session, generator = _db()
    pm = session.get(PaymentMethod, payment_method_id)
    pm.meta = DEV_DECLINE_MARKER
    session.add(pm)
    session.commit()
    generator.close()


# ---------------------------------------------------------------- plans / seats


def test_plan_catalogue_exposes_marketing_and_seat_pricing(client: TestClient) -> None:
    plans = client.get("/api/billing/plans").json()
    by_code = {plan["code"]: plan for plan in plans}
    assert set(by_code) == {"team", "business", "enterprise"}
    assert by_code["business"]["seat_price_cents"] == 2800
    assert by_code["business"]["is_seat_based"] is True
    assert by_code["business"]["tag"] == "Most adopted"
    assert {"label", "value"} <= set(by_code["business"]["marketing_lines"][0])


def test_subscription_reports_seats_and_next_invoice(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    _add_users(org_id, 2)

    body = client.get("/api/billing/subscription", headers=headers).json()
    assert body["plan_code"] == "team"
    assert body["seats_activated"] == 3
    assert body["seats_licensed"] == 3  # unset column reads as "licence what is in use"
    assert body["is_seat_based"] is True
    assert body["seat_price_cents"] == 1200
    assert body["cycle"] == "monthly"
    assert body["next_invoice_total_cents"] == 3 * 1200


def test_plan_change_preview_prorates_the_unused_period(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    _add_users(_org_id(client, headers), 1)

    preview = client.get(
        "/api/billing/change-plan/preview", params={"plan_code": "business"}, headers=headers
    ).json()
    assert preview["current_plan_code"] == "team"
    assert preview["seats_licensed"] == 2
    assert preview["current_amount_cents"] == 2400
    assert preview["target_amount_cents"] == 5600
    assert preview["is_downgrade"] is False
    # A brand-new subscription has almost all of its period left, so the
    # proration is nearly the whole difference.
    assert 0.9 < preview["remaining_fraction"] <= 1.0
    assert 0 < preview["proration_cents"] <= 3200

    downgrade = client.get(
        "/api/billing/change-plan/preview", params={"plan_code": "team"}, headers=headers
    ).json()
    assert downgrade["is_downgrade"] is False  # already on team: no change
    client.post("/api/billing/change-plan", json={"plan_code": "business"}, headers=headers)
    back = client.get(
        "/api/billing/change-plan/preview", params={"plan_code": "team"}, headers=headers
    ).json()
    assert back["is_downgrade"] is True
    assert back["proration_cents"] < 0  # a credit


def test_seat_changes_are_priced_and_cannot_strand_a_user(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    client.post("/api/billing/change-plan", json={"plan_code": "business"}, headers=headers)
    _add_users(org_id, 2)

    added = client.post("/api/billing/seats", json={"delta": 2}, headers=headers)
    assert added.status_code == 200, added.text
    body = added.json()
    assert body["seats_licensed"] == 5
    assert body["seats_activated"] == 3
    assert 0 < body["proration_cents"] <= 2 * 2800
    assert body["subscription"]["seats_licensed"] == 5
    assert body["subscription"]["next_invoice_total_cents"] == 5 * 2800

    released = client.post("/api/billing/seats", json={"delta": -2}, headers=headers).json()
    assert released["seats_licensed"] == 3
    assert released["proration_cents"] < 0

    # 3 seats are occupied; the fourth removal must be refused.
    blocked = client.post("/api/billing/seats", json={"delta": -1}, headers=headers)
    assert blocked.status_code == 409
    assert "in use" in blocked.json()["detail"]


def test_seat_addition_respects_the_plans_user_entitlement(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    # Team allows 2 users; asking for 5 more seats is a 402, not a silent sale.
    blocked = client.post("/api/billing/seats", json={"delta": 5}, headers=headers)
    assert blocked.status_code == 402
    assert blocked.json()["detail"]["limit"] == "max_users"


def test_entitlements_tighten_again_after_a_downgrade(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    client.post("/api/billing/change-plan", json={"plan_code": "business"}, headers=headers)

    # Business allows 10 users, so a third seat is invitable.
    _add_users(org_id, 2)
    invited = client.post("/api/invitations/", json={"email": "fourth@example.com"}, headers=headers)
    assert invited.status_code == 201, invited.text

    client.post("/api/billing/change-plan", json={"plan_code": "team"}, headers=headers)
    usage = client.get("/api/billing/usage", headers=headers).json()
    assert usage["plan_code"] == "team"
    assert usage["limits"]["max_users"]["limit"] == 2
    assert usage["limits"]["max_users"]["exceeded"] is True

    blocked = client.post("/api/invitations/", json={"email": "fifth@example.com"}, headers=headers)
    assert blocked.status_code == 402
    detail = blocked.json()["detail"]
    assert detail["limit"] == "max_users"
    assert detail["plan"] == "team"


def test_usage_rows_render_every_metered_dimension(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    client.post("/api/documents", json={"title": "Doc"}, headers=headers)

    rows = {row["key"]: row for row in client.get("/api/billing/usage", headers=headers).json()["rows"]}
    assert set(rows) == {
        "max_documents_per_month",
        "max_api_calls_per_month",
        "max_storage_bytes",
        "max_sms_per_month",
    }
    assert rows["max_documents_per_month"]["used"] == 1
    assert rows["max_documents_per_month"]["limit"] == 5
    assert rows["max_documents_per_month"]["pct"] == 20
    assert rows["max_documents_per_month"]["display"] == "1 of 5"
    # Every plan now declares the metered ceilings, so the rows have a real
    # denominator instead of reading as unlimited.
    assert rows["max_api_calls_per_month"]["limit"] == 5_000
    assert rows["max_api_calls_per_month"]["used"] == 0
    assert rows["max_api_calls_per_month"]["display"] == "0 of 5,000"
    assert rows["max_sms_per_month"]["limit"] == 100
    assert rows["max_sms_per_month"]["display"] == "0 of 100"


# ------------------------------------------------------------ settings / cycle


def test_billing_settings_round_trip_and_annual_cycle(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")

    defaults = client.get("/api/billing/settings", headers=headers).json()
    assert defaults["autopay"] is True
    assert defaults["cycle"] == "monthly"

    updated = client.patch(
        "/api/billing/settings",
        json={
            "autopay": False,
            "billing_email": "ap@acme.example.com",
            "tax_id": "GB123456789",
            "cycle": "annual",
        },
        headers=headers,
    ).json()
    assert updated["autopay"] is False
    assert updated["billing_email"] == "ap@acme.example.com"
    assert updated["tax_id"] == "GB123456789"
    assert updated["cycle"] == "annual"

    # Annual is twelve monthly periods; nothing else about the plan changes.
    upcoming = client.get("/api/billing/upcoming-invoice", headers=headers).json()
    assert upcoming["cycle"] == "annual"
    assert upcoming["total_cents"] == 1200 * 12
    assert upcoming["line_items"][0]["unit_cents"] == 1200 * 12
    assert upcoming["tax_cents"] == 0
    assert upcoming["subtotal_cents"] == upcoming["total_cents"]


def test_upcoming_invoice_line_items_follow_seats(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    client.post("/api/billing/change-plan", json={"plan_code": "business"}, headers=headers)
    client.post("/api/billing/seats", json={"delta": 3}, headers=headers)

    body = client.get("/api/billing/upcoming-invoice", headers=headers).json()
    assert body["plan_code"] == "business"
    assert body["seats_licensed"] == 4
    line = body["line_items"][0]
    assert line["quantity"] == 4
    assert line["unit_cents"] == 2800
    assert line["amount_cents"] == 11200
    assert body["total_cents"] == 11200


def test_settings_are_admin_only(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    _add_users(org_id, 1, prefix="sender")
    sender = client.post(
        "/api/auth/login", json={"email": "sender0@example.com", "password": "strong-password"}
    ).json()
    sender_headers = {"Authorization": f"Bearer {sender['access_token']}"}

    assert client.get("/api/billing/settings", headers=sender_headers).status_code == 200
    assert (
        client.patch("/api/billing/settings", json={"autopay": False}, headers=sender_headers).status_code
        == 403
    )
    assert client.post("/api/billing/seats", json={"delta": 1}, headers=sender_headers).status_code == 403


# ----------------------------------------------------------- payment methods


def test_payment_method_lifecycle(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")

    first = client.post(
        "/api/billing/payment-methods",
        json={"type": "card", "provider_token": "tok_visa", "holder_name": "Acme Realty"},
        headers=headers,
    )
    assert first.status_code == 201, first.text
    card = first.json()
    assert card["is_default"] is True  # the first instrument becomes the default
    assert card["brand"] == "Visa"
    assert len(card["last4"]) == 4
    assert card["label"].startswith("Visa")

    # The provider seam is deterministic: the same token yields the same card.
    again = client.post(
        "/api/billing/payment-methods",
        json={"type": "card", "provider_token": "tok_visa"},
        headers=headers,
    ).json()
    assert again["last4"] == card["last4"]
    assert again["is_default"] is False

    invoice_pm = client.post(
        "/api/billing/payment-methods",
        json={"type": "invoice", "po_number": "PO-4471", "make_default": True},
        headers=headers,
    ).json()
    assert invoice_pm["type"] == "invoice"
    assert invoice_pm["po_number"] == "PO-4471"
    assert invoice_pm["is_default"] is True

    settings = client.get("/api/billing/settings", headers=headers).json()
    assert settings["default_payment_method_id"] == invoice_pm["id"]
    assert settings["po_number"] == "PO-4471"

    promoted = client.post(
        f"/api/billing/payment-methods/{card['id']}/default", headers=headers
    ).json()
    assert promoted["is_default"] is True
    listed = client.get("/api/billing/payment-methods", headers=headers).json()
    assert [pm["is_default"] for pm in listed] == [True, False, False]
    assert sum(pm["is_default"] for pm in listed) == 1

    assert (
        client.delete(f"/api/billing/payment-methods/{card['id']}", headers=headers).status_code == 204
    )
    remaining = client.get("/api/billing/payment-methods", headers=headers).json()
    assert len(remaining) == 2
    # Deleting the default promotes another rather than leaving the org with none.
    assert sum(pm["is_default"] for pm in remaining) == 1


def test_payment_methods_are_tenant_scoped(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    mine = client.post(
        "/api/billing/payment-methods",
        json={"type": "card", "provider_token": "tok_mine"},
        headers=headers,
    ).json()

    other_headers, _ = _second_org(client)
    assert client.get("/api/billing/payment-methods", headers=other_headers).json() == []
    assert (
        client.post(f"/api/billing/payment-methods/{mine['id']}/default", headers=other_headers).status_code
        == 404
    )
    assert client.delete(f"/api/billing/payment-methods/{mine['id']}", headers=other_headers).status_code == 404


# ------------------------------------------------------------------- invoices


def test_paying_an_invoice_is_idempotent_and_records_a_charge(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    client.post(
        "/api/billing/payment-methods",
        json={"type": "card", "provider_token": "tok_ok"},
        headers=headers,
    )
    invoice = _make_invoice(org_id, number="INV-PAY-1")

    paid = client.post(f"/api/invoices/{invoice.id}/pay", json={}, headers=headers)
    assert paid.status_code == 200, paid.text
    body = paid.json()
    assert body["status"] == "paid"
    assert body["amount_due_cents"] == 0
    assert body["paid_at"] is not None
    assert body["provider_payment_intent_id"].startswith("pi_null_")
    assert body["payment_method_label"].startswith("Visa")

    charges = client.get("/api/billing/charges", headers=headers).json()
    assert len(charges) == 1
    assert charges[0]["status"] == "succeeded"
    assert charges[0]["amount_cents"] == 2800
    assert charges[0]["invoice_id"] == invoice.id

    # Paying again neither charges twice nor errors.
    repeat = client.post(f"/api/invoices/{invoice.id}/pay", json={}, headers=headers)
    assert repeat.status_code == 200
    assert repeat.json()["status"] == "paid"
    assert len(client.get("/api/billing/charges", headers=headers).json()) == 1


def test_a_declined_payment_moves_the_invoice_to_past_due_and_can_recover(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    pm = client.post(
        "/api/billing/payment-methods",
        json={"type": "card", "provider_token": "tok_bad"},
        headers=headers,
    ).json()
    _decline(pm["id"])
    invoice = _make_invoice(org_id, number="INV-DECLINE-1")

    declined = client.post(f"/api/invoices/{invoice.id}/pay", json={}, headers=headers)
    assert declined.status_code == 402
    detail = declined.json()["detail"]
    assert detail["error"] == "payment_failed"
    assert detail["decline_code"] == "card_declined"
    assert detail["invoice_status"] == "past_due"
    assert detail["dunning_step"] == 1

    listed = client.get("/api/invoices", headers=headers).json()
    assert listed[0]["status"] == "past_due"
    assert listed[0]["is_overdue"] is True

    # A past-due invoice is still reachable through the past_due filter alias.
    assert [i["number"] for i in client.get(
        "/api/invoices", params={"status": "past_due"}, headers=headers
    ).json()] == ["INV-DECLINE-1"]

    # The platform sees it in the dunning queue.
    _promote(client, headers)
    queue = client.get("/api/saas/dunning", headers=headers).json()
    assert len(queue) == 1
    assert queue[0]["invoice_number"] == "INV-DECLINE-1"
    assert queue[0]["dunning_step"] == 1
    assert queue[0]["max_step"] >= 1
    assert queue[0]["reason"] == "card_declined"
    assert queue[0]["next_attempt_at"] is not None

    # A working instrument plus a platform retry recovers it.
    good = client.post(
        "/api/billing/payment-methods",
        json={"type": "card", "provider_token": "tok_good", "make_default": True},
        headers=headers,
    ).json()
    retried = client.post(
        f"/api/saas/invoices/{invoice.id}/retry-payment",
        json={"payment_method_id": good["id"]},
        headers=headers,
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "paid"
    statuses = [c["status"] for c in client.get("/api/billing/charges", headers=headers).json()]
    assert "recovered" in statuses and "failed" in statuses
    assert client.get("/api/saas/dunning", headers=headers).json() == []


def test_invoice_status_transitions(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    _promote(client, headers)

    overdue = _make_invoice(
        org_id, number="INV-OD", status=InvoiceStatus.past_due, due_at=now_utc() - timedelta(days=5)
    )
    marked = client.post(f"/api/saas/invoices/{overdue.id}/mark-paid", json={}, headers=headers)
    assert marked.status_code == 200, marked.text
    assert marked.json()["status"] == "paid"
    assert marked.json()["organization_name"] == "Acme Realty"

    # A paid invoice cannot be voided.
    assert client.post(f"/api/saas/invoices/{overdue.id}/void", json={}, headers=headers).status_code == 409

    open_invoice = _make_invoice(org_id, number="INV-VOID")
    voided = client.post(f"/api/saas/invoices/{open_invoice.id}/void", json={"reason": "duplicate"}, headers=headers)
    assert voided.status_code == 200
    assert voided.json()["status"] == "void"
    # Void is idempotent, and a void invoice can no longer be paid.
    assert client.post(f"/api/saas/invoices/{open_invoice.id}/void", json={}, headers=headers).status_code == 200
    assert client.post(f"/api/saas/invoices/{open_invoice.id}/mark-paid", json={}, headers=headers).status_code == 409
    assert client.post(f"/api/invoices/{open_invoice.id}/pay", json={}, headers=headers).status_code == 409


def test_invoice_detail_pdf_and_receipt(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    invoice = _make_invoice(org_id, number="INV-PDF", hosted_url="https://pay.example.test/INV-PDF")

    detail = client.get(f"/api/invoices/{invoice.id}", headers=headers).json()
    assert detail["hosted_url"] == "https://pay.example.test/INV-PDF"
    assert detail["period_label"] == "Aug 2026"
    assert detail["organization_name"] == "Acme Realty"
    assert detail["line_items"][0]["description"] == "Business plan"

    pdf = client.get(f"/api/invoices/{invoice.id}/pdf", headers=headers)
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
    assert pdf.content.startswith(b"%PDF")

    # No receipt before payment.
    assert client.get(f"/api/invoices/{invoice.id}/receipt", headers=headers).status_code == 409
    client.post(
        "/api/billing/payment-methods", json={"type": "card", "provider_token": "t"}, headers=headers
    )
    client.post(f"/api/invoices/{invoice.id}/pay", json={}, headers=headers)
    receipt = client.get(f"/api/invoices/{invoice.id}/receipt", headers=headers)
    assert receipt.status_code == 200
    assert receipt.content.startswith(b"%PDF")


def test_a_tenant_admin_cannot_see_another_orgs_invoices_or_revenue(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    mine = _make_invoice(_org_id(client, headers), number="INV-ACME")
    other_headers, other_org = _second_org(client)
    theirs = _make_invoice(other_org, number="INV-NORTHWIND")

    # Own scope only, even when asking for everything.
    numbers = [i["number"] for i in client.get("/api/invoices", headers=headers).json()]
    assert numbers == ["INV-ACME"]
    widened = [
        i["number"] for i in client.get("/api/invoices", params={"scope": "all"}, headers=headers).json()
    ]
    assert widened == ["INV-ACME"]
    assert client.get(f"/api/invoices/{theirs.id}", headers=headers).status_code == 404
    assert client.get(f"/api/invoices/{theirs.id}/pdf", headers=headers).status_code == 404
    assert client.post(f"/api/invoices/{theirs.id}/pay", json={}, headers=headers).status_code == 404

    for path in (
        "/api/saas/invoices",
        "/api/saas/revenue",
        "/api/saas/revenue/churn",
        "/api/saas/balance",
        "/api/saas/dunning",
        "/api/saas/billing-events",
        "/api/saas/health",
    ):
        assert client.get(path, headers=headers).status_code == 403, path
    assert client.post(f"/api/saas/invoices/{mine.id}/void", json={}, headers=headers).status_code == 403
    assert (
        client.post(f"/api/saas/invoices/{mine.id}/retry-payment", json={}, headers=headers).status_code == 403
    )

    # Promoted, the same caller sees both tenants and can widen the tenant list.
    _promote(client, headers)
    platform = client.get("/api/saas/invoices", headers=headers).json()
    assert {i["number"] for i in platform} == {"INV-ACME", "INV-NORTHWIND"}
    assert {i["organization_name"] for i in platform} == {"Acme Realty", "Northwind Legal"}
    assert {
        i["number"] for i in client.get("/api/invoices", params={"scope": "all"}, headers=headers).json()
    } == {"INV-ACME", "INV-NORTHWIND"}
    filtered = client.get(
        "/api/saas/invoices", params={"organization_id": other_org}, headers=headers
    ).json()
    assert [i["number"] for i in filtered] == ["INV-NORTHWIND"]


# -------------------------------------------------------------------- revenue


def test_mrr_aggregation_is_seat_and_plan_aware(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    _promote(client, headers)

    # Acme: business, 4 seats -> 4 x 2800.
    client.post("/api/billing/change-plan", json={"plan_code": "business"}, headers=headers)
    _add_users(org_id, 1)
    client.post("/api/billing/seats", json={"delta": 2}, headers=headers)

    other_headers, _ = _second_org(client)
    # Northwind: enterprise, 1 seat -> 4400.
    client.post("/api/billing/change-plan", json={"plan_code": "enterprise"}, headers=other_headers)

    body = client.get("/api/saas/revenue", headers=headers).json()
    assert body["mrr_cents"] == 4 * 2800 + 4400
    assert body["arr_cents"] == body["mrr_cents"] * 12
    assert body["paying_tenants"] == 2
    by_plan = {entry["plan_code"]: entry for entry in body["by_plan"]}
    assert by_plan["business"]["mrr_cents"] == 4 * 2800
    assert by_plan["business"]["seats"] == 4
    assert by_plan["business"]["active_subscribers"] == 1
    assert by_plan["business"]["plan_tag"] == "Most adopted"
    assert by_plan["enterprise"]["mrr_cents"] == 4400
    # The trailing series ends on today's figure.
    assert len(body["mrr_series"]) == 12
    assert body["mrr_series"][-1]["mrr_cents"] == body["mrr_cents"]


def test_revenue_cash_tiles_come_from_invoices_and_charges(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    _make_invoice(org_id, number="INV-C1", status=InvoiceStatus.paid, amount_paid_cents=2800)
    _make_invoice(org_id, number="INV-C2")
    _make_invoice(org_id, number="INV-C3", status=InvoiceStatus.past_due, due_at=now_utc() - timedelta(days=9))

    session, generator = _db()
    session.add(
        Charge(
            organization_id=org_id,
            amount_cents=2800,
            status="succeeded",
            provider="null",
            occurred_at=now_utc() - timedelta(days=10),
        )
    )
    session.add(
        Charge(
            organization_id=org_id,
            amount_cents=2800,
            status="failed",
            decline_code="card_declined",
            provider="null",
            occurred_at=now_utc(),
        )
    )
    session.commit()
    generator.close()

    _promote(client, headers)
    body = client.get("/api/saas/revenue", headers=headers).json()
    assert body["collected_cents"] == 2800
    assert body["outstanding_cents"] == 5600  # open + past_due
    assert body["overdue_cents"] == 2800
    assert body["at_risk_cents"] == 2800
    assert body["gross_volume_30d_cents"] == 2800
    assert body["charge_count_30d"] == 2
    assert body["failed_payment_count"] == 1
    assert len(body["series"]) >= 1

    balance = client.get("/api/saas/balance", headers=headers).json()
    assert balance["available_cents"] == 2800  # settled
    assert balance["pending_cents"] == 0
    assert balance["payout_destination"] == "null"
    assert balance["dispute_count"] == 0

    churn = client.get("/api/saas/revenue/churn", params={"range": "3m"}, headers=headers).json()
    assert len(churn["rows"]) == 3
    assert churn["gross_logo_churn_pct"] == 0.0
    # No MRR existed three months ago, so retention has no baseline to divide by.
    assert churn["net_revenue_retention_pct"] == 0.0

    client.post("/api/billing/cancel", json={"at_period_end": False}, headers=headers)
    after = client.get("/api/saas/revenue/churn", params={"range": "3m"}, headers=headers).json()
    assert after["rows"][-1]["churned_tenants"] == 1
    assert after["rows"][-1]["churned_mrr_cents"] == 1200
    assert after["gross_logo_churn_pct"] > 0


def test_billing_events_list_and_replay(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    _promote(client, headers)

    session, generator = _db()
    event = ProcessedWebhookEvent(
        provider="null",
        event_id="evt_1",
        event_type="subscription.updated",
        payload={
            "id": "evt_1",
            "type": "subscription.updated",
            "data": {"organization_id": org_id, "plan_code": "business"},
        },
        processed=False,
    )
    session.add(event)
    session.commit()
    event_id = event.id
    generator.close()

    listed = client.get("/api/saas/billing-events", headers=headers).json()
    assert [e["event_id"] for e in listed] == ["evt_1"]
    assert listed[0]["processed"] is False
    assert client.get("/api/saas/billing-events", params={"status": "processed"}, headers=headers).json() == []

    replayed = client.post(f"/api/saas/billing-events/{event_id}/replay", headers=headers)
    assert replayed.status_code == 200, replayed.text
    assert replayed.json()["processed"] is True
    assert replayed.json()["status_code"] == 200
    # Replay went through the real handler, so the subscription really moved.
    assert client.get("/api/billing/subscription", headers=headers).json()["plan_code"] == "business"
    assert (
        len(client.get("/api/saas/billing-events", params={"status": "processed"}, headers=headers).json())
        == 1
    )
    assert client.post("/api/saas/billing-events/missing/replay", headers=headers).status_code == 404


def test_platform_health_reports_derived_components(client: TestClient) -> None:
    headers = auth_headers(client)
    _promote(client, headers)
    components = client.get("/api/saas/health", headers=headers).json()
    # One derivation (platform_service.component_health) feeds both this
    # endpoint and GET /api/saas/overview.
    assert {c["component"] for c in components} == {
        "API",
        "Signing",
        "Tenants",
        "Webhook delivery",
        "Payment provider",
        "Collections",
    }
    assert all(c["tone"] in {"good", "warn", "bad"} for c in components)
