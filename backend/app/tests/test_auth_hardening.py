"""Regressions for five auth defects found by an audit probe suite.

The probes themselves were throwaway. The findings were not, so they are
pinned here instead of being deleted with the scaffolding that found them.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _request(peer: str | None, forwarded: str | None):
    headers = {"x-forwarded-for": forwarded} if forwarded else {}
    return SimpleNamespace(
        headers=headers,
        client=SimpleNamespace(host=peer) if peer else None,
    )


# --- 1. X-Forwarded-For spoofing -------------------------------------------


def test_forwarded_for_is_ignored_from_an_untrusted_peer(monkeypatch) -> None:
    """Trusting it unconditionally made every per-IP rate limit bypassable.

    Login, forgot-password, OTP and signing-link limits are all keyed on the
    client address; a header any client can set is not a client address.
    """
    from app.api import deps
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "trusted_proxy_ips", "", raising=False)
    deps._trusted_proxies.cache_clear()
    assert deps.request_ip(_request("203.0.113.9", "10.1.1.1")) == "203.0.113.9"


def test_forwarded_for_is_honoured_from_a_trusted_proxy(monkeypatch) -> None:
    """Behind a real ingress the header is the only way to see the client."""
    from app.api import deps
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "trusted_proxy_ips", "203.0.113.0/24", raising=False)
    deps._trusted_proxies.cache_clear()
    assert deps.request_ip(_request("203.0.113.9", "10.1.1.1, 7.7.7.7")) == "10.1.1.1"
    # A peer outside the trusted range is still not believed.
    assert deps.request_ip(_request("198.51.100.4", "10.1.1.1")) == "198.51.100.4"
    deps._trusted_proxies.cache_clear()


def test_the_rate_limiter_and_the_audit_trail_agree_on_the_client_ip() -> None:
    """They were two copies of the same decision, and only one was fixed.

    Divergent copies of a security rule are how a hole stays open in one place
    after being closed in the other.
    """
    import inspect

    from app.core.ratelimit import client_ip

    assert "request_ip" in inspect.getsource(client_ip)


# --- 2. password change did not revoke other sessions ----------------------


def test_changing_a_password_revokes_every_other_session(client: TestClient) -> None:
    """The one action a user takes to eject an intruder must eject them."""
    first = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Hardening Co", "name": "Owner",
            "email": "owner@example.com", "password": "strong-password",
        },
    ).json()
    intruder = client.post(
        "/api/auth/login", json={"email": "owner@example.com", "password": "strong-password"}
    ).json()
    intruder_headers = {"Authorization": f"Bearer {intruder['access_token']}"}
    assert client.get("/api/auth/me", headers=intruder_headers).status_code == 200

    owner_headers = {"Authorization": f"Bearer {first['access_token']}"}
    assert client.patch(
        "/api/auth/password",
        json={"current_password": "strong-password", "password": "an-even-stronger-password"},
        headers=owner_headers,
    ).status_code == 204

    # The other session is dead...
    assert client.get("/api/auth/me", headers=intruder_headers).status_code == 401
    # ...and the one that made the change is not, because signing yourself out
    # of the tab you just used is not the intent.
    assert client.get("/api/auth/me", headers=owner_headers).status_code == 200


# --- 3. rolling a revoked API key resurrected it ---------------------------


def test_rolling_a_revoked_api_key_is_refused(client: TestClient) -> None:
    """`roll` was an undocumented second path to `restore`.

    A key deliberately killed after a leak could be brought back by anyone able
    to roll it.
    """
    from app.models.api_key import ApiKey
    from app.services.api_key_service import api_key_service

    from app.tests.conftest import upgrade_plan

    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")  # api_access is a paid feature
    created = client.post(
        "/api/api-keys", json={"label": "CI", "mode": "test", "scopes": ["documents:read"]},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    key_id = created.json()["id"]
    assert client.post(f"/api/api-keys/{key_id}/revoke", headers=headers).status_code == 200

    db = _db()
    key = db.get(ApiKey, key_id)
    with pytest.raises(Exception) as excinfo:
        api_key_service.roll(db, api_key=key)
    assert "revoked" in str(excinfo.value).lower()

    db2 = _db()
    assert db2.get(ApiKey, key_id).revoked_at is not None


# --- 4. an accepted invitation created an unrevocable identity -------------


def test_accepting_an_invitation_creates_a_revocable_session(client: TestClient) -> None:
    """A token minted with no `sid` has no session row, so nothing can revoke it.

    "Sign out all devices" and an admin force-logout both silently skipped
    anyone who had joined by invitation, for the life of their token.
    """
    from app.models.user import User
    from app.models.user_session import UserSession

    headers = auth_headers(client)
    invited = client.post(
        "/api/invitations/", json={"email": "member@example.com", "role": "sender"}, headers=headers
    )
    assert invited.status_code == 201, invited.text
    raw_token = invited.json()["invite_link"].rsplit("/", 1)[-1]

    accepted = client.post(
        "/api/invitations/accept",
        json={"token": raw_token, "name": "New Member", "password": "strong-password"},
    )
    assert accepted.status_code == 201, accepted.text
    # A refresh token only exists when a real session row was created.
    assert accepted.json().get("refresh_token"), "an invited member got no refresh token"

    db = _db()
    user = db.query(User).filter(User.email == "member@example.com").one()
    assert db.query(UserSession).filter(UserSession.user_id == user.id).count() == 1

    # And it is genuinely revocable, which is the whole point.
    member_headers = {"Authorization": f"Bearer {accepted.json()['access_token']}"}
    assert client.get("/api/auth/me", headers=member_headers).status_code == 200
    assert client.post("/api/auth/logout", headers=member_headers).status_code == 204
    assert client.get("/api/auth/me", headers=member_headers).status_code == 401


# --- 5. sensitive auth actions were not semantically audited ---------------


def test_sensitive_auth_actions_are_audited_semantically(client: TestClient) -> None:
    """The request middleware already logs `PATCH /api/auth/password -> 204`.

    That is a transport record. An incident review needs to know that a
    password was changed and an API key minted, without reconstructing it from
    HTTP verbs.
    """
    from app.models.platform_audit import PlatformAuditEntry

    headers = auth_headers(client)
    client.patch(
        "/api/auth/password",
        json={"current_password": "strong-password", "password": "another-strong-password"},
        headers=headers,
    )
    from app.tests.conftest import upgrade_plan

    upgrade_plan(client, headers, "business")
    client.post(
        "/api/api-keys", json={"label": "CI", "mode": "test", "scopes": ["documents:read"]},
        headers=headers,
    )

    db = _db()
    actions = {row.action for row in db.query(PlatformAuditEntry).all()}
    assert "auth.password_changed" in actions
    assert "api_key.created" in actions
