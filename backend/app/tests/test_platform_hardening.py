"""Regression tests for the platform-operations hardening wave (C8 and §6/§7).

Every test here reproduces an exploit the audit actually drove through the
real API. They are grouped by the property they defend:

* impersonation scope, revocation and attribution (C8);
* audit coverage of privileged platform mutations;
* the single lock-out guard shared by both role-assignment routes;
* embed session single-use and origin locking;
* per-key throttling of the public API.
"""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.mixins import now_utc
from app.models.user import User


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _register(client: TestClient, *, org: str, email: str, name: str = "Owner") -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _me(client: TestClient, headers: dict[str, str]) -> dict:
    return client.get("/api/auth/me", headers=headers).json()


def _promote(client: TestClient, headers: dict[str, str]) -> None:
    session, generator = _db()
    user = session.get(User, _me(client, headers)["id"])
    user.is_platform_admin = True
    session.add(user)
    session.commit()
    generator.close()


def _platform_and_tenant(client: TestClient) -> tuple[dict[str, str], dict[str, str], str]:
    platform = _register(client, org="SignForge", email="ops@signforge.com", name="Jordan Mehta")
    _promote(client, platform)
    tenant = _register(client, org="Acme Realty", email="priya@acme.io", name="Priya Rao")
    return platform, tenant, _me(client, tenant)["organization_id"]


def _impersonate(client, platform, org_id, *, scopes=None, ttl=600) -> dict:
    body = {"justification": "incident #INC-4471", "ttl_seconds": ttl}
    if scopes is not None:
        body["scopes"] = scopes
    response = client.post(
        f"/api/saas/tenants/{org_id}/impersonate", json=body, headers=platform
    )
    assert response.status_code == 200, response.text
    return response.json()


def _entitled(client: TestClient, *, org: str, email: str) -> dict[str, str]:
    """A tenant that has bought the ``api_access`` entitlement the API needs."""
    from app.tests.conftest import upgrade_plan

    headers = _register(client, org=org, email=email)
    upgrade_plan(client, headers, "business")
    return headers


def _audit_actions(client: TestClient, platform: dict[str, str]) -> list[str]:
    return [entry["action"] for entry in client.get("/api/saas/audit", headers=platform).json()["items"]]


