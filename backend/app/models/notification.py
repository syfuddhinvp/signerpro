from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin, now_utc


class Notification(Base, UUIDPrimaryKeyMixin):
    """Bell-feed entry (ACT-4)."""

    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_unread", "user_id", "read_at"),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # info | good | warn | bad
    tone: Mapped[str] = mapped_column(String(10), nullable=False, default="info", server_default="info")
    screen: Mapped[str | None] = mapped_column(String(40), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)


class NotificationPreference(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Per-user notification switches (PREF-2)."""

    __tablename__ = "notification_preferences"
    __table_args__ = (Index("uq_notif_pref", "user_id", "event_key", unique=True),)

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    event_key: Mapped[str] = mapped_column(String(60), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    extra_recipients: Mapped[list | None] = mapped_column(JSON, nullable=True)
