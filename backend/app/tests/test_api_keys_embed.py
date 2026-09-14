from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers, upgrade_plan
from app.tests.test_document_flow import add_recipient, create_uploaded_document



def _entitled_headers(client: TestClient) -> dict[str, str]:
    """A tenant that has actually bought the ``api_access`` entitlement.

    Team declares ``api_access: False`` and that is now enforced, so these tests
    pay for Business first. Previously they exercised the surface from an
    unentitled org, which is exactly the hole AUDIT_REPORT.md section 7 found.
    """
    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")
    return headers

def create_key(
    client: TestClient,
    headers: dict[str, str],
    scopes: list[str],
    label: str = "Server key",
    mode: str = "live",
) -> tuple[str, str]:
    """Mint a key. ``live`` by default, because these tests assert against the
    tenant's real records.

    ``mode`` is no longer a label: a ``test`` key resolves to the paired
    sandbox organization (API-11), so a test-mode key here would correctly see
    an empty tenant and every assertion below would be meaningless. The
    sandbox side of that behaviour is covered in ``test_sandbox.py``.
    """
    response = client.post("/api/api-keys", headers=headers, json={"label": label, "mode": mode, "scopes": scopes})
    assert response.status_code == 201, response.text
    body = response.json()
    return body["id"], body["secret"]


def test_scope_catalogue(client: TestClient) -> None:
    headers = _entitled_headers(client)
    response = client.get("/api/api-keys/scopes", headers=headers)
    assert response.status_code == 200
    scopes = {item["scope"] for item in response.json()}
    assert "documents:read" in scopes and "audit:read" in scopes


def test_secret_is_returned_exactly_once(client: TestClient) -> None:
    headers = _entitled_headers(client)
    key_id, secret = create_key(client, headers, ["documents:read"], mode="test")
    assert secret.startswith("sk_test_")

    listed = client.get("/api/api-keys", headers=headers)
    assert listed.status_code == 200
    row = next(item for item in listed.json() if item["id"] == key_id)
    assert "secret" not in row
    assert secret not in row["masked"]
    assert row["masked"].startswith(row["prefix"])
    assert row["masked"].endswith(secret[-4:])

    detail = client.get(f"/api/api-keys/{key_id}", headers=headers)
    assert "secret" not in detail.json()
    # There is deliberately no reveal endpoint.
    assert client.post(f"/api/api-keys/{key_id}/reveal", headers=headers).status_code in {404, 405}


def test_key_authenticates_and_scope_is_enforced(client: TestClient) -> None:
    headers = _entitled_headers(client)
    _, read_secret = create_key(client, headers, ["documents:read"])

    assert client.get("/api/v1/documents").status_code == 401
    assert client.get("/api/v1/documents", headers={"X-API-Key": "sk_test_nope"}).status_code == 401

    allowed = client.get("/api/v1/documents", headers={"X-API-Key": read_secret})
    assert allowed.status_code == 200, allowed.text

    forbidden = client.get("/api/v1/contacts", headers={"X-API-Key": read_secret})
    assert forbidden.status_code == 403
    assert "contacts:read" in forbidden.json()["detail"]

    whoami = client.get("/api/v1/whoami", headers={"X-API-Key": read_secret})
    assert whoami.status_code == 200
    assert whoami.json()["is_platform_admin"] is False
    assert whoami.json()["scopes"] == ["documents:read"]


def test_last_used_at_is_tracked(client: TestClient) -> None:
    headers = _entitled_headers(client)
    key_id, secret = create_key(client, headers, ["documents:read"])
    assert client.get(f"/api/api-keys/{key_id}", headers=headers).json()["last_used_at"] is None
    client.get("/api/v1/documents", headers={"X-API-Key": secret})
    assert client.get(f"/api/api-keys/{key_id}", headers=headers).json()["last_used_at"] is not None


def test_scope_grant_and_revoke(client: TestClient) -> None:
    headers = _entitled_headers(client)
    key_id, secret = create_key(client, headers, ["documents:read"])
    granted = client.post(f"/api/api-keys/{key_id}/scopes/grant", headers=headers, json={"scopes": ["contacts:read"]})
    assert granted.status_code == 200
    assert set(granted.json()["scopes"]) == {"documents:read", "contacts:read"}
    assert client.get("/api/v1/contacts", headers={"X-API-Key": secret}).status_code == 200

    revoked = client.post(f"/api/api-keys/{key_id}/scopes/revoke", headers=headers, json={"scopes": ["contacts:read"]})
    assert revoked.json()["scopes"] == ["documents:read"]
    assert client.get("/api/v1/contacts", headers={"X-API-Key": secret}).status_code == 403

    bad = client.patch(f"/api/api-keys/{key_id}/scopes", headers=headers, json={"scopes": ["nope:write"]})
    assert bad.status_code == 400


