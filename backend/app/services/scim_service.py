"""SCIM 2.0 user provisioning (the ``scim`` security-posture control).

Implements the subset of RFC 7643/7644 that an IdP-driven lifecycle actually
needs: list/filter, get, create, replace, patch (``active`` only) and
deactivate on ``/Users``. Groups are **not implemented** — there is no
``/Groups`` endpoint and role/group sync from an IdP does not happen here.

The load-bearing property is the same as ``api_key_service``: a SCIM bearer
token authenticates an *organization*, never a platform admin, and every
lookup is filtered by ``organization_id`` so a token minted for one tenant can
never see or touch another tenant's directory.

Deactivation (PATCH ``active=false`` or DELETE) is the actual point of this
module. Setting a status flag and leaving a live session behind is not
deprovisioning, so both paths mark the user ``deprovisioned`` *and* revoke
every one of their sessions in the same transaction, exactly as
``auth_service`` does for a forced password change.
"""

from __future__ import annotations

from datetime import datetime, timezone
from secrets import token_urlsafe

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.hashing import sha256_bytes
from app.core.security import hash_password
from app.models.enums import UserRole
from app.models.scim_token import ScimToken
from app.models.user import User
from app.models.user_session import UserSession

SCIM_USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User"
SCIM_LIST_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error"


def hash_scim_token(raw_token: str) -> str:
    return sha256_bytes(raw_token.encode("utf-8"))


class ScimException(HTTPException):
    """Carries a flat SCIM error body (RFC 7644 §3.12) instead of FastAPI's
    default ``{"detail": ...}`` envelope. Unwrapped by a dedicated handler in
    ``app.main`` so the wire format is exactly the SCIM error schema."""

    def __init__(self, body: dict, *, status_code: int) -> None:
        super().__init__(status_code=status_code, detail=body)
        self.scim_body = body


def scim_error(detail: str, *, status_code: int) -> ScimException:
    """A SCIM-shaped error body, per RFC 7644 §3.12."""
    return ScimException(
        {"schemas": [SCIM_ERROR_SCHEMA], "detail": detail, "status": str(status_code)},
        status_code=status_code,
    )


def _mint_token() -> tuple[str, str]:
    body = token_urlsafe(24).replace("-", "").replace("_", "")[:32]
    raw = f"scim_{body}"
    prefix = f"scim_{body[:4]}"
    return raw, prefix


class ScimTokenService:
    """Issuance and revocation of the per-organization SCIM bearer token."""

    def create(self, db: Session, *, organization_id: str, created_by_user_id: str | None, label: str = "SCIM provisioning") -> tuple[ScimToken, str]:
        raw, prefix = _mint_token()
        token = ScimToken(
            organization_id=organization_id,
            label=label,
            prefix=prefix,
            token_hash=hash_scim_token(raw),
            created_by_user_id=created_by_user_id,
        )
        db.add(token)
        db.commit()
        db.refresh(token)
        return token, raw

    def list_for_organization(self, db: Session, *, organization_id: str) -> list[ScimToken]:
        stmt = select(ScimToken).where(ScimToken.organization_id == organization_id)
        return list(db.scalars(stmt.order_by(ScimToken.created_at.desc())))

    def revoke(self, db: Session, *, token: ScimToken) -> ScimToken:
        if token.revoked_at is None:
            token.revoked_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(token)
        return token

    def authenticate(self, db: Session, *, raw_token: str) -> ScimToken:
        token = db.scalar(select(ScimToken).where(ScimToken.token_hash == hash_scim_token(raw_token)))
        if not token or token.revoked_at is not None:
            raise scim_error("Invalid or revoked SCIM token", status_code=status.HTTP_401_UNAUTHORIZED)
        token.last_used_at = datetime.now(timezone.utc)
        db.commit()
        return token


scim_token_service = ScimTokenService()


def _coerce_active(value: object) -> bool | None:
    """SCIM ``active`` as a real boolean, or ``None`` if it isn't one.

    ``bool(value)`` is wrong here: IdPs serialise the attribute as the strings
    ``"false"``/``"False"`` often enough that a bare truthiness test turns a
    deprovision into an activation. Anything unrecognised is rejected rather
    than guessed at.
    """
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in ("true", "1"):
            return True
        if lowered in ("false", "0"):
            return False
    return None


def _revoke_all_sessions(db: Session, user: User) -> None:
    """Kill every live session for a deprovisioned user.

    Mirrors ``auth_service._revoke_all_sessions``: a session row surviving a
    deprovision means the access it grants survives too.
    """
    rows = db.scalars(
        select(UserSession).where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
    ).all()
    now = datetime.now(timezone.utc)
    for row in rows:
        row.revoked_at = now


def _to_scim(user: User) -> dict:
    active = user.status not in ("deprovisioned", "erased")
    return {
        "schemas": [SCIM_USER_SCHEMA],
        "id": user.id,
        "userName": user.email,
        "name": {"formatted": user.name},
        "emails": [{"value": user.email, "primary": True}],
        "active": active,
        "meta": {
            "resourceType": "User",
            "created": user.created_at.isoformat() if user.created_at else None,
            "lastModified": user.updated_at.isoformat() if user.updated_at else None,
        },
    }


