"""Closing the pay-then-sign lifecycle gap: voiding/declining an envelope that
still holds settled signer money must warn (audit + bell), never move money
on its own, and refunds must refuse the three unsafe requests.

Same no-network discipline as `test_signer_payments.py`: `FakeStripe` stands
in for `SignerPaymentService.transport`.
"""

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import create_access_token, hash_password
from app.models.document import Document
from app.models.enums import UserRole
from app.models.notification import Notification
from app.models.recipient import Recipient
from app.models.signer_payment import SignerPayment
from app.models.user import User
from app.services.signer_payment_service import signer_payment_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document
from app.tests.test_signer_payments import add_payment_field, connect_stripe, FakeStripe, setup_document
from app.tests.test_signing_correctness import add_field, send


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def _settle_payment(client: TestClient, document_id: str, recipient_email: str, field_id: str, monkeypatch) -> SignerPayment:
    """Drive one payment field to a real `succeeded` `SignerPayment` row."""
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    tokens = send(client, document_id, auth_headers_cache["headers"])
    tokens_cache["tokens"] = tokens
    raw_token = tokens[recipient_email]
    db = db_session(client)
    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    row = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
    event = {
        "id": "evt_1",
        "type": "payment_intent.succeeded",
        "data": {
            "object": {
                "id": row.provider_payment_intent_id,
                "status": "succeeded",
                "charges": {"data": [{"id": "ch_1", "receipt_url": "https://example.com/r"}]},
            }
        },
    }
    signer_payment_service.apply_webhook_event(db, event=event)
    db.refresh(row)
    assert row.status == "succeeded"
    return row


auth_headers_cache: dict[str, dict[str, str]] = {}
tokens_cache: dict[str, dict[str, str]] = {}


def _prepare_settled_document(client: TestClient, pdf_bytes: bytes, monkeypatch):
    headers = auth_headers(client)
    auth_headers_cache["headers"] = headers
    connect_stripe(client, headers)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    field_id = add_payment_field(client, document_id, headers, alice, "Alice pay", 500, amount_mode="fixed", amount_cents=1000, currency="usd")
    add_field(client, document_id, headers, bob, "signature", "Bob sig", 600)
    payment = _settle_payment(client, document_id, "alice@example.com", field_id, monkeypatch)
    return headers, document_id, alice, bob, payment


# ------------------------------------------------------------- void warning


def test_voiding_a_document_with_settled_payments_logs_a_distinct_event_and_notifies_the_sender(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)

    # Void through the real HTTP route, which is what the UI actually calls.
    response = client.post(f"/api/documents/{document_id}/void", headers=headers)
    assert response.status_code == 200, response.text

    db = db_session(client)
    from app.models.audit_log import AuditLog

    held_events = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "payment_held_on_termination")
        .all()
    )
    assert len(held_events) == 1
    assert "1000" in str(held_events[0].log_metadata.get("held_cents"))
    assert held_events[0].log_metadata["payment_ids"] == [payment.id]

    me = client.get("/api/auth/me", headers=headers).json()
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == me["id"], Notification.title == "Payment held on terminated envelope")
        .all()
    )
    assert len(notifications) == 1
    assert "10.00" in notifications[0].detail


