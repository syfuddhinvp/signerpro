"""Account-level preferences (SIGN-3, PREF-1…PREF-4).

Paths follow INTEGRATION_PLAN.md: ``/api/me/*`` for per-user settings and
``/api/integrations/*`` for the organization's connected apps.
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.database import get_db
from app.models.user import User
from app.schemas.account import (
    AccountAuditFeed,
    AvatarUpdate,
    AuthorizeResponse,
    CloudExportItem,
    CloudTargetItem,
    CloudTargetsUpdate,
    FieldFavoritesResponse,
    FieldFavoritesUpdate,
    IntegrationResponse,
    OAuthCallbackRequest,
    NotificationPreferenceResponse,
    NotificationPreferencesUpdate,
    SavedSignatureCreate,
    SavedSignatureResponse,
)
from app.schemas.auth import CurrentUserResponse, ProfileUpdateRequest
from app.services.account_service import account_service
from app.services.auth_service import auth_service
from app.services.cloud_export_service import cloud_export_service
from app.services.cloud_integration_service import cloud_integration_service


router = APIRouter(tags=["account"])


# --- profile (PREF-1) --------------------------------------------------------


@router.get("/api/me", response_model=CurrentUserResponse)
def read_me(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> CurrentUserResponse:
    return auth_service.current_user_payload(db, user)


@router.patch("/api/me", response_model=CurrentUserResponse)
def update_me(
    payload: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CurrentUserResponse:
    return auth_service.update_profile(db, user=user, payload=payload)


@router.put("/api/me/avatar", response_model=CurrentUserResponse)
def upload_avatar(
    payload: AvatarUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CurrentUserResponse:
    account_service.set_avatar(db, user=user, image_base64=payload.image_base64)
    return auth_service.current_user_payload(db, user)


@router.delete("/api/me/avatar", response_model=CurrentUserResponse)
def delete_avatar(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> CurrentUserResponse:
    account_service.clear_avatar(db, user=user)
    return auth_service.current_user_payload(db, user)


@router.get("/api/me/avatar")
def read_avatar_image(user: User = Depends(get_current_user)) -> StreamingResponse:
    """Stream the signed-in user's uploaded photo (see `read_signature_image`)."""
    stream, media_type = account_service.open_avatar_image(user=user)
    return StreamingResponse(
        stream,
        media_type=media_type,
        headers={"Cache-Control": "private, max-age=300"},
    )


# --- saved signatures (SIGN-3) ----------------------------------------------


