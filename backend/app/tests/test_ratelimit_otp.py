import secrets

import pytest
from fastapi.testclient import TestClient

from app.core import ratelimit
from app.core.ratelimit import reset_rate_limits
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, create_uploaded_document, token_from_link


@pytest.fixture(autouse=True)
def _clean_rate_limits():
    reset_rate_limits()
    yield
    reset_rate_limits()


def _otp_document(client: TestClient, pdf_bytes: bytes) -> tuple[str, dict[str, str], str]:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    response = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={
            "name": "OTP Signer",
            "email": "otpsigner@example.com",
            "role_name": "Signer",
            "signing_order": 1,
            "otp_enabled": True,
        },
    )
    assert response.status_code == 201, response.text
    signer_id = response.json()["id"]
    add_field(client, document_id, headers, signer_id, "text", "Input field", 680)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    return document_id, headers, token


def _send_otp_with_known_code(client: TestClient, token: str) -> str:
    original_choice = secrets.choice
    secrets.choice = lambda seq: "1"
    try:
        response = client.post(f"/api/sign/{token}/otp/send")
        assert response.status_code == 204, response.text
    finally:
        secrets.choice = original_choice
    return "111111"


def test_login_rate_limited_per_ip(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    auth_headers(client)
    monkeypatch.setattr(ratelimit.login_ip_limiter, "limit", 3)
    payload = {"email": "admin@example.com", "password": "wrong-password"}

    for _ in range(3):
        assert client.post("/api/auth/login", json=payload).status_code == 401

    blocked = client.post("/api/auth/login", json=payload)
    assert blocked.status_code == 429
    assert "Retry-After" in blocked.headers


def test_login_rate_limited_per_email_across_ips(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    auth_headers(client)
    monkeypatch.setattr(ratelimit.login_email_limiter, "limit", 2)
    payload = {"email": "admin@example.com", "password": "wrong-password"}

    for index in range(2):
        response = client.post("/api/auth/login", json=payload, headers={"x-forwarded-for": f"10.0.0.{index}"})
        assert response.status_code == 401

    blocked = client.post("/api/auth/login", json=payload, headers={"x-forwarded-for": "10.0.0.99"})
    assert blocked.status_code == 429


def test_signing_session_rate_limited_per_ip(client: TestClient, pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, token = _otp_document(client, pdf_bytes)
    monkeypatch.setattr(ratelimit.signing_session_limiter, "limit", 2)

    # `X-Forwarded-For` is only honoured when the immediate peer is a
    # configured proxy -- otherwise any client bypasses every per-IP limit by
    # rotating one header. TestClient's peer is "testclient", so it has to be
    # trusted explicitly for this test to be able to vary the client address
    # at all. That requirement is the fix, not an inconvenience.
    from app.api import deps
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "trusted_proxy_ips", "0.0.0.0/0", raising=False)
    deps._trusted_proxies.cache_clear()
    monkeypatch.setattr(deps, "request_ip", _forwarded_ip)

    for _ in range(2):
        assert client.get(f"/api/sign/{token}", headers={"x-forwarded-for": "8.8.8.8"}).status_code == 200

    blocked = client.get(f"/api/sign/{token}", headers={"x-forwarded-for": "8.8.8.8"})
    assert blocked.status_code == 429
    # A different IP is unaffected.
    assert client.get(f"/api/sign/{token}", headers={"x-forwarded-for": "9.9.9.9"}).status_code == 200


def _forwarded_ip(request):
    """Stand-in for a deployment sitting behind a trusted proxy."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else None


def test_otp_send_rate_limited_per_token(client: TestClient, pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, token = _otp_document(client, pdf_bytes)
    monkeypatch.setattr(ratelimit.otp_send_limiter, "limit", 2)

    for _ in range(2):
        assert client.post(f"/api/sign/{token}/otp/send").status_code == 204

    blocked = client.post(f"/api/sign/{token}/otp/send")
    assert blocked.status_code == 429
    assert blocked.headers.get("Retry-After")


def test_otp_verify_rate_limited_per_token(client: TestClient, pdf_bytes: bytes, monkeypatch: pytest.MonkeyPatch) -> None:
    _, _, token = _otp_document(client, pdf_bytes)
    _send_otp_with_known_code(client, token)
    monkeypatch.setattr(ratelimit.otp_verify_limiter, "limit", 2)

    for _ in range(2):
        assert client.post(f"/api/sign/{token}/otp/verify", json={"code": "000000"}).status_code == 400

    blocked = client.post(f"/api/sign/{token}/otp/verify", json={"code": "000000"})
    assert blocked.status_code == 429


def test_otp_code_is_hashed_and_locks_out_after_five_attempts(client: TestClient, pdf_bytes: bytes) -> None:
    _, _, token = _otp_document(client, pdf_bytes)
    code = _send_otp_with_known_code(client, token)

    session = client.get(f"/api/sign/{token}")
    assert session.status_code == 200
    assert code not in session.text

    for _ in range(ratelimit.OTP_MAX_ATTEMPTS - 1):
        wrong = client.post(f"/api/sign/{token}/otp/verify", json={"code": "000000"})
        assert wrong.status_code == 400

    locked = client.post(f"/api/sign/{token}/otp/verify", json={"code": "000000"})
    assert locked.status_code == 429
    assert locked.headers.get("Retry-After")

    # The correct code no longer works while locked out...
    still_locked = client.post(f"/api/sign/{token}/otp/verify", json={"code": code})
    assert still_locked.status_code == 429

    # ...and a resend is not a way out of the lockout.
    resend = client.post(f"/api/sign/{token}/otp/send")
    assert resend.status_code == 429


def test_successful_verification_resets_attempts(client: TestClient, pdf_bytes: bytes) -> None:
    _, _, token = _otp_document(client, pdf_bytes)
    code = _send_otp_with_known_code(client, token)

    assert client.post(f"/api/sign/{token}/otp/verify", json={"code": "000000"}).status_code == 400
    verified = client.post(f"/api/sign/{token}/otp/verify", json={"code": code})
    assert verified.status_code == 200
    assert verified.json()["otp_required"] is False


def test_reminder_revokes_previous_signing_token(client: TestClient, pdf_bytes: bytes) -> None:
    document_id, headers, token = _otp_document(client, pdf_bytes)
    assert client.get(f"/api/sign/{token}").status_code == 200

    reminded = client.post(f"/api/documents/{document_id}/remind", headers=headers)
    assert reminded.status_code == 200, reminded.text
    new_token = token_from_link(reminded.json()["signing_links"][0]["signing_link"])
    assert new_token != token

    stale = client.get(f"/api/sign/{token}")
    assert stale.status_code == 403
    assert "revoked" in stale.text.lower()
    assert client.get(f"/api/sign/{new_token}").status_code == 200
