"""WebAuthn passkeys (W13).

Why this is worth having over TOTP: there is no shared secret. The server
stores only a public key, so disclosing this database does not let anyone
authenticate as anybody -- unlike ``users.mfa_secret``, which is a seed that
grants exactly that if it leaks. Passkeys are also bound to the relying party's
origin by the browser, which makes the credential unphishable in a way no
six-digit code can be.

Three things this implementation is careful about.

**Challenges are single-use and server-side.** A challenge is minted here,
stored against the user, and consumed on verification. A challenge the client
supplies, or one that can be replayed, reduces the whole ceremony to theatre.

**The signature counter is checked.** An authenticator that signs with a
counter that has not advanced is a signal that the credential has been cloned.
Storing the counter and refusing a non-advancing one is the only reason it
exists in the spec.

**The relying-party id comes from configuration, not the request.** Deriving it
from a Host header would let an attacker's origin nominate itself as the RP.
"""

from __future__ import annotations

import base64
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.passkey import Passkey
from app.models.user import User

#: Challenges live in the existing MFA-challenge table shape rather than a new
#: one: same lifecycle, same single-use semantics, same cleanup.
CHALLENGE_TTL_SECONDS = 300


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def relying_party() -> tuple[str, str]:
    """``(rp_id, origin)`` derived from the configured base URL, never a header."""
    base = get_settings().app_base_url
    parsed = urlparse(base)
    host = parsed.hostname or "localhost"
    origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme else base
    return host, origin


