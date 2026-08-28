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
    # BIL-9
    provider_payment_intent_id: str | None = None
    payment_method_label: str | None = None
    period_label: str | None = None
    #: Present on the tenant response too so one client mapper serves both;
    #: the platform variant makes it required.
    organization_name: str | None = None


class PlatformInvoiceResponse(InvoiceResponse):
    organization_name: str


class InvoiceMarkPaid(BaseModel):
    amount_cents: int | None = None


class InvoiceVoid(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class InvoicePayRequest(BaseModel):
    payment_method_id: str | None = Field(default=None, max_length=36)


# --- Support ----------------------------------------------------------------


class TicketMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    author_name: str
    body: str
    is_staff: bool
    is_internal: bool = False
    created_at: datetime


class TicketResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    organization_name: str | None = None
    organization_slug: str | None = None
    reference: str
    subject: str
    category: str | None = None
    status: str
    priority: str
    assignee_user_id: str | None = None
    assignee_name: str | None = None
    document_id: str | None = None
    document_title: str | None = None
    tags: list[str] = []
    sla_due_at: datetime | None = None
    sla_label: str | None = None
    sla_breached: bool = False
    requester_name: str | None = None
    requester_email: str | None = None
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
    document_id: str | None = None
    tags: list[str] | None = None


class TicketReply(BaseModel):
    body: str = Field(min_length=1, max_length=8000)
    # Internal notes are visible to platform agents only (SUP-3).
    internal: bool = False


class TicketUpdate(BaseModel):
    status: str | None = Field(default=None, max_length=20)
    priority: str | None = Field(default=None, max_length=20)
    assignee_user_id: str | None = None
    tags: list[str] | None = None


class TicketBucketCounts(BaseModel):
    """Counts for the filter pills. ``all`` excludes nothing."""

    all: int
    open: int
    pending: int
    escalated: int
    resolved: int


class TicketPage(BaseModel):
    items: list[TicketResponse]
    total: int
    counts: TicketBucketCounts


class SupportAgent(BaseModel):
    id: str
    name: str
    email: str
    specialty: str | None = None
    open_ticket_count: int = 0


class TenantTicketStats(BaseModel):
    open_count: int
    escalated_count: int
    avg_first_response_minutes: int | None = None
    sla_target_minutes: int
    resolved_90d: int
    avg_resolution_minutes: int | None = None


class QueueTicketStats(BaseModel):
    open_count: int
    breaching_soon_count: int
    first_response_minutes: int | None = None
    target_minutes: int
    csat_30d: float | None = None
    csat_responses: int = 0


class QuickReply(BaseModel):
    label: str
    body: str


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
    plan_tag: str | None = None
    subscribers: int
    mrr_cents: int
    #: Sub-counts, so the "subscriptions by plan" table can show the mix.
    active_subscribers: int = 0
    trialing_subscribers: int = 0
    seats: int = 0
    seat_price_cents: int | None = None


class RevenueMrrPoint(BaseModel):
    period: str
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
    # REV-1
    gross_volume_30d_cents: int = 0
    charge_count_30d: int = 0
    failed_payment_count: int = 0
    at_risk_cents: int = 0
    mrr_change_pct: float = 0.0
    #: Trailing 12 months of MRR, oldest first; the last point is `mrr_cents`.
    mrr_series: list[RevenueMrrPoint] = Field(default_factory=list)


# REV-2
class DunningRow(BaseModel):
    organization_id: str
    organization_name: str
    invoice_id: str | None = None
    invoice_number: str | None = None
    amount_cents: int
    dunning_step: int
    max_step: int
    reason: str
    next_attempt_at: datetime | None = None


# REV-3
class BalanceResponse(BaseModel):
    currency: str = "USD"
    available_cents: int
    pending_cents: int
    pending_settles_at: datetime | None = None
    next_payout_cents: int
    next_payout_at: datetime | None = None
    payout_destination: str
    disputes_cents: int
    dispute_count: int
    dispute_rate_pct: float


# REV-4
class ChurnRow(BaseModel):
    period: str
    churned_tenants: int
    churned_mrr_cents: int
    retained_tenants: int
    new_tenants: int


class ChurnResponse(BaseModel):
    range: str
    gross_logo_churn_pct: float
    net_revenue_retention_pct: float
    involuntary_churn_pct: float
    trial_conversion_pct: float
    rows: list[ChurnRow]


# REV-5
class BillingEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    provider: str
    event_id: str
    event_type: str
    status_code: int | None = None
    received_at: datetime
    processed: bool = False
    error: str | None = None


# REV-6
class HealthComponent(BaseModel):
    component: str
    detail: str
    tone: str
