from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class FieldAttachment(Base, UUIDPrimaryKeyMixin):
    """A file uploaded by a signer against an ``attachment`` field.

    Wave 1 stashed this metadata under a reserved ``"attachment"`` key inside
    ``fields.options`` because it could not add a migration. ``options`` is
    authoring configuration; stored-file metadata is evidence, and it belongs
    in its own table where it can be queried, joined and (unlike a JSON blob)
    constrained.
    """

    __tablename__ = "field_attachments"
    __table_args__ = (
        Index("ix_field_attachments_field_id", "field_id"),
        Index("ix_field_attachments_document_id", "document_id"),
        # ON DELETE SET NULL when a recipient is removed with the document.
        Index("ix_field_attachments_recipient_id", "recipient_id"),
        Index("ix_field_attachments_sha256", "sha256"),
    )

    field_id: Mapped[str] = mapped_column(ForeignKey("fields.id", ondelete="CASCADE"), nullable=False)
    #: Denormalized so a document's attachments can be listed without a join.
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    recipient_id: Mapped[str | None] = mapped_column(
        ForeignKey("recipients.id", ondelete="SET NULL"), nullable=True
    )
    #: Storage key, relative to the storage root — never an absolute path.
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    #: Original client filename, already reduced to a basename by the caller.
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
