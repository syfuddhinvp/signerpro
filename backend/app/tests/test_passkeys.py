"""WebAuthn passkeys (W13).

No software authenticator is used: `soft-webauthn` pins an older
`cryptography` than pyhanko requires, and downgrading a crypto library to make
a test convenient is a bad trade. So the cryptographic verification itself is
left to the `webauthn` library, and these tests pin what *this* codebase is
responsible for -- challenge lifecycle, credential ownership, the relying-party
id, and refusing anything unverified.
"""

from fastapi.testclient import TestClient

from app.services import passkey_service as module
from app.tests.conftest import auth_headers


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def test_registration_options_are_minted_server_side(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.post("/api/auth/passkeys/register/begin", headers=headers)
    assert response.status_code == 200, response.text
    options = response.json()
    assert options["challenge"]
    assert options["rp"]["id"] == module.relying_party()[0]
    # A user handle, not the email: the email is mutable and the handle is not.
    assert options["user"]["id"]


def test_the_relying_party_comes_from_config_not_the_request(client: TestClient) -> None:
    """Deriving it from Host would let an attacker's origin nominate itself."""
    headers = auth_headers(client)
    response = client.post(
        "/api/auth/passkeys/register/begin",
        headers={**headers, "Host": "evil.example.com", "Origin": "https://evil.example.com"},
    )
    assert response.json()["rp"]["id"] == module.relying_party()[0]
    assert response.json()["rp"]["id"] != "evil.example.com"


def test_a_challenge_is_single_use(client: TestClient) -> None:
    """A replayable challenge reduces the whole ceremony to theatre."""
    from app.models.mfa_challenge import MfaChallenge

    headers = auth_headers(client)
    client.post("/api/auth/passkeys/register/begin", headers=headers)
    db = _db()
    assert db.query(MfaChallenge).filter(MfaChallenge.jti.like("webauthn:%")).count() == 1

    # Finishing consumes it, even though verification then fails.
    client.post(
        "/api/auth/passkeys/register/finish",
        json={"credential": {"id": "nope"}, "label": "Laptop"},
        headers=headers,
    )
    assert db.query(MfaChallenge).filter(MfaChallenge.jti.like("webauthn:%")).count() == 0


def test_starting_a_new_ceremony_invalidates_the_previous_challenge(client: TestClient) -> None:
    from app.models.mfa_challenge import MfaChallenge

    headers = auth_headers(client)
    client.post("/api/auth/passkeys/register/begin", headers=headers)
    client.post("/api/auth/passkeys/register/begin", headers=headers)
    db = _db()
    assert db.query(MfaChallenge).filter(MfaChallenge.jti.like("webauthn:%")).count() == 1


def test_finishing_without_starting_is_refused(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.post(
        "/api/auth/passkeys/register/finish",
        json={"credential": {"id": "anything"}},
        headers=headers,
    )
    assert response.status_code == 400
    assert "ceremony" in response.text


def test_an_unverifiable_credential_registers_nothing(client: TestClient) -> None:
    headers = auth_headers(client)
    client.post("/api/auth/passkeys/register/begin", headers=headers)
    response = client.post(
        "/api/auth/passkeys/register/finish",
        json={"credential": {"id": "forged", "response": {}}},
        headers=headers,
    )
    assert response.status_code == 400
    assert client.get("/api/auth/passkeys", headers=headers).json() == []


def test_authentication_requires_a_registered_passkey(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.post("/api/auth/passkeys/authenticate/begin", headers=headers)
    assert response.status_code == 400
    assert "No passkey" in response.text


def test_a_passkey_belongs_to_its_owner_alone(client: TestClient) -> None:
    """Deleting someone else's credential must 404, not succeed."""
    from app.models.passkey import Passkey

    owner = auth_headers(client)
    db = _db()
    from app.models.user import User

    user = db.query(User).filter(User.email == "admin@example.com").one()
    passkey = Passkey(user_id=user.id, credential_id="cred-1", public_key="key", label="Laptop")
    db.add(passkey)
    db.commit()

    assert len(client.get("/api/auth/passkeys", headers=owner).json()) == 1

    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Co", "name": "Other", "email": "other@example.com",
            "password": "strong-password",
        },
    ).json()
    other_headers = {"Authorization": f"Bearer {other['access_token']}"}

    assert client.get("/api/auth/passkeys", headers=other_headers).json() == []
    assert client.delete(f"/api/auth/passkeys/{passkey.id}", headers=other_headers).status_code == 404
    assert client.delete(f"/api/auth/passkeys/{passkey.id}", headers=owner).status_code == 204


def test_passkeys_require_authentication(client: TestClient) -> None:
    assert client.get("/api/auth/passkeys").status_code == 401


# -- sign-in ------------------------------------------------------------------


def _register_credential() -> None:
    """Put a credential row on the account without a real authenticator.

    `finish_registration` cannot be driven without one (see the module note),
    so the row is written directly. What the sign-in tests care about is the
    branch `begin_login` takes when credentials exist, not how they got there.
    """
    from app.models.passkey import Passkey
    from app.models.user import User

    db = _db()
    user = db.query(User).filter(User.email == "admin@example.com").one()
    db.add(
        Passkey(
            user_id=user.id,
            credential_id="Y3JlZGVudGlhbA",
            public_key="cHVibGlj",
            sign_count=1,
            label="Laptop",
        )
    )
    db.commit()


def test_login_begin_does_not_enumerate_accounts(client: TestClient) -> None:
    """An unknown address and a real one must be indistinguishable here."""
    auth_headers(client)
    _register_credential()

    known = client.post("/api/auth/passkeys/login/begin", json={"email": "admin@example.com"})
    unknown = client.post("/api/auth/passkeys/login/begin", json={"email": "nobody@example.com"})

    assert known.status_code == 200, known.text
    assert unknown.status_code == 200, unknown.text
    assert known.json().keys() == unknown.json().keys()
    assert known.json()["rpId"] == unknown.json()["rpId"] == module.relying_party()[0]
    # Both carry a challenge; only the real account has one stored to consume.
    assert known.json()["challenge"] and unknown.json()["challenge"]


def test_login_begin_stores_no_challenge_for_an_unknown_address(client: TestClient) -> None:
    from app.models.mfa_challenge import MfaChallenge

    auth_headers(client)
    client.post("/api/auth/passkeys/login/begin", json={"email": "nobody@example.com"})
    db = _db()
    assert db.query(MfaChallenge).filter(MfaChallenge.jti.like("webauthn:%")).count() == 0


def test_login_finish_refuses_an_unknown_address_as_a_bad_passkey(client: TestClient) -> None:
    auth_headers(client)
    response = client.post(
        "/api/auth/passkeys/login/finish",
        json={"email": "nobody@example.com", "credential": {"id": "nope"}},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "That passkey could not be verified"


def test_login_finish_refuses_an_unverified_assertion(client: TestClient) -> None:
    """No session may be minted without a signature the server checked."""
    auth_headers(client)
    _register_credential()
    client.post("/api/auth/passkeys/login/begin", json={"email": "admin@example.com"})

    response = client.post(
        "/api/auth/passkeys/login/finish",
        json={"email": "admin@example.com", "credential": {"id": "nope", "rawId": "nope"}},
    )
    assert response.status_code == 401
    assert "access_token" not in response.json()


def test_login_finish_respects_enforced_sso(client: TestClient) -> None:
    """Enforcement must not be a control that only applies to passwords."""
    from app.models.sso_connection import SsoConnection
    from app.models.user import User

    auth_headers(client)
    _register_credential()
    db = _db()
    user = db.query(User).filter(User.email == "admin@example.com").one()
    user.is_platform_admin = False
    db.add(
        SsoConnection(
            organization_id=user.organization_id,
            idp_entity_id="urn:idp",
            idp_sso_url="https://idp.example.com/sso",
            idp_x509_cert="cert",
            allowed_email_domains="example.com",
            enabled=True,
            enforced=True,
        )
    )
    db.commit()

    client.post("/api/auth/passkeys/login/begin", json={"email": "admin@example.com"})
    response = client.post(
        "/api/auth/passkeys/login/finish",
        json={"email": "admin@example.com", "credential": {"id": "nope", "rawId": "nope"}},
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "This workspace requires single sign-on"
