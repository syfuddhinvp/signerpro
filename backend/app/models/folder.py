from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Folder(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "folders"
    __table_args__ = (
        Index("ix_folders_organization_id", "organization_id"),
        # folder_service walks the tree one level at a time; without this every
        # level of a nested hierarchy is a sequential scan.
        Index("ix_folders_parent_id", "parent_id"),
        # team_service.delete_team reassigns folders by team.
        Index("ix_folders_team_id", "team_id"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), nullable=True)
    team_id: Mapped[str | None] = mapped_column(ForeignKey("teams.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
