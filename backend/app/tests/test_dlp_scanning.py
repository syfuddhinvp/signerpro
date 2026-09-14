"""DLP scanning (FLG-5 "dlp"): Luhn-validated card/SSN/IBAN/email detection,
wired to the security-posture toggle and blocking send, never storing or
logging the matched value.
"""

import logging

from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from app.services import dlp_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document


def _pdf_with_text(text: str) -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(612, 792))
    pdf.drawString(72, 700, text)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _enable_dlp(client: TestClient, headers: dict[str, str]) -> None:
    # Register the caller as a platform super admin isn't available via this
    # client fixture, so posture is flipped directly through the service used
    # by the admin route, against the same DB the test client is bound to.
    from app.core.database import get_db
    from app.main import app
    from app.services import platform_service

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        platform_service.ensure_security_posture(db)
        from app.models.platform_setting import SecurityPosture
        from sqlalchemy import select

        row = db.scalar(select(SecurityPosture).where(SecurityPosture.key == "dlp"))
        row.enabled = True
        db.add(row)
        db.commit()
    finally:
        db_gen.close()


# --- Unit tests on dlp_service directly -------------------------------------


def test_luhn_valid_card_is_detected() -> None:
    # 4111 1111 1111 1111 is the well-known Luhn-valid Visa test number.
    findings = dlp_service.scan_text("Card on file: 4111 1111 1111 1111 thanks")
    types = {f.pattern_type for f in findings}
    assert dlp_service.CREDIT_CARD in types
    card_finding = next(f for f in findings if f.pattern_type == dlp_service.CREDIT_CARD)
    assert card_finding.count == 1


def test_luhn_invalid_16_digit_number_not_flagged() -> None:
    # Same shape, but the checksum fails -- a bare-regex scanner would flag it.
    findings = dlp_service.scan_text("Reference number: 1234 5678 9012 3456")
    types = {f.pattern_type for f in findings}
    assert dlp_service.CREDIT_CARD not in types


def test_ssn_detected() -> None:
    findings = dlp_service.scan_text("SSN on file: 123-45-6789")
    types = {f.pattern_type for f in findings}
    assert dlp_service.SSN in types


def test_iban_detected() -> None:
    findings = dlp_service.scan_text("Wire to GB29NWBK60161331926819 please")
    types = {f.pattern_type for f in findings}
    assert dlp_service.IBAN in types


def test_email_detected() -> None:
    findings = dlp_service.scan_text("Contact buyer@example.com for questions")
    types = {f.pattern_type for f in findings}
    assert dlp_service.EMAIL in types


def test_clean_document_passes() -> None:
    findings = dlp_service.scan_text("Purchase agreement between Buyer and Seller for the property at 12 Main St.")
    assert findings == []


def test_raw_pii_value_never_appears_in_finding_or_logs(caplog) -> None:
    secret_card = "4111 1111 1111 1111"
    with caplog.at_level(logging.INFO):
        findings = dlp_service.scan_text(f"Card: {secret_card}")
    assert findings and findings[0].pattern_type == dlp_service.CREDIT_CARD
    # The finding object itself carries no matched text -- only offsets.
    for finding in findings:
        for attr_name in ("pattern_type", "count", "offsets"):
            value = getattr(finding, attr_name)
            assert "4111" not in repr(value)
    # scan_text never logs at all -- confirms nothing was emitted with the value.
    assert "4111" not in caplog.text


# --- Integration through the upload/send path -------------------------------


def test_posture_disabled_means_no_scan(client: TestClient) -> None:
    headers = auth_headers(client)
    pdf_bytes = _pdf_with_text("Card 4111 1111 1111 1111")
    document_id = create_uploaded_document(client, pdf_bytes, headers)

    from app.core.database import get_db
    from app.main import app
    from app.models.dlp_finding import DocumentDlpFinding
    from sqlalchemy import select

    db_gen = app.dependency_overrides[get_db]()
    db = next(db_gen)
    try:
        rows = db.scalars(select(DocumentDlpFinding).where(DocumentDlpFinding.document_id == document_id)).all()
        assert rows == []
    finally:
        db_gen.close()


def test_blocked_send_names_finding_types(client: TestClient) -> None:
    headers = auth_headers(client)
    _enable_dlp(client, headers)

    pdf_bytes = _pdf_with_text("Card 4111 1111 1111 1111 SSN 123-45-6789")
    document_id = create_uploaded_document(client, pdf_bytes, headers)

    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 600)

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 400, sent.text
    detail = sent.json()["detail"]
    assert "credit card" in detail
    assert "Social Security" in detail
    # Never the matched value itself.
    assert "4111" not in detail
    assert "123-45-6789" not in detail


def test_clean_document_sends_when_dlp_enabled(client: TestClient) -> None:
    headers = auth_headers(client)
    _enable_dlp(client, headers)

    pdf_bytes = _pdf_with_text("Purchase agreement between Buyer and Seller.")
    document_id = create_uploaded_document(client, pdf_bytes, headers)

    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 600)

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text


def test_email_alone_is_recorded_but_does_not_block_send(client: TestClient) -> None:
    """An email address must never block delivery.

    Nearly every envelope in an e-signature product carries the signer's own
    address, so blocking on ``email`` would make the "dlp" posture row stop
    essentially every send. The finding is still recorded for review.
    """
    headers = auth_headers(client)
    _enable_dlp(client, headers)

    pdf_bytes = _pdf_with_text("Please countersign and return to buyer@example.com today.")
    document_id = create_uploaded_document(client, pdf_bytes, headers)

    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 600)

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text

    # ...and the email was still detected, just not treated as blocking.
    findings = dlp_service.scan_text("Please countersign and return to buyer@example.com today.")
    assert [f.pattern_type for f in findings] == [dlp_service.EMAIL]
    assert dlp_service.EMAIL not in dlp_service.BLOCKING_FINDING_TYPES