class ScimUserService:
    def _get(self, db: Session, *, organization_id: str, user_id: str) -> User:
        user = db.get(User, user_id)
        if not user or user.organization_id != organization_id:
            raise scim_error(f"User {user_id} not found", status_code=status.HTTP_404_NOT_FOUND)
        return user

    def list_users(
        self,
        db: Session,
        *,
        organization_id: str,
        user_name: str | None = None,
        start_index: int = 1,
        count: int = 100,
    ) -> dict:
        stmt = select(User).where(User.organization_id == organization_id)
        if user_name is not None:
            stmt = stmt.where(User.email == user_name.lower())
        rows = list(db.scalars(stmt.order_by(User.created_at)))
        total = len(rows)
        # SCIM's startIndex is 1-based.
        page = rows[max(start_index - 1, 0): max(start_index - 1, 0) + count]
        return {
            "schemas": [SCIM_LIST_SCHEMA],
            "totalResults": total,
            "startIndex": start_index,
            "itemsPerPage": len(page),
            "Resources": [_to_scim(row) for row in page],
        }

    def get_user(self, db: Session, *, organization_id: str, user_id: str) -> dict:
        return _to_scim(self._get(db, organization_id=organization_id, user_id=user_id))

    def create_user(self, db: Session, *, organization_id: str, payload: dict) -> dict:
        user_name = payload.get("userName")
        if not user_name:
            raise scim_error("userName is required", status_code=status.HTTP_400_BAD_REQUEST)
        email = str(user_name).lower()
        # ``User.email`` is unique product-wide, not per organization, so this
        # check cannot be org-scoped without trading the 409 for an
        # IntegrityError. It must not confirm that the address exists in some
        # *other* tenant, though -- that turns provisioning into a cross-tenant
        # existence oracle for anyone holding any SCIM token.
        if db.scalar(select(User).where(User.email == email)):
            raise scim_error("userName is not available", status_code=status.HTTP_409_CONFLICT)

        name = payload.get("name") or {}
        display_name = name.get("formatted") or payload.get("displayName") or email
        active = payload.get("active", True)

        user = User(
            organization_id=organization_id,
            name=display_name,
            email=email,
            # SCIM never carries a password; the account is provisioned
            # passwordless until the user completes SSO or a reset flow.
            password_hash=hash_password(token_urlsafe(32)),
            role=UserRole.sender,
            status="active" if active else "deprovisioned",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return _to_scim(user)

    def replace_user(self, db: Session, *, organization_id: str, user_id: str, payload: dict) -> dict:
        user = self._get(db, organization_id=organization_id, user_id=user_id)
        name = payload.get("name") or {}
        if name.get("formatted"):
            user.name = name["formatted"]
        elif payload.get("displayName"):
            user.name = payload["displayName"]

        was_active = user.status not in ("deprovisioned", "erased")
        active = was_active if "active" not in payload else _coerce_active(payload["active"])
        if active is None:
            raise scim_error("active must be a boolean", status_code=status.HTTP_400_BAD_REQUEST)
        if active and not was_active:
            user.status = "active"
        elif not active and was_active:
            user.status = "deprovisioned"
            _revoke_all_sessions(db, user)

        db.commit()
        db.refresh(user)
        return _to_scim(user)

    def patch_user(self, db: Session, *, organization_id: str, user_id: str, operations: list[dict]) -> dict:
        user = self._get(db, organization_id=organization_id, user_id=user_id)
        applied = False
        for op in operations:
            path = (op.get("path") or "").strip().lower()
            value = op.get("value")
            action = (op.get("op") or "").strip().lower()
            if action not in ("replace", "add"):
                continue

            # Entra and Okta both emit the path-less form
            # ``{"op": "replace", "value": {"active": false}}``. Reading only
            # the ``path`` variant made every such deprovision a silent no-op
            # that still answered 200 -- the IdP recorded success while the
            # user kept their session, which is the exact failure this control
            # exists to prevent.
            if path == "active":
                raw = value
            elif not path and isinstance(value, dict) and "active" in value:
                raw = value["active"]
            else:
                # Only the deprovisioning attribute is supported; anything
                # else is silently ignored rather than pretending to apply it.
                continue

            active = _coerce_active(raw)
            if active is None:
                raise scim_error(
                    "active must be a boolean", status_code=status.HTTP_400_BAD_REQUEST
                )
            applied = True
            was_active = user.status not in ("deprovisioned", "erased")
            if active and not was_active:
                user.status = "active"
            elif not active and was_active:
                user.status = "deprovisioned"
                _revoke_all_sessions(db, user)

        if not applied:
            # Answering 200 to a PATCH that changed nothing tells the IdP the
            # deprovision succeeded. Say plainly that it did not.
            raise scim_error(
                "No supported operation in PATCH; only the 'active' attribute is supported",
                status_code=status.HTTP_400_BAD_REQUEST,
            )
        db.commit()
        db.refresh(user)
        return _to_scim(user)

    def deactivate_user(self, db: Session, *, organization_id: str, user_id: str) -> None:
        """SCIM DELETE. Deactivates in place; never hard-deletes the row."""
        user = self._get(db, organization_id=organization_id, user_id=user_id)
        if user.status not in ("deprovisioned", "erased"):
            user.status = "deprovisioned"
            _revoke_all_sessions(db, user)
            db.commit()


scim_user_service = ScimUserService()
