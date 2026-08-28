from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class PlatformAuditEntry(Base, UUIDPrimaryKeyMixin):
    """Administrative audit trail (ACT-3).

    ``audit_logs`` requires a document_id, so platform-level actions (flag
    flips, impersonation, suspensions, key rotation, SCIM) live here.
    """

    __tablename__ = "platform_audit_entries"
    __table_args__ = (
        Index("ix_platform_audit_entries_created_at", "created_at"),
        Index("ix_platform_audit_entries_organization_id", "organization_id"),
    )

    action: Mapped[str] = mapped_column(String(80), nullable=False)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), nullable=True)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    entry_metadata: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
