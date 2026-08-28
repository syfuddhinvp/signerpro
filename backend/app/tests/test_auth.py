from fastapi.testclient import TestClient


def test_register_and_login(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "North Star Mortgage",
            "name": "Morgan Sender",
            "email": "morgan@example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["user"]["role"] == "admin"

    login = client.post(
        "/api/auth/login",
        json={"email": "morgan@example.com", "password": "strong-password"},
    )
    assert login.status_code == 200, login.text
    assert login.json()["access_token"]



import pytest
from app.core import totp
from app.core.ratelimit import reset_rate_limits


@pytest.fixture(autouse=True)
def _clean_rate_limits():
    reset_rate_limits()
    yield
    reset_rate_limits()


def _register(client: TestClient, email: str = "casey@example.com", password: str = "strong-password") -> dict:
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Harbour Legal",
            "name": "Casey Owner",
            "email": email,
            "password": password,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _headers(payload: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['access_token']}"}


def test_register_payload_carries_platform_flag_and_org_name(client: TestClient) -> None:
    body = _register(client)
    user = body["user"]
    assert user["is_platform_admin"] is False
    assert user["organization_name"] == "Harbour Legal"
    assert user["mfa_enrolled"] is False
    assert body["refresh_token"]
    assert body["expires_in"] > 0


def test_login_payload_matches_register_payload(client: TestClient) -> None:
    _register(client)
    login = client.post("/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"})
    assert login.status_code == 200, login.text
    user = login.json()["user"]
    assert set(user) >= {"id", "organization_id", "organization_name", "name", "email", "role", "is_platform_admin"}


# --- password reset ----------------------------------------------------------


def _issue_reset_token(client: TestClient, monkeypatch, email: str = "casey@example.com") -> str:
    sent: list = []
    from app.core import email as email_module

    monkeypatch.setattr(email_module.email_service, "send", lambda message, organization=None: sent.append(message))
    response = client.post("/api/auth/password/forgot", json={"email": email})
    assert response.status_code == 204, response.text
    assert len(sent) == 1
    body = sent[0].body
    return body.split("token=", 1)[1].split()[0]


def test_forgot_password_is_silent_for_unknown_addresses(client: TestClient, monkeypatch) -> None:
    from app.core import email as email_module

    sent: list = []
    monkeypatch.setattr(email_module.email_service, "send", lambda message, organization=None: sent.append(message))
    response = client.post("/api/auth/password/forgot", json={"email": "nobody@example.com"})
    assert response.status_code == 204
    assert sent == []


def test_password_reset_is_single_use(client: TestClient, monkeypatch) -> None:
    _register(client)
    token = _issue_reset_token(client, monkeypatch)

    first = client.post("/api/auth/password/reset", json={"token": token, "password": "brand-new-password"})
    assert first.status_code == 200, first.text
    assert first.json()["user"]["email"] == "casey@example.com"

    second = client.post("/api/auth/password/reset", json={"token": token, "password": "another-password"})
    assert second.status_code == 400

    assert client.post(
        "/api/auth/login", json={"email": "casey@example.com", "password": "brand-new-password"}
    ).status_code == 200
    assert client.post(
        "/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"}
    ).status_code == 401


def test_password_reset_rejects_expired_token(client: TestClient, monkeypatch) -> None:
    _register(client)
    token = _issue_reset_token(client, monkeypatch)

    from datetime import datetime, timedelta, timezone

    from app.core.security import hash_opaque_token
    from app.models.password_reset import PasswordResetToken
    from sqlalchemy import select

    # Reach into the same overridden session factory the app uses.
    from app.core.database import get_db
    from app.main import app as fastapi_app

    generator = fastapi_app.dependency_overrides[get_db]()
    db = next(generator)
    row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_opaque_token(token)))
    row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    db.commit()

    response = client.post("/api/auth/password/reset", json={"token": token, "password": "brand-new-password"})
    assert response.status_code == 400


def test_password_reset_rejects_unknown_token(client: TestClient) -> None:
    _register(client)
    response = client.post("/api/auth/password/reset", json={"token": "not-a-token", "password": "brand-new-password"})
    assert response.status_code == 400


