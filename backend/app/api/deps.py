from datetime import datetime, timezone
from hashlib import sha256

from functools import lru_cache
from ipaddress import ip_address, ip_network

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logging import set_impersonation, set_organization_id, set_user_id
from app.core.security import (
    ACCESS_TOKEN_PURPOSE,
    IMPERSONATION_TOKEN_PURPOSE,
    JWTError,
    decode_access_token,
    decode_token,
)
from app.models.impersonation import ImpersonationSession
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.user import User
from app.models.user_session import UserSession


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

_INVALID = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token"
)


def _aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; compare in UTC regardless."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)



# ---------------------------------------------------------------------------
# Platform-admin impersonation (C8)
#
# An impersonation token is a *different kind of credential* to an access
# token, and is resolved here rather than by the ordinary path. Three
# properties the feature advertised were previously decorative:
#
#   scope        - ``scopes`` was written to the session row and read nowhere.
#   revocation   - ``token_hash`` was written and read nowhere, so ending a
#                  session left the JWT working until it expired.
#   attribution  - the ``imp`` claim was decoded nowhere, so every action was
#                  logged as the tenant's own administrator.
#
# All three now hang off one per-request lookup of the session row.
# ---------------------------------------------------------------------------

#: Methods a ``read``-scoped session may use.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

#: Surfaces no impersonation session may mutate, whatever its scope. These
#: grant *durable* access that outlives the session's TTL - an invitation, an
#: API key, a role change or a credential change - which is exactly how a
#: 15-minute support session becomes a permanent backdoor.
IMPERSONATION_FORBIDDEN_PREFIXES: tuple[str, ...] = (
    "/api/invitations",
    "/api/api-keys",
    "/api/auth",
    "/api/organizations/members",
    "/api/users",
)


def _impersonation_denied(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def authorize_impersonation(
    db: Session, *, token: str, payload: dict, request: Request | None
) -> ImpersonationSession:
    """Resolve an impersonation token against its (still live) session row."""
    token_hash = sha256(token.encode("utf-8")).hexdigest()
    row = db.execute(
        select(ImpersonationSession, User.email)
        .outerjoin(User, User.id == ImpersonationSession.admin_user_id)
        .where(ImpersonationSession.token_hash == token_hash)
    ).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This impersonation session is not recognised",
        )
    session, admin_email = row
    now = datetime.now(timezone.utc)
    expires_at = _aware(session.expires_at)
    if session.ended_at is not None or (expires_at and expires_at <= now):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This impersonation session has ended",
        )

    scopes = {str(scope).lower() for scope in (session.scopes or ["read"])}
    method = (request.method if request else "GET").upper()
    path = request.url.path if request else "/"
    if method not in SAFE_METHODS:
        if "write" not in scopes:
            raise _impersonation_denied(
                "This impersonation session is read-only; it cannot modify tenant data"
            )
        if any(path.startswith(prefix) for prefix in IMPERSONATION_FORBIDDEN_PREFIXES):
            raise _impersonation_denied(
                "Impersonation cannot grant or change credentials, invitations, API keys or roles"
            )

    set_impersonation(
        {
            "session_id": session.id,
            "admin_user_id": session.admin_user_id,
            "admin_email": admin_email,
            "organization_id": session.organization_id,
            "scopes": sorted(scopes),
            "justification": session.justification,
        }
    )
    return session


#: Opt-in header letting a session-authenticated caller run one request
#: against its organization's sandbox (API-11). It is per-request and never
#: sticky: the app UI stays live unless a caller asks for the sandbox
#: explicitly, which is what keeps a "test mode" toggle from silently
#: becoming the state the whole UI is in.
SANDBOX_HEADER = "X-SignerPro-Sandbox"
_SANDBOX_TRUE = {"1", "true", "yes", "on", "sandbox", "test"}


def wants_sandbox(request: Request) -> bool:
    """Whether the caller asked for the sandbox on this request."""
    return (request.headers.get(SANDBOX_HEADER) or "").strip().lower() in _SANDBOX_TRUE


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
) -> User:
    """Authenticate a bearer access token.

    Four things are checked here, all of which used to be missing:

    1. ``purpose`` — the MFA challenge token (and any future signing / embed
       scoped token) is *not* an access credential and is rejected outright.
    2. ``sid`` — the session row the token belongs to must still be live.
       Logout, "sign out other devices" and admin-forced logout revoke that
       row; without this check they were cosmetic until the token expired.
    3. The user must still be active.
    4. The user's organization must not be suspended.

    Cost: exactly one extra query per authenticated request. User, organization
    and session are fetched in a single row via joins rather than three
    round-trips.
    """
    set_impersonation(None)
    try:
        payload = decode_token(token)
    except JWTError as exc:
        raise _INVALID from exc
    user_id = payload.get("sub")
    if not user_id:
        raise _INVALID

    # Legacy tokens carry no purpose at all and are treated as access tokens,
    # exactly as ``decode_token`` documents.
    purpose = payload.get("purpose", ACCESS_TOKEN_PURPOSE)
    impersonation: ImpersonationSession | None = None
    if purpose == IMPERSONATION_TOKEN_PURPOSE:
        impersonation = authorize_impersonation(db, token=token, payload=payload, request=request)
    elif purpose != ACCESS_TOKEN_PURPOSE:
        raise _INVALID

    session_id = payload.get("sid")
    query = select(User, Organization.suspended_at, UserSession).join(
        Organization, Organization.id == User.organization_id
    )
    if session_id:
        # Outer join on the literal sid: a missing/foreign session row still
        # returns the user row, and is then rejected below.
        query = query.outerjoin(
            UserSession,
            (UserSession.id == session_id) & (UserSession.user_id == User.id),
        )
    else:
        # Tokens minted without a session (invitation acceptance, platform
        # impersonation) carry no sid; there is nothing to revoke.
        query = query.outerjoin(UserSession, UserSession.id.is_(None))
    row = db.execute(query.where(User.id == user_id)).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    user, org_suspended_at, session_row = row

    if session_id:
        now = datetime.now(timezone.utc)
        expires_at = _aware(session_row.expires_at) if session_row else None
        if session_row is None or session_row.revoked_at is not None or (expires_at and expires_at <= now):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="This session has been signed out"
            )

    if (user.status or "active") != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account has been deactivated")
    if org_suspended_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This organization is suspended")

    if impersonation is not None:
        # The token names a subject; the session names the tenant. If they ever
        # disagree, or the subject is itself a platform admin, the credential is
        # not what it claims to be.
        if user.organization_id != impersonation.organization_id or user.is_platform_admin:
            raise _INVALID

    if wants_sandbox(request):
        # Hand the service layer the sandbox mirror instead of the live user.
        # Everything downstream reads ``user.organization_id``, so this single
        # substitution moves the entire request into the sandbox org without
        # any service or query needing to know that sandboxes exist.
        from app.services.sandbox_service import sandbox_service

        user = sandbox_service.mirror_user_for(db, live_user=user)

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


