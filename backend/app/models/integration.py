from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import EncryptedString
from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Integration(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A connected third-party app (PREF-3)."""

    __tablename__ = "integrations"
    __table_args__ = (Index("uq_integrations_org_provider", "organization_id", "provider", unique=True),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    connected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credentials: Mapped[str | None] = mapped_column(EncryptedString(2048), nullable=True)
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class CloudTarget(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Cloud-storage export destination (PREF-4)."""

    __tablename__ = "cloud_targets"
    __table_args__ = (Index("uq_cloud_targets_org_provider", "organization_id", "provider", unique=True),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