def test_revocation_blocks_access_and_restore_reenables(client: TestClient) -> None:
    headers = _entitled_headers(client)
    key_id, secret = create_key(client, headers, ["documents:read"])
    assert client.get("/api/v1/documents", headers={"X-API-Key": secret}).status_code == 200

    revoked = client.post(f"/api/api-keys/{key_id}/revoke", headers=headers)
    assert revoked.status_code == 200
    assert revoked.json()["revoked_at"] is not None
    assert client.get("/api/v1/documents", headers={"X-API-Key": secret}).status_code == 401

    restored = client.post(f"/api/api-keys/{key_id}/restore", headers=headers)
    assert restored.json()["revoked_at"] is None
    assert client.get("/api/v1/documents", headers={"X-API-Key": secret}).status_code == 200


def test_roll_invalidates_the_old_secret(client: TestClient) -> None:
    headers = _entitled_headers(client)
    key_id, secret = create_key(client, headers, ["documents:read"])
    rolled = client.post(f"/api/api-keys/{key_id}/roll", headers=headers)
    assert rolled.status_code == 200
    new_secret = rolled.json()["secret"]
    assert new_secret != secret
    assert client.get("/api/v1/documents", headers={"X-API-Key": secret}).status_code == 401
    assert client.get("/api/v1/documents", headers={"X-API-Key": new_secret}).status_code == 200


def test_keys_are_tenant_scoped(client: TestClient) -> None:
    headers = _entitled_headers(client)
    key_id, _ = create_key(client, headers, ["documents:read"])
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
    assert client.get(f"/api/api-keys/{key_id}", headers=other_headers).status_code == 404
    assert client.get("/api/api-keys", headers=other_headers).json() == []


def test_usage_summary(client: TestClient) -> None:
    headers = _entitled_headers(client)
    _, secret = create_key(client, headers, ["documents:read"])
    client.get("/api/v1/documents", headers={"X-API-Key": secret})
    usage = client.get("/api/api-keys/usage", headers=headers)
    assert usage.status_code == 200
    body = usage.json()
    assert body["active_key_count"] == 1
    assert body["revoked_key_count"] == 0
    assert body["requests_24h"] == 1


