from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.database import get_db
from app.models.user import User
from app.schemas.api_key import (
    ApiKeyCreate,
    ApiKeyCreated,
    ApiKeyResponse,
    ApiKeyScopeResponse,
    ApiKeyScopesRequest,
    ApiKeyUsageResponse,
    ApiSettingsResponse,
    ApiSettingsUpdate,
)
from app.models.plan import ENTITLEMENT_API_ACCESS
from app.services.api_key_service import api_key_service
from app.services.entitlement_service import EntitlementContext, entitlement_service
from app.services.embed_service import embed_service


router = APIRouter(prefix="/api/api-keys", tags=["api-keys"])
settings_router = APIRouter(prefix="/api/organizations/me/api-settings", tags=["api-keys"])


def _created(api_key, secret: str) -> ApiKeyCreated:
    return ApiKeyCreated(**ApiKeyResponse.model_validate(api_key).model_dump(), secret=secret)


@router.get("/scopes", response_model=list[ApiKeyScopeResponse])
def list_scopes(user: User = Depends(get_current_user)) -> list[dict]:
    return api_key_service.scope_catalogue()


@router.get("/usage", response_model=ApiKeyUsageResponse)
def key_usage(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return api_key_service.usage(db, organization_id=user.organization_id)


@router.get("", response_model=list[ApiKeyResponse])
def list_keys(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[ApiKeyResponse]:
    return [ApiKeyResponse.model_validate(item) for item in api_key_service.list_for_organization(db, organization_id=user.organization_id)]


@router.post("", response_model=ApiKeyCreated, status_code=201)
def create_key(
    payload: ApiKeyCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
    _entitlement: EntitlementContext = Depends(
        entitlement_service.requires(ENTITLEMENT_API_ACCESS)
    ),
) -> ApiKeyCreated:
    """Issue a key. ``api_access`` is a Business-and-above entitlement; it was
    sold but never checked (AUDIT_REPORT.md section 7, finding 2)."""
    api_key, secret = api_key_service.create(db, user=user, label=payload.label, mode=payload.mode, scopes=payload.scopes)
    return _created(api_key, secret)


@router.post("/{key_id}/roll", response_model=ApiKeyCreated)
def roll_key(
    key_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
    _entitlement: EntitlementContext = Depends(
        entitlement_service.requires(ENTITLEMENT_API_ACCESS)
    ),
) -> ApiKeyCreated:
    api_key = api_key_service.get_for_organization(db, key_id=key_id, organization_id=user.organization_id)
    api_key, secret = api_key_service.roll(db, api_key=api_key)
    return _created(api_key, secret)


@router.post("/{key_id}/revoke", response_model=ApiKeyResponse)
def revoke_key(key_id: str, db: Session = Depends(get_db), user: User = Depends(require_org_admin)) -> ApiKeyResponse:
    api_key = api_key_service.get_for_organization(db, key_id=key_id, organization_id=user.organization_id)
    return ApiKeyResponse.model_validate(api_key_service.revoke(db, api_key=api_key))


@router.post("/{key_id}/restore", response_model=ApiKeyResponse)
def restore_key(key_id: str, db: Session = Depends(get_db), user: User = Depends(require_org_admin)) -> ApiKeyResponse:
    api_key = api_key_service.get_for_organization(db, key_id=key_id, organization_id=user.organization_id)
    return ApiKeyResponse.model_validate(api_key_service.restore(db, api_key=api_key))


@router.patch("/{key_id}/scopes", response_model=ApiKeyResponse)
def replace_scopes(
    key_id: str,
    payload: ApiKeyScopesRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> ApiKeyResponse:
    api_key = api_key_service.get_for_organization(db, key_id=key_id, organization_id=user.organization_id)
    return ApiKeyResponse.model_validate(api_key_service.set_scopes(db, api_key=api_key, scopes=payload.scopes))


@router.post("/{key_id}/scopes/grant", response_model=ApiKeyResponse)
def grant_scopes(
    key_id: str,
    payload: ApiKeyScopesRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> ApiKeyResponse:
    api_key = api_key_service.get_for_organization(db, key_id=key_id, organization_id=user.organization_id)
    return ApiKeyResponse.model_validate(api_key_service.grant_scopes(db, api_key=api_key, scopes=payload.scopes))


@router.post("/{key_id}/scopes/revoke", response_model=ApiKeyResponse)
def revoke_scopes(
    key_id: str,
    payload: ApiKeyScopesRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> ApiKeyResponse:
    api_key = api_key_service.get_for_organization(db, key_id=key_id, organization_id=user.organization_id)
    return ApiKeyResponse.model_validate(api_key_service.revoke_scopes(db, api_key=api_key, scopes=payload.scopes))


@router.get("/{key_id}", response_model=ApiKeyResponse)
def get_key(key_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ApiKeyResponse:
    return ApiKeyResponse.model_validate(api_key_service.get_for_organization(db, key_id=key_id, organization_id=user.organization_id))


@settings_router.get("", response_model=ApiSettingsResponse)
def get_api_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict:
    return embed_service.get_settings_payload(db, organization_id=user.organization_id)


@settings_router.patch("", response_model=ApiSettingsResponse)
def update_api_settings(
    payload: ApiSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> dict:
    return embed_service.update_settings(db, organization_id=user.organization_id, payload=payload)
