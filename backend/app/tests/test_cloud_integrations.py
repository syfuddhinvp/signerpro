"""Real Google Drive / Dropbox integrations: OAuth, token lifecycle, export.

Nothing here touches the network. Every provider adapter routes its HTTP
through ``CloudProvider.transport``, which these tests replace with a scripted
fake -- the same seam, and the same discipline, as the webhook suite.
"""

from __future__ import annotations

import json
from collections import deque
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.security import create_scoped_token
from app.models.integration import CloudExport, Integration
from app.services import cloud_export_service as export_module
from app.services.cloud_export_service import cloud_export_service
from app.services.cloud_integration_service import STATE_PURPOSE
from app.services.cloud_providers import PROVIDERS, dropbox_provider, google_drive_provider
from app.services.cloud_providers.base import HttpResponse
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import (
    add_field,
    add_recipient,
    create_uploaded_document,
    token_from_link,
)

PROVIDER_ENV = {
    "GOOGLE_DRIVE_CLIENT_ID": "drive-client-id",
    "GOOGLE_DRIVE_CLIENT_SECRET": "drive-client-secret",
    "DROPBOX_APP_KEY": "dropbox-app-key",
    "DROPBOX_APP_SECRET": "dropbox-app-secret",
}


# --------------------------------------------------------------------------- #
# Scripted transport
# --------------------------------------------------------------------------- #


class FakeTransport:
    """Stand-in for httpx: records every call, replays scripted responses.

    ``respond`` queues answers per URL fragment. The last queued answer is
    reused once the queue runs dry, so "fail twice then succeed" is a
    three-line script and a steady-state endpoint is a one-liner.
    """

    def __init__(self) -> None:
        self.calls: list[SimpleNamespace] = []
        self._scripts: dict[str, deque] = {}

    def respond(self, fragment: str, status_code: int = 200, payload: dict | None = None):
        self._scripts.setdefault(fragment, deque()).append((status_code, payload or {}))
        return self

    def script(self, fragment: str, *entries):
        """Replace a fragment's queue outright (``(status, payload)`` tuples)."""
        self._scripts[fragment] = deque(entries)
        return self

    def raises(self, fragment: str, error: Exception):
        self._scripts.setdefault(fragment, deque()).append(error)
        return self

    def urls(self, fragment: str) -> list[str]:
        return [call.url for call in self.calls if fragment in call.url]

    def __call__(self, method, url, *, headers=None, data=None, content=None):
        self.calls.append(
            SimpleNamespace(method=method, url=url, headers=headers or {}, data=data, content=content)
        )
        for fragment, script in self._scripts.items():
            if fragment not in url:
                continue
            entry = script[0] if len(script) == 1 else script.popleft()
            if isinstance(entry, Exception):
                raise entry
            status_code, payload = entry
            return HttpResponse(status_code, json.dumps(payload).encode(), {})
        raise AssertionError(f"unscripted {method} {url}")


@pytest.fixture()
def configured(monkeypatch: pytest.MonkeyPatch):
    """A deployment that actually has provider credentials."""
    for key, value in PROVIDER_ENV.items():
        monkeypatch.setenv(key, value)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def transport(configured):
    """Swap every provider's HTTP seam for one recorder."""
    fake = FakeTransport()
    originals = {provider: type(provider).transport for provider in PROVIDERS.values()}
    for provider in PROVIDERS.values():
        type(provider).transport = staticmethod(fake)
    previous_sync = cloud_export_service.synchronous
    cloud_export_service.synchronous = True  # export inline so tests are deterministic
    yield fake
    cloud_export_service.synchronous = previous_sync
    for provider, original in originals.items():
        type(provider).transport = staticmethod(original)


def dropbox_script(fake: FakeTransport) -> FakeTransport:
    fake.respond(
        "oauth2/token",
        200,
        {"access_token": "dbx-access-1", "refresh_token": "dbx-refresh-1", "expires_in": 14400},
    )
    fake.respond("users/get_current_account", 200, {"email": "owner@dropbox.test"})
    fake.respond("auth/token/revoke", 200, {})
    fake.respond("files/upload", 200, {"id": "id:dbx-file-1"})
    return fake


