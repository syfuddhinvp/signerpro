from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class AuditLog(Base, UUIDPrimaryKeyMixin):
    """An append-only, hash-chained evidentiary record.

    **Retention:** audit rows deliberately outlive the documents they describe.
    ESIGN/UETA and eIDAS require the evidentiary record to be retained
    independently of the signed artefact, so ``document_id`` is a *nullable*
    FK that is cleared when a document is purged, while ``document_ref``,
    ``document_title`` and ``organization_id`` are denormalized copies taken at
    append time that keep the orphaned trail identifiable and queryable.
    Rows must never be updated or deleted; doing so breaks the hash chain by
    design (see ``audit_service.verify_chain``).
    """

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_document_id", "document_id"),
        Index("ix_audit_logs_document_ref", "document_ref"),
        Index("ix_audit_logs_recipient_id", "recipient_id"),
        Index("ix_audit_logs_user_id", "user_id"),
    )

    # Nullable on purpose: nulled on purge so the row survives the document.
    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    #: Immutable document identity; never cleared, and what the chain is keyed on.
    document_ref: Mapped[str | None] = mapped_column(String(36), nullable=True)
    #: Denormalized so a purged document's trail is still human-readable.
    document_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    recipient_id: Mapped[str | None] = mapped_column(ForeignKey("recipients.id", ondelete="SET NULL"), nullable=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    #: Immutable copies of the FK values above. The FK columns are nulled by the
    #: ORM when the referenced row is deleted (purging a document deletes its
    #: recipients), which would otherwise silently rewrite hashed content; the
    #: chain therefore commits to these ``*_ref`` columns, never to the FKs.
    recipient_ref: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_ref: Mapped[str | None] = mapped_column(String(36), nullable=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    event_message: Mapped[str] = mapped_column(Text, nullable=False)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    log_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    # ---- persisted hash chain (SIGN-2 / C6) ------------------------------
    #: Zero-based position within this document's chain. A gap proves deletion.
    sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: SHA-256 over this row's canonical form *and* ``previous_checksum``.
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    #: The predecessor's ``checksum``; genesis for the first entry.
    previous_checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)

    document: Mapped["Document"] = relationship(back_populates="audit_logs")
    recipient: Mapped["Recipient"] = relationship(back_populates="audit_logs")
    user: Mapped["User"] = relationship(back_populates="audit_logs")
