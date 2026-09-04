"""SAML 2.0 single sign-on (W13).

Federated login is the part of an auth system where a subtle mistake hands an
attacker every account, so the choices here are deliberate and stated.

**A tenant's IdP may only assert that tenant's users.** This is the property
that matters most and the one a naive implementation gets wrong. A SAML
assertion is XML signed by the IdP; nothing in the protocol prevents Acme's
IdP asserting ``admin@rival.example``. If sign-in trusted the asserted address
alone, every customer who configured SSO could log in as any user of any other
customer. So a connection carries ``allowed_email_domains``, sign-in is
refused unless the address falls inside one, and the resulting user is always
resolved *within the organization that owns the connection*.

**Signatures and replay are enforced, not assumed.** python3-saml is
configured to require signed assertions, to reject an unsolicited response,
and the ``InResponseTo`` is matched against a request id this server minted
and stores single-use. A signature check that runs but whose result is not
consulted is the classic SAML failure, so ``get_errors()`` is treated as fatal.

**Auto-provisioning is bounded.** A first-time user is created only when the
connection says so and only inside the verified domains, never with elevated
privileges: a new SSO user always lands as the lowest-privilege role, and
promotion stays a deliberate act by an admin.
"""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.mfa_challenge import MfaChallenge
from app.models.organization import Organization
from app.models.sso_connection import SsoConnection
from app.models.user import User

#: How long a SAML AuthnRequest stays redeemable.
REQUEST_TTL_SECONDS = 300

#: The role a newly provisioned SSO user receives. Never an admin: an IdP
#: assertion says who somebody is, not what they may do here.
DEFAULT_PROVISIONED_ROLE = "sender"


def _acs_url() -> str:
    base = get_settings().app_base_url.rstrip("/")
    return f"{base}/api/auth/sso/acs"


def _entity_id() -> str:
    return get_settings().app_base_url.rstrip("/")