def db_session():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


# --------------------------------------------------------------------------- #
# Helpers shared with test_account.py
# --------------------------------------------------------------------------- #


def connect_integration(client: TestClient, headers: dict[str, str], provider: str = "dropbox") -> dict:
    """Take an organization through a full OAuth flow for ``provider``.

    Self-contained on purpose: other suites need a *connected* integration
    without knowing anything about consent screens or token endpoints.
    """
    import os

    fake = dropbox_script(FakeTransport())
    fake.respond("oauth2/v2/auth", 200, {})
    previous = {key: os.environ.get(key) for key in PROVIDER_ENV}
    originals = {item: type(item).transport for item in PROVIDERS.values()}
    os.environ.update(PROVIDER_ENV)
    get_settings.cache_clear()
    for item in PROVIDERS.values():
        type(item).transport = staticmethod(fake)
    try:
        authorized = client.post(f"/api/integrations/{provider}/authorize", headers=headers)
        assert authorized.status_code == 200, authorized.text
        connected = client.post(
            f"/api/integrations/{provider}/callback",
            json={"code": "auth-code", "state": authorized.json()["state"]},
            headers=headers,
        )
        assert connected.status_code == 200, connected.text
        return connected.json()
    finally:
        for item, original in originals.items():
            type(item).transport = staticmethod(original)
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        get_settings.cache_clear()


def second_org_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Rival Realty",
            "name": "Rita Rival",
            "email": "rita@rival.example",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def complete_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]) -> str:
    """Drive one document all the way to a sealed final PDF."""
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    field_id = add_field(client, document_id, headers, signer_id, "signature", "Sign here", 600)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    assert client.post(f"/api/sign/{token}/consent").status_code == 200
    signed = client.post(
        f"/api/sign/{token}/fields/{field_id}/signature",
        json={"signature_type": "typed", "signature_text": "Buyer One"},
    )
    assert signed.status_code == 200, signed.text
    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["document_status"] == "completed"
    return document_id


def enable_target(client: TestClient, headers: dict[str, str], provider: str, path: str) -> None:
    response = client.put(
        "/api/integrations/cloud-targets",
        json={"targets": [{"provider": provider, "path": path, "enabled": True}]},
        headers=headers,
    )
    assert response.status_code == 200, response.text


# --------------------------------------------------------------------------- #
# OAuth
# --------------------------------------------------------------------------- #


def test_authorize_then_callback_stores_an_encrypted_grant(
    client: TestClient, transport: FakeTransport
) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)

    authorized = client.post("/api/integrations/dropbox/authorize", headers=headers)
    assert authorized.status_code == 200, authorized.text
    url = authorized.json()["authorization_url"]
    assert url.startswith("https://www.dropbox.com/oauth2/authorize?")
    # Without this Dropbox issues no refresh token at all and the grant dies
    # four hours later with nothing to renew it.
    assert "token_access_type=offline" in url
    assert authorized.json()["state"] in url
    assert "provider%3Ddropbox" in url

    # The token exchange must repeat the redirect_uri byte for byte.
    def redirect_uri_sent() -> str:
        call = next(item for item in transport.calls if "oauth2/token" in item.url)
        return call.data["redirect_uri"]


    connected = client.post(
        "/api/integrations/dropbox/callback",
        json={"code": "auth-code", "state": authorized.json()["state"]},
        headers=headers,
    )
    assert connected.status_code == 200, connected.text
    body = connected.json()
    assert body["connected"] is True
    assert body["configured"] is True
    assert body["needs_reauth"] is False
    assert body["account_email"] == "owner@dropbox.test"
    assert body["connected_at"]
    assert redirect_uri_sent().endswith("/account/integrations/callback?provider=dropbox")

    # Tokens are encrypted at rest and never echoed.
    from sqlalchemy import text

    stored = db_session().execute(
        text("SELECT access_token, refresh_token FROM integrations")
    ).first()
    assert "dbx-access-1" not in (stored[0] or "")
    assert "dbx-refresh-1" not in (stored[1] or "")
    assert stored[0].startswith("enc:") and stored[1].startswith("enc:")


