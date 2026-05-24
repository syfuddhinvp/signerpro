from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.field import FieldCreate, FieldResponse, FieldUpdate
from app.services.document_service import document_service
from app.services.field_service import field_service


router = APIRouter(prefix="/api/documents/{document_id}/fields", tags=["fields"])


@router.post("", response_model=FieldResponse, status_code=201)
def create_field(
    document_id: str,
    payload: FieldCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FieldResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return field_service.create(db, document=document, user=user, payload=payload)


@router.get("", response_model=list[FieldResponse])
def list_fields(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[FieldResponse]:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document.fields


@router.patch("/{field_id}", response_model=FieldResponse)
def update_field(
    document_id: str,
    field_id: str,
    payload: FieldUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FieldResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return field_service.update(db, document=document, user=user, field_id=field_id, payload=payload)


@router.delete("/{field_id}", status_code=204)
def delete_field(document_id: str, field_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    field_service.delete(db, document=document, user=user, field_id=field_id)