@lru_cache(maxsize=1)
def _trusted_proxies() -> tuple[ip_network, ...]:
    from app.core.config import get_settings

    raw = (get_settings().trusted_proxy_ips or "").strip()
    if not raw:
        return ()
    networks = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ip_network(entry, strict=False))
        except ValueError:
            continue
    return tuple(networks)


def request_ip(request: Request) -> str | None:
    """The client's IP, trusting ``X-Forwarded-For`` only from a known proxy.

    Trusting it unconditionally is what made every per-IP rate limit -- login,
    forgot-password, OTP, signing-link -- bypassable by rotating a single
    header, and let anyone write an arbitrary address into the audit trail.
    The header is only meaningful if something we control put it there.
    """
    peer = request.client.host if request.client else None
    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded or not peer:
        return peer

    trusted = _trusted_proxies()
    if not trusted:
        return peer
    try:
        peer_address = ip_address(peer)
    except ValueError:
        return peer
    if not any(peer_address in network for network in trusted):
        return peer
    return forwarded.split(",", 1)[0].strip() or peer


def request_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")



def require_platform_admin(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Enforce that the current user is a SignFlow platform administrator.

    Also enforces the ``ipAllow`` security-posture control: when it is
    enabled *and* at least one CIDR has been configured, callers outside
    every configured range are rejected. An empty allowlist is never treated
    as "deny all" -- see ``platform_service.ip_allowlist_enforced``.
    """
    if not current_user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Requires SaaS Super Admin permissions.",
        )

    from app.services import platform_service

    if platform_service.ip_allowlist_enforced(db):
        if not platform_service.ip_allowed(db, request_ip(request)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Forbidden: your network is not on the platform admin IP allowlist.",
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


def effective_organization_id(db: Session, *, api_key: "ApiKey") -> str:
    """The organization a key's calls act on (API-11).

    A ``test``-mode key resolves to the sandbox paired with the key's own
    organization, created on first use. ``mode`` used to be a label the backend
    never read, so a key marked ``test`` wrote real documents; this is the line
    that makes the distinction real.

    Only *data* moves. Entitlements, the monthly call quota and usage metering
    all key off ``api_key.organization_id`` in ``api_key_service.authenticate``
    — the live organization that owns the key — so sandbox traffic is still
    metered to the paying tenant and a test key is not a way around a plan
    limit.
    """
    if api_key.mode != "test":
        return api_key.organization_id
    from app.services.sandbox_service import sandbox_service

    return sandbox_service.sandbox_for(db, live_organization_id=api_key.organization_id).id


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
    organization_id = effective_organization_id(db, api_key=api_key)
    set_organization_id(organization_id)
    return ApiKeyPrincipal(
        api_key=api_key,
        organization_id=organization_id,
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


from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer  # noqa: E402

from app.models.scim_token import ScimToken  # noqa: E402

scim_bearer = HTTPBearer(auto_error=False, scheme_name="ScimBearer")


@dataclass
class ScimPrincipal:
    """The organization identified by a SCIM bearer token (never a user)."""

    token: ScimToken
    organization_id: str


def get_scim_principal(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(scim_bearer),
) -> ScimPrincipal:
    from app.services.scim_service import scim_error, scim_token_service

    if not credentials or not credentials.credentials:
        raise scim_error("Missing SCIM bearer token", status_code=status.HTTP_401_UNAUTHORIZED)
    token = scim_token_service.authenticate(db, raw_token=credentials.credentials.strip())
    set_organization_id(token.organization_id)
    return ScimPrincipal(token=token, organization_id=token.organization_id)


def get_org_principal(
    request: Request,
    db: Session = Depends(get_db),
    token: str | None = Depends(OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)),
    raw_key: str | None = Depends(api_key_header),
) -> OrgPrincipal:
    """Accept a user bearer token *or* an API key (API-7)."""
    if raw_key:
        from app.services.api_key_service import api_key_service

        api_key = api_key_service.authenticate(db, raw_key=raw_key.strip())
        organization_id = effective_organization_id(db, api_key=api_key)
        set_organization_id(organization_id)
        return OrgPrincipal(organization_id=organization_id, api_key=api_key)
    if token:
        user = get_current_user(request=request, db=db, token=token)
        return OrgPrincipal(organization_id=user.organization_id, user=user)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
