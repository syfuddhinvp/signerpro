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
    # BIL-12: a downgrade the tenant has asked for that has not landed yet.
    #: True when the provider already holds a subscription for this
    #: organization. A plan change must then modify it rather than opening a
    #: checkout, which would start a second one (BIL-13).
    has_provider_subscription: bool = False
    pending_plan_code: str | None = None
    pending_plan_name: str | None = None
    pending_plan_effective_at: datetime | None = None
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
    #: ``embedded`` renders the provider's own iframe inside our modal, so no
    #: card data ever enters this application's DOM. ``hosted`` redirects.
    ui_mode: Literal["hosted", "embedded"] = "hosted"
    return_url: str | None = None


class SetupSessionRequest(BaseModel):
    """Save an instrument without buying anything."""

    return_url: str | None = None
    ui_mode: Literal["hosted", "embedded"] = "embedded"


class CheckoutResponse(BaseModel):
    session_id: str
    provider: str
    plan_code: str
    #: Hosted mode returns a ``url``; embedded mode returns a
    #: ``client_secret`` and no url. Exactly one of the two is populated.
    url: str | None = None
    client_secret: str | None = None
    mode: str = "subscription"
    ui_mode: str = "hosted"
    #: False for a provider test-mode session. The UI badges it, so a test
    #: payment is never read as a real one.
    livemode: bool = False


class CheckoutStatusResponse(BaseModel):
    session_id: str
    #: ``open`` | ``complete`` | ``expired`` -- the *provider's* word, read
    #: server-side. A browser arriving at the return url proves nothing.
    status: str
    mode: str = "subscription"
    applied: bool = False
    payment_method_id: str | None = None


class ChangePlanRequest(BaseModel):
    plan_code: str = Field(max_length=50)
    #: Which stored instrument to charge the proration to. Omitted means "the
    #: organization's default"; an upgrade with neither is a 402.
    payment_method_id: str | None = Field(default=None, max_length=64)
    #: When the change lands. Omitted takes the default for its direction:
    #: an upgrade now, a downgrade at the end of the period already paid for.
    #: ``immediately`` on a downgrade forfeits the remainder to account
    #: balance rather than to a refund.
    effective: Literal["immediately", "period_end"] | None = None
    #: The total the tenant was shown by the preview. If the real figure has
    #: moved since, the change is refused rather than charging a number
    #: nobody agreed to. Omitted skips the check.
    quoted_amount_cents: int | None = Field(default=None, ge=0)
    #: Proceed despite blockers. Reserved for platform admins acting
    #: deliberately; an org admin never sets it.
    force: bool = False


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
    #: Charged for the prorated cost of added seats. Defaults to the org's
    #: default instrument; buying seats with neither is a 402.
    payment_method_id: str | None = Field(default=None, max_length=64)


class SeatChangeResponse(BaseModel):
    subscription: "SubscriptionResponse"
    seats_licensed: int
    seats_activated: int
    proration_cents: int
    effective_at: datetime
    #: Balance credited by releasing seats mid-period (BIL-12). Never a refund.
    wallet_credit_cents: int = 0


# --- Plan change preview ---------------------------------------------------


class PlanChangeIssue(BaseModel):
    """One blocker or warning. See `services/plan_change_service.py`."""

    code: str
    key: str
    message: str
    current: int | None = None
    limit: int | None = None
    remedy: str | None = None


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
    effective_at: datetime | None = None
    next_invoice_total_cents: int
    next_invoice_at: datetime | None = None
    is_downgrade: bool

    # --- BIL-12 -----------------------------------------------------------
    currency: str = "USD"
    #: upgrade | downgrade | lateral | interval_switch
    direction: str = "lateral"
    #: immediately | period_end
    effective_mode: str = "immediately"
    scheduled: bool = False
    #: What is owed today, before balance is applied.
    amount_due_cents: int = 0
    wallet_balance_cents: int = 0
    wallet_applied_cents: int = 0
    #: What the card is actually charged, after balance.
    charge_cents: int = 0
    #: Balance this change adds. Always 0 when scheduled.
    wallet_credit_cents: int = 0
    #: Capacity the org is already over. Non-empty means the change is refused.
    blockers: list[PlanChangeIssue] = Field(default_factory=list)
    #: Features that stop working. Confirmable, not refused.
    warnings: list[PlanChangeIssue] = Field(default_factory=list)
    allowed: bool = True


# --- BIL-12: account balance ------------------------------------------------


class WalletEntryResponse(BaseModel):
    """One movement of an organization's balance."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    #: Signed: positive is credit, negative is balance spent.
    amount_cents: int
    balance_after_cents: int
    currency: str
    kind: str
    description: str
    reason: str | None = None
    invoice_id: str | None = None
    created_at: datetime


class WalletResponse(BaseModel):
    balance_cents: int
    currency: str
    #: Always false. Stated rather than implied, so a client does not render
    #: a "withdraw" affordance that no endpoint backs.
    withdrawable: bool = False
    total: int
    entries: list[WalletEntryResponse] = Field(default_factory=list)


class WalletCreditRequest(BaseModel):
    """A platform-admin grant. Not reachable by a tenant."""

    amount_cents: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=500)


UsageResponse.model_rebuild()
SeatChangeResponse.model_rebuild()
