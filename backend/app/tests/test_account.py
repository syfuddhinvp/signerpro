"""Account preferences: signatures, notification prefs, integrations, cloud
targets and the account audit feed."""

from base64 import b64encode

from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers
from app.tests.test_cloud_integrations import connect_integration

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


def test_signature_image_is_served_and_owner_only(client: TestClient) -> None:
    """The preview is a real image over the API, on either storage backend.

    Presigned object URLs are not used here: a signature image is the visual
    form of someone's name, and a presigned URL works for whoever holds it.
    """
    headers = auth_headers(client)
    drawn = client.post(
        "/api/me/signatures",
        json={"signature_type": "drawn", "signature_image_base64": PNG, "label": "Quick"},
        headers=headers,
    ).json()
    assert drawn["preview_url"] == f"/api/me/signatures/{drawn['id']}/image"

    image = client.get(drawn["preview_url"], headers=headers)
    assert image.status_code == 200, image.text
    assert image.headers["content-type"].startswith("image/png")
    assert image.content.startswith(b"\x89PNG")

    other = _sender_headers(client)
    assert client.get(drawn["preview_url"], headers=other).status_code == 404

    typed = client.post(
        "/api/me/signatures",
        json={"signature_type": "typed", "signature_text": "Admin User", "type_face": "Caveat"},
        headers=headers,
    ).json()
    assert typed["preview_url"] is None, "a typed signature is text, not an image"
    assert client.get(f"/api/me/signatures/{typed['id']}/image", headers=headers).status_code == 404

def test_default_signature_is_always_exactly_one(client: TestClient) -> None:
    """One default, kept true through create, set-default and delete.

    Nothing else on the account picks a signature to offer, so an account with
    saved signatures and no default would silently sign with none of them.
    """
    headers = auth_headers(client)

    first = client.post(
        "/api/me/signatures",
        json={"signature_type": "typed", "signature_text": "Admin User", "type_face": "Caveat"},
        headers=headers,
    ).json()
    assert first["is_default"] is True, "the first signature adopted is the default"

    second = client.post(
        "/api/me/signatures",
        json={"signature_type": "typed", "signature_text": "A. User", "type_face": "Great Vibes"},
        headers=headers,
    ).json()
    assert second["is_default"] is False, "a later signature does not steal the default"

    promoted = client.post(f"/api/me/signatures/{second['id']}/default", headers=headers)
    assert promoted.status_code == 200, promoted.text
    defaults = {row["id"]: row["is_default"] for row in promoted.json()}
    assert defaults == {first["id"]: False, second["id"]: True}
    # The default sorts first, so the profile can read the list in order.
    assert promoted.json()[0]["id"] == second["id"]

    other = _sender_headers(client)
    assert client.post(f"/api/me/signatures/{second['id']}/default", headers=other).status_code == 404

    assert client.delete(f"/api/me/signatures/{second['id']}", headers=headers).status_code == 204
    remaining = client.get("/api/me/signatures", headers=headers).json()
    assert [row["is_default"] for row in remaining] == [True], "deleting the default promotes a survivor"


    third = client.post(
        "/api/me/signatures",
        json={"signature_type": "typed", "signature_text": "AU", "is_default": True},
        headers=headers,
    ).json()
    assert third["is_default"] is True
    assert [r["is_default"] for r in client.get("/api/me/signatures", headers=headers).json()] == [True, False]


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