def test_google_authorize_url_asks_for_an_offline_grant(
    client: TestClient, transport: FakeTransport
) -> None:
    headers = auth_headers(client)
    url = client.post("/api/integrations/google_drive/authorize", headers=headers).json()[
        "authorization_url"
    ]
    assert url.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
    # access_type alone is not enough: Google only mints a refresh token on a
    # *fresh* consent, so prompt=consent is what makes a re-connect work.
    assert "access_type=offline" in url and "prompt=consent" in url
    assert "drive.file" in url
    assert "account%2Fintegrations%2Fcallback" in url
    # The callback page is shared by both providers, so the redirect carries
    # which one came back -- a convenience; the signed state is what is trusted.
    assert "provider%3Dgoogle_drive" in url


def test_authorize_409s_when_the_provider_is_not_configured(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.post("/api/integrations/dropbox/authorize", headers=headers)
    assert response.status_code == 409


def test_callback_rejects_tampered_expired_and_cross_org_state(
    client: TestClient, transport: FakeTransport
) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)
    state = client.post("/api/integrations/dropbox/authorize", headers=headers).json()["state"]

    def callback(candidate: str, provider: str = "dropbox", who: dict | None = None):
        return client.post(
            f"/api/integrations/{provider}/callback",
            json={"code": "auth-code", "state": candidate},
            headers=who or headers,
        )

    assert callback(state[:-4] + "aaaa").status_code == 400  # tampered signature
    assert callback("not-a-token").status_code == 400

    expired = create_scoped_token(
        "whoever",
        purpose=STATE_PURPOSE,
        expires_in_seconds=-30,
        org="whatever",
        provider="dropbox",
    )
    assert callback(expired).status_code == 400

    # A state minted for Drive must not connect Dropbox.
    assert callback(state, provider="google_drive").status_code == 400

    # Cross-org replay: another tenant cannot spend this organization's state.
    assert callback(state, who=second_org_headers(client)).status_code == 400

    # ...and the genuine one still works.
    assert callback(state).status_code == 200


def test_disconnect_revokes_remotely_and_clears_the_grant(
    client: TestClient, transport: FakeTransport
) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)
    connect_integration(client, headers)

    assert client.delete("/api/integrations/dropbox", headers=headers).status_code == 204
    assert transport.urls("auth/token/revoke"), "the remote grant must actually be revoked"

    row = next(
        item
        for item in client.get("/api/integrations", headers=headers).json()
        if item["provider"] == "dropbox"
    )
    assert row["connected"] is False and row["account_email"] is None

    # The row survives (it keeps the tenant's label); the credentials do not.
    stored = db_session().query(Integration).filter(Integration.provider == "dropbox").first()
    assert stored is not None
    assert stored.access_token is None and stored.refresh_token is None
    assert stored.needs_reauth is False


def test_no_response_ever_carries_a_token(client: TestClient, transport: FakeTransport) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)
    connected = connect_integration(client, headers)
    enable_target(client, headers, "dropbox", "/Signed")

    bodies = [
        json.dumps(connected),
        client.get("/api/integrations", headers=headers).text,
        client.get("/api/integrations/cloud-targets", headers=headers).text,
        client.get("/api/integrations/exports", headers=headers).text,
    ]
    for body in bodies:
        assert "dbx-access-1" not in body
        assert "dbx-refresh-1" not in body
        assert "access_token" not in body
        assert "refresh_token" not in body


# --------------------------------------------------------------------------- #
# Token lifecycle
# --------------------------------------------------------------------------- #


def test_an_expired_access_token_is_refreshed_before_use(
    client: TestClient, transport: FakeTransport
) -> None:
    from app.services.cloud_integration_service import cloud_integration_service

    dropbox_script(transport)
    headers = auth_headers(client)
    connect_integration(client, headers)

    db = db_session()
    row = db.query(Integration).filter(Integration.provider == "dropbox").one()
    row.token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.commit()

    transport.script("oauth2/token", (200, {"access_token": "dbx-access-2", "expires_in": 14400}))
    token = cloud_integration_service.access_token_for(db, row)
    assert token == "dbx-access-2"
    # The refresh response carried no refresh token; the existing one survives.
    assert row.refresh_token == "dbx-refresh-1"
    assert row.needs_reauth is False