def test_change_password_requires_current_password(client: TestClient) -> None:
    body = _register(client)
    headers = _headers(body)

    wrong = client.patch(
        "/api/auth/password",
        json={"current_password": "not-it", "password": "replacement-password"},
        headers=headers,
    )
    assert wrong.status_code == 403

    ok = client.patch(
        "/api/auth/password",
        json={"current_password": "strong-password", "password": "replacement-password"},
        headers=headers,
    )
    assert ok.status_code == 204
    assert client.post(
        "/api/auth/login", json={"email": "casey@example.com", "password": "replacement-password"}
    ).status_code == 200


# --- MFA ---------------------------------------------------------------------


def _enrol_mfa(client: TestClient, headers: dict[str, str]) -> tuple[str, list[str]]:
    enroll = client.post("/api/auth/mfa/enroll", json={"method": "totp"}, headers=headers)
    assert enroll.status_code == 200, enroll.text
    secret = enroll.json()["secret"]
    assert enroll.json()["otpauth_url"].startswith("otpauth://totp/")
    codes = enroll.json()["recovery_codes"]
    confirm = client.post(
        "/api/auth/mfa/enroll/confirm", json={"code": totp.current_code(secret)}, headers=headers
    )
    assert confirm.status_code == 204, confirm.text
    return secret, codes


def test_mfa_challenge_and_exchange_flow(client: TestClient) -> None:
    body = _register(client)
    headers = _headers(body)
    secret, recovery_codes = _enrol_mfa(client, headers)

    status_response = client.get("/api/auth/mfa", headers=headers)
    assert status_response.json()["enrolled"] is True
    assert status_response.json()["recovery_codes_remaining"] == len(recovery_codes)

    login = client.post("/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"})
    assert login.status_code == 200, login.text
    challenge = login.json()
    assert challenge["mfa_required"] is True
    assert "access_token" not in challenge
    mfa_token = challenge["mfa_token"]

    info = client.post("/api/auth/mfa/challenge", json={"mfa_token": mfa_token})
    assert info.status_code == 200
    assert info.json()["delivery"] == "totp"
    assert info.json()["masked_target"].endswith("@example.com")

    bad = client.post("/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": "000000"})
    assert bad.status_code == 401

    good = client.post(
        "/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": totp.current_code(secret)}
    )
    assert good.status_code == 200, good.text
    assert good.json()["access_token"]
    assert good.json()["user"]["mfa_enrolled"] is True


def test_mfa_recovery_code_is_single_use(client: TestClient) -> None:
    body = _register(client)
    headers = _headers(body)
    _secret, codes = _enrol_mfa(client, headers)

    mfa_token = client.post(
        "/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"}
    ).json()["mfa_token"]
    first = client.post("/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": codes[0]})
    assert first.status_code == 200, first.text

    mfa_token = client.post(
        "/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"}
    ).json()["mfa_token"]
    replay = client.post("/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": codes[0]})
    assert replay.status_code == 401


def test_mfa_disable_requires_valid_code(client: TestClient) -> None:
    body = _register(client)
    headers = _headers(body)
    secret, _codes = _enrol_mfa(client, headers)

    assert client.post("/api/auth/mfa/disable", json={"code": "000000"}, headers=headers).status_code == 400
    assert client.post(
        "/api/auth/mfa/disable", json={"code": totp.current_code(secret)}, headers=headers
    ).status_code == 204
    assert client.get("/api/auth/mfa", headers=headers).json()["enrolled"] is False
    assert "mfa_token" not in client.post(
        "/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"}
    ).json()


def test_mfa_secret_is_encrypted_at_rest(client: TestClient) -> None:
    body = _register(client)
    headers = _headers(body)
    secret, _codes = _enrol_mfa(client, headers)

    from sqlalchemy import text

    from app.core.database import get_db
    from app.main import app as fastapi_app

    db = next(fastapi_app.dependency_overrides[get_db]())
    stored = db.execute(text("SELECT mfa_secret FROM users")).scalar()
    assert stored != secret
    assert stored.startswith("enc:")


# --- rate limiting -----------------------------------------------------------


