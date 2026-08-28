from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class EmbedSession(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "embed_sessions"
    __table_args__ = (
        Index("ix_embed_sessions_token_hash", "token_hash", unique=True),
        Index("ix_embed_sessions_organization_id", "organization_id"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    document_id: Mapped[str | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    # builder | routing | signing
    landing: Mapped[str] = mapped_column(String(20), nullable=False, default="builder", server_default="builder")
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    return_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    allowed_origins: Mapped[list | None] = mapped_column(JSON, nullable=True)
    contact_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
