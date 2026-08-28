from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document, token_from_link


def _complete_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str], title: str = "Packet") -> str:
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    name_field = add_field(client, document_id, headers, recipient_id, "full_name", "Buyer full name", 680)
    sig_field = add_field(client, document_id, headers, recipient_id, "signature", "Buyer signature", 620)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    assert client.post(f"/api/sign/{token}/consent").status_code == 200
    client.post(f"/api/sign/{token}/viewed")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    client.post(
        f"/api/sign/{token}/fields/{sig_field}/signature",
        json={"signature_type": "typed", "signature_text": "Buyer One"},
    )
    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.json()["document_status"] == "completed", completed.text
    return document_id


def _declined_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]) -> str:
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Seller", "seller@example.com")
    add_field(client, document_id, headers, recipient_id, "full_name", "Seller name", 600)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    assert client.post(f"/api/sign/{token}/decline", json={"reason": "Wrong counterparty"}).status_code == 204
    return document_id


def test_overview_and_invites_aggregates(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    _complete_document(client, pdf_bytes, headers)
    _declined_document(client, pdf_bytes, headers)

    overview = client.get("/api/reports/overview", headers=headers, params={"range": "30d"})
    assert overview.status_code == 200, overview.text
    body = overview.json()
    assert body["documents_created"] == 2
    assert body["documents_completed"] == 1
    assert body["completion_rate_pct"] == 50.0
    assert body["recipient_count"] == 2
    assert body["sender_count"] == 1
    assert body["first_time_recipients"] == 2
    assert {tile["key"] for tile in body["tiles"]} >= {"documents_created", "completion_rate"}

    invites = client.get("/api/reports/invites", headers=headers)
    assert invites.status_code == 200
    split = {item["label"]: item["count"] for item in invites.json()["split"]}
    assert invites.json()["total"] == 2
    assert split == {"pending_expired": 0, "completed": 1, "declined": 1, "cancelled": 0}


def test_documents_and_recipients_reports(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    _complete_document(client, pdf_bytes, headers)
    _declined_document(client, pdf_bytes, headers)

    documents = client.get("/api/reports/documents", headers=headers)
    assert documents.json()["total"] == 2
    row = next(item for item in documents.json()["items"] if item["status"] == "completed")
    assert row["signed"] == 1 and row["total"] == 1
    assert row["sender_name"] == "Admin User"

    filtered = client.get("/api/reports/documents", headers=headers, params={"status": "declined"})
    assert filtered.json()["total"] == 1

    recipients = client.get("/api/reports/recipients", headers=headers)
    rows = {item["email"]: item for item in recipients.json()["items"]}
    assert rows["buyer@example.com"]["completed"] == 1
    assert rows["buyer@example.com"]["viewed"] == 1
    assert rows["buyer@example.com"]["completion_rate_pct"] == 100.0
    assert rows["buyer@example.com"]["median_completion_seconds"] is not None
    assert rows["seller@example.com"]["declined"] == 1
    assert rows["seller@example.com"]["completion_rate_pct"] == 0.0

    senders = client.get("/api/reports/senders", headers=headers)
    assert senders.json()[0]["sent_count"] == 2
    assert senders.json()[0]["approved_count"] == 1


def test_template_use_counts(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    created = client.post("/api/documents", headers=headers, json={"title": "NDA template", "is_template": True})
    template_id = created.json()["id"]
    client.post(
        f"/api/documents/{template_id}/upload-pdf",
        headers=headers,
        files={"upload": ("nda.pdf", pdf_bytes, "application/pdf")},
    )
    for _ in range(2):
        used = client.post(f"/api/documents/templates/{template_id}/use", headers=headers)
        assert used.status_code == 200, used.text

    templates = client.get("/api/reports/templates", headers=headers)
    assert templates.status_code == 200, templates.text
    row = next(item for item in templates.json()["items"] if item["template_id"] == template_id)
    assert row["use_count"] == 2
    assert row["completed_copies"] == 0
    assert row["owner_name"] == "Admin User"


def test_time_range_filtering_excludes_old_documents(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)

    from datetime import datetime, timedelta, timezone

    from app.core.database import get_db
    from app.main import app
    from app.models.document import Document

    db = next(app.dependency_overrides[get_db]())
    document = db.get(Document, document_id)
    document.created_at = datetime.now(timezone.utc) - timedelta(days=45)
    db.commit()

    assert client.get("/api/reports/overview", headers=headers, params={"range": "30d"}).json()["documents_created"] == 0
    assert client.get("/api/reports/overview", headers=headers, params={"range": "90d"}).json()["documents_created"] == 1
    assert client.get("/api/reports/overview", headers=headers, params={"range": "nope"}).status_code == 400


def test_csv_export_flow(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    _complete_document(client, pdf_bytes, headers)

    inline = client.get("/api/reports/documents/csv", headers=headers)
    assert inline.status_code == 200
    assert inline.headers["content-type"].startswith("text/csv")
    assert "document_id,title,status" in inline.text

    export = client.post("/api/reports/export", headers=headers, json={"report": "recipients", "range": "30d", "format": "csv"})
    assert export.status_code == 202, export.text
    export_id = export.json()["export_id"]
    assert export.json()["status"] == "ready"

    fetched = client.get(f"/api/reports/exports/{export_id}", headers=headers)
    assert fetched.json()["download_url"] == f"/api/reports/exports/{export_id}/download"
    download = client.get(fetched.json()["download_url"], headers=headers)
    assert download.status_code == 200
    assert "buyer@example.com" in download.text

    assert client.post("/api/reports/export", headers=headers, json={"report": "bogus"}).status_code == 400


def test_custom_reports_crud_and_run(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    _complete_document(client, pdf_bytes, headers)

    created = client.post(
        "/api/reports/custom",
        headers=headers,
        json={
            "name": "Completion by status",
            "fields": ["document_title", "document_status", "recipient_email"],
            "filters": {"status": "completed"},
            "group_by": "document_status",
        },
    )
    assert created.status_code == 201, created.text
    report_id = created.json()["id"]

    assert [item["id"] for item in client.get("/api/reports/custom", headers=headers).json()] == [report_id]

    run = client.post(f"/api/reports/custom/{report_id}/run", headers=headers)
    assert run.status_code == 200, run.text
    body = run.json()
    assert body["row_count"] == 1
    assert set(body["rows"][0]) == {"document_title", "document_status", "recipient_email"}
    assert body["groups"] == [{"key": "completed", "count": 1}]

    patched = client.patch(f"/api/reports/custom/{report_id}", headers=headers, json={"name": "Renamed"})
    assert patched.json()["name"] == "Renamed"
    assert client.post("/api/reports/custom", headers=headers, json={"name": "bad", "fields": ["nope"]}).status_code == 400

    scheduled = client.post(
        f"/api/reports/custom/{report_id}/schedule",
        headers=headers,
        json={"cadence": "weekly", "format": "csv", "recipients": ["ops@example.com"]},
    )
    assert scheduled.status_code == 201, scheduled.text
    assert scheduled.json()["next_run_at"] is not None

    assert client.delete(f"/api/reports/custom/{report_id}", headers=headers).status_code == 204
    assert client.get(f"/api/reports/custom/{report_id}", headers=headers).status_code == 404


def test_reports_are_tenant_scoped(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    _complete_document(client, pdf_bytes, headers)
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
    assert client.get("/api/reports/overview", headers=other_headers).json()["documents_created"] == 0
    assert client.get("/api/reports/documents", headers=other_headers).json()["total"] == 0
