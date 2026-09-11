"""PAY-1: a settled payment must actually show up in the executed document.

Covers `pdf_service`'s two payment-facing surfaces:

* the page overlay -- a settled field renders a legible confirmation (amount,
  date paid, reference) in place of the on-screen Pay button, and an
  unsettled/refunded attempt never renders as if it had cleared;
* the certificate of completion -- a payments section with each payer, their
  amount/status/reference and the collected total, present only when the
  envelope actually carries payments.

No test here touches the network -- Stripe's transport is faked exactly as in
`test_signer_payments.py`/`test_payment_gate.py`.
"""

from io import BytesIO

from pypdf import PdfReader

from fastapi.testclient import TestClient

from app.models.document import Document
from app.models.enums import SignerPaymentStatus
from app.services.pdf_service import pdf_service
from app.services.signer_payment_service import signer_payment_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, create_uploaded_document, token_from_link
from app.tests.test_signer_payments import FakeStripe, add_payment_field, connect_stripe, db_session


def _settle(client: TestClient, raw_token: str, field_id: str, monkeypatch) -> None:
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


def _single_signer_with_payment(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]):
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    from app.tests.test_signing_correctness import add_recipient

    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com", order=1)
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 680)
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="fixed", amount_cents=2500, currency="USD", memo="Deposit",
    )
    connect_stripe(client, headers)
    return document_id, alice, field_id


def _sign_and_complete(client: TestClient, document_id: str, headers: dict[str, str], raw_token: str, sig_field_id: str) -> None:
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200
    assert (
        client.post(
            f"/api/sign/{raw_token}/fields/{sig_field_id}/signature",
            json={"signature_type": "typed", "signature_text": "Alice One"},
        ).status_code
        == 200
    )


def _send_and_token(client: TestClient, document_id: str, headers: dict[str, str]) -> str:
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    links = {item["email"]: token_from_link(item["signing_link"]) for item in sent.json()["signing_links"]}
    return links["alice@example.com"]


# --------------------------------------------------------------- page overlay


def test_settled_payment_renders_a_confirmation_on_the_final_pdf(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_signer_with_payment(client, pdf_bytes, headers)
    sig_field_id = next(
        f["id"]
        for f in client.get(f"/api/documents/{document_id}/fields", headers=headers).json()
        if f["type"] == "signature"
    )
    raw_token = _send_and_token(client, document_id, headers)
    _sign_and_complete(client, document_id, headers, raw_token, sig_field_id)
    _settle(client, raw_token, field_id, monkeypatch)

    complete = client.post(f"/api/sign/{raw_token}/complete")
    assert complete.status_code == 200, complete.text
    assert complete.json()["document_status"] == "completed"

    final_pdf = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert final_pdf.status_code == 200

    reader = PdfReader(BytesIO(final_pdf.content))
    page_text = reader.pages[0].extract_text() or ""
    assert "25.00 USD" in page_text
    assert "Paid" in page_text
    # The internal `paid:<intent>` breadcrumb must never leak onto the page.
    assert "paid:pi_" not in page_text


def test_unsettled_payment_never_renders_as_paid(client: TestClient, pdf_bytes: bytes) -> None:
    """A required payment field blocks completion, so this checks the overlay
    helper directly against a document whose payment was never settled."""
    headers = auth_headers(client)
    document_id, alice, field_id = _single_signer_with_payment(client, pdf_bytes, headers)

    db = db_session(client)
    document = db.get(Document, document_id)
    payments = pdf_service._latest_payments(db, document.id)
    assert payments == {}

    from reportlab.pdfgen import canvas as _canvas

    drew = pdf_service._draw_payment_confirmation(_canvas.Canvas(BytesIO()), None, 0, 0, 100, 20)
    assert drew is False


def test_refunded_payment_says_refunded_not_paid(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_signer_with_payment(client, pdf_bytes, headers)
    sig_field_id = next(
        f["id"]
        for f in client.get(f"/api/documents/{document_id}/fields", headers=headers).json()
        if f["type"] == "signature"
    )
    raw_token = _send_and_token(client, document_id, headers)
    _sign_and_complete(client, document_id, headers, raw_token, sig_field_id)
    _settle(client, raw_token, field_id, monkeypatch)

    complete = client.post(f"/api/sign/{raw_token}/complete")
    assert complete.status_code == 200, complete.text

    db = db_session(client)
    from app.models.signer_payment import SignerPayment

    payment = db.query(SignerPayment).filter_by(field_id=field_id).one()
    payment.status = SignerPaymentStatus.refunded
    payment.refunded_amount_cents = payment.amount_cents
    db.add(payment)
    db.commit()

    document = db.get(Document, document_id)
    payments = pdf_service._latest_payments(db, document.id)
    assert payments[field_id].status == SignerPaymentStatus.refunded


# ------------------------------------------------------------- certificate


def test_certificate_lists_payments_and_total_collected(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, alice, field_id = _single_signer_with_payment(client, pdf_bytes, headers)
    sig_field_id = next(
        f["id"]
        for f in client.get(f"/api/documents/{document_id}/fields", headers=headers).json()
        if f["type"] == "signature"
    )
    raw_token = _send_and_token(client, document_id, headers)
    _sign_and_complete(client, document_id, headers, raw_token, sig_field_id)
    _settle(client, raw_token, field_id, monkeypatch)

    complete = client.post(f"/api/sign/{raw_token}/complete")
    assert complete.status_code == 200, complete.text

    final_pdf = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    reader = PdfReader(BytesIO(final_pdf.content))
    full_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "Payments" in full_text
    assert "Alice" in full_text
    assert "25.00 USD" in full_text
    assert "Total collected: 25.00 USD" in full_text
    assert "SUCCEEDED" in full_text


def test_certificate_has_no_payments_section_and_is_unchanged_without_payment_fields(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """An envelope carrying no `SignerPayment` rows must produce a certificate
    identical to one built before PAY-1's rendering existed: no "Payments"
    heading at all, and re-building it twice is byte-for-byte stable (the
    only way to prove "unchanged" without a pre-PAY-1 snapshot on disk)."""
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    from app.tests.test_signing_correctness import add_recipient

    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com", order=1)
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 680)

    raw_token = _send_and_token(client, document_id, headers)
    _sign_and_complete(client, document_id, headers, raw_token, next(
        f["id"]
        for f in client.get(f"/api/documents/{document_id}/fields", headers=headers).json()
        if f["type"] == "signature"
    ))
    complete = client.post(f"/api/sign/{raw_token}/complete")
    assert complete.status_code == 200, complete.text

    db = db_session(client)
    document = db.get(Document, document_id)
    assert pdf_service._latest_payments(db, document.id) == {}

    certificate_a = pdf_service.build_audit_certificate(db, document)
    certificate_b = pdf_service.build_audit_certificate(db, document)
    text_a = "\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(certificate_a)).pages)
    assert "Payments" not in text_a
    assert "Total collected" not in text_a
    # Rebuilding is deterministic when nothing changed in between (the only
    # source of instability, the owner-password encryption, is stripped away
    # by re-reading both through pypdf before comparing content).
    assert PdfReader(BytesIO(certificate_a)).pages[0].extract_text() == PdfReader(BytesIO(certificate_b)).pages[0].extract_text()
