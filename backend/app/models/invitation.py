from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import UserRole
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Invitation(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "invitations"
    __table_args__ = (
        Index("ix_invitations_token_hash", "token_hash", unique=True),
        Index("ix_invitations_organization_id", "organization_id"),
        Index("ix_invitations_email", "email"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False, default=UserRole.sender)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    invited_by_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    organization: Mapped["Organization"] = relationship()
    invited_by: Mapped["User"] = relationship(back_populates="sent_invitations")
