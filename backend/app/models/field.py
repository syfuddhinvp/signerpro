from decimal import Decimal

from sqlalchemy import Boolean, Enum, ForeignKey, Index, Integer, JSON, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.enums import FieldType
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Field(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "fields"
    __table_args__ = (
        Index("ix_fields_document_id", "document_id"),
        Index("ix_fields_recipient_id", "recipient_id"),
    )

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id"), nullable=False)
    recipient_id: Mapped[str] = mapped_column(ForeignKey("recipients.id"), nullable=False)
    type: Mapped[FieldType] = mapped_column(Enum(FieldType), nullable=False)
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    required: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    x: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    y: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    width: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    height: Mapped[Decimal] = mapped_column(Numeric(12, 4), nullable=False)
    placeholder: Mapped[str | None] = mapped_column(String(255), nullable=True)
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    options: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    document: Mapped["Document"] = relationship(back_populates="fields")
    recipient: Mapped["Recipient"] = relationship(back_populates="fields")
    signatures: Mapped[list["Signature"]] = relationship(back_populates="field", cascade="all, delete-orphan")