def test_field_favorites_round_trip(client: TestClient) -> None:
    headers = auth_headers(client)
    defaults = client.get("/api/me/field-favorites", headers=headers)
    assert defaults.status_code == 200
    assert defaults.json()["types"] == ["signature", "date", "full_name", "checkbox"]

    # A replace, in the order the tiles were starred, with duplicates collapsed.
    saved = client.put(
        "/api/me/field-favorites",
        json={"types": ["checkbox", "stamp", "checkbox"]},
        headers=headers,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["types"] == ["checkbox", "stamp"]
    assert client.get("/api/me/field-favorites", headers=headers).json()["types"] == ["checkbox", "stamp"]

    # Starring nothing is a real state, not "fall back to the defaults".
    assert client.put("/api/me/field-favorites", json={"types": []}, headers=headers).json()["types"] == []
    assert client.get("/api/me/field-favorites", headers=headers).json()["types"] == []

    rejected = client.put("/api/me/field-favorites", json={"types": ["not_a_field"]}, headers=headers)
    assert rejected.status_code == 400


def test_appearance_round_trip(client: TestClient) -> None:
    headers = auth_headers(client)
    fresh = client.get("/api/me/appearance", headers=headers)
    assert fresh.status_code == 200
    assert fresh.json() == {"mode": "system", "palette": "indigo"}

    saved = client.put(
        "/api/me/appearance", json={"mode": "dark", "palette": "emerald"}, headers=headers
    )
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"mode": "dark", "palette": "emerald"}
    assert client.get("/api/me/appearance", headers=headers).json() == {
        "mode": "dark",
        "palette": "emerald",
    }

    # Theme choices sit beside the palette favourites on the same JSON column
    # and must not clobber them.
    client.put("/api/me/field-favorites", json={"types": ["stamp"]}, headers=headers)
    client.put("/api/me/appearance", json={"mode": "light", "palette": "rose"}, headers=headers)
    assert client.get("/api/me/field-favorites", headers=headers).json()["types"] == ["stamp"]
    assert client.get("/api/me/appearance", headers=headers).json()["palette"] == "rose"

    # Unknown values are a client bug, not a preference.
    assert client.put("/api/me/appearance", json={"mode": "sepia", "palette": "rose"}, headers=headers).status_code == 422
    assert client.put("/api/me/appearance", json={"mode": "dark", "palette": "neon"}, headers=headers).status_code == 422


def test_integration_catalogue_starts_disconnected(client: TestClient) -> None:
    """Nothing is connected until a real OAuth flow completes.

    The catalogue used to be connectable by POSTing a boolean; the OAuth flow
    that replaced it lives in test_cloud_integrations.py.
    """
    headers = auth_headers(client)
    catalogue = client.get("/api/integrations", headers=headers)
    assert catalogue.status_code == 200
    assert all(row["connected"] is False for row in catalogue.json())
    # Unconfigured deployment (no client id/secret in the test env): the UI
    # needs to know the button would go nowhere.
    assert all(row["configured"] is False for row in catalogue.json())
    assert all(row["needs_reauth"] is False for row in catalogue.json())
    # The fake connect endpoint is gone.
    assert client.post("/api/integrations/dropbox/connect", json={}, headers=headers).status_code == 404


def test_retired_integrations_are_not_offered(client: TestClient) -> None:
    """Only Drive and Dropbox ship; the connectors we dropped stay gone."""
    headers = auth_headers(client)
    providers = {row["provider"] for row in client.get("/api/integrations", headers=headers).json()}
    assert providers == {"google_drive", "dropbox"}
    assert client.post("/api/integrations/slack/authorize", headers=headers).status_code == 404


def test_cloud_targets_round_trip(client: TestClient) -> None:
    headers = auth_headers(client)
    initial = client.get("/api/integrations/cloud-targets", headers=headers)
    assert initial.status_code == 200
    assert {row["provider"] for row in initial.json()} == {"google_drive", "dropbox"}

    # A destination can only be *enabled* once its provider is connected.
    connect_integration(client, headers, "dropbox")

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
    assert empty.json() == {"items": [], "total": 0, "event_types": [], "actors": []}

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


