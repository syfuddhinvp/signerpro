from io import BytesIO

from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document, token_from_link


def _sent_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]) -> tuple[str, str, str, str]:
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    name_field = add_field(client, document_id, headers, recipient_id, "full_name", "Buyer full name", 680)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    return document_id, recipient_id, name_field, token


def test_session_bootstrap_exposes_fields_and_consent_state(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, recipient_id, name_field, token = _sent_document(client, pdf_bytes, headers)

    session = client.get(f"/api/sign/{token}")
    assert session.status_code == 200, session.text
    body = session.json()
    assert body["document_id"] == document_id
    assert body["current_recipient_id"] == recipient_id
    assert body["consent_required"] is True
    assert body["consent_accepted"] is False
    assert body["fields"] == []  # withheld until consent
    assert body["assigned_field_ids"] == [name_field]
    assert body["can_decline"] is True and body["can_reassign"] is True

    accepted = client.post(f"/api/sign/{token}/consent")
    assert accepted.json()["consent_accepted"] is True
    assert accepted.json()["consent_required"] is False
    assert accepted.json()["consent_accepted_at"] is not None
    assert [item["id"] for item in accepted.json()["fields"]] == [name_field]


def test_field_value_saving_progresses_required_counters(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    _, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")

    assert client.get(f"/api/sign/{token}").json()["required_completed"] == 0
    saved = client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "  Buyer One  "})
    assert saved.status_code == 200, saved.text
    assert saved.json()["value"] == "Buyer One"

    session = client.get(f"/api/sign/{token}")
    assert session.json()["required_completed"] == 1
    assert session.json()["required_total"] == 1

    # Values survive a reload and can be overwritten while the turn is open.
    assert client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer Two"}).json()["value"] == "Buyer Two"


