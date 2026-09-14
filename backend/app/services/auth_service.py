"""Authentication, MFA, password reset and device-session management.

Security notes for reviewers:
* Nothing here ever logs a secret, a TOTP code, a recovery code or a raw token.
* TOTP / recovery-code / reset-token comparisons are constant-time
  (``hmac.compare_digest`` inside ``app.core.totp``, SHA-256 hash lookups for
  opaque tokens, bcrypt for passwords).
* Password-reset tokens are single-use and expire; MFA challenge tokens are
  short-lived JWTs bound to ``purpose="mfa"``.
"""

from __future__ import annotations

import hmac
import time
from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import request_ip, request_user_agent
from app.core.config import get_settings
from app.core.email import EmailMessage, email_service
from app.core.logging import get_logger
from app.core.security import (
    JWTError,
    create_access_token,
    create_scoped_token,
    decode_access_token,
    generate_refresh_token,
    hash_opaque_token,
    dummy_password_hash,
    hash_password,
    verify_password,
)
from app.core import totp
from app.models.enums import UserRole
from app.models.mfa_challenge import MfaChallenge
from app.models.organization import Organization
from app.models.password_reset import PasswordResetToken
from app.models.user import User
from app.models.user_session import UserSession
from app.schemas.auth import (
    AuthUserResponse,
    ChangePasswordRequest,
    CurrentUserResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MfaChallengeResponse,
    MfaEnrollResponse,
    MfaRecoveryCodesResponse,
    MfaStatusResponse,
    ProfileUpdateRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    TokenResponse,
)

logger = get_logger("signflow.auth")

MFA_TOKEN_TTL_SECONDS = 300
MFA_TOKEN_PURPOSE = "mfa"
PASSWORD_RESET_TTL_MINUTES = 60
SESSION_TTL_HOURS = 12
SESSION_REMEMBER_TTL_DAYS = 30
#: How long after a rotation the spent refresh token is still answered.
#:
#: The frontend refreshes on a 30s skew against a 15-minute access token, so
#: two tabs can present the same refresh token within milliseconds of each
#: other. Rotation revokes on first use, so without this the loser got a 401
#: and the user was signed out at random.
#:
#: This is a deliberate, bounded security tradeoff and it is worth naming: a
#: stolen refresh token replayed inside the window is honoured. The window is
#: therefore small, and the compensating control is real -- see
#: ``_reuse_detected``: a spent token presented *outside* the window revokes
#: the entire refresh chain, which is detection this code did not have at all
#: before. The old behaviour silently tolerated replay forever and simply
#: logged the legitimate user out.
REFRESH_ROTATION_GRACE_SECONDS = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; compare in UTC regardless."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _mask_email(email: str) -> str:
    local, _, domain = email.partition("@")
    head = local[:1] if local else ""
    return f"{head}{'*' * max(len(local) - 1, 1)}@{domain}"


def _parse_user_agent(user_agent: str | None) -> tuple[str | None, str | None, str | None]:
    """Best-effort device/browser/OS labels. No external UA database needed."""
    if not user_agent:
        return None, None, None
    ua = user_agent.lower()
    browser = next(
        (name for marker, name in (
            ("edg/", "Edge"), ("opr/", "Opera"), ("chrome/", "Chrome"),
            ("safari/", "Safari"), ("firefox/", "Firefox"),
        ) if marker in ua),
        None,
    )
    os_name = next(
        (name for marker, name in (
            ("iphone", "iOS"), ("ipad", "iPadOS"), ("android", "Android"),
            ("mac os x", "macOS"), ("windows", "Windows"), ("cros", "ChromeOS"),
            ("linux", "Linux"),
        ) if marker in ua),
        None,
    )
    if any(marker in ua for marker in ("iphone", "android", "ipad", "mobile")):
        device = "Mobile"
    elif os_name:
        device = f"{os_name} device"
    else:
        device = "Unknown device"
    return device, browser, os_name


