from urllib.parse import urlparse

from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers


def create_uploaded_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]) -> str:
    created = client.post("/api/documents", headers=headers, json={"title": "Buyer Seller Packet", "workflow_type": "parallel"})
    assert created.status_code == 201, created.text
    document_id = created.json()["id"]
    upload = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("packet.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["page_count"] == 1
    return document_id


def add_recipient(client: TestClient, document_id: str, headers: dict[str, str], name: str, email: str) -> str:
    response = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={"name": name, "email": email, "role_name": name, "signing_order": 1},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def add_field(client: TestClient, document_id: str, headers: dict[str, str], recipient_id: str, field_type: str, label: str, y: int) -> str:
    response = client.post(
        f"/api/documents/{document_id}/fields",
        headers=headers,
        json={
            "recipient_id": recipient_id,
            "type": field_type,
            "label": label,
            "required": True,
            "page_number": 1,
            "x": 72,
            "y": y,
            "width": 180,
            "height": 32 if field_type != "signature" else 48,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def token_from_link(link: str) -> str:
    return urlparse(link).path.rsplit("/", 1)[-1]


def test_document_upload_validation(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)

    second_upload = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("packet.pdf", pdf_bytes, "application/pdf")},
    )
    assert second_upload.status_code == 409


def test_signer_permissions_completion_final_pdf_and_audit(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    buyer_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    seller_id = add_recipient(client, document_id, headers, "Seller", "seller@example.com")

    buyer_name = add_field(client, document_id, headers, buyer_id, "full_name", "Buyer full name", 680)
    buyer_sig = add_field(client, document_id, headers, buyer_id, "signature", "Buyer signature", 620)
    buyer_date = add_field(client, document_id, headers, buyer_id, "date", "Buyer date", 580)
    seller_name = add_field(client, document_id, headers, seller_id, "full_name", "Seller full name", 520)
    seller_sig = add_field(client, document_id, headers, seller_id, "signature", "Seller signature", 460)
    seller_date = add_field(client, document_id, headers, seller_id, "date", "Seller date", 420)

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    links = {item["email"]: token_from_link(item["signing_link"]) for item in sent.json()["signing_links"]}
    buyer_token = links["buyer@example.com"]
    seller_token = links["seller@example.com"]

    blocked = client.post(f"/api/sign/{buyer_token}/fields/{seller_name}/value", json={"value": "Wrong signer"})
    assert blocked.status_code == 403

    # Accept electronic consent for both signers before editing fields
    assert client.post(f"/api/sign/{buyer_token}/consent").status_code == 200
    assert client.post(f"/api/sign/{seller_token}/consent").status_code == 200

    assert client.post(f"/api/sign/{buyer_token}/fields/{buyer_name}/value", json={"value": "Buyer One"}).status_code == 200
    assert (
        client.post(
            f"/api/sign/{buyer_token}/fields/{buyer_sig}/signature",
            json={"signature_type": "typed", "signature_text": "Buyer One"},
        ).status_code
        == 200
    )
    assert client.post(f"/api/sign/{buyer_token}/fields/{buyer_date}/value", json={"value": "2026-05-23"}).status_code == 200
    buyer_complete = client.post(f"/api/sign/{buyer_token}/complete")
    assert buyer_complete.status_code == 200, buyer_complete.text
    assert buyer_complete.json()["document_status"] == "partially_completed"

    assert client.post(f"/api/sign/{seller_token}/fields/{seller_name}/value", json={"value": "Seller One"}).status_code == 200
    assert (
        client.post(
            f"/api/sign/{seller_token}/fields/{seller_sig}/signature",
            json={"signature_type": "typed", "signature_text": "Seller One"},
        ).status_code
        == 200
    )
    assert client.post(f"/api/sign/{seller_token}/fields/{seller_date}/value", json={"value": "2026-05-23"}).status_code == 200
    seller_complete = client.post(f"/api/sign/{seller_token}/complete")
    assert seller_complete.status_code == 200, seller_complete.text
    assert seller_complete.json()["document_status"] == "completed"

    final_pdf = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert final_pdf.status_code == 200
    assert final_pdf.headers["content-type"].startswith("application/pdf")

    audit = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers)
    assert audit.status_code == 200
    events = {item["event_type"] for item in audit.json()}
    assert "final_pdf_generated" in events
    assert "document_completed" in events


def test_invalid_token_is_rejected(client: TestClient) -> None:
    response = client.get("/api/sign/not-a-real-token")
    assert response.status_code == 404

