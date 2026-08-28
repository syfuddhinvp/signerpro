"""Platform revenue, balance, churn, dunning, provider events and health.

Everything here is *derived*. A second stored copy of a revenue number is a
second thing to be wrong, so each figure is computed from the rows that caused
it: `subscriptions` x `plans` x seats for recurring revenue, `invoices` for
billed/collected, `charges` for cash and dunning, `billing_webhook_events` for
provider traffic. Nothing on these endpoints writes, except the explicit
replay action.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require_platform_admin
from app.core.database import get_db
from app.models.charge import Charge
from app.models.invoice import Invoice, InvoiceStatus
from app.models.organization import Organization
from app.models.plan import Plan
from app.models.subscription import (
    ACTIVE_SUBSCRIPTION_STATUSES,
    ProcessedWebhookEvent,
    Subscription,
    SubscriptionStatus,
)
from app.models.user import User
from app.schemas.operations import (
    BalanceResponse,
    BillingEventResponse,
    ChurnResponse,
    ChurnRow,
    DunningRow,
    HealthComponent,
    RevenueMrrPoint,
    RevenuePlanBreakdown,
    RevenueSeriesPoint,
    RevenueSummary,
)
from app.services import platform_service
from app.services.billing_service import MAX_DUNNING_STEP, billing_service

# The router owns the whole /api/saas billing surface, so the new tiles do not
# each need a router registration in app/main.py.
router = APIRouter(prefix="/api/saas", tags=["revenue"])

#: How long provider funds are considered in transit before they are payable.
SETTLEMENT_DAYS = 2


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _month_key(moment: datetime) -> str:
    return moment.strftime("%Y-%m")


def _month_starts(count: int, *, now: datetime) -> list[datetime]:
    """The first instant of each of the trailing ``count`` months, oldest first."""
    starts: list[datetime] = []
    cursor = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for _ in range(count):
        starts.append(cursor)
        cursor = (cursor - timedelta(days=1)).replace(day=1)
    return list(reversed(starts))


def _seat_counts(db: Session) -> dict[str, int]:
    """Billable seats per organization: what is licensed, or what is in use."""
    users = dict(
        db.execute(select(User.organization_id, func.count(User.id)).group_by(User.organization_id)).all()
    )
    seats: dict[str, int] = {}
    for org_id, licensed in db.execute(
        select(Organization.id, Organization.seats_licensed)
    ).all():
        activated = int(users.get(org_id, 0) or 0)
        seats[org_id] = int(licensed) if (licensed or 0) > 0 else max(activated, 1)
    return seats


def _subscription_rows(db: Session) -> list[tuple[Subscription, Plan]]:
    return db.execute(select(Subscription, Plan).join(Plan, Plan.id == Subscription.plan_id)).all()


def _mrr_at(rows: list[tuple[Subscription, Plan]], seats: dict[str, int], *, at: datetime) -> int:
    """MRR as it stood at ``at``, from subscription lifecycle timestamps."""
    total = 0
    for subscription, plan in rows:
        created = _aware(subscription.created_at)
        if created is not None and created > at:
            continue
        canceled = _aware(subscription.canceled_at)
        if canceled is not None and canceled <= at:
            continue
        if subscription.status in {SubscriptionStatus.canceled, SubscriptionStatus.expired}:
            # Terminal today with no cancellation stamp: assume it never paid.
            if canceled is None:
                continue
        if subscription.status == SubscriptionStatus.trialing:
            continue
        total += billing_service.monthly_amount_cents(plan, seats.get(subscription.organization_id, 1))
    return total


@router.get("/revenue", response_model=RevenueSummary)
def revenue_summary(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> RevenueSummary:
    """Recurring revenue, cash and the plan mix (REV-1)."""
    now = _now()
    rows = _subscription_rows(db)
    seats = _seat_counts(db)

    mrr = 0
    paying = 0
    trialing = 0
    by_plan: dict[str, RevenuePlanBreakdown] = {}

    for subscription, plan in rows:
        org_seats = seats.get(subscription.organization_id, 1)
        if subscription.status == SubscriptionStatus.trialing:
            trialing += 1
        if subscription.status not in ACTIVE_SUBSCRIPTION_STATUSES:
            continue
        monthly = billing_service.monthly_amount_cents(plan, org_seats)
        # A trial contributes no cash yet, so it is counted as a tenant but not as MRR.
        if subscription.status != SubscriptionStatus.trialing:
            mrr += monthly
            if monthly > 0:
                paying += 1

        entry = by_plan.get(plan.code)
        if entry is None:
            entry = RevenuePlanBreakdown(
                plan_code=plan.code,
                plan_name=plan.name,
                plan_tag=plan.tag,
                subscribers=0,
                mrr_cents=0,
                seat_price_cents=plan.seat_price_cents,
            )
            by_plan[plan.code] = entry
        entry.subscribers += 1
        entry.seats += org_seats
        if subscription.status == SubscriptionStatus.trialing:
            entry.trialing_subscribers += 1
        else:
            entry.active_subscribers += 1
            entry.mrr_cents += monthly

    invoices = db.scalars(select(Invoice)).all()
    collected = sum(invoice.amount_paid_cents for invoice in invoices)
    outstanding = sum(
        invoice.amount_due_cents
        for invoice in invoices
        if invoice.status in {InvoiceStatus.open, InvoiceStatus.past_due}
    )
    overdue = sum(
        invoice.amount_due_cents
        for invoice in invoices
        if invoice.is_overdue or invoice.status == InvoiceStatus.past_due
    )
    at_risk = sum(
        invoice.amount_due_cents
        for invoice in invoices
        if invoice.status in {InvoiceStatus.past_due, InvoiceStatus.uncollectible}
    )

    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {"invoiced": 0, "collected": 0})
    for invoice in invoices:
        key = _month_key(invoice.issued_at)
        buckets[key]["invoiced"] += invoice.total_cents
        buckets[key]["collected"] += invoice.amount_paid_cents

    series = [
        RevenueSeriesPoint(period=period, invoiced_cents=values["invoiced"], collected_cents=values["collected"])
        for period, values in sorted(buckets.items())
    ][-12:]

    starts = _month_starts(12, now=now)
    mrr_series: list[RevenueMrrPoint] = []
    for index, start in enumerate(starts):
        at = now if index == len(starts) - 1 else starts[index + 1]
        mrr_series.append(RevenueMrrPoint(period=_month_key(start), mrr_cents=_mrr_at(rows, seats, at=at)))
    # The last point is "now", so it must agree with mrr_cents.
    if mrr_series:
        mrr_series[-1] = RevenueMrrPoint(period=mrr_series[-1].period, mrr_cents=mrr)
    previous = mrr_series[-2].mrr_cents if len(mrr_series) >= 2 else 0
    mrr_change_pct = round((mrr - previous) * 100 / previous, 2) if previous else 0.0

    window = now - timedelta(days=30)
    charges = list(db.scalars(select(Charge).where(Charge.occurred_at >= window)))
    gross_volume = sum(c.amount_cents for c in charges if c.status in {"succeeded", "recovered"})
    failed = sum(1 for c in charges if c.status == "failed")

    return RevenueSummary(
        mrr_cents=mrr,
        arr_cents=mrr * 12,
        collected_cents=collected,
        outstanding_cents=outstanding,
        overdue_cents=overdue,
        paying_tenants=paying,
        trialing_tenants=trialing,
        series=series,
        by_plan=sorted(by_plan.values(), key=lambda item: -item.mrr_cents),
        gross_volume_30d_cents=gross_volume,
        charge_count_30d=len(charges),
        failed_payment_count=failed,
        at_risk_cents=at_risk,
        mrr_change_pct=mrr_change_pct,
        mrr_series=mrr_series,
    )


@router.get("/revenue/churn", response_model=ChurnResponse)
def revenue_churn(
    range: str = Query(default="12m", pattern="^(3m|6m|12m)$"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ChurnResponse:
    """Logo churn, revenue retention and trial conversion (REV-4)."""
    now = _now()
    months = {"3m": 3, "6m": 6, "12m": 12}[range]
    rows = _subscription_rows(db)
    seats = _seat_counts(db)
    starts = _month_starts(months, now=now)

    churn_rows: list[ChurnRow] = []
    for index, start in enumerate(starts):
        end = now if index == len(starts) - 1 else starts[index + 1]
        churned = 0
        churned_mrr = 0
        new = 0
        for subscription, plan in rows:
            created = _aware(subscription.created_at)
            canceled = _aware(subscription.canceled_at)
            if created is not None and start <= created < end:
                new += 1
            if canceled is not None and start <= canceled < end:
                churned += 1
                churned_mrr += billing_service.monthly_amount_cents(
                    plan, seats.get(subscription.organization_id, 1)
                )
        retained = max(0, _tenant_count_at(rows, at=end) - churned)
        churn_rows.append(
            ChurnRow(
                period=_month_key(start),
                churned_tenants=churned,
                churned_mrr_cents=churned_mrr,
                retained_tenants=retained,
                new_tenants=new,
            )
        )

    window_start = starts[0] if starts else now
    # Denominator is every tenant that was live at any point in the window, not
    # just those live on day one: a platform whose whole book signed up inside
    # the window still has a meaningful churn rate.
    exposed = _tenant_count_in_window(rows, start=window_start, end=now)
    churned_total = sum(row.churned_tenants for row in churn_rows)
    gross_logo_churn = round(churned_total * 100 / exposed, 2) if exposed else 0.0

    mrr_start = _mrr_at(rows, seats, at=window_start)
    mrr_now = _mrr_at(rows, seats, at=now)
    nrr = round(mrr_now * 100 / mrr_start, 2) if mrr_start else 0.0

    # Involuntary churn = cancellations that followed a terminal payment
    # failure, which is the only churn cause the system actually records.
    uncollectible_orgs = {
        row[0]
        for row in db.execute(
            select(Invoice.organization_id).where(Invoice.status == InvoiceStatus.uncollectible)
        ).all()
    }
    involuntary = sum(
        1
        for subscription, _ in rows
        if subscription.canceled_at is not None and subscription.organization_id in uncollectible_orgs
    )
    involuntary_pct = round(involuntary * 100 / churned_total, 2) if churned_total else 0.0

    trials = [s for s, _ in rows if s.trial_ends_at is not None]
    converted = sum(1 for s in trials if s.status == SubscriptionStatus.active)
    trial_conversion = round(converted * 100 / len(trials), 2) if trials else 0.0

    return ChurnResponse(
        range=range,
        gross_logo_churn_pct=gross_logo_churn,
        net_revenue_retention_pct=nrr,
        involuntary_churn_pct=involuntary_pct,
        trial_conversion_pct=trial_conversion,
        rows=churn_rows,
    )


def _tenant_count_in_window(
    rows: list[tuple[Subscription, Plan]], *, start: datetime, end: datetime
) -> int:
    count = 0
    for subscription, _ in rows:
        created = _aware(subscription.created_at)
        if created is not None and created >= end:
            continue
        canceled = _aware(subscription.canceled_at)
        if canceled is not None and canceled < start:
            continue
        count += 1
    return count


def _tenant_count_at(rows: list[tuple[Subscription, Plan]], *, at: datetime) -> int:
    count = 0
    for subscription, _ in rows:
        created = _aware(subscription.created_at)
        if created is not None and created > at:
            continue
        canceled = _aware(subscription.canceled_at)
        if canceled is not None and canceled <= at:
            continue
        count += 1
    return count


@router.get("/balance", response_model=BalanceResponse)
def platform_balance(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> BalanceResponse:
    """Provider balance and next payout (REV-3).

    Derived from the charge ledger: money collected more than
    ``SETTLEMENT_DAYS`` ago is available, anything newer is in transit. When a
    real provider is wired in behind ``PaymentProvider`` these figures should
    come from its balance API instead.
    """
    now = _now()
    settled_before = now - timedelta(days=SETTLEMENT_DAYS)
    charges = list(db.scalars(select(Charge)))
    available = sum(
        c.amount_cents
        for c in charges
        if c.status in {"succeeded", "recovered"} and (_aware(c.occurred_at) or now) < settled_before
    )
    pending = sum(
        c.amount_cents
        for c in charges
        if c.status in {"succeeded", "recovered"} and (_aware(c.occurred_at) or now) >= settled_before
    )
    disputed = [c for c in charges if c.decline_code == "disputed"]
    settled_count = sum(1 for c in charges if c.status in {"succeeded", "recovered"})
    next_payout_at = (now + timedelta(days=1)).replace(hour=9, minute=0, second=0, microsecond=0)
    return BalanceResponse(
        available_cents=available,
        pending_cents=pending,
        pending_settles_at=next_payout_at if pending else None,
        next_payout_cents=available,
        next_payout_at=next_payout_at if available else None,
        payout_destination=billing_service.provider.name,
        disputes_cents=sum(c.amount_cents for c in disputed),
        dispute_count=len(disputed),
        dispute_rate_pct=round(len(disputed) * 100 / settled_count, 2) if settled_count else 0.0,
    )


@router.get("/dunning", response_model=list[DunningRow])
def dunning_queue(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[DunningRow]:
    """Invoices in collection, newest attempt first (REV-2)."""
    rows = db.execute(
        select(Charge, Invoice, Organization.name)
        .join(Invoice, Invoice.id == Charge.invoice_id)
        .join(Organization, Organization.id == Charge.organization_id)
        .where(Charge.status == "failed")
        .order_by(Charge.occurred_at.desc())
    ).all()
    seen: set[str] = set()
    queue: list[DunningRow] = []
    for charge, invoice, org_name in rows:
        # One row per invoice: the latest attempt is the state of the dunning.
        if invoice.id in seen or invoice.status in {InvoiceStatus.paid, InvoiceStatus.void}:
            continue
        seen.add(invoice.id)
        queue.append(
            DunningRow(
                organization_id=charge.organization_id,
                organization_name=org_name,
                invoice_id=invoice.id,
                invoice_number=invoice.number,
                amount_cents=invoice.amount_due_cents,
                dunning_step=charge.dunning_step or 1,
                max_step=MAX_DUNNING_STEP,
                reason=charge.decline_code or "payment_failed",
                next_attempt_at=charge.next_attempt_at,
            )
        )
    return queue


@router.get("/billing-events", response_model=list[BillingEventResponse])
def billing_events(
    limit: int = Query(default=50, ge=1, le=200),
    status_filter: str | None = Query(default=None, alias="status", pattern="^(processed|pending|failed)$"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[BillingEventResponse]:
    """Inbound payment-provider webhook deliveries (REV-5)."""
    query = select(ProcessedWebhookEvent)
    if status_filter == "processed":
        query = query.where(ProcessedWebhookEvent.processed == True)  # noqa: E712
    elif status_filter == "pending":
        query = query.where(ProcessedWebhookEvent.processed == False)  # noqa: E712
    elif status_filter == "failed":
        query = query.where(ProcessedWebhookEvent.error.is_not(None))
    events = db.scalars(query.order_by(ProcessedWebhookEvent.received_at.desc()).limit(limit)).all()
    return [BillingEventResponse.model_validate(event) for event in events]


@router.post("/billing-events/{event_id}/replay", response_model=BillingEventResponse)
def replay_billing_event(
    event_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> BillingEventResponse:
    """Re-apply a stored provider event through the normal handler."""
    event = db.get(ProcessedWebhookEvent, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Billing event not found")
    return BillingEventResponse.model_validate(
        billing_service.replay_webhook_event(db, event=event)
    )


@router.get("/health", response_model=list[HealthComponent])
def platform_health(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[HealthComponent]:
    """Component health for the platform home tiles (REV-6).

    The derivation lives in ``platform_service.component_health`` so this
    endpoint and ``GET /api/saas/overview`` can never disagree.
    """
    return [HealthComponent(**row) for row in platform_service.component_health(db)]
