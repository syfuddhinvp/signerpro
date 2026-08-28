from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class ImpersonationSession(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "impersonation_sessions"
    __table_args__ = (
        Index("ix_impersonation_sessions_token_hash", "token_hash", unique=True),
        Index("ix_impersonation_sessions_organization_id", "organization_id"),
    )

    admin_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    justification: Mapped[str] = mapped_column(String(255), nullable=False)
    scopes: Mapped[list | None] = mapped_column(JSON, nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
