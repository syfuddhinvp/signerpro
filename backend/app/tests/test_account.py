"""Account preferences: signatures, notification prefs, integrations, cloud
targets and the account audit feed."""

from base64 import b64encode

from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers

PNG = b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 64).decode()


def _sender_headers(client: TestClient) -> dict[str, str]:
    """A non-admin member of a second organization."""
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Second Org",
            "name": "Sam Sender",
            "email": "sam@example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_saved_signature_crud(client: TestClient) -> None:
    headers = auth_headers(client)
    assert client.get("/api/me/signatures", headers=headers).json() == []

    typed = client.post(
        "/api/me/signatures",
        json={"signature_type": "typed", "signature_text": "Admin User", "type_face": "Caveat", "label": "Formal"},
        headers=headers,
    )
    assert typed.status_code == 201, typed.text
    assert typed.json()["face"] == "Caveat"
    assert typed.json()["method"] == "Typed"

    drawn = client.post(
        "/api/me/signatures",
        json={"signature_type": "drawn", "signature_image_base64": PNG, "label": "Quick", "is_passkey_bound": True},
        headers=headers,
    )
    assert drawn.status_code == 201, drawn.text
    assert drawn.json()["is_passkey_bound"] is True

    missing_image = client.post("/api/me/signatures", json={"signature_type": "drawn"}, headers=headers)
    assert missing_image.status_code == 400
    missing_text = client.post("/api/me/signatures", json={"signature_type": "typed"}, headers=headers)
    assert missing_text.status_code == 400

    assert len(client.get("/api/me/signatures", headers=headers).json()) == 2

    other = _sender_headers(client)
    assert client.get("/api/me/signatures", headers=other).json() == []
    assert client.delete(f"/api/me/signatures/{drawn.json()['id']}", headers=other).status_code == 404

    assert client.delete(f"/api/me/signatures/{drawn.json()['id']}", headers=headers).status_code == 204
    assert len(client.get("/api/me/signatures", headers=headers).json()) == 1


def test_notification_preferences_round_trip(client: TestClient) -> None:
    headers = auth_headers(client)
    defaults = client.get("/api/me/notification-preferences", headers=headers)
    assert defaults.status_code == 200
    rows = {row["event_key"]: row for row in defaults.json()}
    assert rows["document_sent"]["enabled"] is True
    assert rows["weekly_summary"]["enabled"] is False
    assert rows["document_sent"]["label"]

    updated = client.put(
        "/api/me/notification-preferences",
        json={"prefs": {"document_sent": False, "weekly_summary": True}, "extra_recipients": ["ops@example.com"]},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    rows = {row["event_key"]: row for row in updated.json()}
    assert rows["document_sent"]["enabled"] is False
    assert rows["weekly_summary"]["enabled"] is True
    assert rows["document_sent"]["extra_recipients"] == ["ops@example.com"]

    persisted = {row["event_key"]: row for row in client.get("/api/me/notification-preferences", headers=headers).json()}
    assert persisted["document_sent"]["enabled"] is False
    assert persisted["weekly_summary"]["enabled"] is True

    rejected = client.put(
        "/api/me/notification-preferences", json={"prefs": {"not_an_event": True}}, headers=headers
    )
    assert rejected.status_code == 400


def test_integrations_connect_and_disconnect(client: TestClient) -> None:
    headers = auth_headers(client)
    catalogue = client.get("/api/integrations", headers=headers)
    assert catalogue.status_code == 200
    assert all(row["connected"] is False for row in catalogue.json())

    connected = client.post(
        "/api/integrations/slack/connect",
        json={"detail": "#deals", "credentials": {"access_token": "xoxb-secret"}},
        headers=headers,
    )
    assert connected.status_code == 200, connected.text
    assert connected.json()["connected"] is True
    assert connected.json()["connected_at"]
    # Credentials are never echoed back.
    assert "credentials" not in connected.json()

    row = next(item for item in client.get("/api/integrations", headers=headers).json() if item["provider"] == "slack")
    assert row["connected"] is True and row["detail"] == "#deals"

    from sqlalchemy import text

    from app.core.database import get_db
    from app.main import app as fastapi_app

    db = next(fastapi_app.dependency_overrides[get_db]())
    stored = db.execute(text("SELECT credentials FROM integrations")).scalar()
    assert "xoxb-secret" not in (stored or "")

    assert client.delete("/api/integrations/slack", headers=headers).status_code == 204
    row = next(item for item in client.get("/api/integrations", headers=headers).json() if item["provider"] == "slack")
    assert row["connected"] is False
    assert client.delete("/api/integrations/slack", headers=headers).status_code == 204  # idempotent-ish: row exists


def test_cloud_targets_round_trip(client: TestClient) -> None:
    headers = auth_headers(client)
    initial = client.get("/api/integrations/cloud-targets", headers=headers)
    assert initial.status_code == 200
    assert {row["provider"] for row in initial.json()} >= {"google_drive", "dropbox"}

    updated = client.put(
        "/api/integrations/cloud-targets",
        json={"targets": [{"provider": "dropbox", "path": "/Signed", "enabled": True}]},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    dropbox = next(row for row in updated.json() if row["provider"] == "dropbox")
    assert dropbox["path"] == "/Signed" and dropbox["enabled"] is True

    persisted = next(
        row for row in client.get("/api/integrations/cloud-targets", headers=headers).json()
        if row["provider"] == "dropbox"
    )
    assert persisted["enabled"] is True


def test_profile_and_signature_default_via_api_me(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.patch(
        "/api/me", json={"name": "Renamed Admin", "signature_default": "Caveat"}, headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Renamed Admin"
    assert client.get("/api/me", headers=headers).json()["name"] == "Renamed Admin"


def test_account_audit_feed(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    empty = client.get("/api/me/audit-trail", headers=headers)
    assert empty.status_code == 200
    assert empty.json() == {"items": [], "total": 0}

    created = client.post(
        "/api/documents", headers=headers, json={"title": "Audit trail agreement", "workflow_type": "parallel"}
    )
    assert created.status_code == 201, created.text
    upload = client.post(
        f"/api/documents/{created.json()['id']}/upload-pdf",
        headers=headers,
        files={"upload": ("agreement.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == 200, upload.text

    feed = client.get("/api/me/audit-trail", headers=headers)
    assert feed.status_code == 200, feed.text
    assert feed.json()["total"] >= 1
    entry = feed.json()["items"][0]
    assert entry["document_title"] == "Audit trail agreement"
    assert entry["event_type"]

    other = _sender_headers(client)
    assert client.get("/api/me/audit-trail", headers=other).json()["total"] == 0


def test_account_endpoints_require_authentication(client: TestClient) -> None:
    for method, path in (
        ("get", "/api/me"),
        ("get", "/api/me/signatures"),
        ("get", "/api/me/notification-preferences"),
        ("get", "/api/integrations"),
        ("get", "/api/integrations/cloud-targets"),
        ("get", "/api/me/audit-trail"),
        ("get", "/api/auth/sessions"),
    ):
        response = getattr(client, method)(path)
        assert response.status_code == 401, f"{path} -> {response.status_code}"
