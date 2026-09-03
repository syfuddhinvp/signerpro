from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class DocumentFavorite(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "document_favorites"
    __table_args__ = (
        Index("uq_document_favorites", "user_id", "document_id", unique=True),
        # ON DELETE CASCADE when a document is purged; document_id is not the
        # leading column of the unique index above.
        Index("ix_document_favorites_document_id", "document_id"),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