def test_login_is_rate_limited(client: TestClient) -> None:
    _register(client)
    from app.core.ratelimit import LOGIN_EMAIL_LIMIT

    codes = [
        client.post("/api/auth/login", json={"email": "casey@example.com", "password": "wrong"}).status_code
        for _ in range(LOGIN_EMAIL_LIMIT + 2)
    ]
    assert 429 in codes


def test_password_forgot_is_rate_limited(client: TestClient, monkeypatch) -> None:
    _register(client)
    from app.core import email as email_module
    from app.core.ratelimit import PASSWORD_FORGOT_LIMIT

    monkeypatch.setattr(email_module.email_service, "send", lambda message, organization=None: None)
    codes = [
        client.post("/api/auth/password/forgot", json={"email": "casey@example.com"}).status_code
        for _ in range(PASSWORD_FORGOT_LIMIT + 2)
    ]
    assert codes[0] == 204
    assert codes[-1] == 429


def test_mfa_verify_is_rate_limited(client: TestClient) -> None:
    body = _register(client)
    headers = _headers(body)
    _enrol_mfa(client, headers)
    mfa_token = client.post(
        "/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"}
    ).json()["mfa_token"]

    from app.core.ratelimit import MFA_VERIFY_LIMIT

    codes = [
        client.post("/api/auth/mfa/verify", json={"mfa_token": mfa_token, "code": "000000"}).status_code
        for _ in range(MFA_VERIFY_LIMIT + 2)
    ]
    assert codes[-1] == 429


# --- sessions / devices ------------------------------------------------------


def test_sessions_are_recorded_listed_and_revoked(client: TestClient) -> None:
    first = _register(client)
    second = client.post(
        "/api/auth/login",
        json={"email": "casey@example.com", "password": "strong-password"},
        headers={"user-agent": "Mozilla/5.0 (iPhone) Safari/605"},
    )
    assert second.status_code == 200

    sessions = client.get("/api/auth/sessions", headers=_headers(first))
    assert sessions.status_code == 200, sessions.text
    rows = sessions.json()
    assert len(rows) == 2
    current = [row for row in rows if row["is_current"]]
    assert len(current) == 1
    other = next(row for row in rows if not row["is_current"])
    assert other["device"] == "Mobile"

    assert client.delete(f"/api/auth/sessions/{other['id']}", headers=_headers(first)).status_code == 204
    assert len(client.get("/api/auth/sessions", headers=_headers(first)).json()) == 1

    # Revoking someone else's session is a 404, never a silent success.
    third = _register(client, email="dana@example.com")
    assert client.delete(
        f"/api/auth/sessions/{current[0]['id']}", headers=_headers(third)
    ).status_code == 404


def test_revoke_other_sessions_keeps_the_caller(client: TestClient) -> None:
    first = _register(client)
    client.post("/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"})
    client.post("/api/auth/login", json={"email": "casey@example.com", "password": "strong-password"})

    assert client.delete("/api/auth/sessions", headers=_headers(first)).status_code == 204
    rows = client.get("/api/auth/sessions", headers=_headers(first)).json()
    assert len(rows) == 1 and rows[0]["is_current"] is True


def test_refresh_rotates_the_session_and_logout_revokes_it(client: TestClient) -> None:
    body = _register(client)
    refreshed = client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["refresh_token"] != body["refresh_token"]
    # The consumed refresh token cannot be replayed.
    assert client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]}).status_code == 401

    assert client.post("/api/auth/logout", headers=_headers(refreshed.json())).status_code == 204
    rows = client.get("/api/auth/sessions", headers=_headers(refreshed.json())).json()
    assert all(row["is_current"] is False for row in rows)


# --- profile -----------------------------------------------------------------


def test_profile_update_round_trip(client: TestClient) -> None:
    body = _register(client)
    headers = _headers(body)
    response = client.patch(
        "/api/auth/me",
        json={"name": "Casey Renamed", "locale": "en-GB", "timezone": "Europe/London", "avatar_url": "https://cdn/x.png"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["name"] == "Casey Renamed"
    assert response.json()["timezone"] == "Europe/London"

    me = client.get("/api/auth/me", headers=headers).json()
    assert me["locale"] == "en-GB"
    assert me["avatar_url"] == "https://cdn/x.png"
    assert me["organization_name"] == "Harbour Legal"