def test_account_audit_feed_filters_and_pages(client: TestClient, pdf_bytes: bytes) -> None:
    """Search, event-type, actor, date range and paging all narrow in SQL."""
    headers = auth_headers(client)
    created = client.post(
        "/api/documents", headers=headers, json={"title": "Filterable agreement", "workflow_type": "parallel"}
    )
    assert created.status_code == 201, created.text
    upload = client.post(
        f"/api/documents/{created.json()['id']}/upload-pdf",
        headers=headers,
        files={"upload": ("agreement.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == 200, upload.text

    feed = client.get("/api/me/audit-trail", headers=headers).json()
    assert feed["total"] >= 1
    # The facets describe the whole trail, and the actor is resolved, not assumed.
    assert feed["event_types"]
    known_type = feed["event_types"][0]
    assert feed["actors"], "the acting user's email should be resolved from the join"
    actor = feed["actors"][0]
    assert feed["items"][0]["actor"] == actor

    # Event type narrows to that type only.
    by_type = client.get("/api/me/audit-trail", headers=headers, params={"event_type": known_type}).json()
    assert by_type["total"] >= 1
    assert {row["event_type"] for row in by_type["items"]} == {known_type}
    # ...and the facet lists stay whole, so the dropdown never empties itself.
    assert by_type["event_types"] == feed["event_types"]

    # A type that is not in the trail matches nothing.
    assert client.get(
        "/api/me/audit-trail", headers=headers, params={"event_type": "no_such_event"}
    ).json()["total"] == 0

    # Actor filter.
    assert client.get("/api/me/audit-trail", headers=headers, params={"actor": actor}).json()["total"] >= 1
    assert client.get(
        "/api/me/audit-trail", headers=headers, params={"actor": "nobody@example.com"}
    ).json()["total"] == 0

    # Search spans the document title.
    assert client.get(
        "/api/me/audit-trail", headers=headers, params={"search": "Filterable"}
    ).json()["total"] >= 1
    assert client.get(
        "/api/me/audit-trail", headers=headers, params={"search": "zzz-no-match"}
    ).json()["total"] == 0

    # Date range: a window ending before the trail began holds nothing, and one
    # opening after it holds nothing either.
    assert client.get(
        "/api/me/audit-trail", headers=headers, params={"date_to": "2000-01-01T00:00:00Z"}
    ).json()["total"] == 0
    assert client.get(
        "/api/me/audit-trail", headers=headers, params={"date_from": "2000-01-01T00:00:00Z"}
    ).json()["total"] == feed["total"]

    # Paging: one row at a time, and the total keeps describing the whole match.
    page = client.get("/api/me/audit-trail", headers=headers, params={"limit": 1, "offset": 0}).json()
    assert len(page["items"]) == 1
    assert page["total"] == feed["total"]
    if feed["total"] > 1:
        second = client.get("/api/me/audit-trail", headers=headers, params={"limit": 1, "offset": 1}).json()
        assert second["items"][0]["id"] != page["items"][0]["id"]


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


def test_profile_photo_upload_read_and_removal(client: TestClient) -> None:
    headers = auth_headers(client)
    assert client.get("/api/me", headers=headers).json()["avatar_url"] is None
    assert client.get("/api/me/avatar", headers=headers).status_code == 404

    saved = client.put("/api/me/avatar", json={"image_base64": PNG}, headers=headers)
    assert saved.status_code == 200, saved.text
    # Served by our own route, not a storage URL, and stamped so a replacement
    # is not answered from cache.
    assert saved.json()["avatar_url"].startswith("/api/me/avatar?v=")

    image = client.get("/api/me/avatar", headers=headers)
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.content.startswith(b"\x89PNG")

    removed = client.delete("/api/me/avatar", headers=headers)
    assert removed.status_code == 200
    assert removed.json()["avatar_url"] is None
    assert client.get("/api/me/avatar", headers=headers).status_code == 404


def test_profile_photo_rejects_non_image_payloads(client: TestClient) -> None:
    headers = auth_headers(client)
    assert client.put("/api/me/avatar", json={"image_base64": "not base64!"}, headers=headers).status_code == 400
    gif = b64encode(b"GIF89a" + b"0" * 32).decode()
    assert client.put("/api/me/avatar", json={"image_base64": gif}, headers=headers).status_code == 400
    assert client.get("/api/me", headers=headers).json()["avatar_url"] is None


def test_profile_photo_is_not_readable_without_a_session(client: TestClient) -> None:
    headers = auth_headers(client)
    client.put("/api/me/avatar", json={"image_base64": PNG}, headers=headers)
    assert client.get("/api/me/avatar").status_code == 401
