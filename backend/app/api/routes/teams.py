"""Teams CRUD and membership (ORG-8).

Reads are open to any member of the tenant -- the folder sidebar and the
recipient picker both need the team list. Writes are org-admin only.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.database import get_db
from app.models.user import User
from app.schemas.team import TeamCreate, TeamMemberAdd, TeamResponse, TeamUpdate
from app.services.team_service import team_service


router = APIRouter(prefix="/api/teams", tags=["teams"])


@router.get("", response_model=list[TeamResponse])
def list_teams(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[TeamResponse]:
    """Every team in the caller's organization, with the caller's own role."""
    return team_service.list_for_user(db, user=user)


@router.post("", response_model=TeamResponse, status_code=201)
def create_team(
    payload: TeamCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> TeamResponse:
    team = team_service.create(db, user=user, payload=payload)
    return team_service.detail(db, team=team, user=user)


@router.get("/{team_id}", response_model=TeamResponse)
def get_team(
    team_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> TeamResponse:
    team = team_service.get_for_user(db, team_id=team_id, user=user)
    return team_service.detail(db, team=team, user=user)


@router.patch("/{team_id}", response_model=TeamResponse)
def rename_team(
    team_id: str,
    payload: TeamUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> TeamResponse:
    team = team_service.get_for_user(db, team_id=team_id, user=user)
    team = team_service.update(db, team=team, user=user, payload=payload)
    return team_service.detail(db, team=team, user=user)


@router.delete("/{team_id}", status_code=204)
def delete_team(
    team_id: str, db: Session = Depends(get_db), user: User = Depends(require_org_admin)
) -> None:
    """Folders shared with the team become unshared; no document is deleted."""
    team = team_service.get_for_user(db, team_id=team_id, user=user)
    team_service.delete(db, team=team)


@router.post("/{team_id}/members", response_model=TeamResponse, status_code=201)
def add_team_member(
    team_id: str,
    payload: TeamMemberAdd,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> TeamResponse:
    """Idempotent: adding an existing member updates their role."""
    team = team_service.get_for_user(db, team_id=team_id, user=user)
    return team_service.add_member(db, team=team, user=user, user_id=payload.user_id, role=payload.role)


@router.delete("/{team_id}/members/{user_id}", status_code=204)
def remove_team_member(
    team_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> None:
    team = team_service.get_for_user(db, team_id=team_id, user=user)
    team_service.remove_member(db, team=team, user_id=user_id)
