from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.folder import Folder
from app.models.team import Team, TeamMember
from app.models.user import User
from app.schemas.folder import FolderCreate, FolderResponse, FolderTreeResponse, FolderUpdate


class FolderService:
    def get_for_user(self, db: Session, *, folder_id: str, user: User) -> Folder:
        folder = db.get(Folder, folder_id)
        if not folder or folder.organization_id != user.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")
        return folder

    def document_counts(self, db: Session, *, organization_id: str) -> dict[str | None, int]:
        rows = db.execute(
            select(Document.folder_id, func.count(Document.id))
            .where(
                Document.organization_id == organization_id,
                Document.is_template == False,  # noqa: E712
                Document.deleted_at.is_(None),
            )
            .group_by(Document.folder_id)
        ).all()
        return {row[0]: row[1] for row in rows}

    def team_names(self, db: Session, *, organization_id: str) -> dict[str, str]:
        rows = db.scalars(select(Team).where(Team.organization_id == organization_id)).unique()
        return {team.id: team.name for team in rows}

    def to_response(self, folder: Folder, *, counts: dict[str | None, int], team_names: dict[str, str]) -> FolderResponse:
        return FolderResponse(
            id=folder.id,
            organization_id=folder.organization_id,
            name=folder.name,
            parent_id=folder.parent_id,
            team_id=folder.team_id,
            team_name=team_names.get(folder.team_id) if folder.team_id else None,
            scope="team" if folder.team_id else "personal",
            document_count=counts.get(folder.id, 0),
            sort_order=folder.sort_order,
            created_at=folder.created_at,
            updated_at=folder.updated_at,
            children=[],
        )

    def tree(self, db: Session, *, user: User) -> FolderTreeResponse:
        folders = list(
            db.scalars(
                select(Folder)
                .where(Folder.organization_id == user.organization_id)
                .order_by(Folder.sort_order.asc(), Folder.name.asc())
            ).unique()
        )
        counts = self.document_counts(db, organization_id=user.organization_id)
        team_names = self.team_names(db, organization_id=user.organization_id)
        my_team_ids = set(
            db.scalars(select(TeamMember.team_id).where(TeamMember.user_id == user.id)).all()
        )

        # Team folders are visible only to members of that team; personal folders
        # are visible to their creator (legacy rows with no creator stay visible).
        visible: list[Folder] = []
        for folder in folders:
            if folder.team_id:
                if folder.team_id in my_team_ids:
                    visible.append(folder)
            elif folder.created_by_user_id in (None, user.id):
                visible.append(folder)

        nodes = {folder.id: self.to_response(folder, counts=counts, team_names=team_names) for folder in visible}
        roots: list[FolderResponse] = []
        for folder in visible:
            node = nodes[folder.id]
            parent = nodes.get(folder.parent_id) if folder.parent_id else None
            if parent is not None:
                parent.children.append(node)
            else:
                roots.append(node)

        unfiled = counts.get(None, 0)
        return FolderTreeResponse(
            personal=[node for node in roots if node.scope == "personal"],
            team=[node for node in roots if node.scope == "team"],
            unfiled_count=unfiled,
        )

    def flat(self, db: Session, *, user: User) -> list[FolderResponse]:
        tree = self.tree(db, user=user)
        out: list[FolderResponse] = []

        def walk(nodes: list[FolderResponse]) -> None:
            for node in nodes:
                out.append(node)
                walk(node.children)

        walk(tree.personal)
        walk(tree.team)
        return out

    def create(self, db: Session, *, user: User, payload: FolderCreate) -> Folder:
        if payload.parent_id:
            parent = self.get_for_user(db, folder_id=payload.parent_id, user=user)
            if payload.team_id and parent.team_id != payload.team_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A team folder cannot be nested under a folder from another scope",
                )
        if payload.team_id:
            self._ensure_team_member(db, team_id=payload.team_id, user=user)
        folder = Folder(
            organization_id=user.organization_id,
            name=payload.name,
            parent_id=payload.parent_id,
            team_id=payload.team_id,
            created_by_user_id=user.id,
            sort_order=payload.sort_order,
        )
        db.add(folder)
        db.commit()
        db.refresh(folder)
        return folder

    def _ensure_team_member(self, db: Session, *, team_id: str, user: User) -> Team:
        team = db.get(Team, team_id)
        if not team or team.organization_id != user.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found")
        member = db.scalars(
            select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
        ).first()
        if not member:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not a member of this team")
        return team

    def update(self, db: Session, *, folder: Folder, user: User, payload: FolderUpdate) -> Folder:
        data = payload.model_dump(exclude_unset=True)
        if "parent_id" in data:
            new_parent_id = data.pop("parent_id")
            if new_parent_id == folder.id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A folder cannot be its own parent")
            if new_parent_id:
                parent = self.get_for_user(db, folder_id=new_parent_id, user=user)
                if self._is_descendant(db, folder_id=folder.id, candidate=parent):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="A folder cannot be moved inside one of its own descendants",
                    )
            folder.parent_id = new_parent_id
        if "team_id" in data:
            team_id = data.pop("team_id")
            if team_id:
                self._ensure_team_member(db, team_id=team_id, user=user)
            folder.team_id = team_id
        for key, value in data.items():
            if value is not None:
                setattr(folder, key, value)
        db.commit()
        db.refresh(folder)
        return folder

    def _is_descendant(self, db: Session, *, folder_id: str, candidate: Folder) -> bool:
        cursor: Folder | None = candidate
        seen: set[str] = set()
        while cursor is not None and cursor.id not in seen:
            if cursor.id == folder_id:
                return True
            seen.add(cursor.id)
            cursor = db.get(Folder, cursor.parent_id) if cursor.parent_id else None
        return False

    def delete(self, db: Session, *, folder: Folder) -> None:
        # Sub-folders are re-parented and documents survive as unfiled; deleting a
        # folder must never delete work.
        for child in db.scalars(select(Folder).where(Folder.parent_id == folder.id)).unique():
            child.parent_id = folder.parent_id
        for document in db.scalars(select(Document).where(Document.folder_id == folder.id)).unique():
            document.folder_id = None
        db.delete(folder)
        db.commit()

    def move_documents(self, db: Session, *, user: User, document_ids: list[str], folder_id: str | None) -> list[Document]:
        if folder_id:
            self.get_for_user(db, folder_id=folder_id, user=user)
        documents = list(
            db.scalars(
                select(Document).where(
                    Document.organization_id == user.organization_id,
                    Document.id.in_(document_ids),
                )
            ).unique()
        )
        found = {document.id for document in documents}
        missing = [document_id for document_id in document_ids if document_id not in found]
        if missing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Document not found: {missing[0]}")
        for document in documents:
            document.folder_id = folder_id
        db.commit()
        for document in documents:
            db.refresh(document)
        return documents


folder_service = FolderService()
