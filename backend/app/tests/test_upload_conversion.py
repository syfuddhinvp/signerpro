"""Uploads that are not already PDFs.

The signing pipeline only understands PDFs, so the upload endpoint converts
images and Office documents on the way in. These tests pin that the sender can
start from a PNG or a .docx and still end up with a signable envelope.
"""

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader

from app.services import conversion_service
from app.tests.conftest import auth_headers


def _document(client: TestClient, headers: dict[str, str]) -> str:
    created = client.post("/api/documents", headers=headers, json={"title": "Converted", "workflow_type": "parallel"})
    assert created.status_code == 201, created.text
    return created.json()["id"]


def _png(size: tuple[int, int] = (240, 180), mode: str = "RGB") -> bytes:
    buffer = BytesIO()
    Image.new(mode, size, (255, 0, 0) if mode == "RGB" else (255, 0, 0, 128)).save(buffer, format="PNG")
    return buffer.getvalue()


def test_png_upload_becomes_a_one_page_pdf(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers)
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("scan.png", _png(), "image/png")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 1

    stored = client.get(f"/api/documents/{document_id}/pdf", headers=headers)
    assert stored.status_code == 200
    assert stored.content.startswith(b"%PDF")
    assert stored.headers["content-type"].startswith("application/pdf")


def test_transparent_image_is_flattened_rather_than_rejected(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers)
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("logo.png", _png(mode="RGBA"), "image/png")},
    )
    assert response.status_code == 200, response.text


def test_conversion_records_the_source_format_in_the_audit_trail(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers)
    client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("scan.png", _png(), "image/png")},
    )
    events = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers)
    assert events.status_code == 200, events.text
    uploaded = [e for e in events.json() if e["event_type"] == "document_uploaded"]
    assert uploaded, events.text
    assert "PNG" in uploaded[0]["event_message"]


def test_pdf_upload_is_stored_byte_for_byte(client: TestClient, pdf_bytes: bytes) -> None:
    """An existing PDF must never be re-rendered — that would break its forms."""
    headers = auth_headers(client)
    document_id = _document(client, headers)
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("packet.pdf", pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 200, response.text
    stored = client.get(f"/api/documents/{document_id}/pdf", headers=headers)
    assert stored.content == pdf_bytes


def test_unsupported_extension_is_refused(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers)
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("payload.exe", b"MZ\x00\x00", "application/octet-stream")},
    )
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_corrupt_image_is_refused(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers)
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("broken.png", b"not really a png", "image/png")},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Image could not be read"


@pytest.mark.skipif(conversion_service.soffice_binary() is None, reason="LibreOffice is not installed")
def test_text_document_is_converted_by_libreoffice(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers)
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("terms.txt", b"Mutual non-disclosure agreement.\n", "text/plain")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] >= 1

    stored = client.get(f"/api/documents/{document_id}/pdf", headers=headers)
    assert len(PdfReader(BytesIO(stored.content)).pages) >= 1


def test_office_upload_is_refused_cleanly_without_libreoffice(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(conversion_service, "soffice_binary", lambda: None)
    headers = auth_headers(client)
    document_id = _document(client, headers)
    response = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("terms.docx", b"PK\x03\x04stub", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert response.status_code == 503
    assert "Upload a PDF instead" in response.json()["detail"]