def _document(client: TestClient, headers: dict[str, str]) -> str:
    response = client.post("/api/documents", json={"title": "Lease"}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


# --------------------------------------------------------------------------- #
# C8.1 — scopes are enforced
# --------------------------------------------------------------------------- #

def test_read_scoped_impersonation_cannot_write(client: TestClient) -> None:
    """The auditor's exploit: a ``read`` token that happily wrote.

    ``PATCH /api/documents/{id}`` and ``POST /{id}/trash`` both returned 200,
    and ``POST /api/invitations/`` returned 201 with a live admin invite.
    """
    platform, tenant, org_id = _platform_and_tenant(client)
    document_id = _document(client, tenant)
    token = _impersonate(client, platform, org_id, scopes=["read"])
    assert token["scopes"] == ["read"]
    headers = {"Authorization": f"Bearer {token['access_token']}"}

    # Reads still work — that is the whole point of a support session.
    assert client.get("/api/documents", headers=headers).status_code == 200
    assert _me(client, headers)["email"] == "priya@acme.io"

    assert client.patch(
        f"/api/documents/{document_id}", json={"title": "Owned"}, headers=headers
    ).status_code == 403
    assert client.post(f"/api/documents/{document_id}/trash", headers=headers).status_code == 403
    invite = client.post(
        "/api/invitations/", json={"email": "attacker@evil.com", "role": "admin"}, headers=headers
    )
    assert invite.status_code == 403

    # And the tenant's data is untouched.
    assert client.get(f"/api/documents/{document_id}", headers=tenant).json()["title"] == "Lease"


def test_write_scoped_impersonation_still_cannot_grant_durable_access(client: TestClient) -> None:
    """A write session may edit tenant data but never mint lasting credentials."""
    platform, tenant, org_id = _platform_and_tenant(client)
    document_id = _document(client, tenant)
    token = _impersonate(client, platform, org_id, scopes=["read", "write"])
    headers = {"Authorization": f"Bearer {token['access_token']}"}

    assert client.patch(
        f"/api/documents/{document_id}", json={"title": "Support edit"}, headers=headers
    ).status_code == 200
    # The backdoor the auditor planted: an admin invitation that outlives the
    # 15-minute session.
    assert client.post(
        "/api/invitations/", json={"email": "attacker@evil.com", "role": "admin"}, headers=headers
    ).status_code == 403
    assert client.post(
        "/api/api-keys",
        json={"label": "backdoor", "mode": "test", "scopes": ["documents:read"]},
        headers=headers,
    ).status_code == 403


def test_unknown_impersonation_scope_is_rejected(client: TestClient) -> None:
    platform, _tenant, org_id = _platform_and_tenant(client)
    response = client.post(
        f"/api/saas/tenants/{org_id}/impersonate",
        json={"justification": "fishing expedition", "scopes": ["admin"]},
        headers=platform,
    )
    assert response.status_code == 400
    assert "admin" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# C8.2 — ending a session revokes the token
# --------------------------------------------------------------------------- #

def test_ending_impersonation_revokes_the_token_immediately(client: TestClient) -> None:
    """Previously the JWT kept working until ``exp``; ``token_hash`` was unread."""
    platform, tenant, org_id = _platform_and_tenant(client)
    token = _impersonate(client, platform, org_id)
    headers = {"Authorization": f"Bearer {token['access_token']}"}
    assert client.get("/api/documents", headers=headers).status_code == 200

    ended = client.delete("/api/saas/impersonation", headers=platform)
    assert ended.json()["ended_sessions"] == 1

    for path in ("/api/documents", "/api/auth/me", "/api/contacts"):
        response = client.get(path, headers=headers)
        assert response.status_code == 401, (path, response.text)
        assert "impersonation session has ended" in response.json()["detail"]


def test_expired_impersonation_session_is_refused(client: TestClient) -> None:
    platform, _tenant, org_id = _platform_and_tenant(client)
    token = _impersonate(client, platform, org_id)
    headers = {"Authorization": f"Bearer {token['access_token']}"}

    session, generator = _db()
    from app.models.impersonation import ImpersonationSession

    row = session.get(ImpersonationSession, token["id"])
    row.expires_at = now_utc() - timedelta(minutes=1)
    session.add(row)
    session.commit()
    generator.close()

    assert client.get("/api/documents", headers=headers).status_code == 401


def test_a_forged_impersonation_token_has_no_session_row(client: TestClient) -> None:
    """The credential is the row, not the signature."""
    platform, tenant, org_id = _platform_and_tenant(client)
    target_id = _me(client, tenant)["id"]

    from app.core.security import IMPERSONATION_TOKEN_PURPOSE, create_scoped_token

    forged = create_scoped_token(
        target_id,
        purpose=IMPERSONATION_TOKEN_PURPOSE,
        expires_in_seconds=600,
        imp="whoever",
        scopes=["read", "write"],
    )
    response = client.get("/api/documents", headers={"Authorization": f"Bearer {forged}"})
    assert response.status_code == 401
    assert "not recognised" in response.json()["detail"]


# --------------------------------------------------------------------------- #
# C8.3 — actions are attributable to the admin
# --------------------------------------------------------------------------- #

def test_impersonated_actions_are_attributed_to_the_platform_admin(client: TestClient) -> None:
    """The tenant's trail used to read as their own admin acting alone."""
    platform, tenant, org_id = _platform_and_tenant(client)
    document_id = _document(client, tenant)
    token = _impersonate(client, platform, org_id, scopes=["write"])
    headers = {"Authorization": f"Bearer {token['access_token']}"}

    assert client.patch(
        f"/api/documents/{document_id}", json={"title": "Support edit"}, headers=headers
    ).status_code == 200

    trail = client.get(f"/api/documents/{document_id}/audit-logs", headers=tenant).json()
    stamped = [
        entry for entry in trail if (entry.get("log_metadata") or {}).get("impersonation")
    ]
    assert stamped, trail
    marker = stamped[0]["log_metadata"]["impersonation"]
    assert marker["admin_email"] == "ops@signforge.com"
    assert marker["session_id"] == token["id"]
    assert marker["justification"] == "incident #INC-4471"

    # The document's own creation, taken by the tenant, is *not* stamped: the
    # marker must distinguish the two, not decorate everything.
    assert any(not (entry.get("log_metadata") or {}).get("impersonation") for entry in trail)


def test_impersonation_context_does_not_leak_to_the_next_request(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)
    document_id = _document(client, tenant)
    token = _impersonate(client, platform, org_id, scopes=["write"])
    client.patch(
        f"/api/documents/{document_id}",
        json={"title": "One"},
        headers={"Authorization": f"Bearer {token['access_token']}"},
    )
    assert client.patch(
        f"/api/documents/{document_id}", json={"title": "Two"}, headers=tenant
    ).status_code == 200

    trail = client.get(f"/api/documents/{document_id}/audit-logs", headers=tenant).json()
    marked = [bool((entry.get("log_metadata") or {}).get("impersonation")) for entry in trail]
    assert True in marked and False in marked


# --------------------------------------------------------------------------- #
# Suspension holds for impersonation too
# --------------------------------------------------------------------------- #

def test_suspending_a_tenant_blocks_its_users_and_impersonation(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)
    token = _impersonate(client, platform, org_id)
    headers = {"Authorization": f"Bearer {token['access_token']}"}

    assert client.post(
        f"/api/saas/tenants/{org_id}/suspend", json={"reason": "non-payment"}, headers=platform
    ).status_code == 200

    assert client.get("/api/documents", headers=tenant).status_code == 403
    assert client.get("/api/documents", headers=headers).status_code == 403

    assert client.post(f"/api/saas/tenants/{org_id}/resume", headers=platform).status_code == 200
    assert client.get("/api/documents", headers=tenant).status_code == 200


# --------------------------------------------------------------------------- #
# Audit coverage of privileged mutations
# --------------------------------------------------------------------------- #

def test_changing_a_tenants_plan_is_audited(client: TestClient) -> None:
    """Verified by the auditor: the audit total was 1 before *and* after."""
    platform, _tenant, org_id = _platform_and_tenant(client)
    before = client.get("/api/saas/audit", headers=platform).json()["total"]

    response = client.patch(
        f"/api/saas/organizations/{org_id}",
        json={"subscription_tier": "enterprise", "subscription_status": "active"},
        headers=platform,
    )
    assert response.status_code == 200, response.text

    audit = client.get("/api/saas/audit", headers=platform).json()
    assert audit["total"] == before + 1
    entry = next(item for item in audit["items"] if item["action"] == "tenant.subscription_updated")
    assert entry["organization_id"] == org_id
    assert entry["actor_email"] == "ops@signforge.com"
    assert "enterprise" in entry["detail"]


def test_invoice_operations_are_audited(client: TestClient) -> None:
    platform, _tenant, org_id = _platform_and_tenant(client)

    session, generator = _db()
    from app.models.invoice import Invoice, InvoiceStatus

    invoice = Invoice(
        organization_id=org_id,
        number="INV-TEST-1",
        status=InvoiceStatus.open,
        total_cents=250_000,
        issued_at=now_utc(),
        due_at=now_utc() + timedelta(days=7),
    )
    voidable = Invoice(
        organization_id=org_id,
        number="INV-TEST-2",
        status=InvoiceStatus.open,
        total_cents=1_000,
        issued_at=now_utc(),
        due_at=now_utc() + timedelta(days=7),
    )
    session.add_all([invoice, voidable])
    session.commit()
    paid_id, void_id = invoice.id, voidable.id
    generator.close()

    assert client.post(
        f"/api/saas/invoices/{paid_id}/mark-paid", json={"amount_cents": 250_000}, headers=platform
    ).status_code == 200
    assert client.post(
        f"/api/saas/invoices/{void_id}/void", json={"reason": "duplicate"}, headers=platform
    ).status_code == 200

    actions = _audit_actions(client, platform)
    assert "invoice.marked_paid" in actions
    assert "invoice.voided" in actions


def test_billing_event_replay_is_audited(client: TestClient) -> None:
    platform, _tenant, org_id = _platform_and_tenant(client)

    session, generator = _db()
    from app.models.subscription import ProcessedWebhookEvent

    event = ProcessedWebhookEvent(
        provider="null",
        event_id="evt_test_1",
        event_type="subscription.activated",
        payload={"type": "subscription.activated", "organization_id": org_id},
        processed=True,
    )
    session.add(event)
    session.commit()
    event_id = event.id
    generator.close()

    response = client.post(f"/api/saas/billing-events/{event_id}/replay", headers=platform)
    assert response.status_code == 200, response.text
    assert "billing_event.replayed" in _audit_actions(client, platform)


# --------------------------------------------------------------------------- #
# Role assignment — one guard, two routes
# --------------------------------------------------------------------------- #

def test_both_role_routes_refuse_to_strand_a_tenant_without_an_admin(client: TestClient) -> None:
    """``PATCH /api/saas/users/{id}/role`` had no guards at all."""
    platform, tenant, _org_id = _platform_and_tenant(client)
    tenant_admin_id = _me(client, tenant)["id"]

    for path in (
        f"/api/saas/directory/{tenant_admin_id}/role",
        f"/api/saas/users/{tenant_admin_id}/role",
    ):
        response = client.patch(path, json={"role": "sender"}, headers=platform)
        assert response.status_code == 409, (path, response.text)
        assert "at least one administrator" in response.json()["detail"]

    assert _me(client, tenant)["role"] == "admin"


def test_the_last_platform_admin_cannot_be_demoted(client: TestClient) -> None:
    """Demoting them locks everyone out of /api/saas/* — there is no bootstrap."""
    platform, _tenant, _org_id = _platform_and_tenant(client)
    admin_id = _me(client, platform)["id"]

    for path in (
        f"/api/saas/directory/{admin_id}/role",
        f"/api/saas/users/{admin_id}/role",
    ):
        response = client.patch(path, json={"role": "orgadmin"}, headers=platform)
        assert response.status_code == 409, (path, response.text)
        assert "platform administrator" in response.json()["detail"]

    # With a second platform admin in place the demotion is allowed again.
    second = _register(client, org="SignForge Ops", email="sam@signforge.com", name="Sam Ops")
    _promote(client, second)
    assert client.patch(
        f"/api/saas/users/{admin_id}/role", json={"role": "orgadmin"}, headers=second
    ).status_code == 200
    assert client.get("/api/saas/tenants", headers=platform).status_code == 403


# --------------------------------------------------------------------------- #
# Embed sessions
# --------------------------------------------------------------------------- #

def _embed_token(client: TestClient, headers: dict[str, str]) -> str:
    response = client.post(
        "/api/embed/sessions", json={"landing": "builder", "ttl_minutes": 30}, headers=headers
    )
    assert response.status_code == 201, response.text
    return response.json()["url"].split("session=")[1]


def test_embed_session_is_single_use(client: TestClient) -> None:
    """The route has always claimed a single-use stamp; it never enforced one."""
    headers = _entitled(client, org="Embed Co", email="dev@embed.example")
    token = _embed_token(client, headers)

    assert client.get("/api/embed/resolve", params={"token": token}).status_code == 200
    replay = client.get("/api/embed/resolve", params={"token": token})
    assert replay.status_code == 410
    assert "already been used" in replay.json()["detail"]


def test_embed_without_an_allowlist_refuses_third_party_origins(client: TestClient) -> None:
    """Empty ``allowed_origins`` is the default for every new organization."""
    headers = _entitled(client, org="Embed Co", email="dev@embed.example")
    token = _embed_token(client, headers)

    refused = client.get(
        "/api/embed/resolve", params={"token": token}, headers={"Origin": "https://evil.example"}
    )
    assert refused.status_code == 403
    assert "allowlist" in refused.json()["detail"]

    # Still unconsumed, so the legitimate first-party exchange works.
    assert client.get(
        "/api/embed/resolve",
        params={"token": token},
        headers={"Origin": "http://localhost:3000"},
    ).status_code == 200


def test_embed_allowlist_still_locks_to_configured_origins(client: TestClient) -> None:
    headers = _entitled(client, org="Embed Co", email="dev@embed.example")
    assert client.patch(
        "/api/organizations/me/api-settings",
        json={"allowed_origins": ["https://app.embed.example"]},
        headers=headers,
    ).status_code == 200
    token = _embed_token(client, headers)

    assert client.get(
        "/api/embed/resolve", params={"token": token}, headers={"Origin": "http://localhost:3000"}
    ).status_code == 403
    assert client.get(
        "/api/embed/resolve", params={"token": token}, headers={"Origin": "https://app.embed.example"}
    ).status_code == 200


# --------------------------------------------------------------------------- #
# Public API throttling
# --------------------------------------------------------------------------- #

def test_public_api_is_rate_limited_per_key(client: TestClient) -> None:
    from app.core import ratelimit

    headers = _entitled(client, org="Api Co", email="dev@api.example")
    created = client.post(
        "/api/api-keys",
        json={"label": "primary", "mode": "test", "scopes": ["documents:read"]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    secret = created.json()["secret"]

    ratelimit.reset_rate_limits()
    original = ratelimit.public_api_limiter.limit
    ratelimit.public_api_limiter.limit = 3
    try:
        codes = [
            client.get("/api/v1/documents", headers={"X-API-Key": secret}).status_code
            for _ in range(5)
        ]
    finally:
        ratelimit.public_api_limiter.limit = original
        ratelimit.reset_rate_limits()

    assert codes[:3] == [200, 200, 200]
    assert codes[3:] == [429, 429]


# --------------------------------------------------------------------------- #
# Outbound webhook SSRF — validation must happen at delivery, not only at
# registration (DNS rebinding).
# --------------------------------------------------------------------------- #

def test_delivery_time_resolution_refuses_a_rebound_host(monkeypatch) -> None:
    """The endpoint was validated at creation; the attacker rebinds afterwards."""
    import socket as socket_module

    from app.services import webhook_service as module

    monkeypatch.setattr(
        module.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket_module.AF_INET, socket_module.SOCK_STREAM, 6, "", ("169.254.169.254", 443))
        ],
    )
    try:
        module.resolve_and_pin("https://hook.example.com/path")
    except module.WebhookUrlError as exc:
        assert "blocked address range" in str(exc)
    else:  # pragma: no cover - the point of the test
        raise AssertionError("a rebound host was accepted at delivery time")


def test_delivery_pins_the_connection_to_the_validated_address(monkeypatch) -> None:
    """Resolving again in the socket layer would reopen the same window."""
    import socket as socket_module

    from app.services import webhook_service as module

    monkeypatch.setattr(
        module.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [
            (socket_module.AF_INET, socket_module.SOCK_STREAM, 6, "", ("93.184.216.34", 443))
        ],
    )
    url, headers = module.resolve_and_pin("https://hook.example.com/path?x=1")
    assert url == "https://93.184.216.34/path?x=1"
    assert headers == {"Host": "hook.example.com"}


def test_insecure_webhook_urls_are_gated_on_is_production() -> None:
    """A misconfigured ENVIRONMENT name must not re-enable the bypass."""
    from app.services.webhook_service import WebhookUrlError, validate_endpoint_url

    # Explicit override stands in for "production", whatever the env is named.
    for blocked in ("http://example.com/hook", "https://127.0.0.1/hook", "https://localhost/hook"):
        try:
            validate_endpoint_url(blocked, allow_insecure=False)
        except WebhookUrlError:
            continue
        raise AssertionError(f"{blocked} was accepted in a production posture")
