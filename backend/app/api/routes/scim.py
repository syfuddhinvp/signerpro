"""SCIM 2.0 user provisioning (the ``scim`` security-posture control).

``/scim/v2/Users`` is authenticated by a per-organization bearer token (see
``get_scim_principal``), never by a signed-in user, and every read or write is
scoped to ``principal.organization_id`` — a token minted for one tenant
cannot see or modify another tenant's directory (the same tenant-boundary
convention as ``sso_service`` and ``public_api``).

Groups are **not implemented**: there is no ``/scim/v2/Groups`` endpoint and
no role/group sync. Only user lifecycle — create, read, list/filter,
replace, patch ``active``, deactivate — is real.
"""

from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import ScimPrincipal, get_scim_principal, require_org_admin
from app.core.database import get_db
from app.models.user import User
from app.services.scim_service import scim_error, scim_token_service, scim_user_service

router = APIRouter(prefix="/scim/v2", tags=["scim"])
#: Token issuance lives on the ordinary authenticated API, not the SCIM
#: surface itself -- an IdP cannot mint its own credential.
token_router = APIRouter(prefix="/api/organizations/me/scim-token", tags=["scim"])


def _parse_user_name_filter(raw_filter: str | None) -> str | None:
    """Support ``filter=userName eq "value"`` only, as scoped by the task.

    Anything else is rejected as an unsupported filter rather than silently
    ignored, which would otherwise look like "no filter" and return every
    user in the organization.
    """
    if raw_filter is None:
        return None
    parts = raw_filter.strip().split(None, 2)
    if len(parts) != 3 or parts[0].lower() != "username" or parts[1].lower() != "eq":
        raise scim_error(
            f"Unsupported filter: {raw_filter!r}. Only 'userName eq \"value\"' is supported.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    value = parts[2].strip()
    if value.startswith('"') and value.endswith('"') and len(value) >= 2:
        value = value[1:-1]
    return value


@router.get("/Users")
def list_users(
    filter: str | None = Query(default=None),
    startIndex: int = Query(default=1, ge=1),
    count: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
    principal: ScimPrincipal = Depends(get_scim_principal),
) -> dict:
    user_name = _parse_user_name_filter(filter)
    return scim_user_service.list_users(
        db,
        organization_id=principal.organization_id,
        user_name=user_name,
        start_index=startIndex,
        count=count,
    )


@router.get("/Users/{user_id}")
def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    principal: ScimPrincipal = Depends(get_scim_principal),
) -> dict:
    return scim_user_service.get_user(db, organization_id=principal.organization_id, user_id=user_id)


@router.post("/Users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: ScimPrincipal = Depends(get_scim_principal),
) -> dict:
    return scim_user_service.create_user(db, organization_id=principal.organization_id, payload=payload)


@router.put("/Users/{user_id}")
def replace_user(
    user_id: str,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: ScimPrincipal = Depends(get_scim_principal),
) -> dict:
    return scim_user_service.replace_user(
        db, organization_id=principal.organization_id, user_id=user_id, payload=payload
    )


@router.patch("/Users/{user_id}")
def patch_user(
    user_id: str,
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    principal: ScimPrincipal = Depends(get_scim_principal),
) -> dict:
    operations = payload.get("Operations") or payload.get("operations") or []
    return scim_user_service.patch_user(
        db, organization_id=principal.organization_id, user_id=user_id, operations=operations
    )


@router.delete("/Users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: str,
    db: Session = Depends(get_db),
    principal: ScimPrincipal = Depends(get_scim_principal),
) -> None:
    """SCIM DELETE deprovisions in place; the row is never hard-deleted."""
    scim_user_service.deactivate_user(db, organization_id=principal.organization_id, user_id=user_id)


# --- Token management (ordinary session auth, org-admin only) --------------


@token_router.post("", status_code=status.HTTP_201_CREATED)
def create_scim_token(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> dict:
    token, raw = scim_token_service.create(db, organization_id=user.organization_id, created_by_user_id=user.id)
    from app.services.platform_service import record_platform_audit

    record_platform_audit(
        db,
        action="scim_token.created",
        actor=user,
        organization_id=user.organization_id,
        detail="SCIM provisioning token created",
    )
    db.commit()
    return {"id": token.id, "prefix": token.prefix, "secret": raw, "created_at": token.created_at}


@token_router.get("")
def list_scim_tokens(
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> list[dict]:
    return [
        {
            "id": item.id,
            "label": item.label,
            "masked": item.masked,
            "created_at": item.created_at,
            "last_used_at": item.last_used_at,
            "revoked_at": item.revoked_at,
        }
        for item in scim_token_service.list_for_organization(db, organization_id=user.organization_id)
    ]


@token_router.post("/{token_id}/revoke")
def revoke_scim_token(
    token_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> dict:
    from app.models.scim_token import ScimToken

    token = db.get(ScimToken, token_id)
    if not token or token.organization_id != user.organization_id:
        raise scim_error(f"Token {token_id} not found", status_code=status.HTTP_404_NOT_FOUND)
    token = scim_token_service.revoke(db, token=token)
    return {"id": token.id, "revoked_at": token.revoked_at}
