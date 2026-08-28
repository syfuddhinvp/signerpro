from datetime import datetime
from typing import Any

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class PlanResponse(BaseModel):
    id: str
    code: str
    name: str
    description: str | None = None
    price_cents: int
    currency: str
    billing_interval: str
    trial_days: int
    is_active: bool
    entitlements: dict[str, Any]
    # BIL-1: marketing presentation, so the pricing cards are server-driven.
    tag: str | None = None
    marketing_lines: list[dict[str, Any]] | None = None
    seat_price_cents: int | None = None
    is_seat_based: bool = False

    class Config:
        from_attributes = True


class SubscriptionResponse(BaseModel):
    id: str | None = None
    organization_id: str
    plan_code: str
    plan_name: str
    status: str
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    trial_ends_at: datetime | None = None
    cancel_at_period_end: bool = False
    canceled_at: datetime | None = None
    provider: str | None = None
    entitlements: dict[str, Any] = Field(default_factory=dict)
    # BIL-7
    seats_licensed: int = 0
    seats_activated: int = 0
    seat_price_cents: int | None = None
    is_seat_based: bool = False
    cycle: str = "monthly"
    next_invoice_total_cents: int = 0
    next_invoice_at: datetime | None = None


class UsageLimit(BaseModel):
    limit: int | None = None
    used: int = 0
    remaining: int | None = None
    exceeded: bool = False


class UsageResponse(BaseModel):
    organization_id: str
    plan_code: str
    plan_name: str
    subscription_status: str
    period_start: datetime
    period_end: datetime
    limits: dict[str, UsageLimit]
    period_totals: dict[str, int]
    features: dict[str, bool]
    # BIL-11: one presentation-ready row per metered dimension.
    rows: list["UsageRow"] = Field(default_factory=list)


class UsageRow(BaseModel):
    key: str
    label: str
    used: int
    limit: int | None = None
    pct: int = 0
    display: str = ""


class CheckoutRequest(BaseModel):
    plan_code: str = Field(max_length=50)
    success_url: str | None = None
    cancel_url: str | None = None


class CheckoutResponse(BaseModel):
    session_id: str
    url: str
    provider: str
    plan_code: str


class ChangePlanRequest(BaseModel):
    plan_code: str = Field(max_length=50)


class CancelRequest(BaseModel):
    at_period_end: bool = True


# --- BIL-1: marketing presentation ------------------------------------------


class PlanMarketingLine(BaseModel):
    label: str
    value: str


# --- BIL-2 / BIL-3: payment methods -----------------------------------------


class PaymentMethodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    type: str
    brand: str | None = None
    last4: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None
    holder_name: str | None = None
    country: str | None = None
    label: str
    meta: str | None = None
    po_number: str | None = None
    provider: str | None = None
    is_default: bool = False
    created_at: datetime | None = None


class PaymentMethodCreate(BaseModel):
    type: Literal["card", "ach", "sepa", "invoice"] = "card"
    #: An opaque provider token. A raw PAN, CVC or full account number must
    #: never reach this API, so there is deliberately no field for one.
    provider_token: str | None = Field(default=None, max_length=255)
    holder_name: str | None = Field(default=None, max_length=255)
    country: str | None = Field(default=None, min_length=2, max_length=2)
    po_number: str | None = Field(default=None, max_length=60)
    make_default: bool = False


# --- BIL-4: upcoming invoice preview ----------------------------------------


class InvoiceLineItem(BaseModel):
    description: str
    quantity: int = 1
    unit_cents: int = 0
    amount_cents: int = 0


class UpcomingInvoiceResponse(BaseModel):
    organization_id: str
    plan_code: str
    plan_name: str
    cycle: str
    seats_licensed: int
    period_start: datetime | None = None
    period_end: datetime | None = None
    currency: str
    line_items: list[InvoiceLineItem]
    subtotal_cents: int
    tax_cents: int
    total_cents: int
    due_at: datetime | None = None


# --- BIL-5: charge history --------------------------------------------------


class ChargeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    invoice_id: str | None = None
    amount_cents: int
    currency: str
    provider: str | None = None
    provider_payment_id: str | None = None
    method_label: str | None = None
    status: str
    decline_code: str | None = None
    occurred_at: datetime
    description: str | None = None


# --- BIL-6: billing settings -----------------------------------------------


class BillingSettingsResponse(BaseModel):
    organization_id: str
    autopay: bool
    billing_email: str | None = None
    tax_id: str | None = None
    cycle: str
    default_payment_method_id: str | None = None
    po_number: str | None = None
    currency: str = "USD"


class BillingSettingsUpdate(BaseModel):
    autopay: bool | None = None
    billing_email: EmailStr | None = None
    tax_id: str | None = Field(default=None, max_length=60)
    cycle: Literal["monthly", "annual"] | None = None
    default_payment_method_id: str | None = Field(default=None, max_length=36)
    po_number: str | None = Field(default=None, max_length=60)


# --- BIL-8: seats ----------------------------------------------------------


class SeatChangeRequest(BaseModel):
    delta: int = Field(ge=-1000, le=1000)


class SeatChangeResponse(BaseModel):
    subscription: "SubscriptionResponse"
    seats_licensed: int
    seats_activated: int
    proration_cents: int
    effective_at: datetime


# --- Plan change preview ---------------------------------------------------


class PlanChangePreview(BaseModel):
    current_plan_code: str
    current_plan_name: str
    target_plan_code: str
    target_plan_name: str
    cycle: str
    seats_licensed: int
    current_amount_cents: int
    target_amount_cents: int
    #: Positive = charged now, negative = credited. Prorated across the
    #: unused remainder of the current period.
    proration_cents: int
    remaining_fraction: float
    effective_at: datetime
    next_invoice_total_cents: int
    next_invoice_at: datetime | None = None
    is_downgrade: bool


UsageResponse.model_rebuild()
SeatChangeResponse.model_rebuild()
