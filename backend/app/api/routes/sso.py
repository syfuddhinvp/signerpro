"""SAML single sign-on endpoints (AUTH-13).

The login endpoint is public by necessity -- someone signing in has no session
yet -- so it takes a workspace slug rather than anything guessable about a
user, and reveals nothing beyond whether SSO is configured for that workspace.
"""

from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.auth import TokenResponse
from app.services.sso_service import sso_service

router = APIRouter(prefix="/api/auth/sso", tags=["auth"])


class SsoConnectionRequest(BaseModel):
    idp_entity_id: str
    idp_sso_url: str
    #: Empty means "keep the certificate already stored". The certificate is
    #: write-only -- it is never returned by the GET -- so a client editing any
    #: other field has nothing to send back, and blanking it on every save
    #: would silently break the connection.
    idp_x509_cert: str = ""
    allowed_email_domains: str
    enabled: bool = True
    enforced: bool = False
    auto_provision: bool = True


class SsoConnectionResponse(BaseModel):
    enabled: bool
    enforced: bool
    auto_provision: bool
    idp_entity_id: str
    idp_sso_url: str
    allowed_email_domains: str


@router.get("/login/{slug}")
def begin_login(slug: str, db: Session = Depends(get_db)) -> RedirectResponse:
    url = sso_service.begin_login(db, slug=slug)
    return RedirectResponse(url, status_code=status.HTTP_303_SEE_OTHER)


@router.post("/acs", response_model=TokenResponse)
def assertion_consumer(
    SAMLResponse: str = Form(...),
    RelayState: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> TokenResponse:
    return sso_service.complete_login(db, saml_response=SAMLResponse, relay_state=RelayState)


@router.get("/connection", response_model=SsoConnectionResponse | None)
def read_connection(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> SsoConnectionResponse | None:
    connection = sso_service.get_connection(db, user.organization_id)
    if connection is None:
        return None
    return SsoConnectionResponse(
        enabled=connection.enabled,
        enforced=connection.enforced,
        auto_provision=connection.auto_provision,
        idp_entity_id=connection.idp_entity_id,
        idp_sso_url=connection.idp_sso_url,
        allowed_email_domains=connection.allowed_email_domains,
    )


@router.put("/connection", response_model=SsoConnectionResponse)
def save_connection(
    payload: SsoConnectionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SsoConnectionResponse:
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only an admin can configure single sign-on"
        )
    # Without at least one domain the connection would let the IdP assert any
    # address at all, so it is refused rather than saved half-configured.
    domains = [part.strip() for part in payload.allowed_email_domains.split(",") if part.strip()]
    if not domains:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one allowed email domain is required",
        )

    from app.models.sso_connection import SsoConnection

    connection = sso_service.get_connection(db, user.organization_id)
    if connection is None:
        connection = SsoConnection(organization_id=user.organization_id)
        db.add(connection)
    connection.idp_entity_id = payload.idp_entity_id
    connection.idp_sso_url = payload.idp_sso_url
    if payload.idp_x509_cert.strip():
        connection.idp_x509_cert = payload.idp_x509_cert
    elif not connection.idp_x509_cert:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An IdP signing certificate is required",
        )
    connection.allowed_email_domains = ",".join(domains)
    was_enforcing = bool(connection.enabled and connection.enforced)
    connection.enabled = payload.enabled
    connection.enforced = payload.enforced
    connection.auto_provision = payload.auto_provision

    now_enforcing = bool(connection.enabled and connection.enforced)
    revoked = 0
    if now_enforcing and not was_enforcing:
        # Turning enforcement on must end the password sessions that already
        # exist. Blocking `login` alone left every session minted before this
        # moment renewing itself through `auth_service.refresh` indefinitely,
        # so an admin who switched SSO on saw a control that only applied to
        # people who happened to log out. Sessions carry no auth-method, so
        # every session in the org is ended and users return through the IdP.
        #
        # Platform admins are skipped for the same reason they are exempt from
        # the login check: they are the way back in if the IdP is misconfigured.
        revoked = sso_service.revoke_password_sessions(db, organization_id=user.organization_id)

    from app.services.platform_service import record_platform_audit

    record_platform_audit(
        db,
        action="sso.connection_saved",
        actor=user,
        organization_id=user.organization_id,
        detail=(
            f"SAML connection {'enabled' if payload.enabled else 'disabled'} for {','.join(domains)}"
            + (f" · enforcement on, {revoked} existing session(s) ended" if revoked else "")
        ),
    )
    db.commit()
    db.refresh(connection)
    return SsoConnectionResponse(
        enabled=connection.enabled,
        enforced=connection.enforced,
        auto_provision=connection.auto_provision,
        idp_entity_id=connection.idp_entity_id,
        idp_sso_url=connection.idp_sso_url,
        allowed_email_domains=connection.allowed_email_domains,
    )
