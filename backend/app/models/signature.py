from sqlalchemy import Enum, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import SignatureType
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc
from sqlalchemy import DateTime
from datetime import datetime


class Signature(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "signatures"
    __table_args__ = (
        Index("ix_signatures_document_id", "document_id"),
        Index("ix_signatures_recipient_id", "recipient_id"),
        Index("ix_signatures_field_id", "field_id"),
    )

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("recipients.id", ondelete="CASCADE"), nullable=False)
    field_id: Mapped[str] = mapped_column(ForeignKey("fields.id", ondelete="CASCADE"), nullable=False)
    signature_type: Mapped[SignatureType] = mapped_column(Enum(SignatureType), nullable=False)
    signature_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    signature_image_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    document: Mapped["Document"] = relationship(back_populates="signatures")
    recipient: Mapped["Recipient"] = relationship(back_populates="signatures")
    field: Mapped["Field"] = relationship(back_populates="signatures")

