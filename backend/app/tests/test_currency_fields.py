"""Currency fields (W10).

`currency` was retired from the palette because it neither formatted nor
validated an amount. These tests are what let it be offered honestly again.
"""

from fastapi.testclient import TestClient

from app.services.currency_service import format_currency
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_recipient, create_uploaded_document, token_from_link


def test_currency_formats_and_rejects() -> None:
    assert format_currency("$1,234.5") == "1,234.50"
    assert format_currency("(50)") == "-50.00"
    assert format_currency("abc") is None


def test_a_currency_field_rejects_a_non_amount(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    field = client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id, "type": "currency", "label": "Fee",
            "page_number": 1, "x": 60, "y": 100, "width": 120, "height": 32,
        },
        headers=headers,
    ).json()
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    assert client.post(
        f"/api/sign/{token}/fields/{field['id']}/value", json={"value": "not money"}
    ).status_code == 400
    assert client.post(
        f"/api/sign/{token}/fields/{field['id']}/value", json={"value": "$1,200.5"}
    ).status_code == 200
