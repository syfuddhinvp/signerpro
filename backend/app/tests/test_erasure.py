"""GDPR erasure (W11).

The tests that matter here are the ones pinning what erasure must NOT do: it
must not break the audit chain, and it must not quietly rewrite an executed
contract's recipients.
"""

from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers
from app.tests.test_signer_audit import _sent_document


def _register(client: TestClient, email: str, org: str = "Erasure Co") -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": "Subject", "email": email, "password": "strong-password"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _platform_admin(client: TestClient) -> dict[str, str]:
    from app.models.user import User

    headers = _register(client, "platformadmin@example.com", org="Platform Co")
    db = _db()
    user = db.query(User).filter(User.email == "platformadmin@example.com").one()
    user.is_platform_admin = True
    db.commit()
    return headers


def test_erasure_removes_the_account_and_reports_what_it_kept(client: TestClient) -> None:
    from app.models.user import User

    subject = _register(client, "subject@example.com")
    assert client.get("/api/auth/me", headers=subject).status_code == 200

    admin = _platform_admin(client)
    response = client.post(
        "/api/platform/erasure", json={"email": "subject@example.com"}, headers=admin
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["erased"]["user"] == 1
    assert "17(3)" in body["retention_basis"]

    db = _db()
    assert db.query(User).filter(User.email == "subject@example.com").one_or_none() is None
    erased = db.query(User).filter(User.status == "erased").one()
    assert erased.email.endswith("@invalid.erased") and erased.name != "subject@example.com"

    # The session is gone, so the erased user's credential dies with the data.
    assert client.get("/api/auth/me", headers=subject).status_code == 401


def test_erasure_does_not_break_the_audit_chain(client: TestClient, pdf_bytes: bytes) -> None:
    """The whole design constraint, in one test.

    Rewriting audit rows to satisfy Article 17 would make the chain report
    itself as tampered with -- correctly. So erasure must leave it alone.
    """
    headers = auth_headers(client)
    document_id, _, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    before = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers).json()
    assert before["valid"] is True

    admin = _platform_admin(client)
    report = client.post(
        "/api/platform/erasure", json={"email": "buyer@example.com"}, headers=admin
    ).json()

    after = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers).json()
    assert after["valid"] is True
    assert after["chain_head"] == before["chain_head"]
    # And it says so rather than implying the signer was forgotten everywhere.
    assert report["retained"].get("recipients_on_sent_or_executed_documents", 0) >= 1


def test_a_sealed_documents_recipients_are_retained_not_redacted(
    client: TestClient, pdf_bytes: bytes
) -> None:
    from app.models.recipient import Recipient

    headers = auth_headers(client)
    document_id, recipient_id, name_field, token = _sent_document(client, pdf_bytes, headers)
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    client.post(f"/api/sign/{token}/complete")

    admin = _platform_admin(client)
    client.post("/api/platform/erasure", json={"email": "buyer@example.com"}, headers=admin)

    db = _db()
    recipient = db.get(Recipient, recipient_id)
    # Still the real address: this is a record of who actually signed.
    assert recipient.email == "buyer@example.com"


def test_erasure_requires_platform_admin(client: TestClient) -> None:
    ordinary = _register(client, "nobody@example.com", org="Nobody Co")
    assert client.post(
        "/api/platform/erasure", json={"email": "nobody@example.com"}, headers=ordinary
    ).status_code == 403


def test_erasure_of_an_unknown_address_is_not_an_error(client: TestClient) -> None:
    """A subject with nothing stored is still entitled to an answer."""
    admin = _platform_admin(client)
    body = client.post(
        "/api/platform/erasure", json={"email": "never-seen@example.com"}, headers=admin
    ).json()
    assert body["erased"] == {} or body["erased"].get("user") is None