class AuthService:
    # --- shared helpers ---------------------------------------------------

    def user_payload(self, db: Session, user: User) -> AuthUserResponse:
        """The user record returned by login / register / me.

        Carries ``is_platform_admin`` and the organization's name so the
        frontend session cookie can be minted from one response.
        """
        organization = db.get(Organization, user.organization_id)
        return AuthUserResponse(
            id=user.id,
            organization_id=user.organization_id,
            organization_name=organization.name if organization else None,
            name=user.name,
            email=user.email,
            role=user.role,
            is_platform_admin=bool(user.is_platform_admin),
            avatar_url=self.avatar_url_for(user),
            locale=user.locale,
            timezone=user.timezone,
            status=user.status or "active",
            mfa_method=user.mfa_method,
            mfa_enrolled=bool(user.mfa_enrolled_at and user.mfa_secret),
            last_active_at=user.last_active_at,
        )

    @staticmethod
    def avatar_url_for(user: User) -> str | None:
        """The photo the frontend should show for `user`.

        A photo uploaded here beats whatever URL an identity provider set: the
        upload is the more deliberate choice of the two. It is served through
        our own route, and carries the row's update time so a replaced photo
        is not answered from a stale cache.
        """
        if user.avatar_path:
            stamp = int(user.updated_at.timestamp()) if user.updated_at else 0
            return f"/api/me/avatar?v={stamp}"
        return user.avatar_url

    def current_user_payload(self, db: Session, user: User) -> CurrentUserResponse:
        return CurrentUserResponse(**self.user_payload(db, user).model_dump())

    def issue_session_for(self, db: Session, user: User, *, request=None) -> TokenResponse:
        """Public wrapper: mint a real, revocable session for ``user``.

        Exists so other services (invitation acceptance) cannot accidentally
        hand out a bare access token with no session row behind it.
        """
        return self._issue_session(db, user, request=request)

    def _issue_session(
        self,
        db: Session,
        user: User,
        *,
        request: Request | None,
        remember: bool = False,
    ) -> TokenResponse:
        raw_refresh = generate_refresh_token()
        ttl = timedelta(days=SESSION_REMEMBER_TTL_DAYS) if remember else timedelta(hours=SESSION_TTL_HOURS)
        device, browser, os_name = _parse_user_agent(request_user_agent(request) if request else None)
        session_row = UserSession(
            user_id=user.id,
            refresh_token_hash=hash_opaque_token(raw_refresh),
            device=device,
            browser=browser,
            os=os_name,
            ip_address=request_ip(request) if request else None,
            user_agent=(request_user_agent(request) if request else None),
            expires_at=_now() + ttl,
        )
        db.add(session_row)
        user.last_active_at = _now()
        db.flush()
        settings = get_settings()
        payload = TokenResponse(
            access_token=create_access_token(user.id, session_id=session_row.id),
            refresh_token=raw_refresh,
            expires_in=settings.jwt_expires_minutes * 60,
            user=self.user_payload(db, user),
        )
        db.commit()
        return payload

    # --- register / login -------------------------------------------------

    def register(self, db: Session, payload: RegisterRequest, *, request: Request | None = None) -> TokenResponse:
        existing = db.scalar(select(User).where(User.email == payload.email.lower()))
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")

        # The user who creates a brand-new organization administers it.
        organization = Organization(name=payload.organization_name)
        db.add(organization)
        db.flush()

        user = User(
            organization_id=organization.id,
            name=payload.name,
            email=payload.email.lower(),
            password_hash=hash_password(payload.password),
            role=UserRole.admin,
        )
        db.add(user)
        db.flush()
        return self._issue_session(db, user, request=request)

    def login(
        self,
        db: Session,
        payload: LoginRequest,
        *,
        request: Request | None = None,
    ) -> TokenResponse | MfaChallengeResponse:
        user = db.scalar(select(User).where(User.email == payload.email.lower()))
        # Always run one bcrypt comparison, even for an address that does not
        # exist: skipping it answered ~80x faster and enumerated accounts.
        password_ok = verify_password(
            payload.password, user.password_hash if user else dummy_password_hash()
        )
        if not user or not password_ok:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
        if user.status == "deprovisioned":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")
        if user.status == "erased":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")
        # A sandbox mirror user is a service-layer convenience, not an account.
        # Its password hash is unusable, so the comparison above cannot succeed
        # anyway -- this is the explicit second lock, so that the sandbox can
        # never become a way to hold a session.
        from app.services.sandbox_service import sandbox_service

        if sandbox_service.is_mirror(user):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
        # An organization that enforces SSO has decided its IdP is the only way
        # in. Leaving the password path open would make "enforce SSO" a
        # suggestion -- the offboarding an admin does in their IdP would not
        # actually lock anyone out.
        #
        # Break-glass: a platform admin is exempt. That flag is not something
        # an org admin can grant themselves (see platform_service.set_role),
        # so it is an existing privileged role, not a new bypass -- and it is
        # the only way back into a workspace whose IdP has been misconfigured
        # into locking everyone else out.
        from app.services.sso_service import sso_service

        if not user.is_platform_admin and sso_service.is_enforced(db, user.organization_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This workspace requires single sign-on",
            )
        if self._mfa_active(user):
            return self._mfa_challenge(db, user, remember=payload.remember)
        return self._issue_session(db, user, request=request, remember=payload.remember)

    def refresh(
        self,
        db: Session,
        *,
        refresh_token: str,
        remember: bool = False,
        request: Request | None = None,
    ) -> TokenResponse:
        session_row = db.scalar(
            select(UserSession).where(UserSession.refresh_token_hash == hash_opaque_token(refresh_token))
        )
        if not session_row:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

        expires_at = _aware(session_row.expires_at)
        if expires_at and expires_at <= _now():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

        if session_row.revoked_at:
            # A revoked row is only ever answered when it was retired by a
            # rotation and the rotation was moments ago. Logout and admin
            # revoke set revoked_at without rotated_at and are final.
            rotated_at = _aware(session_row.rotated_at)
            if rotated_at is None:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
                )
            if (_now() - rotated_at).total_seconds() > REFRESH_ROTATION_GRACE_SECONDS:
                # A spent token replayed long after it was rotated is a stolen
                # token, not a racing tab. Kill the chain it belongs to.
                self._revoke_refresh_chain(db, session_row)
                db.commit()
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
                )
            user = db.get(User, session_row.user_id)
            if not user:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
            # The loser of a concurrent refresh. It cannot be handed the
            # winner's refresh token -- only the hash is stored -- so it gets a
            # session of its own, linked into the same chain.
            issued = self._issue_session(db, user, request=request, remember=remember)
            self._link_successor(db, session_row)
            db.commit()
            return issued

        user = db.get(User, session_row.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        # Rotate: the presented token dies with the row it belongs to.
        session_row.revoked_at = _now()
        session_row.rotated_at = session_row.revoked_at
        issued = self._issue_session(db, user, request=request, remember=remember)
        self._link_successor(db, session_row)
        db.commit()
        return issued

    def _link_successor(self, db: Session, predecessor: UserSession) -> None:
        """Point ``predecessor`` at the newest live session for that user."""
        successor = db.scalar(
            select(UserSession)
            .where(
                UserSession.user_id == predecessor.user_id,
                UserSession.revoked_at.is_(None),
                UserSession.id != predecessor.id,
            )
            .order_by(UserSession.created_at.desc())
        )
        if successor is not None:
            predecessor.replaced_by_id = successor.id
            db.add(predecessor)

    def _revoke_refresh_chain(self, db: Session, start: UserSession) -> None:
        """Revoke every session reachable from ``start`` by rotation.

        Replay of a spent token means the token leaked; the sessions minted
        from it are no more trustworthy than the one presented.
        """
        seen: set[str] = set()
        current: UserSession | None = start
        while current is not None and current.id not in seen:
            seen.add(current.id)
            if current.revoked_at is None:
                current.revoked_at = _now()
                db.add(current)
            next_id = current.replaced_by_id
            current = db.get(UserSession, next_id) if next_id else None

    def logout(self, db: Session, *, user: User, session_id: str | None) -> None:
        if session_id:
            session_row = db.get(UserSession, session_id)
            if session_row and session_row.user_id == user.id and not session_row.revoked_at:
                session_row.revoked_at = _now()
        db.commit()

    # --- MFA --------------------------------------------------------------

    def _mfa_active(self, user: User) -> bool:
        return bool(user.mfa_secret and user.mfa_enrolled_at)

    def _mfa_challenge(self, db: Session, user: User, *, remember: bool = False) -> MfaChallengeResponse:
        jti = token_urlsafe(12)
        token = create_scoped_token(
            user.id,
            purpose=MFA_TOKEN_PURPOSE,
            expires_in_seconds=MFA_TOKEN_TTL_SECONDS,
            remember=bool(remember),
            jti=jti,
        )
        db.add(
            MfaChallenge(
                jti=jti,
                user_id=user.id,
                expires_at=_now() + timedelta(seconds=MFA_TOKEN_TTL_SECONDS),
            )
        )
        db.commit()
        return MfaChallengeResponse(
            mfa_token=token,
            delivery=user.mfa_method or "totp",
            masked_target=_mask_email(user.email),
        )

    # --- single-use MFA state (replay defence) ---------------------------
    #
    # Backed by the ``mfa_challenges`` table and ``users.mfa_last_used_step``.
    # A challenge ``jti`` is burned when it is redeemed, and the TOTP step a
    # code belongs to is recorded on the user, so the same code cannot be
    # replayed through a freshly issued challenge.

    def _challenge_consumed(self, db: Session, jti: str) -> bool:
        challenge = db.get(MfaChallenge, jti)
        return challenge is not None and challenge.consumed_at is not None

    def _burn_challenge(self, db: Session, user: User, jti: str) -> None:
        challenge = db.get(MfaChallenge, jti)
        if challenge is None:
            challenge = MfaChallenge(
                jti=jti,
                user_id=user.id,
                expires_at=_now() + timedelta(seconds=MFA_TOKEN_TTL_SECONDS),
            )
            db.add(challenge)
        challenge.consumed_at = _now()
        db.flush()

    def _matched_totp_step(self, secret: str, code: str, *, now: float | None = None) -> int | None:
        """Which TOTP step a code corresponds to, or None. Constant-time."""
        candidate = "".join(ch for ch in (code or "") if ch.isdigit())
        if not secret or len(candidate) != totp.DIGITS:
            return None
        counter = int((now if now is not None else time.time()) // totp.PERIOD)
        matched: int | None = None
        for offset in range(-totp.DEFAULT_DRIFT_STEPS, totp.DEFAULT_DRIFT_STEPS + 1):
            step = counter + offset
            if hmac.compare_digest(totp.code_at(secret, step), candidate) and matched is None:
                matched = step
        return matched

    def _resolve_mfa_token(self, db: Session, mfa_token: str) -> tuple[User, bool]:
        try:
            claims = decode_access_token(mfa_token)
        except JWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="This verification session has expired"
            ) from exc
        if claims.get("purpose") != MFA_TOKEN_PURPOSE:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid verification token")
        user = db.get(User, claims.get("sub") or "")
        if not user or not self._mfa_active(user):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid verification token")
        jti = claims.get("jti")
        if jti and self._challenge_consumed(db, jti):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="This verification session has already been used",
            )
        return user, bool(claims.get("remember"))

    def mfa_challenge_info(self, db: Session, *, mfa_token: str) -> MfaChallengeResponse:
        user, remember = self._resolve_mfa_token(db, mfa_token)
        return MfaChallengeResponse(
            mfa_token=mfa_token,
            delivery=user.mfa_method or "totp",
            masked_target=_mask_email(user.email),
        )

    def mfa_verify_login(
        self,
        db: Session,
        *,
        mfa_token: str,
        code: str,
        remember: bool = False,
        request: Request | None = None,
    ) -> TokenResponse:
        user, token_remember = self._resolve_mfa_token(db, mfa_token)
        claims = decode_access_token(mfa_token)
        now = time.time()

        step = self._matched_totp_step(user.mfa_secret or "", code, now=now)
        last_step = user.mfa_last_used_step
        if step is not None and last_step is not None and step <= last_step:
            # Same 30-second TOTP window replayed: reject rather than mint a
            # second session from one code.
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="That verification code has already been used"
            )
        if not self._check_code(db, user, code):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="That verification code is not valid")

        # Burn the challenge token and the TOTP step before minting a session.
        jti = claims.get("jti")
        if jti:
            self._burn_challenge(db, user, jti)
        if step is not None:
            user.mfa_last_used_step = step
            db.flush()
        return self._issue_session(db, user, request=request, remember=remember or token_remember)

    def _check_code(self, db: Session, user: User, code: str) -> bool:
        """Constant-time TOTP check, falling back to a single-use recovery code."""
        if totp.verify(user.mfa_secret or "", code):
            return True
        matched, remaining = totp.consume_recovery_code(user.mfa_recovery_codes, code)
        if matched:
            user.mfa_recovery_codes = remaining
            db.flush()
            return True
        return False

    def mfa_enroll(self, db: Session, *, user: User, method: str = "totp") -> MfaEnrollResponse:
        if method != "totp":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only TOTP enrolment is supported")
        if self._mfa_active(user):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Multi-factor authentication is already enabled. Disable it first to re-enrol.",
            )
        secret = totp.generate_secret()
        codes = totp.generate_recovery_codes()
        # Pending enrolment: the secret is stored (encrypted) but mfa_enrolled_at
        # stays null, so login is not yet challenged until /confirm succeeds.
        user.mfa_method = method
        user.mfa_secret = secret
        user.mfa_enrolled_at = None
        user.mfa_recovery_codes = [totp.hash_recovery_code(entry) for entry in codes]
        db.commit()
        settings = get_settings()
        return MfaEnrollResponse(
            method=method,
            secret=secret,
            otpauth_url=totp.provisioning_uri(
                secret, account_name=user.email, issuer=getattr(settings, "app_name", None) or "SignerPro"
            ),
            recovery_codes=codes,
        )

    def mfa_confirm(self, db: Session, *, user: User, code: str) -> None:
        if not user.mfa_secret:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start enrolment first")
        if not totp.verify(user.mfa_secret, code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That verification code is not valid")
        user.mfa_enrolled_at = _now()
        db.commit()

    def mfa_disable(self, db: Session, *, user: User, code: str | None, password: str) -> None:
        # Stripping 2FA is a re-authentication event: a stolen access token
        # must not be enough to do it.
        if not password or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password is incorrect")
        if self._mfa_active(user):
            if not code or not self._check_code(db, user, code):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="A valid verification code is required"
                )
        user.mfa_method = None
        user.mfa_secret = None
        user.mfa_enrolled_at = None
        user.mfa_recovery_codes = None
        db.commit()

    def mfa_status(self, user: User) -> MfaStatusResponse:
        return MfaStatusResponse(
            enrolled=self._mfa_active(user),
            method=user.mfa_method,
            enrolled_at=user.mfa_enrolled_at,
            recovery_codes_remaining=len(user.mfa_recovery_codes or []),
        )

    def mfa_regenerate_recovery_codes(
        self, db: Session, *, user: User, code: str, password: str
    ) -> MfaRecoveryCodesResponse:
        # Same reasoning as mfa_disable: new recovery codes invalidate the old
        # ones and are a standalone second factor, so re-auth is required.
        if not password or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Password is incorrect")
        if not self._mfa_active(user):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Multi-factor authentication is not enabled")
        if not totp.verify(user.mfa_secret or "", code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That verification code is not valid")
        codes = totp.generate_recovery_codes()
        user.mfa_recovery_codes = [totp.hash_recovery_code(entry) for entry in codes]
        db.commit()
        return MfaRecoveryCodesResponse(recovery_codes=codes)

    # --- password reset ---------------------------------------------------

    def forgot_password(self, db: Session, payload: ForgotPasswordRequest) -> None:
        """Always succeeds — a 404 here would enumerate accounts."""
        user = db.scalar(select(User).where(User.email == payload.email.lower()))
        if not user:
            logger.info("Password reset requested for an unknown address")
            return
        raw_token = generate_refresh_token()
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_opaque_token(raw_token),
                expires_at=_now() + timedelta(minutes=PASSWORD_RESET_TTL_MINUTES),
            )
        )
        db.commit()
        settings = get_settings()
        link = f"{settings.app_base_url.rstrip('/')}/reset-password?token={raw_token}"
        organization = db.get(Organization, user.organization_id)
        email_service.send(
            EmailMessage(
                to_email=user.email,
                subject="Reset your SignerPro password",
                body=(
                    f"Hello {user.name},\n\n"
                    "We received a request to reset your SignerPro password.\n"
                    f"Set a new password here: {link}\n\n"
                    f"This link can be used once and expires in {PASSWORD_RESET_TTL_MINUTES} minutes.\n"
                    "If you did not request this, you can safely ignore this email."
                ),
                category="auth",
            ),
            organization=organization,
        )
        logger.info("Password reset email dispatched", extra={"user_id": user.id})

    def reset_password(
        self,
        db: Session,
        payload: ResetPasswordRequest,
        *,
        request: Request | None = None,
    ) -> TokenResponse:
        token_hash = hash_opaque_token(payload.token)
        row = db.scalar(select(PasswordResetToken).where(PasswordResetToken.token_hash == token_hash))
        expires_at = _aware(row.expires_at) if row else None
        # Constant-time on the hash itself; the lookup above is by digest, so a
        # near-miss token reveals nothing.
        if (
            not row
            or not hmac.compare_digest(row.token_hash, token_hash)
            or row.used_at is not None
            or (expires_at and expires_at <= _now())
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired"
            )
        user = db.get(User, row.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This reset link is invalid or has expired")
        # Setting a new password is exactly the thing SSO enforcement exists to
        # rule out -- a reset link would otherwise be a standing bypass of it,
        # letting a member mint a password login even though the org decided
        # the IdP is the only path in. The break-glass exemption for platform
        # admins mirrors login().
        from app.services.sso_service import sso_service

        if not user.is_platform_admin and sso_service.is_enforced(db, user.organization_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This workspace requires single sign-on; ask an admin for the workspace's SSO login link",
            )
        row.used_at = _now()
        user.password_hash = hash_password(payload.password)
        self._revoke_all_sessions(db, user)
        db.flush()
        return self._issue_session(db, user, request=request)

    def change_password(
        self,
        db: Session,
        *,
        user: User,
        payload: ChangePasswordRequest,
        keep_session_id: str | None = None,
    ) -> None:
        if not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Current password is incorrect")
        user.password_hash = hash_password(payload.password)
        # Changing a password is what someone does when they believe it has
        # been compromised. Leaving every other session alive means the person
        # they are locking out stays logged in for the life of their token --
        # so the one action a user takes to eject an intruder did not eject
        # them. Every other session dies; the caller's own survives, because
        # signing yourself out of the tab you just used is not the intent.
        revoked = self._revoke_all_sessions(db, user, keep_session_id=keep_session_id)
        # A semantic entry, not just the `PATCH /api/auth/password -> 204` the
        # request middleware already writes. An auditor reading a security
        # incident needs "who changed a password, and when", not an HTTP verb.
        from app.services.platform_service import record_platform_audit

        record_platform_audit(
            db,
            action="auth.password_changed",
            actor=user,
            organization_id=user.organization_id,
            detail=f"Password changed; {revoked} other session(s) revoked",
        )
        db.commit()

    def _revoke_all_sessions(self, db: Session, user: User, *, keep_session_id: str | None = None) -> int:
        rows = db.scalars(
            select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        ).all()
        revoked = 0
        for row in rows:
            if keep_session_id and row.id == keep_session_id:
                continue
            row.revoked_at = _now()
            revoked += 1
        return revoked

    # --- sessions / devices ----------------------------------------------

    def list_sessions(self, db: Session, *, user: User, current_session_id: str | None) -> list[SessionResponse]:
        rows = db.scalars(
            select(UserSession)
            .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
            .order_by(UserSession.last_seen_at.desc())
        ).all()
        now = _now()
        return [
            SessionResponse(
                id=row.id,
                device=row.device,
                browser=row.browser,
                os=row.os,
                ip_address=row.ip_address,
                location=row.location,
                last_seen_at=row.last_seen_at,
                created_at=row.created_at,
                expires_at=row.expires_at,
                is_current=row.id == current_session_id,
            )
            for row in rows
            if (_aware(row.expires_at) or now) > now
        ]

    def revoke_session(self, db: Session, *, user: User, session_id: str) -> None:
        row = db.get(UserSession, session_id)
        if not row or row.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
        row.revoked_at = _now()
        db.commit()

    def revoke_other_sessions(self, db: Session, *, user: User, current_session_id: str | None) -> int:
        revoked = self._revoke_all_sessions(db, user, keep_session_id=current_session_id)
        db.commit()
        return revoked

    def touch(self, db: Session, *, user: User, session_id: str | None) -> None:
        """Refresh last-seen markers; called by the /me read path."""
        user.last_active_at = _now()
        if session_id:
            row = db.get(UserSession, session_id)
            if row and row.user_id == user.id:
                row.last_seen_at = _now()
        db.commit()

    # --- profile ----------------------------------------------------------

    def update_profile(self, db: Session, *, user: User, payload: ProfileUpdateRequest) -> CurrentUserResponse:
        data = payload.model_dump(exclude_unset=True)
        for attribute in ("name", "locale", "timezone", "avatar_url"):
            if attribute in data and data[attribute] is not None:
                setattr(user, attribute, data[attribute])
        if "signature_default" in data:
            preferences = dict(user.preferences or {})
            preferences["signature_default"] = data["signature_default"]
            user.preferences = preferences
        db.commit()
        db.refresh(user)
        return self.current_user_payload(db, user)


auth_service = AuthService()