# --------------------------------------------------------------------------- #
# Cloud targets
# --------------------------------------------------------------------------- #


def test_cloud_target_validation(client: TestClient, transport: FakeTransport) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)

    not_connected = client.put(
        "/api/integrations/cloud-targets",
        json={"targets": [{"provider": "dropbox", "path": "/Signed", "enabled": True}]},
        headers=headers,
    )
    assert not_connected.status_code == 409

    connect_integration(client, headers)

    blank_path = client.put(
        "/api/integrations/cloud-targets",
        json={"targets": [{"provider": "dropbox", "path": "   ", "enabled": True}]},
        headers=headers,
    )
    assert blank_path.status_code == 422

    # Disabling needs neither a path nor a connection.
    disabled = client.put(
        "/api/integrations/cloud-targets",
        json={"targets": [{"provider": "google_drive", "path": None, "enabled": False}]},
        headers=headers,
    )
    assert disabled.status_code == 200


# --------------------------------------------------------------------------- #
# Export pipeline
# --------------------------------------------------------------------------- #


def test_completion_uploads_the_sealed_pdf(
    client: TestClient, transport: FakeTransport, pdf_bytes: bytes
) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)
    connect_integration(client, headers)
    enable_target(client, headers, "dropbox", "/Signed/2026")

    document_id = complete_document(client, pdf_bytes, headers)

    uploads = [call for call in transport.calls if "files/upload" in call.url]
    assert len(uploads) == 1
    arg = json.loads(uploads[0].headers["Dropbox-API-Arg"])
    assert arg["path"] == "/Signed/2026/Buyer Seller Packet.pdf"
    # Never overwrite something a human put there.
    assert arg["mode"] == "add" and arg["autorename"] is True
    assert uploads[0].content.startswith(b"%PDF")

    exports = client.get("/api/integrations/exports", headers=headers).json()
    assert len(exports) == 1
    assert exports[0]["status"] == "succeeded"
    assert exports[0]["provider"] == "dropbox"
    assert exports[0]["document_id"] == document_id
    assert exports[0]["document_title"] == "Buyer Seller Packet"
    assert exports[0]["remote_file_id"] == "id:dbx-file-1"
    assert exports[0]["completed_at"]

    # Exactly once: re-running the sealer must not queue a second copy.
    client.post(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert len(client.get("/api/integrations/exports", headers=headers).json()) == 1


def test_a_disabled_or_unconnected_target_exports_nothing(
    client: TestClient, transport: FakeTransport, pdf_bytes: bytes
) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)
    connect_integration(client, headers)
    # Connected, but the destination is switched off.
    complete_document(client, pdf_bytes, headers)
    assert client.get("/api/integrations/exports", headers=headers).json() == []
    assert not transport.urls("files/upload")


def test_a_transient_failure_retries_and_then_succeeds(
    client: TestClient, transport: FakeTransport, pdf_bytes: bytes
) -> None:
    dropbox_script(transport)
    transport.script("files/upload", (503, {"error": "overloaded"}), (200, {"id": "id:dbx-file-2"}))
    headers = auth_headers(client)
    connect_integration(client, headers)
    enable_target(client, headers, "dropbox", "/Signed")

    complete_document(client, pdf_bytes, headers)

    export = client.get("/api/integrations/exports", headers=headers).json()[0]
    assert export["status"] == "pending"
    assert export["attempts"] == 1
    assert "503" in export["last_error"]

    db = db_session()
    row = db.query(CloudExport).first()
    assert row.next_attempt_at is not None, "a transient failure must schedule a retry"

    # The cron sweep only touches rows whose backoff has elapsed.
    assert cloud_export_service.process_due_retries(db) == 0
    later = datetime.now(timezone.utc) + timedelta(hours=1)
    assert cloud_export_service.process_due_retries(db, now=later) == 1

    export = client.get("/api/integrations/exports", headers=headers).json()[0]
    assert export["status"] == "succeeded"
    assert export["attempts"] == 2
    assert export["remote_file_id"] == "id:dbx-file-2"


