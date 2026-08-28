"""Account-level preferences (SIGN-3, PREF-1…PREF-4).

Paths follow INTEGRATION_PLAN.md: ``/api/me/*`` for per-user settings and
``/api/integrations/*`` for the organization's connected apps.
"""

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.database import get_db
from app.models.user import User
from app.schemas.account import (
    AccountAuditFeed,
    CloudTargetItem,
    CloudTargetsUpdate,
    IntegrationConnectRequest,
    IntegrationResponse,
    NotificationPreferenceResponse,
    NotificationPreferencesUpdate,
    SavedSignatureCreate,
    SavedSignatureResponse,
)
from app.schemas.auth import CurrentUserResponse, ProfileUpdateRequest
from app.services.account_service import account_service
from app.services.auth_service import auth_service


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


# --- account audit trail -----------------------------------------------------


@router.get("/api/me/audit-trail", response_model=AccountAuditFeed)
def account_audit_trail(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> AccountAuditFeed:
    return account_service.audit_feed(db, user=user, limit=limit, offset=offset)


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


@router.post("/api/integrations/{provider}/connect", response_model=IntegrationResponse)
def connect_integration(
    provider: str,
    payload: IntegrationConnectRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> IntegrationResponse:
    return account_service.connect_integration(db, user=user, provider=provider, payload=payload)


@router.delete("/api/integrations/{provider}", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_integration(
    provider: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> Response:
    account_service.disconnect_integration(db, user=user, provider=provider)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
