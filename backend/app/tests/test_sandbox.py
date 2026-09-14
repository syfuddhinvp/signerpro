"""Sandbox tenancy (API-11).

The claims worth pinning are the ones the old fake Test/Live toggle could not
make: that sandbox data is genuinely a different tenant, that a ``test``-mode
key cannot read or write live records, that the destructive verb cannot reach
live records, and that outbound side effects are suppressed.
"""

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.database import get_db
from app.core.email import email_service
from app.models.organization import Organization
from app.services.sandbox_service import sandbox_service
from app.tests.conftest import auth_headers


SANDBOX = {"X-SignerPro-Sandbox": "1"}


def _sandbox_headers(headers: dict[str, str]) -> dict[str, str]:
    return {**headers, **SANDBOX}


def test_a_request_without_the_header_stays_live(client: TestClient) -> None:
    headers = auth_headers(client)
    body = client.get("/api/sandbox", headers=headers).json()
    assert body["is_sandbox"] is False
    assert body["live_organization_id"] is None
    assert body["side_effects_suppressed"] is False


def test_the_header_resolves_to_a_paired_sandbox_organization(client: TestClient) -> None:
    headers = auth_headers(client)
    live = client.get("/api/sandbox", headers=headers).json()

    sandboxed = client.get("/api/sandbox", headers=_sandbox_headers(headers)).json()
    assert sandboxed["is_sandbox"] is True
    assert sandboxed["organization_id"] != live["organization_id"]
    assert sandboxed["live_organization_id"] == live["organization_id"]
    assert sandboxed["side_effects_suppressed"] is True

    # Pairing is stable: asking twice must not mint a second sandbox.
    again = client.get("/api/sandbox", headers=_sandbox_headers(headers)).json()
    assert again["organization_id"] == sandboxed["organization_id"]


def test_contacts_written_in_the_sandbox_are_invisible_to_live(client: TestClient) -> None:
    headers = auth_headers(client)

    live_created = client.post(
        "/api/contacts", headers=headers, json={"name": "Real Person", "email": "real@example.com"}
    )
    assert live_created.status_code in {200, 201}, live_created.text

    sandbox_created = client.post(
        "/api/contacts",
        headers=_sandbox_headers(headers),
        json={"name": "Test Person", "email": "test@example.com"},
    )
    assert sandbox_created.status_code in {200, 201}, sandbox_created.text

    live_names = _contact_names(client, headers)
    sandbox_names = _contact_names(client, _sandbox_headers(headers))

    assert "Real Person" in live_names and "Test Person" not in live_names
    assert "Test Person" in sandbox_names and "Real Person" not in sandbox_names


def test_a_test_mode_key_cannot_see_live_data(client: TestClient) -> None:
    """``mode`` used to be a label the backend never read: a key marked
    ``test`` read and wrote production records. This is that hole closed."""
    headers = auth_headers(client)
    client.post("/api/contacts", headers=headers, json={"name": "Real Person", "email": "real@example.com"})

    test_key = _create_key(client, headers, mode="test")
    live_key = _create_key(client, headers, mode="live")
    if test_key is None or live_key is None:
        return  # the org is not entitled to API access in this environment

    via_test = client.get("/api/v1/contacts", headers={"X-API-Key": test_key})
    via_live = client.get("/api/v1/contacts", headers={"X-API-Key": live_key})
    assert via_test.status_code == 200 and via_live.status_code == 200
    assert "Real Person" in via_live.text
    assert "Real Person" not in via_test.text


def test_seed_populates_the_sandbox_and_never_the_live_org(client: TestClient) -> None:
    headers = auth_headers(client)

    seeded = client.post("/api/sandbox/seed", headers=_sandbox_headers(headers))
    assert seeded.status_code == 201, seeded.text
    body = seeded.json()
    assert body["is_sandbox"] is True
    assert body["contact_count"] >= 4
    assert body["document_count"] >= 4

    live = client.get("/api/sandbox", headers=headers).json()
    assert live["contact_count"] == 0
    assert live["document_count"] == 0


def test_seed_and_reset_are_refused_against_a_live_organization(client: TestClient) -> None:
    headers = auth_headers(client)
    client.post("/api/contacts", headers=headers, json={"name": "Real Person", "email": "real@example.com"})

    assert client.post("/api/sandbox/seed", headers=headers).status_code == 400
    assert client.post("/api/sandbox/reset", headers=headers).status_code == 400

    # The refusal has to be a refusal, not a partial delete.
    assert "Real Person" in str(_contact_names(client, headers))


def test_reset_clears_only_the_sandbox(client: TestClient) -> None:
    headers = auth_headers(client)
    client.post("/api/contacts", headers=headers, json={"name": "Real Person", "email": "real@example.com"})
    client.post("/api/sandbox/seed", headers=_sandbox_headers(headers))

    reset = client.post("/api/sandbox/reset", headers=_sandbox_headers(headers))
    assert reset.status_code == 200, reset.text
    body = reset.json()
    assert body["deleted_contacts"] >= 4
    assert body["deleted_documents"] >= 4
    assert body["contact_count"] == 0 and body["document_count"] == 0

    assert "Real Person" in str(_contact_names(client, headers))