def test_an_auth_failure_flags_needs_reauth_and_stops_retrying(
    client: TestClient, transport: FakeTransport, pdf_bytes: bytes
) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)
    connect_integration(client, headers)
    enable_target(client, headers, "dropbox", "/Signed")

    transport.script("files/upload", (401, {"error": "expired_access_token"}))
    complete_document(client, pdf_bytes, headers)

    export = client.get("/api/integrations/exports", headers=headers).json()[0]
    assert export["status"] == "failed"
    assert export["attempts"] == 1

    integration = next(
        row
        for row in client.get("/api/integrations", headers=headers).json()
        if row["provider"] == "dropbox"
    )
    assert integration["needs_reauth"] is True
    assert "401" in integration["last_error"]

    # A revoked grant will still be revoked in six hours: the sweep leaves it.
    db = db_session()
    later = datetime.now(timezone.utc) + timedelta(days=1)
    assert cloud_export_service.process_due_retries(db, now=later) == 0
    assert len([call for call in transport.calls if "files/upload" in call.url]) == 1

    # And a manual retry refuses to start while the grant is dead.
    retried = client.post(
        f"/api/integrations/exports/{export['id']}/retry", headers=headers
    )
    assert retried.status_code == 200
    assert retried.json()["status"] == "failed"
    assert "not connected" in retried.json()["last_error"] or "reconnect" in retried.json()["last_error"]


def test_manual_retry_is_org_scoped_and_refuses_a_succeeded_export(
    client: TestClient, transport: FakeTransport, pdf_bytes: bytes
) -> None:
    dropbox_script(transport)
    headers = auth_headers(client)
    connect_integration(client, headers)
    enable_target(client, headers, "dropbox", "/Signed")
    complete_document(client, pdf_bytes, headers)

    export_id = client.get("/api/integrations/exports", headers=headers).json()[0]["id"]
    assert (
        client.post(f"/api/integrations/exports/{export_id}/retry", headers=headers).status_code
        == 409
    )

    # Another tenant sees neither the row nor an acknowledgement that it exists.
    rival = second_org_headers(client)
    assert client.get("/api/integrations/exports", headers=rival).json() == []
    assert (
        client.post(f"/api/integrations/exports/{export_id}/retry", headers=rival).status_code == 404
    )


def test_exports_require_authentication(client: TestClient) -> None:
    assert client.get("/api/integrations/exports").status_code == 401
    assert client.post("/api/integrations/dropbox/authorize").status_code == 401
    assert client.post("/api/integrations/exports/whatever/retry").status_code == 401


# --------------------------------------------------------------------------- #
# Google Drive adapter unit tests
# --------------------------------------------------------------------------- #


def test_drive_upload_resolves_the_folder_path(configured) -> None:
    fake = FakeTransport()
    fake.respond("drive/v3/files?q=", 200, {"files": []})  # "Signed" does not exist
    fake.respond("drive/v3/files?supportsAllDrives", 200, {"id": "folder-1"})
    fake.respond("upload/drive/v3/files", 200, {"id": "drive-file-1"})
    original = google_drive_provider.__class__.transport
    google_drive_provider.__class__.transport = staticmethod(fake)
    try:
        file_id = google_drive_provider.upload("at-1", "/Signed", "Deal.pdf", b"%PDF-1.4")
    finally:
        google_drive_provider.__class__.transport = staticmethod(original)

    assert file_id == "drive-file-1"
    assert fake.urls("drive/v3/files?q="), "a missing folder is looked up before being created"
    upload = next(call for call in fake.calls if "upload/drive/v3/files" in call.url)
    assert upload.headers["Content-Type"].startswith("multipart/related; boundary=")
    assert b'"name": "Deal.pdf"' in upload.content
    assert b'"parents": ["folder-1"]' in upload.content
    assert b"%PDF-1.4" in upload.content


def test_dropbox_filename_is_sanitised() -> None:
    document = SimpleNamespace(title="Q3 / Lease: 2026 <final>")
    assert export_module.export_filename(document) == "Q3 Lease 2026 final.pdf"
    assert export_module.export_filename(SimpleNamespace(title="  ")) == "document.pdf"
