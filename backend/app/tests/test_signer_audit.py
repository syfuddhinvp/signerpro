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
    assert verification.json() == {
        "entry_count": len(logs),
        "chain_head": head,
        "hash_algorithm": "SHA-256",
        "valid": True,
    }
    assert client.get(
        f"/api/documents/{document_id}/audit-logs/verify",
        headers=headers,
        params={"expected_head": "deadbeef"},
    ).json()["valid"] is False

    # Tampering with a stored entry breaks every checksum from that point on.
    from app.core.database import get_db
    from app.main import app
    from app.models.audit_log import AuditLog

    db = next(app.dependency_overrides[get_db]())
    target = db.get(AuditLog, chronological[1]["id"])
    target.event_message = "edited by hand"
    db.commit()

    after = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers).json()
    assert after["chain_head"] != head
    assert client.get(
        f"/api/documents/{document_id}/audit-logs/verify",
        headers=headers,
        params={"expected_head": head},
    ).json()["valid"] is False


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
