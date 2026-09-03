"""Invoices, support tickets, activity feed and revenue."""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.invoice import Invoice, InvoiceStatus
from app.models.mixins import now_utc
from app.models.user import User
from app.tests.conftest import auth_headers, upgrade_plan


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


def _make_invoice(org_id: str, **overrides) -> Invoice:
    session, generator = _db()
    invoice = Invoice(
        organization_id=org_id,
        number=overrides.pop("number", "INV-TEST-0001"),
        status=overrides.pop("status", InvoiceStatus.open),
        subtotal_cents=4900,
        tax_cents=0,
        total_cents=4900,
        amount_paid_cents=overrides.pop("amount_paid_cents", 0),
        issued_at=now_utc(),
        due_at=overrides.pop("due_at", now_utc() + timedelta(days=14)),
        line_items=[{"description": "Growth plan", "quantity": 1, "unit_cents": 4900, "amount_cents": 4900}],
        **overrides,
    )
    session.add(invoice)
    session.commit()
    session.refresh(invoice)
    generator.close()
    return invoice


def test_invoices_are_scoped_to_the_callers_organization(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    invoice = _make_invoice(org_id)

    listed = client.get("/api/invoices", headers=headers)
    assert listed.status_code == 200
    assert [item["number"] for item in listed.json()] == ["INV-TEST-0001"]
    assert listed.json()[0]["amount_due_cents"] == 4900

    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Co",
            "name": "Otto",
            "email": "otto@invoices.com",
            "password": "strong-password",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get("/api/invoices", headers=other_headers).json() == []
    # A cross-tenant id must read as absent, not forbidden.
    assert client.get(f"/api/invoices/{invoice.id}", headers=other_headers).status_code == 404


def test_overdue_is_derived_from_the_due_date(client: TestClient) -> None:
    headers = auth_headers(client)
    org_id = _org_id(client, headers)
    _make_invoice(org_id, number="INV-OVERDUE", due_at=now_utc() - timedelta(days=3))
    body = client.get("/api/invoices", headers=headers).json()
    assert body[0]["is_overdue"] is True

    _make_invoice(org_id, number="INV-PAID", status=InvoiceStatus.paid, amount_paid_cents=4900)
    paid = next(item for item in client.get("/api/invoices", headers=headers).json() if item["number"] == "INV-PAID")
    assert paid["is_overdue"] is False
    assert paid["amount_due_cents"] == 0


def test_platform_invoice_listing_requires_platform_admin(client: TestClient) -> None:
    headers = auth_headers(client)
    _make_invoice(_org_id(client, headers))
    assert client.get("/api/saas/invoices", headers=headers).status_code == 403

    _promote(client, headers)
    listed = client.get("/api/saas/invoices", headers=headers)
    assert listed.status_code == 200
    assert listed.json()[0]["organization_name"] == "Acme Realty"


def test_marking_an_invoice_paid(client: TestClient) -> None:
    headers = auth_headers(client)
    invoice = _make_invoice(_org_id(client, headers))
    _promote(client, headers)

    paid = client.post(f"/api/saas/invoices/{invoice.id}/mark-paid", json={}, headers=headers)
    assert paid.status_code == 200
    assert paid.json()["status"] == "paid"
    assert paid.json()["amount_due_cents"] == 0


def test_support_ticket_lifecycle(client: TestClient) -> None:
    headers = auth_headers(client)
    created = client.post(
        "/api/support/tickets",
        json={"subject": "Signer cannot open link", "body": "Ada reports a 410.", "priority": "high"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    ticket = created.json()
    assert ticket["status"] == "open"
    assert len(ticket["messages"]) == 1

    replied = client.post(f"/api/support/tickets/{ticket['id']}/reply", json={"body": "Any update?"}, headers=headers)
    assert replied.status_code == 200
    assert len(replied.json()["messages"]) == 2

    resolved = client.patch(f"/api/support/tickets/{ticket['id']}", json={"status": "resolved"}, headers=headers)
    assert resolved.json()["status"] == "resolved"
    assert resolved.json()["resolved_at"] is not None

    # A reply reopens a resolved thread rather than silently appending to it.
    reopened = client.post(f"/api/support/tickets/{ticket['id']}/reply", json={"body": "Still broken."}, headers=headers)
    assert reopened.json()["status"] == "open"
    assert reopened.json()["resolved_at"] is None


def test_priority_is_reserved_for_platform_staff(client: TestClient) -> None:
    headers = auth_headers(client)
    ticket = client.post(
        "/api/support/tickets", json={"subject": "Billing question", "body": "?"}, headers=headers
    ).json()
    assert client.patch(f"/api/support/tickets/{ticket['id']}", json={"priority": "urgent"}, headers=headers).status_code == 403

    _promote(client, headers)
    assert client.patch(f"/api/support/tickets/{ticket['id']}", json={"priority": "urgent"}, headers=headers).status_code == 200


def test_support_queue_is_platform_only_and_spans_tenants(client: TestClient) -> None:
    headers = auth_headers(client)
    client.post("/api/support/tickets", json={"subject": "One", "body": "x"}, headers=headers)
    assert client.get("/api/support/queue", headers=headers).status_code == 403

    _promote(client, headers)
    queue = client.get("/api/support/queue", headers=headers)
    assert queue.status_code == 200
    assert queue.json()[0]["organization_name"] == "Acme Realty"


def test_activity_is_scoped_and_filterable(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document = client.post("/api/documents", json={"title": "Activity Doc"}, headers=headers).json()
    client.post(
        f"/api/documents/{document['id']}/upload-pdf",
        files={"upload": ("a.pdf", pdf_bytes, "application/pdf")},
        headers=headers,
    )

    page = client.get("/api/activity", headers=headers)
    assert page.status_code == 200
    body = page.json()
    assert body["total"] >= 1
    assert body["entries"][0]["document_title"] == "Activity Doc"
    assert "document_created" in body["event_types"]

    filtered = client.get("/api/activity?event_type=document_created", headers=headers).json()
    assert all(entry["event_type"] == "document_created" for entry in filtered["entries"])

    searched = client.get("/api/activity?search=activity", headers=headers).json()
    assert searched["total"] >= 1
    assert client.get("/api/activity?search=zzzznothing", headers=headers).json()["total"] == 0

    # Another tenant sees none of it.
    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Co",
            "name": "Otto",
            "email": "otto@activity.com",
            "password": "strong-password",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get("/api/activity", headers=other_headers).json()["total"] == 0


def test_platform_activity_requires_platform_admin(client: TestClient) -> None:
    headers = auth_headers(client)
    client.post("/api/documents", json={"title": "Doc"}, headers=headers)
    assert client.get("/api/activity/platform", headers=headers).status_code == 403

    _promote(client, headers)
    body = client.get("/api/activity/platform", headers=headers).json()
    assert body["total"] >= 1
    assert body["entries"][0]["organization_name"] == "Acme Realty"


def test_revenue_summary(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)
    _make_invoice(org_id, number="INV-REV-1", amount_paid_cents=4900, status=InvoiceStatus.paid)
    _make_invoice(org_id, number="INV-REV-2")

    assert client.get("/api/saas/revenue", headers=headers).status_code == 403
    _promote(client, headers)

    body = client.get("/api/saas/revenue", headers=headers).json()
    assert body["collected_cents"] == 4900
    assert body["outstanding_cents"] == 4900
    assert body["arr_cents"] == body["mrr_cents"] * 12
    assert len(body["series"]) >= 1

    upgrade_plan(client, headers, "business")
    upgraded = client.get("/api/saas/revenue", headers=headers).json()
    assert upgraded["mrr_cents"] == 2800
    assert any(entry["plan_code"] == "business" for entry in upgraded["by_plan"])