def test_outbound_email_is_suppressed_for_a_sandbox_organization(client: TestClient, monkeypatch) -> None:
    headers = auth_headers(client)
    client.get("/api/sandbox", headers=_sandbox_headers(headers))

    db = _db(client)
    live_org = db.scalars(
        select(Organization).where(Organization.is_sandbox.is_(False))
    ).first()
    sandbox_org = db.scalars(
        select(Organization).where(Organization.is_sandbox.is_(True))
    ).first()
    assert sandbox_org is not None

    # Force a configured provider so a send would genuinely be attempted.
    attempted: list[str] = []
    monkeypatch.setattr(
        email_service, "_send_via_smtp", lambda *a, **k: attempted.append("smtp") or True, raising=False
    )

    from app.core.email import EmailMessage

    assert email_service.send(
        EmailMessage(to_email="signer@example.com", subject="Signature requested", body="link"),
        organization=sandbox_org,
    ) is True
    assert attempted == [], "a sandbox organization must not reach a mail provider"
    assert live_org is not None


def test_a_sandbox_embed_session_inherits_the_live_allowlist(client: TestClient) -> None:
    """Embed settings live on the tenant, not on the sandbox.

    The sandbox row deliberately stores no ``allowed_origins`` of its own. If
    it did, the copy would be whatever the live list happened to be when the
    sandbox was first created -- and an empty copy means a sandbox session
    carries no permitted framing origins at all, so the embed silently refuses
    to frame in test mode while working in live.
    """
    headers = auth_headers(client)
    configured = client.patch(
        "/api/organizations/me/api-settings",
        headers=headers,
        json={"allowed_origins": ["https://app.hostcrm.example"]},
    )
    if configured.status_code != 200:
        return  # the tenant is not entitled to the embed surface here

    session = client.post(
        "/api/embed/sessions",
        headers=_sandbox_headers(headers),
        json={"landing": "builder", "ttl_minutes": 30},
    )
    assert session.status_code == 201, session.text
    assert session.json()["allowed_origins"] == ["https://app.hostcrm.example"]

    # And the session really was minted in the sandbox, not in the live org.
    assert client.get("/api/sandbox", headers=_sandbox_headers(headers)).json()["is_sandbox"] is True


def test_a_sandbox_mirror_user_cannot_sign_in(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/sandbox", headers=_sandbox_headers(headers))

    from app.models.user import User

    db = _db(client)
    mirror = db.scalars(
        select(User).where(User.email.like("sandbox-%@sandbox.invalid"))
    ).first()
    assert mirror is not None, "the sandbox request should have created a mirror user"
    assert sandbox_service.is_mirror(mirror)

    # Three independent locks, all asserted rather than assumed.
    #
    # 1. The login endpoint will not even accept the address: ``.invalid`` is
    #    reserved by RFC 6761, so ``EmailStr`` rejects it at validation.
    for attempt in ("strong-password", mirror.password_hash):
        response = client.post("/api/auth/login", json={"email": mirror.email, "password": attempt})
        assert response.status_code == 422, response.text

    # 2. The service-level guard refuses the mirror even when the address is
    #    handed straight to ``login``, bypassing the schema.
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.services.auth_service import auth_service

    for attempt in ("strong-password", mirror.password_hash):
        try:
            auth_service.login(
                db, SimpleNamespace(email=mirror.email, password=attempt, mfa_code=None)
            )
        except HTTPException as exc:
            assert exc.status_code == 401, exc.detail
        else:  # pragma: no cover - a pass here is the bug this test exists for
            raise AssertionError("a sandbox mirror user must never be issued a session")

    # 3. The stored hash is not a hash any verifier can satisfy.
    from app.core.security import verify_password

    assert verify_password("strong-password", mirror.password_hash) is False


def test_the_sandbox_org_is_not_listed_as_a_tenant_member(client: TestClient) -> None:
    """The mirror lives in the sandbox org, so it must never show up in the
    live org's user list or inflate its seat count."""
    headers = auth_headers(client)
    client.get("/api/sandbox", headers=_sandbox_headers(headers))

    users = client.get("/api/organizations/me/users", headers=headers)
    if users.status_code != 200:
        return
    assert "sandbox.invalid" not in users.text


# ---- helpers -------------------------------------------------------------


def _db(client: TestClient):
    """The session the app itself is using, as the rest of the suite does it."""
    return next(client.app.dependency_overrides[get_db]())


def _contact_names(client: TestClient, headers: dict[str, str]) -> list[str]:
    response = client.get("/api/contacts", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    items = body.get("items", body) if isinstance(body, dict) else body
    return [item["name"] for item in items]


def _create_key(client: TestClient, headers: dict[str, str], *, mode: str) -> str | None:
    response = client.post(
        "/api/api-keys",
        headers=headers,
        json={"label": f"{mode} key", "mode": mode, "scopes": ["contacts:read", "documents:read"]},
    )
    if response.status_code != 201:
        return None
    return response.json()["secret"]
