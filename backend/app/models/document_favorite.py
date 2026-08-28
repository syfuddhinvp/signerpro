from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class DocumentFavorite(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "document_favorites"
    __table_args__ = (Index("uq_document_favorites", "user_id", "document_id", unique=True),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
