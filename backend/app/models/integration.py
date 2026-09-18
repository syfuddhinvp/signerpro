from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import EncryptedString
from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Integration(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A connected third-party app (PREF-3)."""

    __tablename__ = "integrations"
    __table_args__ = (Index("uq_integrations_org_provider", "organization_id", "provider", unique=True),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credentials: Mapped[str | None] = mapped_column(EncryptedString(2048), nullable=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # --- OAuth grant -------------------------------------------------------
    # Tokens are *bearer credentials for the tenant's own Drive/Dropbox*, so
    # they live behind EncryptedString and are never serialised into a
    # response. Only ``account_email`` -- a label -- ever leaves the backend.
    account_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    access_token: Mapped[str | None] = mapped_column(EncryptedString(2048), nullable=True)
    refresh_token: Mapped[str | None] = mapped_column(EncryptedString(2048), nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: The grant is gone (revoked remotely, or the refresh token expired).
    #: Exports stop retrying and the UI asks for consent again.
    needs_reauth: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)


class CloudTarget(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Cloud-storage export destination (PREF-4)."""

    __tablename__ = "cloud_targets"
    __table_args__ = (Index("uq_cloud_targets_org_provider", "organization_id", "provider", unique=True),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")


class CloudExport(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One completed document, pushed to one cloud destination.

    The unique ``(document_id, provider)`` index is the whole
    exactly-once story: completion can be reached by more than one route, and
    a second enqueue for the same pair is a no-op rather than a duplicate file
    in the tenant's Drive.
    """

    __tablename__ = "cloud_exports"
    __table_args__ = (
        Index("uq_cloud_exports_document_provider", "document_id", "provider", unique=True),
        Index("ix_cloud_exports_org_created", "organization_id", "created_at"),
        Index("ix_cloud_exports_status_next_attempt", "status", "next_attempt_at"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    remote_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    remote_file_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: "pending" | "succeeded" | "failed" (see cloud_export_service).
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    last_error: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    next_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
