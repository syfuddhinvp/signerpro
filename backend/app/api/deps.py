from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logging import set_organization_id, set_user_id
from app.core.security import decode_access_token
from app.models.enums import UserRole
from app.models.user import User


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token") from exc
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # The request middleware cannot know the tenant; stamp it so every log record
    # emitted downstream carries it.
    set_user_id(user.id)
    set_organization_id(user.organization_id)
    return user


def current_session_id(token: str = Depends(oauth2_scheme)) -> str | None:
    """The ``sid`` claim of the calling access token, when it carries one.

    Lets ``GET /api/auth/sessions`` flag the current device and lets logout
    revoke exactly the presenting session. Tokens minted before sessions
    existed simply have no ``sid``.
    """
    try:
        return decode_access_token(token).get("sid")
    except JWTError:
        return None


def request_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else None


def request_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")



def require_platform_admin(current_user: User = Depends(get_current_user)) -> User:
    """Enforce that the current user is a SignFlow platform administrator."""
    if not current_user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Requires SaaS Super Admin permissions.",
        )
    return current_user


def require_org_admin(current_user: User = Depends(get_current_user)) -> User:
    """Enforce that the current user administers their own organization."""
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage organization configurations",
        )
    return current_user


# ---------------------------------------------------------------------------
# API-key authentication (API-1…API-6). Keys authenticate the *organization*,
# never a user, and can never confer platform-admin powers.
# ---------------------------------------------------------------------------

from dataclasses import dataclass  # noqa: E402

from fastapi.security import APIKeyHeader  # noqa: E402

from app.models.api_key import ApiKey  # noqa: E402


api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


@dataclass
class ApiKeyPrincipal:
    """The caller identified by an API key."""

    api_key: ApiKey
    organization_id: str
    scopes: list[str]
    mode: str

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes


def get_api_key_principal(
    db: Session = Depends(get_db),
    raw_key: str | None = Depends(api_key_header),
) -> ApiKeyPrincipal:
    from app.services.api_key_service import api_key_service

    if not raw_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API key",
            headers={"WWW-Authenticate": "X-API-Key"},
        )
    api_key = api_key_service.authenticate(db, raw_key=raw_key.strip())
    set_organization_id(api_key.organization_id)
    return ApiKeyPrincipal(
        api_key=api_key,
        organization_id=api_key.organization_id,
        scopes=list(api_key.scopes or []),
        mode=api_key.mode,
    )


def require_api_scope(*required: str):
    """Dependency factory enforcing that the calling key holds every scope."""

    def dependency(principal: ApiKeyPrincipal = Depends(get_api_key_principal)) -> ApiKeyPrincipal:
        missing = [scope for scope in required if not principal.has_scope(scope)]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"API key is missing required scope(s): {', '.join(missing)}",
            )
        return principal

    return dependency


@dataclass
class OrgPrincipal:
    """Either a signed-in user or an API key, reduced to what routes need."""

    organization_id: str
    user: User | None = None
    api_key: ApiKey | None = None


def get_org_principal(
    db: Session = Depends(get_db),
    token: str | None = Depends(OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)),
    raw_key: str | None = Depends(api_key_header),
) -> OrgPrincipal:
    """Accept a user bearer token *or* an API key (API-7)."""
    if raw_key:
        from app.services.api_key_service import api_key_service

        api_key = api_key_service.authenticate(db, raw_key=raw_key.strip())
        set_organization_id(api_key.organization_id)
        return OrgPrincipal(organization_id=api_key.organization_id, api_key=api_key)
    if token:
        user = get_current_user(db=db, token=token)
        return OrgPrincipal(organization_id=user.organization_id, user=user)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
