from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.schemas.folder import (
    FolderCreate,
    FolderMoveRequest,
    FolderResponse,
    FolderTreeResponse,
    FolderUpdate,
)
from app.services.folder_service import folder_service


router = APIRouter(prefix="/api/folders", tags=["folders"])


@router.get("", response_model=list[FolderResponse])
def list_folders(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[FolderResponse]:
    """Flat list of every folder visible to the caller, with document counts."""
    return folder_service.flat(db, user=user)


@router.get("/tree", response_model=FolderTreeResponse)
def folder_tree(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> FolderTreeResponse:
    return folder_service.tree(db, user=user)


@router.post("", response_model=FolderResponse, status_code=201)
def create_folder(
    payload: FolderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FolderResponse:
    folder = folder_service.create(db, user=user, payload=payload)
    return folder_service.to_response(
        folder,
        counts=folder_service.document_counts(db, organization_id=user.organization_id),
        team_names=folder_service.team_names(db, organization_id=user.organization_id),
    )


@router.patch("/{folder_id}", response_model=FolderResponse)
def update_folder(
    folder_id: str,
    payload: FolderUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> FolderResponse:
    folder = folder_service.get_for_user(db, folder_id=folder_id, user=user)
    folder = folder_service.update(db, folder=folder, user=user, payload=payload)
    return folder_service.to_response(
        folder,
        counts=folder_service.document_counts(db, organization_id=user.organization_id),
        team_names=folder_service.team_names(db, organization_id=user.organization_id),
    )


@router.delete("/{folder_id}", status_code=204)
def delete_folder(folder_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    """Documents survive folder deletion; they fall back to unfiled."""
    folder = folder_service.get_for_user(db, folder_id=folder_id, user=user)
    folder_service.delete(db, folder=folder)


@router.post("/move", response_model=list[str])
def move_documents(
    payload: FolderMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[str]:
    documents = folder_service.move_documents(
        db, user=user, document_ids=payload.document_ids, folder_id=payload.folder_id
    )
    return [document.id for document in documents]