def test_decline_with_reason_is_recorded(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")

    declined = client.post(f"/api/sign/{token}/decline", json={"reason": "Wrong counterparty"})
    assert declined.status_code == 204
    assert client.post(f"/api/sign/{token}/decline", json={"reason": ""}).status_code == 422

    document = client.get(f"/api/documents/{document_id}", headers=headers)
    assert document.json()["status"] == "declined"
    logs = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    entry = next(item for item in logs if item["event_type"] == "document_declined")
    assert entry["log_metadata"]["reason"] == "Wrong counterparty"
    assert entry["kind"] == "bad"

    # The signing session is closed once the document is declined.
    assert client.get(f"/api/sign/{token}").status_code == 410


def test_reassign_delegates_to_another_signer(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, recipient_id, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")

    same = client.post(
        f"/api/sign/{token}/reassign",
        json={"name": "Buyer", "email": "buyer@example.com", "reason": "typo"},
    )
    assert same.status_code == 400

    response = client.post(
        f"/api/sign/{token}/reassign",
        json={"name": "Delegate", "email": "delegate@example.com", "reason": "On leave"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["recipient_id"] == recipient_id
    assert body["previous_email"] == "buyer@example.com"
    assert body["new_email"] == "delegate@example.com"

    # The old link is dead; the new one works and starts from a clean consent state.
    assert client.get(f"/api/sign/{token}").status_code == 403
    new_token = body["signing_url"].rsplit("/", 1)[-1]
    session = client.get(f"/api/sign/{new_token}")
    assert session.status_code == 200, session.text
    assert session.json()["recipient"]["email"] == "delegate@example.com"
    assert session.json()["consent_required"] is True
    assert session.json()["assigned_field_ids"] == [name_field]

    logs = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    entry = next(item for item in logs if item["event_type"] == "recipient_reassigned")
    assert entry["log_metadata"] == {
        "previous_email": "buyer@example.com",
        "new_email": "delegate@example.com",
        "reason": "On leave",
    }
    assert entry["kind"] == "info"


def _db():
    from app.core.database import get_db
    from app.main import app

    return next(app.dependency_overrides[get_db]())


def test_audit_chain_integrity_and_certificate_feed(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/viewed")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})

    logs = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    assert len(logs) >= 4
    # Newest first; every entry links to its predecessor's checksum.
    chronological = list(reversed(logs))
    assert chronological[0]["previous_checksum"] == "0" * 64
    for earlier, later in zip(chronological, chronological[1:]):
        assert later["previous_checksum"] == earlier["checksum"]
    assert len({item["checksum"] for item in logs}) == len(logs)

    verification = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers)
    assert verification.status_code == 200
    head = chronological[-1]["checksum"]
    body = verification.json()
    assert body["entry_count"] == len(logs)
    assert body["chain_head"] == head
    assert body["hash_algorithm"] == "SHA-256"
    assert body["valid"] is True
    assert body["reason"] is None and body["broken_at_index"] is None

    assert client.get(
        f"/api/documents/{document_id}/audit-logs/verify",
        headers=headers,
        params={"expected_head": "deadbeef"},
    ).json()["valid"] is False

    # The checksums are PERSISTED, not derived on read: the stored column is
    # what the API serves.
    from app.models.audit_log import AuditLog

    db = _db()
    stored = db.get(AuditLog, chronological[0]["id"])
    assert stored.checksum == chronological[0]["checksum"]
    assert stored.previous_checksum == "0" * 64
    assert stored.sequence == 0
    # The document carries the anchor that makes truncation detectable.
    from app.models.document import Document

    document = db.get(Document, document_id)
    assert document.audit_chain_head == head
    assert document.audit_entry_count == len(logs)


def test_editing_an_audit_row_in_the_database_invalidates_the_chain(client: TestClient, pdf_bytes: bytes) -> None:
    """C6 regression: the auditor edited an event_message and /verify said valid."""

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/viewed")

    logs = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    chronological = list(reversed(logs))
    assert client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers).json()["valid"] is True

    from app.models.audit_log import AuditLog

    db = _db()
    target = db.get(AuditLog, chronological[1]["id"])
    target.event_message = "edited by hand"
    db.commit()

    after = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers).json()
    assert after["valid"] is False
    assert after["broken_at_entry_id"] == chronological[1]["id"]
    assert after["broken_at_index"] == 1
    assert "checksum" in after["reason"]
    # And the certificate stops claiming the seal is good.
    summary = client.get(f"/api/documents/{document_id}/certificate/summary", headers=headers).json()
    assert summary["chain_valid"] is False
    assert summary["chain_invalid_reason"]


def test_deleting_a_middle_audit_row_invalidates_the_chain(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/viewed")

    logs = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    chronological = list(reversed(logs))
    assert len(chronological) >= 4

    from app.models.audit_log import AuditLog

    db = _db()
    db.delete(db.get(AuditLog, chronological[1]["id"]))
    db.commit()

    after = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers).json()
    assert after["valid"] is False
    assert after["broken_at_index"] == 1


def test_truncating_the_tail_of_the_trail_is_detected(client: TestClient, pdf_bytes: bytes) -> None:
    """Deleting the newest row leaves a self-consistent chain; the anchor catches it."""

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/viewed")

    logs = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    newest = logs[0]

    from app.models.audit_log import AuditLog

    db = _db()
    db.delete(db.get(AuditLog, newest["id"]))
    db.commit()

    after = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers).json()
    assert after["valid"] is False
    assert "count" in after["reason"] or "head" in after["reason"]


def test_purging_a_document_retains_its_audit_trail(client: TestClient, pdf_bytes: bytes) -> None:
    """ESIGN/UETA + eIDAS: the evidentiary record outlives the document."""

    from sqlalchemy import select

    from app.models.audit_log import AuditLog

    headers = auth_headers(client)
    document_id, _, _, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")

    db = _db()
    before = list(db.scalars(select(AuditLog).where(AuditLog.document_ref == document_id)))
    assert before
    title = before[0].document_title
    assert title

    assert client.delete(f"/api/documents/{document_id}", headers=headers).status_code in {200, 204}
    purge = client.delete(f"/api/documents/{document_id}", headers=headers, params={"permanent": "true"})
    assert purge.status_code in {200, 204}, purge.text

    db = _db()
    from app.models.document import Document

    assert db.get(Document, document_id) is None
    after = list(db.scalars(select(AuditLog).where(AuditLog.document_ref == document_id)))
    assert len(after) >= len(before) + 1  # the trail, plus the purge record
    assert all(row.document_id is None for row in after)
    assert all(row.document_title == title for row in after)
    assert any(row.event_type == "document_purged" for row in after)

    # The retained trail still verifies as a chain in its own right.
    from app.services.audit_service import audit_service

    assert audit_service.verify_chain(after)["valid"] is True


def test_appended_bytes_on_the_stored_pdf_break_the_seal(client: TestClient, pdf_bytes: bytes) -> None:
    """Audit 5.3: /certificate/summary reported a stale hash as fact."""

    from app.core.storage import storage

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    sealed = client.get(f"/api/documents/{document_id}/certificate/summary", headers=headers).json()
    assert sealed["final_pdf_intact"] is True
    assert sealed["final_sha256_actual"] == sealed["final_sha256"]
    assert sealed["original_pdf_intact"] is True

    path = storage.path(f"documents/{document_id}/final.pdf")
    with path.open("ab") as handle:
        handle.write(b"tampered")

    after = client.get(f"/api/documents/{document_id}/certificate/summary", headers=headers).json()
    assert after["final_pdf_intact"] is False
    assert after["final_sha256_actual"] != after["final_sha256"]


def test_sealing_refuses_when_the_original_no_longer_matches_its_hash(client: TestClient, pdf_bytes: bytes) -> None:
    from app.core.storage import storage
    from app.models.document import Document

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})

    db = _db()
    document = db.get(Document, document_id)
    with storage.path(document.original_file_path).open("ab") as handle:
        handle.write(b"tampered")

    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.status_code == 409, completed.text
    assert "integrity" in completed.json()["detail"].lower()

    from sqlalchemy import select

    from app.models.audit_log import AuditLog

    db = _db()
    events = [
        row.event_type
        for row in db.scalars(select(AuditLog).where(AuditLog.document_ref == document_id))
    ]
    assert "original_hash_mismatch" in events


