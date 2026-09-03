from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class SigningToken(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "signing_tokens"
    __table_args__ = (
        Index("ix_signing_tokens_token_hash", "token_hash", unique=True),
        Index("ix_signing_tokens_document_id", "document_id"),
        Index("ix_signing_tokens_recipient_id", "recipient_id"),
    )

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    document: Mapped["Document"] = relationship(back_populates="signing_tokens")
    recipient: Mapped["Recipient"] = relationship(back_populates="signing_tokens")