def test_api_settings_roundtrip(client: TestClient) -> None:
    headers = _entitled_headers(client)
    updated = client.patch(
        "/api/organizations/me/api-settings",
        headers=headers,
        json={"allowed_origins": ["https://app.acme.test"], "default_return_url": "https://acme.test/done", "live_mode_enabled": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json() == {
        "allowed_origins": ["https://app.acme.test"],
        "default_return_url": "https://acme.test/done",
        "live_mode_enabled": False,
    }
    assert client.get("/api/organizations/me/api-settings", headers=headers).json()["allowed_origins"] == ["https://app.acme.test"]


def test_embed_session_lifecycle_and_origin_lock(client: TestClient, pdf_bytes: bytes) -> None:
    headers = _entitled_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    client.patch(
        "/api/organizations/me/api-settings",
        headers=headers,
        json={"allowed_origins": ["https://app.acme.test"], "default_return_url": "https://acme.test/done"},
    )

    created = client.post(
        "/api/embed/sessions",
        headers=headers,
        json={"landing": "signing", "document": {"document_id": document_id}, "recipient_id": recipient_id},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["return_url"] == "https://acme.test/done"
    assert body["allowed_origins"] == ["https://app.acme.test"]
    assert body["contacts"][0]["recipient_id"] == recipient_id
    token = body["url"].split("session=")[-1]

    # A cross-site exchange is refused: the allowlist bounds who may trade the
    # token in, and an origin outside it is not one of them.
    assert client.get(
        "/api/embed/resolve", params={"token": token}, headers={"Origin": "https://evil.test"}
    ).status_code == 403
    # A server-side exchange (no Origin at all) is *not* refused. It is how the
    # /embed route itself reads the session, and it is the only way an
    # allowlisted tenant can be framed: allowed_origins names host
    # applications, which never send us a request of their own, so the framing
    # rule is enforced by the frame-ancestors header below rather than here.
    resolved = client.get("/api/embed/resolve", params={"token": token}, headers={"Origin": "https://app.acme.test"})
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["id"] == body["id"]
    assert resolved.json()["consumed_at"] is not None

    listed = client.get("/api/embed/sessions", headers=headers)
    assert [item["id"] for item in listed.json()] == [body["id"]]

    revoked = client.post(f"/api/embed/sessions/{body['id']}/revoke", headers=headers)
    assert revoked.json()["expired"] is True
    expired = client.get("/api/embed/resolve", params={"token": token}, headers={"Origin": "https://app.acme.test"})
    assert expired.status_code == 410


def test_embed_session_expires(client: TestClient, pdf_bytes: bytes) -> None:
    headers = _entitled_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    created = client.post(
        "/api/embed/sessions",
        headers=headers,
        json={"landing": "builder", "document": {"document_id": document_id}, "ttl_minutes": 1},
    )
    token = created.json()["url"].split("session=")[-1]
    assert client.get("/api/embed/resolve", params={"token": token}).status_code == 200

    # Fast-forward past expiry.
    from datetime import datetime, timedelta, timezone

    from app.core.database import get_db
    from app.main import app
    from app.models.embed_session import EmbedSession

    db = next(app.dependency_overrides[get_db]())
    session = db.get(EmbedSession, created.json()["id"])
    session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.commit()

    assert client.get("/api/embed/resolve", params={"token": token}).status_code == 410


def test_embed_session_via_api_key_requires_write_scope(client: TestClient, pdf_bytes: bytes) -> None:
    headers = _entitled_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    _, read_secret = create_key(client, headers, ["documents:read"], label="read only")
    _, write_secret = create_key(client, headers, ["documents:write"], label="writer")

    payload = {"landing": "builder", "document": {"document_id": document_id}}
    assert client.post("/api/embed/sessions", headers={"X-API-Key": read_secret}, json=payload).status_code == 403
    assert client.post("/api/embed/sessions", headers={"X-API-Key": write_secret}, json=payload).status_code == 201


def test_a_key_stops_working_when_the_org_downgrades_below_api_access(client: TestClient) -> None:
    """Gating issuance is not enough.

    Keys outlive the plan that bought them, so ``api_access`` has to be
    re-checked on every key-authenticated call. Before this, an org that
    dropped back to Team kept a fully working live key for as long as it chose
    not to rotate it.
    """
    headers = _entitled_headers(client)
    _key_id, secret = create_key(client, headers, ["documents:read"])
    assert client.get("/api/v1/documents", headers={"X-API-Key": secret}).status_code == 200

    downgraded = client.post("/api/billing/change-plan", json={"plan_code": "team"}, headers=headers)
    assert downgraded.status_code == 200, downgraded.text

    refused = client.get("/api/v1/documents", headers={"X-API-Key": secret})
    assert refused.status_code == 402, refused.text
    detail = refused.json()["detail"]
    assert detail["error"] == "feature_not_available"
    assert detail["feature"] == "api_access"

    # Paying again restores it; the key itself was never revoked.
    upgrade_plan(client, headers, "business")
    assert client.get("/api/v1/documents", headers={"X-API-Key": secret}).status_code == 200


def test_frame_ancestors_carry_the_tenant_allowlist(client: TestClient, pdf_bytes: bytes) -> None:
    """The framing control, which is a header and not an Origin check.

    The frontend middleware turns this into
    ``Content-Security-Policy: frame-ancestors`` on /embed, so an unknown or
    expired token must answer with an empty list rather than an error: the page
    still renders its designed state, just unframed.
    """
    headers = _entitled_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    client.patch(
        "/api/organizations/me/api-settings",
        headers=headers,
        json={"allowed_origins": ["https://app.acme.test"]},
    )
    created = client.post(
        "/api/embed/sessions",
        headers=headers,
        json={"landing": "builder", "document": {"document_id": document_id}},
    )
    token = created.json()["url"].split("session=")[-1]

    got = client.get("/api/embed/frame-ancestors", params={"token": token})
    assert got.status_code == 200
    assert got.json()["frame_ancestors"] == ["https://app.acme.test"]

    # Fail closed, never loudly.
    assert client.get("/api/embed/frame-ancestors", params={"token": "x" * 40}).json()["frame_ancestors"] == []


def test_embed_context_is_scoped_and_survives_the_exchange(client: TestClient, pdf_bytes: bytes) -> None:
    """The framed page's own read.

    Single-use belongs to the *exchange*; the framed surface goes on needing
    its document for as long as the session lives, so ``/context`` must still
    answer after ``/resolve`` has stamped ``consumed_at``.
    """
    headers = _entitled_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    created = client.post(
        "/api/embed/sessions",
        headers=headers,
        json={"landing": "builder", "document": {"document_id": document_id, "external_id": "hostcrm:deal_1"}},
    )
    token = created.json()["url"].split("session=")[-1]

    assert client.get("/api/embed/resolve", params={"token": token}).status_code == 200
    assert client.get("/api/embed/resolve", params={"token": token}).status_code == 410

    context = client.get("/api/embed/context", params={"token": token})
    assert context.status_code == 200, context.text
    payload = context.json()
    assert payload["document"]["id"] == document_id
    assert payload["session"]["external_id"] == "hostcrm:deal_1"
    assert [r["id"] for r in payload["recipients"]] == [recipient_id]

    # The token unlocks the session's own document and nothing wider.
    assert client.get("/api/embed/pdf", params={"token": token}).status_code == 200
    assert client.get("/api/embed/context", params={"token": "y" * 40}).status_code == 404

    from datetime import datetime, timedelta, timezone

    from app.core.database import get_db
    from app.main import app
    from app.models.embed_session import EmbedSession

    db = next(app.dependency_overrides[get_db]())
    session = db.get(EmbedSession, created.json()["id"])
    session.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.commit()

    assert client.get("/api/embed/context", params={"token": token}).status_code == 410
    assert client.get("/api/embed/pdf", params={"token": token}).status_code == 410
