from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class SystemLog(Base, UUIDPrimaryKeyMixin):
    """Request/system log row (ACT-1, ACT-2).

    Written by the request-logging middleware and by the webhook, billing and
    signing services. ``organization_id`` is null for platform-only events.
    Needs a retention job: DELETE WHERE occurred_at < now() - retention_days.
    """

    __tablename__ = "system_logs"
    __table_args__ = (
        Index("ix_system_logs_occurred_at", "occurred_at"),
        Index("ix_system_logs_org_source_level", "organization_id", "source", "level"),
    )

    organization_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    # info | warn | error
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="info", server_default="info")
    # api | webhook | auth | billing | signing | admin
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="api", server_default="api")
    message: Mapped[str] = mapped_column(String(1024), nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    actor_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    payload: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
