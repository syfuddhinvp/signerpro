from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


# --- Invoices ---------------------------------------------------------------


class InvoiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    number: str
    status: str
    currency: str
    subtotal_cents: int
    tax_cents: int
    total_cents: int
    amount_paid_cents: int
    amount_due_cents: int
    is_overdue: bool
    period_start: datetime | None = None
    period_end: datetime | None = None
    issued_at: datetime
    due_at: datetime | None = None
    paid_at: datetime | None = None
    line_items: list | None = None
    hosted_url: str | None = None


class PlatformInvoiceResponse(InvoiceResponse):
    organization_name: str


class InvoiceMarkPaid(BaseModel):
    amount_cents: int | None = None


# --- Support ----------------------------------------------------------------


class TicketMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    author_name: str
    body: str
    is_staff: bool
    created_at: datetime


class TicketResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    reference: str
    subject: str
    category: str | None = None
    status: str
    priority: str
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None = None
    message_count: int = 0


class TicketDetailResponse(TicketResponse):
    messages: list[TicketMessageResponse] = []


class PlatformTicketResponse(TicketResponse):
    organization_name: str


class TicketCreate(BaseModel):
    subject: str = Field(min_length=3, max_length=255)
    body: str = Field(min_length=1, max_length=8000)
    category: str | None = Field(default=None, max_length=60)
    priority: str = Field(default="normal", max_length=20)


class TicketReply(BaseModel):
    body: str = Field(min_length=1, max_length=8000)


class TicketUpdate(BaseModel):
    status: str | None = Field(default=None, max_length=20)
    priority: str | None = Field(default=None, max_length=20)


# --- Activity / logs --------------------------------------------------------


class ActivityEntry(BaseModel):
    id: str
    created_at: datetime
    event_type: str
    event_message: str
    document_id: str | None = None
    document_title: str | None = None
    actor: str | None = None
    ip_address: str | None = None
    organization_id: str | None = None
    organization_name: str | None = None


class ActivityPage(BaseModel):
    entries: list[ActivityEntry]
    total: int
    event_types: list[str]


# --- Revenue ----------------------------------------------------------------


class RevenueSeriesPoint(BaseModel):
    period: str
    invoiced_cents: int
    collected_cents: int


class RevenuePlanBreakdown(BaseModel):
    plan_code: str
    plan_name: str
    subscribers: int
    mrr_cents: int


class RevenueSummary(BaseModel):
    mrr_cents: int
    arr_cents: int
    collected_cents: int
    outstanding_cents: int
    overdue_cents: int
    paying_tenants: int
    trialing_tenants: int
    series: list[RevenueSeriesPoint]
    by_plan: list[RevenuePlanBreakdown]
