from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class CustomReport(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A saved custom report definition (RPT-8)."""

    __tablename__ = "custom_reports"
    __table_args__ = (Index("ix_custom_reports_organization_id", "organization_id"),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    fields: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    filters: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    group_by: Mapped[str | None] = mapped_column(String(60), nullable=True)


class ReportSchedule(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A recurring export of a report (RPT-8)."""

    __tablename__ = "report_schedules"
    __table_args__ = (Index("ix_report_schedules_organization_id", "organization_id"),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    custom_report_id: Mapped[str | None] = mapped_column(ForeignKey("custom_reports.id"), nullable=True)
    report_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    cadence: Mapped[str] = mapped_column(String(20), nullable=False, default="weekly", server_default="weekly")
    format: Mapped[str] = mapped_column(String(10), nullable=False, default="csv", server_default="csv")
    recipients: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ReportExport(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One asynchronous export job (RPT-6)."""

    __tablename__ = "report_exports"
    __table_args__ = (Index("ix_report_exports_organization_id", "organization_id"),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    requested_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    report_key: Mapped[str] = mapped_column(String(40), nullable=False)
    range_key: Mapped[str | None] = mapped_column(String(10), nullable=True)
    format: Mapped[str] = mapped_column(String(10), nullable=False, default="csv", server_default="csv")
    # pending | running | ready | failed
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    file_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
