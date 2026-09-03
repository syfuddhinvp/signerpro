from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin, now_utc


class SavedSignature(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A reusable adopted signature (SIGN-3), owned by a user or an email."""

    __tablename__ = "saved_signatures"
    __table_args__ = (
        Index("ix_saved_signatures_user_id", "user_id"),
        Index("ix_saved_signatures_recipient_email", "recipient_email"),
    )

    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    recipient_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # drawn | typed | uploaded
    signature_type: Mapped[str] = mapped_column(String(20), nullable=False, default="drawn", server_default="drawn")
    signature_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    type_face: Mapped[str | None] = mapped_column(String(60), nullable=True)
    image_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_passkey_bound: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    adopted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
