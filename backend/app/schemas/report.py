from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ReportTile(BaseModel):
    key: str
    label: str
    value: float
    meta: str | None = None


class ReportOverviewResponse(BaseModel):
    range_start: datetime
    range_end: datetime
    documents_created: int
    documents_completed: int
    completion_rate_pct: float
    median_completion_seconds: int
    median_completion_label: str
    templates_created: int
    templates_uses: int
    sender_count: int
    recipient_count: int
    first_time_recipients: int
    tiles: list[ReportTile]


class InviteSplitEntry(BaseModel):
    label: str
    count: int


class InviteReportResponse(BaseModel):
    total: int
    split: list[InviteSplitEntry]


class DocumentReportRow(BaseModel):
    document_id: str
    title: str
    status: str
    signed: int
    total: int
    age_days: int
    sender_name: str | None
    updated_at: datetime | None


class DocumentReportResponse(BaseModel):
    items: list[DocumentReportRow]
    total: int


class TemplateReportRow(BaseModel):
    template_id: str
    title: str
    use_count: int
    completed_copies: int
    field_count: int
    owner_name: str | None
    updated_at: datetime | None


class TemplateReportResponse(BaseModel):
    items: list[TemplateReportRow]
    total: int


class RecipientReportRow(BaseModel):
    email: str
    sent: int
    delivered: int
    viewed: int
    completed: int
    declined: int
    expired: int
    median_completion_seconds: int | None
    median_completion_label: str
    completion_rate_pct: float


class RecipientReportResponse(BaseModel):
    items: list[RecipientReportRow]
    total: int


class SenderReportRow(BaseModel):
    user_id: str
    name: str
    role_label: str
    last_active_at: datetime | None
    sent_count: int
    approved_count: int


class ReportExportRequest(BaseModel):
    report: str
    range: str | None = "30d"
    start: datetime | None = None
    end: datetime | None = None
    format: Literal["csv", "xlsx"] = "csv"
    filters: dict[str, Any] | None = None


class ReportExportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    export_id: str
    status: str
    report_key: str
    range_key: str | None
    format: str
    download_url: str | None = None
    error: str | None = None
    created_at: datetime


class CustomReportCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    fields: list[str] = Field(default_factory=list)
    filters: dict[str, Any] | None = None
    group_by: str | None = Field(default=None, max_length=60)


class CustomReportUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    fields: list[str] | None = None
    filters: dict[str, Any] | None = None
    group_by: str | None = Field(default=None, max_length=60)


class CustomReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    fields: list[str]
    filters: dict[str, Any] | None
    group_by: str | None
    created_at: datetime
    updated_at: datetime | None = None


class CustomReportRunResponse(BaseModel):
    report_id: str
    name: str
    fields: list[str]
    group_by: str | None
    row_count: int
    rows: list[dict[str, Any]]
    groups: list[dict[str, Any]]


class ReportScheduleCreate(BaseModel):
    cadence: Literal["daily", "weekly", "monthly"] = "weekly"
    format: Literal["csv", "xlsx"] = "csv"
    recipients: list[EmailStr] = Field(default_factory=list)


class ReportScheduleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    custom_report_id: str | None
    report_key: str | None
    cadence: str
    format: str
    recipients: list[str]
    last_run_at: datetime | None
    next_run_at: datetime | None


class ReportFieldCatalogueResponse(BaseModel):
    fields: list[str]
    reports: list[str]
    ranges: list[str]
