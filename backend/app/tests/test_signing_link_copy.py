"""Copy-link (SIGN-x): a sender mints a fresh signing URL out-of-band.

Email delivery is not always available, and the raw token is never stored
(only its hash), so "copy the link" has to mint a new one -- which, by
``token_service.create_for_recipient``'s existing contract, revokes whatever
was live before. These tests pin that pairing plus the surrounding guards.
"""

from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document, token_from_link


def _second_org_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Org",
            "name": "Other Admin",
            "email": "other-admin@example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _link_url(client: TestClient, document_id: str, recipient_id: str, headers: dict[str, str]):
    return client.post(f"/api/documents/{document_id}/recipients/{recipient_id}/signing-link", headers=headers)


def test_signing_link_copy_mints_a_usable_url_and_revokes_the_old_one(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 620)

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    old_token = token_from_link(sent.json()["signing_links"][0]["signing_link"])

    # The originally emailed token still works before we mint a replacement.
    assert client.get(f"/api/sign/{old_token}").status_code == 200

    response = _link_url(client, document_id, recipient_id, headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert "url" in body and "expires_at" in body
    new_token = token_from_link(body["url"])
    assert new_token != old_token

    # New token works.
    assert client.get(f"/api/sign/{new_token}").status_code == 200
    # Old token is now revoked (403), not merely stale.
    revoked = client.get(f"/api/sign/{old_token}")
    assert revoked.status_code == 403, revoked.text


def test_signing_link_copy_writes_an_audit_event_naming_the_actor(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 620)
    client.post(f"/api/documents/{document_id}/send", headers=headers)

    response = _link_url(client, document_id, recipient_id, headers)
    assert response.status_code == 200, response.text

    audit = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers)
    assert audit.status_code == 200, audit.text
    events = audit.json() if isinstance(audit.json(), list) else audit.json()["events"]
    matching = [e for e in events if e["event_type"] == "signing_link_issued"]
    assert matching, events
    assert "admin@example.com" in matching[-1]["event_message"]
    assert "buyer@example.com" in matching[-1]["event_message"]


def test_signing_link_copy_is_tenant_scoped(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 620)
    client.post(f"/api/documents/{document_id}/send", headers=headers)

    other_headers = _second_org_headers(client)
    response = _link_url(client, document_id, recipient_id, other_headers)
    assert response.status_code == 404, response.text


def test_signing_link_copy_refuses_a_draft_document(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")

    response = _link_url(client, document_id, recipient_id, headers)
    assert response.status_code == 400, response.text


def test_signing_link_copy_refuses_a_completed_recipient(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    sig = add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 620)

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    assert client.post(f"/api/sign/{token}/consent").status_code == 200
    assert client.post(
        f"/api/sign/{token}/fields/{sig}/signature",
        json={"signature_type": "typed", "signature_text": "Buyer One"},
    ).status_code == 200
    complete = client.post(f"/api/sign/{token}/complete")
    assert complete.status_code == 200, complete.text

    response = _link_url(client, document_id, recipient_id, headers)
    assert response.status_code == 400, response.text


def test_signing_link_copy_refuses_a_copy_recipient(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, signer_id, "signature", "Buyer signature", 620)

    cc = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={"name": "Observer", "email": "observer@example.com", "role": "copy", "signing_order": 1},
    )
    assert cc.status_code == 201, cc.text
    cc_id = cc.json()["id"]

    client.post(f"/api/documents/{document_id}/send", headers=headers)

    response = _link_url(client, document_id, cc_id, headers)
    assert response.status_code == 400, response.text
