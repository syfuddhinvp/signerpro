from collections import defaultdict

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_platform_admin
from app.core.database import get_db
from app.models.invoice import Invoice, InvoiceStatus
from app.models.plan import Plan
from app.models.subscription import ACTIVE_SUBSCRIPTION_STATUSES, Subscription, SubscriptionStatus
from app.models.user import User
from app.schemas.operations import RevenuePlanBreakdown, RevenueSeriesPoint, RevenueSummary

router = APIRouter(prefix="/api/saas/revenue", tags=["revenue"])


def _monthly_cents(plan: Plan) -> int:
    """Normalise a plan's price to a monthly figure so MRR is comparable."""
    if plan.billing_interval == "year":
        return round(plan.price_cents / 12)
    return plan.price_cents


@router.get("", response_model=RevenueSummary)
def revenue_summary(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> RevenueSummary:
    """Revenue derived from subscriptions and invoices.

    Deliberately computed from what the system already records rather than
    stored separately: a second copy of the numbers is a second thing to be
    wrong, and every figure here has a source row behind it.
    """
    rows = db.execute(select(Subscription, Plan).join(Plan, Plan.id == Subscription.plan_id)).all()

    mrr = 0
    paying = 0
    trialing = 0
    by_plan: dict[str, RevenuePlanBreakdown] = {}

    for subscription, plan in rows:
        if subscription.status == SubscriptionStatus.trialing:
            trialing += 1
        if subscription.status not in ACTIVE_SUBSCRIPTION_STATUSES:
            continue
        monthly = _monthly_cents(plan)
        # A trial contributes no cash yet, so it is counted as a tenant but not as MRR.
        if subscription.status != SubscriptionStatus.trialing:
            mrr += monthly
            if monthly > 0:
                paying += 1

        entry = by_plan.get(plan.code)
        if entry is None:
            entry = RevenuePlanBreakdown(plan_code=plan.code, plan_name=plan.name, subscribers=0, mrr_cents=0)
            by_plan[plan.code] = entry
        entry.subscribers += 1
        if subscription.status != SubscriptionStatus.trialing:
            entry.mrr_cents += monthly

    invoices = db.scalars(select(Invoice)).all()
    collected = sum(invoice.amount_paid_cents for invoice in invoices)
    outstanding = sum(
        invoice.amount_due_cents for invoice in invoices if invoice.status == InvoiceStatus.open
    )
    overdue = sum(invoice.amount_due_cents for invoice in invoices if invoice.is_overdue)

    buckets: dict[str, dict[str, int]] = defaultdict(lambda: {"invoiced": 0, "collected": 0})
    for invoice in invoices:
        key = invoice.issued_at.strftime("%Y-%m")
        buckets[key]["invoiced"] += invoice.total_cents
        buckets[key]["collected"] += invoice.amount_paid_cents

    series = [
        RevenueSeriesPoint(period=period, invoiced_cents=values["invoiced"], collected_cents=values["collected"])
        for period, values in sorted(buckets.items())
    ][-12:]

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
    )