def test_declining_a_document_with_settled_payments_logs_a_distinct_event_and_notifies_the_sender(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The decline path lives in `signing_service`, not `document_service`, but
    it must trigger the same `payment_held_on_termination` warning as void
    does -- and, like void, it must never touch the payment row itself.
    """
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)

    bob_token = tokens_cache["tokens"]["bob@example.com"]
    assert client.post(f"/api/sign/{bob_token}/consent").status_code == 200

    response = client.post(f"/api/sign/{bob_token}/decline", json={"reason": "changed my mind"})
    assert response.status_code == 204, response.text

    db = db_session(client)
    from app.models.audit_log import AuditLog

    held_events = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "payment_held_on_termination")
        .all()
    )
    assert len(held_events) == 1
    assert "1000" in str(held_events[0].log_metadata.get("held_cents"))
    assert held_events[0].log_metadata["payment_ids"] == [payment.id]
    assert held_events[0].log_metadata["terminating_event"] == "document_declined"

    me = client.get("/api/auth/me", headers=headers).json()
    notifications = (
        db.query(Notification)
        .filter(Notification.user_id == me["id"], Notification.title == "Payment held on terminated envelope")
        .all()
    )
    assert len(notifications) == 1

    reloaded = db.get(SignerPayment, payment.id)
    assert reloaded.status == "succeeded", "a decline must never move the money on its own"
    assert reloaded.refunded_amount_cents == 0


def test_voiding_a_document_with_no_payments_raises_no_held_money_event(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    response = client.post(f"/api/documents/{document_id}/void", headers=headers)
    assert response.status_code == 200, response.text

    db = db_session(client)
    from app.models.audit_log import AuditLog

    held_events = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "payment_held_on_termination")
        .all()
    )
    assert held_events == []


def test_voiding_after_a_full_refund_raises_no_held_money_event(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)

    refund_response = client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={})
    assert refund_response.status_code == 200, refund_response.text
    assert refund_response.json()["status"] == "refunded"

    response = client.post(f"/api/documents/{document_id}/void", headers=headers)
    assert response.status_code == 200, response.text

    db = db_session(client)
    from app.models.audit_log import AuditLog

    held_events = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "payment_held_on_termination")
        .all()
    )
    assert held_events == []


# ------------------------------------------------------------------ refunds


def test_refund_endpoint_is_admin_only(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)
    response = client.post(f"/api/payments/{payment.id}/refund", headers={}, json={})
    assert response.status_code in (401, 403)


def _member_headers(client: TestClient, headers: dict[str, str]) -> dict[str, str]:
    """An authenticated, non-admin user in the SAME organization -- the case
    that actually exercises `require_org_admin`'s role check, unlike the
    unauthenticated case above.
    """
    db = db_session(client)
    org_id = client.get("/api/auth/me", headers=headers).json()["organization_id"]
    user = User(
        organization_id=org_id,
        name="Just A Sender",
        email="member@example.com",
        password_hash=hash_password("strong-password"),
        role=UserRole.sender,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(subject=user.id)
    return {"Authorization": f"Bearer {token}"}


def test_refund_endpoint_refuses_an_authenticated_non_admin_in_the_same_org(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)
    member_headers = _member_headers(client, headers)
    response = client.post(f"/api/payments/{payment.id}/refund", headers=member_headers, json={})
    assert response.status_code == 403, response.text

    db = db_session(client)
    reloaded = db.get(SignerPayment, payment.id)
    assert reloaded.status == "succeeded", "a refused refund must never touch the payment row"
    assert reloaded.refunded_amount_cents == 0


def test_full_refund_via_the_route_marks_the_payment_refunded(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)
    response = client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "refunded"
    assert body["refunded_amount_cents"] == 1000


def test_partial_refund_via_the_route_leaves_the_payment_succeeded(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)
    response = client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={"amount_cents": 400})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "succeeded"
    assert body["refunded_amount_cents"] == 400


def test_refund_of_a_partial_over_the_remaining_balance_is_refused(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)
    client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={"amount_cents": 400})
    response = client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={"amount_cents": 700})
    assert response.status_code in (400, 409), response.text
    assert "between 1 and 600" in response.json()["detail"]


def test_refund_of_an_already_fully_refunded_payment_is_refused(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers, document_id, alice, bob, payment = _prepare_settled_document(client, pdf_bytes, monkeypatch)
    first = client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={})
    assert first.status_code == 200, first.text
    second = client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={})
    assert second.status_code in (400, 409), second.text
    # `refund()` has nothing left to give back: the remaining balance is 0.
    assert "between 1 and 0" in second.json()["detail"]


def test_refund_of_an_unsettled_payment_is_refused(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    db = db_session(client)
    payment = SignerPayment(
        organization_id=client.get("/api/auth/me", headers=headers).json()["organization_id"],
        document_id=document_id,
        recipient_id="rec_fake",
        field_id="field_fake",
        amount_cents=500,
        currency="usd",
        status="requires_payment",
        provider="stripe",
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    response = client.post(f"/api/payments/{payment.id}/refund", headers=headers, json={})
    assert response.status_code in (400, 409), response.text
    assert "succeeded payment" in response.json()["detail"]