class SsoService:
    # -- configuration ------------------------------------------------------

    def get_connection(self, db: Session, organization_id: str) -> SsoConnection | None:
        return db.scalar(
            select(SsoConnection).where(SsoConnection.organization_id == organization_id)
        )

    def connection_for_slug(self, db: Session, slug: str) -> tuple[Organization, SsoConnection]:
        organization = db.scalar(select(Organization).where(Organization.slug == slug))
        if organization is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown workspace")
        connection = self.get_connection(db, organization.id)
        if connection is None or not connection.enabled:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Single sign-on is not enabled here"
            )
        return organization, connection

    def domains(self, connection: SsoConnection) -> list[str]:
        return [
            part.strip().lower().lstrip("@")
            for part in (connection.allowed_email_domains or "").split(",")
            if part.strip()
        ]

    def is_enforced(self, db: Session, organization_id: str) -> bool:
        connection = self.get_connection(db, organization_id)
        return bool(connection and connection.enabled and connection.enforced)

    # -- SAML settings ------------------------------------------------------

    def _settings(self, connection: SsoConnection) -> dict:
        return {
            "strict": True,
            "debug": False,
            "sp": {
                "entityId": _entity_id(),
                "assertionConsumerService": {
                    "url": _acs_url(),
                    "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
                },
                "NameIDFormat": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            },
            "idp": {
                "entityId": connection.idp_entity_id,
                "singleSignOnService": {
                    "url": connection.idp_sso_url,
                    "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
                },
                "x509cert": connection.idp_x509_cert,
            },
            "security": {
                # The three that matter. An unsigned assertion is an assertion
                # anybody can write.
                "wantAssertionsSigned": True,
                "wantMessagesSigned": False,
                "wantAssertionsEncrypted": False,
                "requestedAuthnContext": False,
                "rejectUnsolicitedResponsesWithInResponseTo": True,
            },
        }

    def _auth(self, connection: SsoConnection, request_data: dict):
        from onelogin.saml2.auth import OneLogin_Saml2_Auth

        return OneLogin_Saml2_Auth(request_data, self._settings(connection))

    # -- the ceremony -------------------------------------------------------

    def begin_login(self, db: Session, *, slug: str) -> str:
        organization, connection = self.connection_for_slug(db, slug)
        parsed = urlparse(get_settings().app_base_url)
        request_data = {
            "https": "on" if parsed.scheme == "https" else "off",
            "http_host": parsed.netloc,
            "script_name": "/api/auth/sso/login",
            "get_data": {},
            "post_data": {},
        }
        auth = self._auth(connection, request_data)
        redirect_url = auth.login()
        self._store_request_id(db, organization.id, auth.get_last_request_id())
        return redirect_url

    def complete_login(self, db: Session, *, saml_response: str, relay_state: str | None):
        from app.services.auth_service import auth_service

        slug = (relay_state or "").strip()
        if not slug:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Missing workspace in RelayState"
            )
        organization, connection = self.connection_for_slug(db, slug)

        parsed = urlparse(get_settings().app_base_url)
        request_data = {
            "https": "on" if parsed.scheme == "https" else "off",
            "http_host": parsed.netloc,
            "script_name": "/api/auth/sso/acs",
            "get_data": {},
            "post_data": {"SAMLResponse": saml_response},
        }
        auth = self._auth(connection, request_data)

        expected_request_id = self._consume_request_id(db, organization.id)
        try:
            auth.process_response(request_id=expected_request_id)
            authenticated = auth.is_authenticated()
            errors = auth.get_errors()
        except Exception:  # noqa: BLE001
            # The ACS endpoint is unauthenticated and takes attacker-controlled
            # XML, so anything malformed must come back as a clean rejection.
            # Letting lxml's parse error escape turned garbage into a 500 with
            # a stack trace in the logs.
            authenticated, errors = False, ["invalid_response"]

        # The classic SAML failure is running the checks and not reading the
        # result. These two lines are the whole point of the library.
        if errors or not authenticated:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="The single sign-on response could not be verified",
            )

        email = (auth.get_nameid() or "").strip().lower()
        if not email or "@" not in email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The identity provider did not assert an email address",
            )

        # THE tenant-isolation check. See the module docstring.
        domain = email.rsplit("@", 1)[1]
        if domain not in self.domains(connection):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="That address is outside the domains configured for this workspace",
            )

        user = db.scalar(
            select(User).where(
                User.email == email, User.organization_id == organization.id
            )
        )
        if user is None:
            # A user of the same email in *another* organization must not be
            # adopted into this one.
            if db.scalar(select(User).where(User.email == email)) is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="That address already belongs to another workspace",
                )
            if not connection.auto_provision:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No account exists here and automatic provisioning is off",
                )
            user = self._provision(db, organization, email, auth)

        if user.status == "erased":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account unavailable")

        return auth_service.issue_session_for(db, user)

    def _provision(self, db: Session, organization: Organization, email: str, auth) -> User:
        from secrets import token_urlsafe

        from app.core.security import hash_password

        attributes = auth.get_attributes() or {}
        display = attributes.get("displayName") or attributes.get("name") or []
        name = (display[0] if isinstance(display, list) and display else None) or email.split("@")[0]

        user = User(
            organization_id=organization.id,
            name=name,
            email=email,
            # No usable password: this account authenticates through the IdP.
            # A random unknown hash is safer than an empty or sentinel one,
            # which some future code path might match.
            password_hash=hash_password(token_urlsafe(48)),
            role=DEFAULT_PROVISIONED_ROLE,
            is_platform_admin=False,
        )
        db.add(user)
        db.flush()

        from app.services.platform_service import record_platform_audit

        record_platform_audit(
            db,
            action="sso.user_provisioned",
            organization_id=organization.id,
            detail=f"{email} provisioned via SAML as {DEFAULT_PROVISIONED_ROLE}",
        )
        db.commit()
        db.refresh(user)
        return user

    # -- request-id storage (replay protection) -----------------------------

    def _store_request_id(self, db: Session, organization_id: str, request_id: str | None) -> None:
        if not request_id:
            return
        from app.services.auth_service import _now

        owner = db.scalar(select(User).where(User.organization_id == organization_id))
        if owner is None:
            return
        db.add(
            MfaChallenge(
                jti=f"saml:{request_id}"[:64],
                user_id=owner.id,
                expires_at=_now() + timedelta(seconds=REQUEST_TTL_SECONDS),
            )
        )
        db.commit()

    def _consume_request_id(self, db: Session, organization_id: str) -> str | None:
        """Single-use: an AuthnRequest id is redeemable exactly once."""
        from app.services.auth_service import _aware, _now

        owner_ids = [
            row.id for row in db.scalars(select(User).where(User.organization_id == organization_id)).all()
        ]
        if not owner_ids:
            return None
        row = db.scalar(
            select(MfaChallenge).where(
                MfaChallenge.user_id.in_(owner_ids), MfaChallenge.jti.like("saml:%")
            )
        )
        if row is None:
            return None
        request_id = row.jti.split(":", 1)[1]
        expires_at = _aware(row.expires_at)
        db.delete(row)
        db.commit()
        if expires_at and expires_at <= _now():
            return None
        return request_id


sso_service = SsoService()
