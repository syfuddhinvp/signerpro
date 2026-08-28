"""Teams: the tenant's sharing boundary (ORG-8).

Visibility rule, shared with ``folder_service``: a team folder -- and every
document filed in it -- is visible to that team's members only. Deleting a team
therefore must not delete work, so it unshares its folders (``team_id = NULL``)
instead of cascading.

Membership is readable by any member of the tenant (the picker needs it);
mutation is org-admin only.
"""

from __future__ import annotations

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.folder import Folder
from app.models.team import Team, TeamMember
from app.models.user import User
from app.schemas.team import TeamCreate, TeamMemberRow, TeamResponse, TeamUpdate


class TeamService:
    # ----------------------------------------------------------------- lookup
    def get_for_user(self, db: Session, *, team_id: str, user: User) -> Team:
        team = db.get(Team, team_id)
        if not team or team.organization_id != user.organization_id:
            # Cross-tenant ids read as absent, never as forbidden.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
        return team

    def _members(self, db: Session, team_ids: list[str]) -> dict[str, list[tuple[TeamMember, User]]]:
        if not team_ids:
            return {}
        rows = db.execute(
            select(TeamMember, User)
            .join(User, User.id == TeamMember.user_id)
            .where(TeamMember.team_id.in_(team_ids))
            .order_by(User.name)
        ).all()
        out: dict[str, list[tuple[TeamMember, User]]] = {team_id: [] for team_id in team_ids}
        for member, member_user in rows:
            out.setdefault(member.team_id, []).append((member, member_user))
        return out

    def _document_counts(self, db: Session, team_ids: list[str], *, is_template: bool) -> dict[str, int]:
        """Documents filed in each team's folders."""
        if not team_ids:
            return {}
        rows = db.execute(
            select(Folder.team_id, func.count(Document.id))
            .join(Document, Document.folder_id == Folder.id)
            .where(
                Folder.team_id.in_(team_ids),
                Document.is_template.is_(is_template),
                Document.deleted_at.is_(None),
            )
            .group_by(Folder.team_id)
        ).all()
        return {row[0]: row[1] for row in rows}

    def to_response(
        self,
        team: Team,
        *,
        members: list[tuple[TeamMember, User]],
        document_count: int,
        template_count: int,
        user: User,
    ) -> TeamResponse:
        my_role = next((member.role for member, member_user in members if member_user.id == user.id), None)
        return TeamResponse(
            id=team.id,
            organization_id=team.organization_id,
            name=team.name,
            description=team.description,
            member_count=len(members),
            document_count=document_count,
            template_count=template_count,
            my_role=my_role,
            members=[
                TeamMemberRow(
                    user_id=member_user.id,
                    name=member_user.name,
                    email=member_user.email,
                    role=member.role,
                )
                for member, member_user in members
            ],
        )

    def list_for_user(self, db: Session, *, user: User) -> list[TeamResponse]:
        teams = list(
            db.scalars(
                select(Team).where(Team.organization_id == user.organization_id).order_by(Team.name)
            ).unique()
        )
        team_ids = [team.id for team in teams]
        members = self._members(db, team_ids)
        documents = self._document_counts(db, team_ids, is_template=False)
        templates = self._document_counts(db, team_ids, is_template=True)
        return [
            self.to_response(
                team,
                members=members.get(team.id, []),
                document_count=documents.get(team.id, 0),
                template_count=templates.get(team.id, 0),
                user=user,
            )
            for team in teams
        ]

    def detail(self, db: Session, *, team: Team, user: User) -> TeamResponse:
        members = self._members(db, [team.id]).get(team.id, [])
        return self.to_response(
            team,
            members=members,
            document_count=self._document_counts(db, [team.id], is_template=False).get(team.id, 0),
            template_count=self._document_counts(db, [team.id], is_template=True).get(team.id, 0),
            user=user,
        )

    # ----------------------------------------------------------------- writes
    def _ensure_name_free(self, db: Session, *, organization_id: str, name: str, exclude_id: str | None = None) -> None:
        query = select(func.count()).select_from(Team).where(
            Team.organization_id == organization_id, func.lower(Team.name) == name.lower()
        )
        if exclude_id:
            query = query.where(Team.id != exclude_id)
        if db.scalar(query):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="A team with that name already exists"
            )

    def create(self, db: Session, *, user: User, payload: TeamCreate) -> Team:
        self._ensure_name_free(db, organization_id=user.organization_id, name=payload.name)
        team = Team(
            organization_id=user.organization_id,
            name=payload.name,
            description=payload.description,
        )
        db.add(team)
        db.flush()
        # The creating admin joins as lead, so a new team is never orphaned and
        # its folders are reachable immediately.
        db.add(TeamMember(team_id=team.id, user_id=user.id, role="lead"))
        db.commit()
        db.refresh(team)
        return team

    def update(self, db: Session, *, team: Team, user: User, payload: TeamUpdate) -> Team:
        data = payload.model_dump(exclude_unset=True)
        if "name" in data and data["name"]:
            self._ensure_name_free(
                db, organization_id=team.organization_id, name=data["name"], exclude_id=team.id
            )
            team.name = data["name"]
        if "description" in data:
            team.description = data["description"]
        db.commit()
        db.refresh(team)
        return team

    def delete(self, db: Session, *, team: Team) -> None:
        # Folders survive as personal folders of their creator; documents are
        # untouched. Deleting a team must never delete work.
        for folder in db.scalars(select(Folder).where(Folder.team_id == team.id)).unique():
            folder.team_id = None
        for member in db.scalars(select(TeamMember).where(TeamMember.team_id == team.id)).unique():
            db.delete(member)
        db.delete(team)
        db.commit()

    def add_member(self, db: Session, *, team: Team, user: User, user_id: str, role: str) -> TeamResponse:
        member_user = db.get(User, user_id)
        if not member_user or member_user.organization_id != team.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        existing = db.scalar(
            select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user_id)
        )
        if existing:
            existing.role = role
        else:
            db.add(TeamMember(team_id=team.id, user_id=user_id, role=role))
        db.commit()
        # ``my_role`` is always the *caller's* role, not the added member's.
        return self.detail(db, team=team, user=user)

    def remove_member(self, db: Session, *, team: Team, user_id: str) -> None:
        member = db.scalar(
            select(TeamMember).where(TeamMember.team_id == team.id, TeamMember.user_id == user_id)
        )
        if not member:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member not found")
        db.delete(member)
        db.commit()


team_service = TeamService()