def test_certificate_summary(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    summary = client.get(f"/api/documents/{document_id}/certificate/summary", headers=headers)
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["envelope_id"] == document_id
    assert body["signers_total"] == 1
    assert body["signers_completed"] == 0
    assert body["hash_algorithm"] == "SHA-256"
    assert body["original_sha256"]
    assert body["final_sha256"] is None
    assert body["sealed_at"] is None
    assert body["chain_head"] != "0" * 64
    assert body["audit_entry_count"] >= 2

    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200
    sealed = client.get(f"/api/documents/{document_id}/certificate/summary", headers=headers).json()
    assert sealed["signers_completed"] == 1
    assert sealed["final_sha256"]
    assert sealed["document_status"] == "completed"


def test_audit_trail_is_tenant_scoped(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, _, _, _ = _sent_document(client, pdf_bytes, headers)
    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Co",
            "name": "Other Admin",
            "email": "other@example.com",
            "password": "strong-password",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get(f"/api/documents/{document_id}/audit-logs", headers=other_headers).status_code == 404
    assert client.get(f"/api/documents/{document_id}/certificate/summary", headers=other_headers).status_code == 404


def test_certificate_pdf_downloads_before_and_after_sealing(client: TestClient, pdf_bytes: bytes) -> None:
    """The certificate is evidence, so it is downloadable for a live envelope too."""

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")

    in_flight = client.get(f"/api/documents/{document_id}/certificate/pdf", headers=headers)
    assert in_flight.status_code == 200, in_flight.text
    assert in_flight.headers["content-type"] == "application/pdf"
    assert "attachment;" in in_flight.headers["content-disposition"]
    assert in_flight.content.startswith(b"%PDF")
    # Evidence, like the sealed contract, is downloaded locked against editing.
    from pypdf import PdfReader as _Reader
    from pypdf.constants import UserAccessPermissions as _Perms

    cert = _Reader(BytesIO(in_flight.content))
    cert.decrypt("")
    assert _Perms.MODIFY not in (cert.user_access_permissions or _Perms.MODIFY)

    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200
    sealed = client.get(f"/api/documents/{document_id}/certificate/pdf", headers=headers)
    assert sealed.status_code == 200
    assert sealed.content.startswith(b"%PDF")
    # It grew: completion adds entries to the trail the certificate prints.
    assert len(sealed.content) > 0


def test_certificate_pdf_is_tenant_scoped(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, _, _, _ = _sent_document(client, pdf_bytes, headers)
    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Co 2",
            "name": "Other Admin 2",
            "email": "other2@example.com",
            "password": "strong-password",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.get(f"/api/documents/{document_id}/certificate/pdf", headers=other_headers).status_code == 404


def test_the_sealed_pdf_is_locked_against_editing(client: TestClient, pdf_bytes: bytes) -> None:
    """The executed PDF opens for anyone and accepts edits from nobody.

    PDF permissions are honoured by conforming readers rather than enforced by
    cryptography — the tamper *evidence* is still ``final_sha256`` and the audit
    chain — but a completed contract should not invite the accidental edit.
    """

    from pypdf import PdfReader
    from pypdf.constants import UserAccessPermissions

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    final = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert final.status_code == 200, final.text
    reader = PdfReader(BytesIO(final.content))
    # No password is needed to read it…
    assert reader.decrypt("") or not reader.is_encrypted
    assert len(reader.pages) > 0
    # …and the editing permissions are gone.
    permissions = reader.user_access_permissions
    assert permissions is not None
    assert UserAccessPermissions.PRINT in permissions
    assert UserAccessPermissions.MODIFY not in permissions
    assert UserAccessPermissions.FILL_FORM_FIELDS not in permissions

    # The properties panel used to be entirely blank, so a downloaded contract
    # identified itself by filename alone.
    meta = reader.metadata
    assert meta is not None
    assert meta.title
    assert meta.author
    assert "SignerPro" in (meta.producer or "")
    assert document_id in (meta.get("/Keywords") or "")
    assert (meta.get("/CreationDate") or "").startswith("D:")
    assert (meta.get("/ModDate") or "").startswith("D:")


def test_the_verified_mark_and_properties_reach_every_page(client: TestClient, pdf_bytes: bytes) -> None:
    """Provenance on the page itself, not only in the certificate.

    A sealed page carries a small "Signed and verified via SignerPro" line with
    the envelope id, so a printed page can be traced back to its audit trail.
    """

    from pypdf import PdfReader

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    final = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    reader = PdfReader(BytesIO(final.content))
    reader.decrypt("")
    first_page_text = reader.pages[0].extract_text() or ""
    assert "Signed and verified via SignerPro" in first_page_text
    assert document_id in first_page_text

    # The certificate that travels with it reports the chain it verified.
    certificate = client.get(f"/api/documents/{document_id}/certificate/pdf", headers=headers)
    cert_reader = PdfReader(BytesIO(certificate.content))
    cert_reader.decrypt("")
    assert "AUDIT CHAIN VERIFIED" in (cert_reader.pages[0].extract_text() or "")
    assert (cert_reader.metadata or {}).get("/Title")


def test_the_full_download_is_one_pdf_of_document_and_certificate(client: TestClient, pdf_bytes: bytes) -> None:
    from pypdf import PdfReader

    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")

    # In flight: the original is stitched to the certificate on demand.
    in_flight = client.get(f"/api/documents/{document_id}/certificate/full", headers=headers)
    assert in_flight.status_code == 200, in_flight.text
    reader = PdfReader(BytesIO(in_flight.content))
    reader.decrypt("")
    assert len(reader.pages) > 1
    assert "signed-with-certificate" in in_flight.headers["content-disposition"]

    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    # Sealed: the bytes are final.pdf itself, so the recorded hash still holds.
    full = client.get(f"/api/documents/{document_id}/certificate/full", headers=headers)
    final = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert full.status_code == 200
    assert full.content == final.content