class PasskeyService:
    def list_for_user(self, db: Session, user: User) -> list[Passkey]:
        return list(db.scalars(select(Passkey).where(Passkey.user_id == user.id)).all())

    # -- registration -------------------------------------------------------

    def begin_registration(self, db: Session, user: User) -> dict:
        from webauthn import generate_registration_options, options_to_json
        from webauthn.helpers.structs import (
            AuthenticatorSelectionCriteria,
            PublicKeyCredentialDescriptor,
            ResidentKeyRequirement,
        )

        rp_id, _ = relying_party()
        existing = [
            PublicKeyCredentialDescriptor(id=_unb64(row.credential_id))
            for row in self.list_for_user(db, user)
        ]
        options = generate_registration_options(
            rp_id=rp_id,
            rp_name="SignerPro",
            user_id=user.id.encode(),
            user_name=user.email,
            user_display_name=user.name,
            # Excluding what is already registered stops a user silently
            # creating a second credential on the same authenticator and
            # believing they have a backup when they do not.
            exclude_credentials=existing,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.PREFERRED,
            ),
        )
        self._store_challenge(db, user, options.challenge)
        import json

        return json.loads(options_to_json(options))

    def finish_registration(self, db: Session, user: User, credential: dict, label: str | None) -> Passkey:
        from webauthn import verify_registration_response

        rp_id, origin = relying_party()
        challenge = self._consume_challenge(db, user)
        try:
            verified = verify_registration_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=rp_id,
                expected_origin=origin,
            )
        except Exception as exc:  # noqa: BLE001 -- the library raises many types
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="That passkey could not be verified"
            ) from exc

        passkey = Passkey(
            user_id=user.id,
            credential_id=_b64(verified.credential_id),
            public_key=_b64(verified.credential_public_key),
            sign_count=verified.sign_count,
            label=(label or "Passkey")[:120],
        )
        db.add(passkey)
        db.commit()
        db.refresh(passkey)
        return passkey

    # -- authentication -----------------------------------------------------

    def begin_authentication(self, db: Session, user: User) -> dict:
        from webauthn import generate_authentication_options, options_to_json
        from webauthn.helpers.structs import PublicKeyCredentialDescriptor

        rp_id, _ = relying_party()
        credentials = [
            PublicKeyCredentialDescriptor(id=_unb64(row.credential_id))
            for row in self.list_for_user(db, user)
        ]
        if not credentials:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="No passkey is registered"
            )
        options = generate_authentication_options(rp_id=rp_id, allow_credentials=credentials)
        self._store_challenge(db, user, options.challenge)
        import json

        return json.loads(options_to_json(options))

    def finish_authentication(self, db: Session, user: User, credential: dict) -> Passkey:
        return self._verify_assertion(db, user, credential)

    def _verify_assertion(self, db: Session, user: User, credential: dict) -> Passkey:
        from webauthn import verify_authentication_response

        rp_id, origin = relying_party()
        challenge = self._consume_challenge(db, user)

        raw_id = credential.get("rawId") or credential.get("id")
        passkey = db.scalar(
            select(Passkey).where(
                Passkey.user_id == user.id, Passkey.credential_id == str(raw_id)
            )
        )
        if passkey is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown passkey"
            )

        try:
            verified = verify_authentication_response(
                credential=credential,
                expected_challenge=challenge,
                expected_rp_id=rp_id,
                expected_origin=origin,
                credential_public_key=_unb64(passkey.public_key),
                credential_current_sign_count=passkey.sign_count,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="That passkey could not be verified"
            ) from exc

        # A counter that does not advance means the credential was cloned. The
        # library enforces this too; the check is repeated because silently
        # trusting a dependency for the one security property this field exists
        # for is not a control.
        if verified.new_sign_count and verified.new_sign_count <= passkey.sign_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This passkey appears to have been cloned and has been refused",
            )

        from app.services.auth_service import _now

        passkey.sign_count = verified.new_sign_count
        passkey.last_used_at = _now()
        db.add(passkey)
        db.commit()
        return passkey

    # -- sign-in ------------------------------------------------------------
    #
    # The two methods above are step-up: they re-prove a session that already
    # exists. These two are the login path, and they answer to nobody, so they
    # carry the extra obligations a public endpoint has -- above all that they
    # must not become an account-enumeration oracle. Every refusal below is the
    # same 401 with the same wording, and `begin_login` returns a well-formed
    # set of options for an address that has no account at all.

    def _login_candidate(self, db: Session, email: str) -> User | None:
        """The user this address may sign in as, or ``None`` -- never an error."""
        from app.services.sandbox_service import sandbox_service

        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None or user.status in {"deprovisioned", "erased"}:
            return None
        # Same second lock as the password path: a sandbox mirror is a
        # service-layer convenience, not an account that can hold a session.
        if sandbox_service.is_mirror(user):
            return None
        return user

    @staticmethod
    def _login_refused() -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="That passkey could not be verified"
        )

    def begin_login(self, db: Session, *, email: str) -> dict:
        from webauthn import generate_authentication_options, options_to_json
        from webauthn.helpers.structs import PublicKeyCredentialDescriptor

        user = self._login_candidate(db, email)
        credentials = [] if user is None else [
            PublicKeyCredentialDescriptor(id=_unb64(row.credential_id))
            for row in self.list_for_user(db, user)
        ]
        rp_id, _ = relying_party()
        options = generate_authentication_options(rp_id=rp_id, allow_credentials=credentials)
        # An unknown address, or a known one with nothing registered, gets a
        # challenge that is simply never stored. The response is the same shape
        # either way; the ceremony then fails at `finish_login` like any other
        # bad attempt, rather than here where the difference would be readable.
        if credentials:
            self._store_challenge(db, user, options.challenge)
        import json

        return json.loads(options_to_json(options))

    def finish_login(self, db: Session, *, email: str, credential: dict, request=None):
        from app.services.auth_service import auth_service
        from app.services.sso_service import sso_service

        user = self._login_candidate(db, email)
        if user is None:
            raise self._login_refused()
        # A workspace that enforces SSO has decided its IdP is the only way in.
        # Passkeys are strong, but they are provisioned here rather than by the
        # IdP, so leaving this path open would survive an IdP offboarding --
        # exactly what enforcement exists to prevent. Platform admins keep the
        # same break-glass exemption they have on the password path.
        if not user.is_platform_admin and sso_service.is_enforced(db, user.organization_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This workspace requires single sign-on",
            )
        try:
            self._verify_assertion(db, user, credential)
        except HTTPException as exc:
            # Collapsed deliberately: "no challenge outstanding", "unknown
            # passkey" and "bad signature" are all one answer to a caller who
            # has not proven who they are. A cloned-authenticator refusal is
            # let through, because it is a warning the user needs to see.
            if exc.status_code == status.HTTP_400_BAD_REQUEST and "cloned" not in str(exc.detail):
                raise self._login_refused() from exc
            raise
        if auth_service._mfa_active(user):
            return auth_service._mfa_challenge(db, user, remember=False)
        return auth_service.issue_session_for(db, user, request=request)

    def delete(self, db: Session, user: User, passkey_id: str) -> None:
        passkey = db.get(Passkey, passkey_id)
        if passkey is None or passkey.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Passkey not found")
        db.delete(passkey)
        db.commit()

    # -- challenge storage --------------------------------------------------

    def _store_challenge(self, db: Session, user: User, challenge: bytes) -> None:
        from datetime import timedelta

        from app.models.mfa_challenge import MfaChallenge
        from app.services.auth_service import _now

        # One outstanding WebAuthn challenge per user: starting a new ceremony
        # invalidates the old one, so a stale challenge cannot be completed.
        for row in db.scalars(
            select(MfaChallenge).where(
                MfaChallenge.user_id == user.id, MfaChallenge.jti.like("webauthn:%")
            )
        ).all():
            db.delete(row)
        db.add(
            MfaChallenge(
                jti=f"webauthn:{_b64(challenge)}",
                user_id=user.id,
                expires_at=_now() + timedelta(seconds=CHALLENGE_TTL_SECONDS),
            )
        )
        db.commit()

    def _consume_challenge(self, db: Session, user: User) -> bytes:
        from app.models.mfa_challenge import MfaChallenge
        from app.services.auth_service import _aware, _now

        row = db.scalar(
            select(MfaChallenge).where(
                MfaChallenge.user_id == user.id, MfaChallenge.jti.like("webauthn:%")
            )
        )
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Start the passkey ceremony first"
            )
        expires_at = _aware(row.expires_at)
        challenge = _unb64(row.jti.split(":", 1)[1])
        # Single use: deleted whether or not verification then succeeds, so a
        # failed attempt cannot be retried against the same challenge.
        db.delete(row)
        db.commit()
        if expires_at and expires_at <= _now():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="That passkey challenge has expired"
            )
        return challenge


passkey_service = PasskeyService()
