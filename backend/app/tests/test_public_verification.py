"""Unauthenticated verification (W12).

The tamper-evidence claim is only worth something if someone outside the
tenant can check it. These tests pin both halves: that a real counterparty can
verify, and that verification never becomes a way to read or enumerate
documents.
"""

from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers
from app.tests.test_signer_audit import _sent_document


def _executed(client: TestClient, pdf_bytes: bytes):
    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200
    summary = client.get(
        f"/api/documents/{document_id}/certificate/summary", headers=headers
    ).json()
    return document_id, summary["final_sha256"], headers


def test_a_counterparty_can_verify_an_executed_document_with_no_account(
    client: TestClient, pdf_bytes: bytes
) -> None:
    document_id, sha, _ = _executed(client, pdf_bytes)

    # No Authorization header anywhere: this is the whole point.
    response = client.get(f"/api/verify/{document_id}", params={"sha256": sha})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["verified"] is True
    assert body["chain_valid"] is True and body["final_pdf_intact"] is True
    assert body["signers_completed"] == body["signers_total"]
    assert body["sealed_at"] is not None


def test_verification_discloses_nothing_beyond_the_seal(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """Verifying a document must not become a way to read one."""
    document_id, sha, _ = _executed(client, pdf_bytes)
    body = client.get(f"/api/verify/{document_id}", params={"sha256": sha}).json()

    serialised = str(body).lower()
    assert "buyer one" not in serialised       # no field values
    assert "@" not in serialised               # no signer email addresses
    for leaked in ("title", "document_title", "recipients", "fields", "audit_logs"):
        assert leaked not in body


def test_a_wrong_hash_and_an_unknown_id_are_indistinguishable(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """Otherwise this is an oracle for which document ids exist."""
    document_id, _, _ = _executed(client, pdf_bytes)

    wrong_hash = client.get(f"/api/verify/{document_id}", params={"sha256": "0" * 64}).json()
    unknown_id = client.get(
        "/api/verify/00000000-0000-0000-0000-000000000000", params={"sha256": "0" * 64}
    ).json()
    assert wrong_hash == unknown_id
    assert wrong_hash["verified"] is False
    assert wrong_hash["document_id"] is None


def test_the_id_alone_verifies_nothing(client: TestClient, pdf_bytes: bytes) -> None:
    document_id, _, _ = _executed(client, pdf_bytes)
    assert client.get(f"/api/verify/{document_id}").json()["verified"] is False


def test_tampering_with_the_stored_pdf_fails_public_verification(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """The seal is re-hashed from disk, not read back out of the database."""
    from app.core.storage import storage

    document_id, sha, _ = _executed(client, pdf_bytes)
    assert client.get(f"/api/verify/{document_id}", params={"sha256": sha}).json()["verified"] is True

    with storage.path(f"documents/{document_id}/final.pdf").open("ab") as handle:
        handle.write(b"tampered")

    body = client.get(f"/api/verify/{document_id}", params={"sha256": sha}).json()
    assert body["verified"] is False and body["final_pdf_intact"] is False


def test_an_unsent_draft_does_not_verify(client: TestClient, pdf_bytes: bytes) -> None:
    """Only a sealed document is a document anyone should be attesting to."""
    from app.tests.test_document_flow import create_uploaded_document

    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    assert client.get(f"/api/verify/{document_id}", params={"sha256": "0" * 64}).json()["verified"] is False
