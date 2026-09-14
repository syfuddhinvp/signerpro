"""Branding theme CRUD (ORG-7).

Reads are open to any member -- the workflow screen's theme picker needs the
list, and a sender who cannot administer the tenant still chooses between its
brands. Writes are org-admin only, like every other tenant-wide setting.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api import deps
from app.core.database import get_db
from app.models.branding_theme import BrandingTheme
from app.models.user import User
from app.schemas.branding import (
    BrandingLogoUpload,
    BrandingThemeCreate,
    BrandingThemeResponse,
    BrandingThemeUpdate,
)
from app.services.branding_service import branding_service
from app.services.organization_service import organization_service


router = APIRouter(prefix="/api/branding-themes", tags=["branding"])

#: The logo is served to recipients' mail clients, which carry no session, so
#: it hangs off a router with no auth dependency rather than `router`.
public_router = APIRouter(prefix="/api/branding-themes", tags=["branding"])


@router.get("", response_model=list[BrandingThemeResponse])
def list_branding_themes(
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
) -> list[BrandingThemeResponse]:
    """The tenant's themes, default first.

    On the first call for a tenant that branded itself before themes existed,
    its accent colour and logo are carried over into a "Default" theme rather
    than being silently dropped.
    """
    themes = branding_service.list_for_org(db, organization_id=current_user.organization_id)
    if not themes:
        org = organization_service.get(db, organization_id=current_user.organization_id)
        if branding_service.seed_from_organization(db, organization=org):
            themes = branding_service.list_for_org(db, organization_id=current_user.organization_id)
    return themes


@router.post("", response_model=BrandingThemeResponse, status_code=status.HTTP_201_CREATED)
def create_branding_theme(
    payload: BrandingThemeCreate,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> BrandingThemeResponse:
    theme = branding_service.create(
        db, organization_id=current_user.organization_id, payload=payload
    )
    return branding_service.response(theme)


@router.put("/{theme_id}/logo", response_model=BrandingThemeResponse)
def upload_branding_logo(
    theme_id: str,
    payload: BrandingLogoUpload,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> BrandingThemeResponse:
    """Store a logo for this theme, replacing any previous one."""
    theme = branding_service.get_for_org(
        db, theme_id=theme_id, organization_id=current_user.organization_id
    )
    return branding_service.response(branding_service.set_logo(db, theme=theme, image_base64=payload.image_base64))


@router.delete("/{theme_id}/logo", response_model=BrandingThemeResponse)
def delete_branding_logo(
    theme_id: str,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> BrandingThemeResponse:
    theme = branding_service.get_for_org(
        db, theme_id=theme_id, organization_id=current_user.organization_id
    )
    return branding_service.response(branding_service.clear_logo(db, theme=theme))


@public_router.get("/{theme_id}/logo")
def read_branding_logo(theme_id: str, db: Session = Depends(get_db)) -> StreamingResponse:
    """The uploaded logo, to anyone who asks.

    Deliberately unauthenticated: this URL goes into invitation emails, and a
    recipient's mail client has no session. A theme id is not a secret and the
    logo is already being mailed to third parties, so the only thing served
    here is an image the tenant chose to publish. Nothing else about the theme
    -- name, wording, envelope counts -- is reachable through it.
    """
    theme = db.get(BrandingTheme, theme_id)
    if theme is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo")
    stream, media_type = branding_service.open_logo(theme)
    return StreamingResponse(
        stream,
        media_type=media_type,
        # Long, because the URL is cache-busted on every change.
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/{theme_id}", response_model=BrandingThemeResponse)
def get_branding_theme(
    theme_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
) -> BrandingThemeResponse:
    theme = branding_service.get_for_org(
        db, theme_id=theme_id, organization_id=current_user.organization_id
    )
    return branding_service.response(theme)


@router.patch("/{theme_id}", response_model=BrandingThemeResponse)
def update_branding_theme(
    theme_id: str,
    payload: BrandingThemeUpdate,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> BrandingThemeResponse:
    theme = branding_service.get_for_org(
        db, theme_id=theme_id, organization_id=current_user.organization_id
    )
    return branding_service.response(branding_service.update(db, theme=theme, payload=payload))


@router.delete("/{theme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_branding_theme(
    theme_id: str,
    current_user: User = Depends(deps.require_org_admin),
    db: Session = Depends(get_db),
) -> Response:
    theme = branding_service.get_for_org(
        db, theme_id=theme_id, organization_id=current_user.organization_id
    )
    branding_service.delete(db, theme=theme)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
