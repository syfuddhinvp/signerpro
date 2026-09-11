"""Pay-then-sign (PAY-1) gate: send-time validation and the completion gate.

Complements `test_signer_payments.py`'s coverage of allocation/charging with
the surrounding gates: `complete()` refusing an unpaid signer, the generic
field-value endpoint refusing to touch a payment field, and `send()` refusing
an unpayable or malformed envelope. No test here touches the network.
"""

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.models.document import Document
from app.services.signer_payment_service import signer_payment_service
from app.services.signing_service import signing_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document
from app.tests.test_signer_payments import (
    FakeStripe,
    add_payment_field,
    connect_stripe,
    db_session,
)
from app.tests.test_signing_correctness import add_field, add_recipient, send


def _single_payment_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str], *, connect: bool = True):
    """One `sign` recipient whose only obligation is a required payment field."""
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com", order=1)
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="fixed", amount_cents=1500, currency="USD", memo="Deposit",
    )
    if connect:
        connect_stripe(client, headers)
    return document_id, alice, field_id


# ------------------------------------------------------- complete() gate


def test_complete_is_blocked_until_the_payment_settles_then_succeeds(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_payment_document(client, pdf_bytes, headers)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)

    # 402: the payment field is required and nothing has been paid yet.
    try:
        signing_service.complete(db, raw_token=raw_token, ip_address=None, user_agent=None)
        assert False, "expected 402 before the payment settles"
    except HTTPException as exc:
        assert exc.status_code == 402

    signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    from app.models.signer_payment import SignerPayment

    row = db.query(SignerPayment).filter_by(field_id=field_id).one()
    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
    }
    signer_payment_service.apply_webhook_event(db, event=event)
    document = db.get(Document, document_id)
    db.refresh(document)

    response = signing_service.complete(db, raw_token=raw_token, ip_address=None, user_agent=None)
    assert response.recipient_status == "completed"


# ------------------------------------------------- generic field-value endpoint


def test_generic_field_value_endpoint_refuses_a_payment_field(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_payment_document(client, pdf_bytes, headers)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200

    response = client.post(f"/api/sign/{raw_token}/fields/{field_id}/value", json={"value": "paid:pi_fake"})
    assert response.status_code == 400, response.text


# --------------------------------------------------------------- send() gates


def test_send_is_blocked_without_a_charges_enabled_connected_account(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_payment_document(client, pdf_bytes, headers, connect=False)

    response = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert response.status_code == 409, response.text


def test_send_succeeds_for_a_recipient_whose_only_field_is_a_required_payment(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_payment_document(client, pdf_bytes, headers, connect=True)

    response = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert response.status_code == 200, response.text


def test_send_rejects_a_payment_field_owned_by_a_copy_recipient(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Alice", "alice@example.com", order=1)
    cc = add_recipient(client, document_id, headers, "Carl", "carl@example.com", role="copy", order=1)
    add_field(client, document_id, headers, signer, "signature", "Alice signature", 680)
    add_payment_field(
        client, document_id, headers, cc, "CC deposit", 500,
        amount_mode="fixed", amount_cents=1500, currency="USD",
    )
    connect_stripe(client, headers)

    response = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert response.status_code == 400, response.text


# ----------------------------------------------------- session progress counters


def test_get_signing_session_reports_a_settled_payment_as_completed(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """Regression: the HTTP route must pass ``db`` into ``session_response``.

    A hand patch fixed three call sites in `signing.py` that were calling
    `signing_service.session_response`/`_field_has_value` without `db`, which
    silently counted a genuinely-paid payment field as incomplete — the
    submit button stayed disabled after the signer had actually paid. This
    drives the real HTTP session endpoint end-to-end (never the service
    directly) so dropping ``db=db`` from the route again fails this test.
    """
    headers = auth_headers(client)
    document_id, alice, field_id = _single_payment_document(client, pdf_bytes, headers)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200

    before = client.get(f"/api/sign/{raw_token}")
    assert before.status_code == 200, before.text
    assert before.json()["required_total"] == 1
    assert before.json()["required_completed"] == 0

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    from app.models.signer_payment import SignerPayment

    row = db.query(SignerPayment).filter_by(field_id=field_id).one()
    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
    }
    signer_payment_service.apply_webhook_event(db, event=event)

    after = client.get(f"/api/sign/{raw_token}")
    assert after.status_code == 200, after.text
    payload = after.json()
    assert payload["required_total"] == 1
    assert payload["required_completed"] == 1, (
        "the settled payment must be counted as completed through the HTTP layer, "
        "not just via the service called directly"
    )


def test_optional_unpaid_payment_field_agrees_between_gate_and_session_counters(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """An OPTIONAL payment field must not make the session counters and the
    completion gate disagree. Before this fix, `outstanding_payment_fields`
    ignored `required` while `signing_service`'s own counters did not, so an
    unpaid optional field could show `required_completed == required_total`
    (submit button enabled) while `complete()` still 402'd -- or the reverse.
    Here the property under test is: whatever `complete()` decides, the
    session counters must say the same thing.
    """
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com", order=1)
    signature_field = add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    add_field(
        client, document_id, headers, alice, "payment", "Optional tip", 500,
        required=False,
        options={"amount_mode": "fixed", "amount_cents": 1500, "currency": "USD"},
    )
    connect_stripe(client, headers)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200
    # Satisfy the one *required* obligation (the signature) so the only
    # remaining question is whether the optional, unpaid payment field is
    # counted consistently by the counters and the gate.
    assert (
        client.post(
            f"/api/sign/{raw_token}/fields/{signature_field}/signature",
            json={"signature_type": "typed", "signature_text": "Alice"},
        ).status_code
        == 200
    )

    session = client.get(f"/api/sign/{raw_token}")
    assert session.status_code == 200, session.text
    payload = session.json()
    counters_say_complete = payload["required_completed"] == payload["required_total"]

    db = db_session(client)
    from fastapi import HTTPException

    from app.services.signing_service import signing_service

    signing_token, document, recipient = signing_service.load_session(db, raw_token=raw_token)
    try:
        signer_payment_service.assert_payments_settled(db, document=document, recipient=recipient)
        gate_says_complete = True
    except HTTPException:
        gate_says_complete = False

    # The unpaid optional field must not leave the counters and the gate
    # disagreeing about whether payment is outstanding.
    assert counters_say_complete == gate_says_complete, (
        "an unpaid optional payment field must not leave the session counters "
        "and the completion gate disagreeing"
    )
    # And concretely: an optional, unpaid field is not an obligation at all --
    # both should agree it is already "complete".
    assert counters_say_complete is True
    assert gate_says_complete is True


def test_session_progress_treats_an_unpaid_payment_field_as_incomplete(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_payment_document(client, pdf_bytes, headers)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    signing_token, document, recipient = signing_service.load_session(db, raw_token=raw_token)
    before = signing_service.session_response(
        raw_token=raw_token, signing_token=signing_token, document=document, recipient=recipient, db=db
    )
    assert before.required_total == 1
    assert before.required_completed == 0

    signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    from app.models.signer_payment import SignerPayment

    row = db.query(SignerPayment).filter_by(field_id=field_id).one()
    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
    }
    signer_payment_service.apply_webhook_event(db, event=event)
    db.refresh(document)

    after = signing_service.session_response(
        raw_token=raw_token, signing_token=signing_token, document=document, recipient=recipient, db=db
    )
    assert after.required_total == 1
    assert after.required_completed == 1
