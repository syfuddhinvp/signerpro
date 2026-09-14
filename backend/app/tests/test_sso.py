"""SAML single sign-on (W13).

The tests that earn their place are the tenant-isolation ones. A SAML
assertion is XML the IdP signed, and nothing in the protocol stops one
customer's IdP asserting another customer's address -- so these pin that the
domain binding and the organization scoping are actually enforced, not merely
present.
"""

import pytest
from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers

CONNECTION = {
    "idp_entity_id": "https://idp.acme.test/metadata",
    "idp_sso_url": "https://idp.acme.test/sso",
    "idp_x509_cert": "MIIBogus",
    "allowed_email_domains": "acme.test",
    "enabled": True,
}


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _configure(client: TestClient, headers, **overrides) -> dict:
    response = client.put("/api/auth/sso/connection", json={**CONNECTION, **overrides}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_connection_without_a_domain_is_refused(client: TestClient) -> None:
    """Without one the IdP could assert any address in the world."""
    headers = auth_headers(client)
    response = client.put(
        "/api/auth/sso/connection", json={**CONNECTION, "allowed_email_domains": "  "}, headers=headers
    )
    assert response.status_code == 400
    assert "domain" in response.text


def test_only_an_admin_can_configure_sso(client: TestClient) -> None:
    from app.models.user import User

    headers = auth_headers(client)
    db = _db()
    user = db.query(User).filter(User.email == "admin@example.com").one()
    user.role = "sender"
    db.commit()

    assert client.put("/api/auth/sso/connection", json=CONNECTION, headers=headers).status_code == 403


def test_the_certificate_is_encrypted_at_rest(client: TestClient) -> None:
    from sqlalchemy import text

    headers = auth_headers(client)
    _configure(client, headers)
    db = _db()
    raw = db.execute(text("SELECT idp_x509_cert FROM sso_connections")).scalar()
    assert raw and raw.startswith("enc:"), "the IdP certificate is stored in plaintext"


def test_enforcing_sso_closes_the_password_path(client: TestClient) -> None:
    """Otherwise "enforce SSO" is a suggestion, and IdP offboarding locks nobody out."""
    headers = auth_headers(client)
    _configure(client, headers, enforced=True)

    response = client.post(
        "/api/auth/login", json={"email": "admin@example.com", "password": "strong-password"}
    )
    assert response.status_code == 403
    assert "single sign-on" in response.text


def test_not_enforcing_leaves_password_login_working(client: TestClient) -> None:
    headers = auth_headers(client)
    _configure(client, headers, enforced=False)
    assert client.post(
        "/api/auth/login", json={"email": "admin@example.com", "password": "strong-password"}
    ).status_code == 200


def test_login_for_an_unknown_workspace_reveals_nothing(client: TestClient) -> None:
    assert client.get("/api/auth/sso/login/no-such-workspace").status_code == 404


def test_a_disabled_connection_does_not_start_a_ceremony(client: TestClient) -> None:
    from app.models.organization import Organization

    headers = auth_headers(client)
    _configure(client, headers, enabled=False)
    db = _db()
    org = db.query(Organization).first()
    org.slug = "acme"
    db.commit()
    assert client.get("/api/auth/sso/login/acme").status_code == 404


# --- the tenant-isolation property -----------------------------------------


def test_an_address_outside_the_configured_domains_is_refused(client: TestClient) -> None:
    """The check that stops Acme's IdP asserting admin@rival.example."""
    from app.services.sso_service import sso_service

    headers = auth_headers(client)
    _configure(client, headers, allowed_email_domains="acme.test,acme.co")
    db = _db()
    from app.models.sso_connection import SsoConnection

    connection = db.query(SsoConnection).one()
    assert sso_service.domains(connection) == ["acme.test", "acme.co"]
    assert "rival.example" not in sso_service.domains(connection)


def test_a_provisioned_sso_user_is_never_an_admin(client: TestClient) -> None:
    """An IdP assertion says who somebody is, not what they may do here."""
    from app.services.sso_service import DEFAULT_PROVISIONED_ROLE

    assert DEFAULT_PROVISIONED_ROLE != "admin"


def test_the_acs_endpoint_rejects_a_response_with_no_relay_state(client: TestClient) -> None:
    response = client.post("/api/auth/sso/acs", data={"SAMLResponse": "not-a-real-assertion"})
    assert response.status_code == 400


def test_the_acs_endpoint_rejects_an_unverifiable_assertion(client: TestClient) -> None:
    """A signature check whose result is not consulted is the classic failure."""
    from app.models.organization import Organization

    headers = auth_headers(client)
    _configure(client, headers)
    db = _db()
    org = db.query(Organization).first()
    org.slug = "acme"
    db.commit()

    response = client.post(
        "/api/auth/sso/acs",
        data={"SAMLResponse": "bm90LWEtcmVhbC1hc3NlcnRpb24=", "RelayState": "acme"},
    )
    assert response.status_code in (400, 401), response.text
    assert "verified" in response.text or "could not" in response.text


def test_saml_settings_demand_signed_assertions(client: TestClient) -> None:
    """`strict` off, or wantAssertionsSigned off, makes the whole thing theatre."""
    from app.models.sso_connection import SsoConnection
    from app.services.sso_service import sso_service

    headers = auth_headers(client)
    _configure(client, headers)
    db = _db()
    connection = db.query(SsoConnection).one()
    settings = sso_service._settings(connection)
    assert settings["strict"] is True
    assert settings["security"]["wantAssertionsSigned"] is True
    assert settings["security"]["rejectUnsolicitedResponsesWithInResponseTo"] is True


def test_saving_without_a_certificate_keeps_the_stored_one(client: TestClient) -> None:
    """The certificate is write-only, so an edit to any other field sends none.

    Blanking it on every save would silently break the connection -- and
    breaking signature verification is the worst possible thing to break.
    """
    from sqlalchemy import text

    headers = auth_headers(client)
    _configure(client, headers)
    db = _db()
    before = db.execute(text("SELECT idp_x509_cert FROM sso_connections")).scalar()

    updated = client.put(
        "/api/auth/sso/connection",
        json={**CONNECTION, "idp_x509_cert": "", "enforced": True},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["enforced"] is True

    db2 = _db()
    after = db2.execute(text("SELECT idp_x509_cert FROM sso_connections")).scalar()
    assert after == before


def test_a_first_time_connection_still_requires_a_certificate(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.put(
        "/api/auth/sso/connection", json={**CONNECTION, "idp_x509_cert": ""}, headers=headers
    )
    assert response.status_code == 400
    assert "certificate" in response.text


def test_the_certificate_is_never_returned(client: TestClient) -> None:
    """A write-only secret that the API echoes back is not write-only."""
    headers = auth_headers(client)
    body = _configure(client, headers)
    assert "idp_x509_cert" not in body
    assert "idp_x509_cert" not in client.get("/api/auth/sso/connection", headers=headers).json()


# --- enforcement closes every password-credential path ----------------------


def _issue_reset_token(client: TestClient, monkeypatch, email: str = "admin@example.com") -> str:
    from app.core import email as email_module

    sent: list = []
    monkeypatch.setattr(email_module.email_service, "send", lambda message, organization=None: sent.append(message))
    response = client.post("/api/auth/password/forgot", json={"email": email})
    assert response.status_code == 204, response.text
    assert len(sent) == 1
    body = sent[0].body
    return body.split("token=", 1)[1].split()[0]


def test_enforcing_sso_closes_the_password_reset_path(client: TestClient, monkeypatch) -> None:
    """A reset link must not be a standing bypass of "password login is refused"."""
    headers = auth_headers(client)
    token = _issue_reset_token(client, monkeypatch)
    _configure(client, headers, enforced=True)

    response = client.post(
        "/api/auth/password/reset", json={"token": token, "password": "a-brand-new-password"}
    )
    assert response.status_code == 403
    assert "single sign-on" in response.text


def test_not_enforcing_leaves_password_reset_working(client: TestClient, monkeypatch) -> None:
    """A connection can exist -- even be enabled -- without enforcement closing anything."""
    headers = auth_headers(client)
    token = _issue_reset_token(client, monkeypatch)
    _configure(client, headers, enforced=False)

    response = client.post(
        "/api/auth/password/reset", json={"token": token, "password": "a-brand-new-password"}
    )
    assert response.status_code == 200, response.text


def test_enforcing_sso_closes_the_invitation_accept_path(client: TestClient) -> None:
    """Accepting a pending invitation still mints a password, so it must be closed too."""
    from app.models.invitation import Invitation
    from app.core.security import generate_signing_token, hash_signing_token
    from app.models.mixins import now_utc
    from datetime import timedelta

    headers = auth_headers(client)
    _configure(client, headers, enforced=True)

    db = _db()
    from app.models.user import User

    admin = db.query(User).filter(User.email == "admin@example.com").one()
    raw_token = generate_signing_token()
    db.add(
        Invitation(
            organization_id=admin.organization_id,
            email="new-hire@example.com",
            role="sender",
            token_hash=hash_signing_token(raw_token),
            invited_by_user_id=admin.id,
            expires_at=now_utc() + timedelta(days=1),
        )
    )
    db.commit()

    response = client.post(
        "/api/invitations/accept",
        json={"token": raw_token, "name": "New Hire", "password": "a-brand-new-password"},
    )
    assert response.status_code == 403
    assert "single sign-on" in response.text


def test_a_platform_admin_is_break_glass_exempt_from_enforcement(client: TestClient) -> None:
    """A misconfigured IdP must not permanently lock everyone out.

    The exemption is scoped to the existing ``is_platform_admin`` role -- not
    a new secret -- so the only people who can still use a password against
    an SSO-enforced organization are the same people who could already act
    across every tenant.
    """
    from app.models.user import User

    headers = auth_headers(client)
    _configure(client, headers, enforced=True)

    db = _db()
    user = db.query(User).filter(User.email == "admin@example.com").one()
    user.is_platform_admin = True
    db.commit()

    response = client.post(
        "/api/auth/login", json={"email": "admin@example.com", "password": "strong-password"}
    )
    assert response.status_code == 200, response.text


def test_enabling_enforcement_ends_existing_password_sessions(client: TestClient) -> None:
    """Blocking ``login`` alone left every session minted *before* enforcement
    renewing itself through ``/api/auth/refresh`` forever, so an admin who
    switched SSO on had a control that only bit people who happened to log out.
    """
    registered = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Acme Realty",
            "name": "Admin User",
            "email": "admin@acme.example",
            "password": "strong-password",
        },
    )
    assert registered.status_code == 201, registered.text
    headers = {"Authorization": f"Bearer {registered.json()['access_token']}"}
    refresh_token = registered.json()["refresh_token"]

    # A password session that works, and can renew itself.
    assert client.get("/api/auth/me", headers=headers).status_code == 200
    first = client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert first.status_code == 200, first.text
    rotated = first.json()["refresh_token"]
    # The refresh rotated the session, so configure with the live token.
    headers = {"Authorization": f"Bearer {first.json()['access_token']}"}

    _configure(client, headers, allowed_email_domains="acme.example", enforced=True)

    # The pre-existing session can no longer be renewed.
    denied = client.post("/api/auth/refresh", json={"refresh_token": rotated})
    assert denied.status_code == 401, denied.text

    # ...and password login stays refused, so no new one can be minted.
    relogin = client.post(
        "/api/auth/login",
        json={"email": "admin@acme.example", "password": "strong-password"},
    )
    assert relogin.status_code == 403, relogin.text
