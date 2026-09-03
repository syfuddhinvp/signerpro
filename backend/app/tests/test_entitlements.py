import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import get_db
from app.main import app
from app.models.plan import Plan
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.usage_event import UsageEvent, UsageEventType
from app.services.billing_service import billing_service, sign_webhook_body
from app.services.entitlement_service import entitlement_service
from app.tests.conftest import auth_headers, upgrade_plan


def _db():
    """Grab a session from the test's dependency override."""
    generator = app.dependency_overrides[get_db]()
    session = next(generator)
    return session, generator


def _create_document(client: TestClient, headers: dict[str, str], title: str = "Doc") -> dict:
    response = client.post("/api/documents", json={"title": title, "workflow_type": "parallel"}, headers=headers)
    return response


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/billing/subscription", headers=headers).json()["organization_id"]


def test_plans_catalogue_is_public_and_seeded(client: TestClient) -> None:
    response = client.get("/api/billing/plans")
    assert response.status_code == 200, response.text
    codes = {plan["code"] for plan in response.json()}
    assert {"team", "business", "enterprise"} <= codes
    entry = next(plan for plan in response.json() if plan["code"] == "team")
    assert entry["entitlements"]["max_documents_per_month"] == 5
    assert entry["entitlements"]["api_access"] is False


def test_org_without_subscription_row_falls_back_to_the_entry_plan(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.get("/api/billing/subscription", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["plan_code"] == "team"
    assert body["status"] in {"active", "trialing"}


def test_document_creation_is_metered_and_capped(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")  # seeds the catalogue

    for index in range(5):
        assert _create_document(client, headers, f"Doc {index}").status_code == 201

    blocked = _create_document(client, headers, "Doc 6")
    assert blocked.status_code == 402, blocked.text
    detail = blocked.json()["detail"]
    assert detail["error"] == "entitlement_limit_reached"
    assert detail["limit"] == "max_documents_per_month"
    assert detail["limit_value"] == 5
    assert detail["plan"] == "team"

    usage = client.get("/api/billing/usage", headers=headers).json()
    assert usage["limits"]["max_documents_per_month"]["used"] == 5
    assert usage["limits"]["max_documents_per_month"]["remaining"] == 0
    assert usage["limits"]["max_documents_per_month"]["exceeded"] is True
    assert usage["period_totals"]["document_created"] == 5


def test_templates_do_not_consume_document_quota(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    for index in range(6):
        response = client.post(
            "/api/documents",
            json={"title": f"T{index}", "workflow_type": "parallel", "is_template": True},
            headers=headers,
        )
        assert response.status_code == 201, response.text
    usage = client.get("/api/billing/usage", headers=headers).json()
    assert usage["limits"]["max_documents_per_month"]["used"] == 0


def test_upgrading_plan_raises_the_limit(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    for index in range(5):
        assert _create_document(client, headers, f"Doc {index}").status_code == 201
    assert _create_document(client, headers, "over").status_code == 402

    changed = upgrade_plan(client, headers, "business")
    assert changed["plan_code"] == "business"

    assert _create_document(client, headers, "now allowed").status_code == 201


def test_recipient_limit_blocks_send_but_business_allows_it(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    document_id = _create_document(client, headers, "Contract").json()["id"]
    client.post(
        f"/api/documents/{document_id}/upload-pdf",
        files={"upload": ("doc.pdf", pdf_bytes, "application/pdf")},
        headers=headers,
    )
    recipient_ids = []
    for index in range(3):
        response = client.post(
            f"/api/documents/{document_id}/recipients",
            json={"name": f"Signer {index}", "email": f"s{index}@example.com", "signing_order": 1},
            headers=headers,
        )
        assert response.status_code == 201, response.text
        recipient_ids.append(response.json()["id"])

    # The per-document cap is now enforced on the incremental add path too, so
    # the fourth single add is refused rather than sailing past a limit of 3
    # and only being caught at send.
    blocked_add = client.post(
        f"/api/documents/{document_id}/recipients",
        json={"name": "Signer 3", "email": "s3@example.com", "signing_order": 1},
        headers=headers,
    )
    assert blocked_add.status_code == 402, blocked_add.text
    assert blocked_add.json()["detail"]["limit"] == "max_recipients_per_document"

    for recipient_id in recipient_ids:
        client.post(
            f"/api/documents/{document_id}/fields",
            json={
                "recipient_id": recipient_id,
                "type": "signature",
                "label": "Signature",
                "page_number": 1,
                "x": 0.1,
                "y": 0.1,
                "width": 0.2,
                "height": 0.05,
                "required": True,
            },
            headers=headers,
        )

    upgrade_plan(client, headers, "business")

    # With the higher cap the fourth recipient is accepted, and the send that
    # the entry plan would have refused now succeeds.
    allowed_add = client.post(
        f"/api/documents/{document_id}/recipients",
        json={"name": "Signer 3", "email": "s3@example.com", "signing_order": 1},
        headers=headers,
    )
    assert allowed_add.status_code == 201, allowed_add.text
    client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": allowed_add.json()["id"],
            "type": "signature",
            "label": "Signature",
            "page_number": 1,
            "x": 0.1,
            "y": 0.1,
            "width": 0.2,
            "height": 0.05,
            "required": True,
        },
        headers=headers,
    )
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text

    usage = client.get("/api/billing/usage", headers=headers).json()
    assert usage["period_totals"]["document_sent"] == 1


def test_storage_bytes_are_metered_on_upload(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    document_id = _create_document(client, headers, "Storage").json()["id"]
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        files={"upload": ("doc.pdf", pdf_bytes, "application/pdf")},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    usage = client.get("/api/billing/usage", headers=headers).json()
    assert usage["limits"]["max_storage_bytes"]["used"] >= len(pdf_bytes)


def test_canceled_subscription_blocks_sending_but_not_reading(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    document_id = _create_document(client, headers, "Executed").json()["id"]
    client.post(
        f"/api/documents/{document_id}/upload-pdf",
        files={"upload": ("doc.pdf", pdf_bytes, "application/pdf")},
        headers=headers,
    )
    recipient_id = client.post(
        f"/api/documents/{document_id}/recipients",
        json={"name": "Buyer", "email": "buyer@example.com", "signing_order": 1},
        headers=headers,
    ).json()["id"]
    client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id,
            "type": "signature",
            "label": "Signature",
            "page_number": 1,
            "x": 0.1,
            "y": 0.1,
            "width": 0.2,
            "height": 0.05,
            "required": True,
        },
        headers=headers,
    )

    canceled = client.post("/api/billing/cancel", json={"at_period_end": False}, headers=headers)
    assert canceled.status_code == 200, canceled.text
    assert canceled.json()["status"] == "canceled"

    # Sending is blocked...
    blocked_send = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert blocked_send.status_code == 402
    assert blocked_send.json()["detail"]["error"] == "subscription_inactive"
    assert client.post("/api/documents", json={"title": "New", "workflow_type": "parallel"}, headers=headers).status_code == 402
    assert client.post(f"/api/documents/{document_id}/remind", headers=headers).status_code == 402

    # ...but the customer keeps access to their own records.
    assert client.get("/api/documents", headers=headers).status_code == 200
    assert client.get(f"/api/documents/{document_id}", headers=headers).status_code == 200
    assert client.get(f"/api/documents/{document_id}/pdf", headers=headers).status_code == 200
    assert client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).status_code in {200, 404}


def test_expired_period_reads_as_expired(client: TestClient) -> None:
    from datetime import datetime, timedelta, timezone

    headers = auth_headers(client)
    client.get("/api/billing/plans")
    session, generator = _db()
    org_id = _org_id(client, headers)
    billing_service.get_or_create_subscription(session, org_id)
    subscription = entitlement_service.get_subscription(session, org_id)
    subscription.current_period_end = datetime.now(timezone.utc) - timedelta(days=1)
    session.commit()

    context = entitlement_service.resolve(session, org_id)
    assert context.subscription_status == "expired"
    assert context.can_perform_billable_actions is False
    generator.close()

    assert _create_document(client, headers, "nope").status_code == 402


def test_webhook_requires_valid_signature_and_is_idempotent(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)

    payload = {
        "id": "evt_1",
        "type": "checkout.completed",
        "data": {"organization_id": org_id, "plan_code": "business", "subscription_id": "sub_ext_1"},
    }
    raw = json.dumps(payload).encode()

    unsigned = client.post("/api/billing/webhook", content=raw)
    assert unsigned.status_code == 401

    bad = client.post("/api/billing/webhook", content=raw, headers={"X-Signature": "sha256=deadbeef"})
    assert bad.status_code == 401

    signature = {"X-Signature": sign_webhook_body(raw)}
    first = client.post("/api/billing/webhook", content=raw, headers=signature)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "processed"

    second = client.post("/api/billing/webhook", content=raw, headers=signature)
    assert second.json()["status"] == "duplicate"

    subscription = client.get("/api/billing/subscription", headers=headers).json()
    assert subscription["plan_code"] == "business"
    assert subscription["status"] == "active"


def test_webhook_can_cancel_and_resume(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    org_id = _org_id(client, headers)

    def send(event_id: str, event_type: str) -> dict:
        raw = json.dumps(
            {"id": event_id, "type": event_type, "data": {"organization_id": org_id}}
        ).encode()
        return client.post(
            "/api/billing/webhook", content=raw, headers={"X-Signature": sign_webhook_body(raw)}
        ).json()

    assert send("evt_pf", "invoice.payment_failed")["status"] == "processed"
    # past_due is a dunning state -- access is retained deliberately.
    assert client.get("/api/billing/subscription", headers=headers).json()["status"] == "past_due"
    assert _create_document(client, headers, "still works").status_code == 201

    assert send("evt_cancel", "subscription.canceled")["status"] == "processed"
    assert client.get("/api/billing/subscription", headers=headers).json()["status"] == "canceled"

    resumed = client.post("/api/billing/resume", headers=headers)
    assert resumed.json()["status"] == "active"


def test_check_entitlement_for_seat_limit(client: TestClient) -> None:
    """max_users is enforceable today; registration/invites must call this."""
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    session, generator = _db()
    org_id = _org_id(client, headers)

    # One user exists; the entry plan allows 2, so one more seat is fine.
    entitlement_service.check_entitlement(session, org_id, "max_users", amount=1)

    with pytest.raises(Exception) as excinfo:
        entitlement_service.check_entitlement(session, org_id, "max_users", amount=5)
    assert getattr(excinfo.value, "status_code", None) == 402
    generator.close()


def test_feature_flag_entitlement(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    session, generator = _db()
    org_id = _org_id(client, headers)
    assert entitlement_service.has_feature(session, org_id, "api_access") is False
    with pytest.raises(Exception) as excinfo:
        entitlement_service.check_entitlement(session, org_id, "api_access")
    assert excinfo.value.detail["error"] == "feature_not_available"
    generator.close()