@router.get("/api/me/signatures", response_model=list[SavedSignatureResponse])
def list_signatures(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[SavedSignatureResponse]:
    return account_service.list_signatures(db, user=user)


@router.post("/api/me/signatures", response_model=SavedSignatureResponse, status_code=201)
def create_signature(
    payload: SavedSignatureCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SavedSignatureResponse:
    return account_service.create_signature(db, user=user, payload=payload)


@router.get("/api/me/signatures/{signature_id}/image")
def read_signature_image(
    signature_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Stream a drawn or uploaded signature's image.

    Served through the API rather than as a presigned object URL: a signature
    image is the visual form of someone's name, and a presigned URL is a
    bearer credential that works for anyone who gets hold of it. This route
    checks ownership on every request and works the same on either storage
    backend.
    """
    stream, media_type = account_service.open_signature_image(db, user=user, signature_id=signature_id)
    return StreamingResponse(
        stream,
        media_type=media_type,
        # Private: a shared cache must never hand one account's signature to
        # another. Revalidating keeps a re-adopted signature from sticking.
        headers={"Cache-Control": "private, no-cache"},
    )


@router.post("/api/me/signatures/{signature_id}/default", response_model=list[SavedSignatureResponse])
def set_default_signature(
    signature_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[SavedSignatureResponse]:
    return account_service.set_default_signature(db, user=user, signature_id=signature_id)


@router.delete("/api/me/signatures/{signature_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_signature(
    signature_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    account_service.delete_signature(db, user=user, signature_id=signature_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- notification preferences (PREF-2) --------------------------------------


@router.get("/api/me/notification-preferences", response_model=list[NotificationPreferenceResponse])
def read_notification_preferences(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[NotificationPreferenceResponse]:
    return account_service.list_notification_preferences(db, user=user)


@router.put("/api/me/notification-preferences", response_model=list[NotificationPreferenceResponse])
def update_notification_preferences(
    payload: NotificationPreferencesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[NotificationPreferenceResponse]:
    return account_service.update_notification_preferences(db, user=user, payload=payload)


# --- builder palette favourites ---------------------------------------------


@router.get("/api/me/field-favorites", response_model=FieldFavoritesResponse)
def read_field_favorites(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> FieldFavoritesResponse:
    return account_service.list_field_favorites(db, user=user)


@router.put("/api/me/field-favorites", response_model=FieldFavoritesResponse)
def write_field_favorites(
    payload: FieldFavoritesUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FieldFavoritesResponse:
    return account_service.update_field_favorites(db, user=user, payload=payload)


# --- account audit trail -----------------------------------------------------


@router.get("/api/me/audit-trail", response_model=AccountAuditFeed)
def account_audit_trail(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=200),
    event_type: str | None = Query(default=None, max_length=80),
    actor: str | None = Query(default=None, max_length=320),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    sort_by: str = Query(default="time", pattern="^(time|action|document|actor)$"),
    sort_dir: str = Query(default="desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AccountAuditFeed:
    return account_service.audit_feed(
        db,
        user=user,
        limit=limit,
        offset=offset,
        search=search,
        event_type=event_type,
        actor=actor,
        date_from=date_from,
        date_to=date_to,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )


# --- integrations (PREF-3) ---------------------------------------------------


@router.get("/api/integrations", response_model=list[IntegrationResponse])
def list_integrations(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[IntegrationResponse]:
    return account_service.list_integrations(db, user=user)


@router.get("/api/integrations/cloud-targets", response_model=list[CloudTargetItem])
def list_cloud_targets(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[CloudTargetItem]:
    return account_service.list_cloud_targets(db, user=user)


@router.put("/api/integrations/cloud-targets", response_model=list[CloudTargetItem])
def update_cloud_targets(
    payload: CloudTargetsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> list[CloudTargetItem]:
    return account_service.update_cloud_targets(db, user=user, payload=payload)


@router.get("/api/integrations/exports", response_model=list[CloudExportItem])
def list_cloud_exports(
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[CloudExportItem]:
    return cloud_export_service.list_exports(db, organization_id=user.organization_id, limit=limit)


@router.post("/api/integrations/exports/{export_id}/retry", response_model=CloudExportItem)
def retry_cloud_export(
    export_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> CloudExportItem:
    return cloud_export_service.retry_export(
        db, organization_id=user.organization_id, export_id=export_id
    )


@router.post("/api/integrations/{provider}/authorize", response_model=AuthorizeResponse)
def authorize_integration(
    provider: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> AuthorizeResponse:
    """Start the OAuth dance: where to send the browser, and the signed state.

    Nothing is written yet -- the integration row only exists once the tenant
    actually comes back from the provider's consent screen.
    """
    return cloud_integration_service.begin_authorization(db, user=user, provider=provider)


@router.post("/api/integrations/{provider}/callback", response_model=IntegrationResponse)
def integration_oauth_callback(
    provider: str,
    payload: OAuthCallbackRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> IntegrationResponse:
    """Finish the dance: verify the state, exchange the code, store the grant."""
    return cloud_integration_service.complete_authorization(
        db, user=user, provider=provider, payload=payload
    )


@router.delete("/api/integrations/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_integration(
    provider: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> Response:
    account_service.disconnect_integration(db, user=user, provider=provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
