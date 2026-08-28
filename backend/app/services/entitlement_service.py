"""Entitlement resolution and enforcement.

Plans carry their limits as JSON data (``Plan.entitlements``) so pricing changes
are row edits, not migrations. Everything in the app asks this service one
question -- "may org X do Y, in amount N?" -- and gets a 402 with a
machine-readable body when the answer is no.
"""

from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.plan import (
    ENTITLEMENT_MAX_API_CALLS_PER_MONTH,
    ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH,
    ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT,
    ENTITLEMENT_MAX_SMS_PER_MONTH,
    ENTITLEMENT_MAX_STORAGE_BYTES,
    ENTITLEMENT_MAX_USERS,
    FALLBACK_ENTITLEMENTS,
    FREE_PLAN_CODE,
    Plan,
)
from app.models.subscription import ACTIVE_SUBSCRIPTION_STATUSES, Subscription, SubscriptionStatus
from app.models.usage_event import UsageEvent, UsageEventType
from app.models.user import User


PAYMENT_REQUIRED = status.HTTP_402_PAYMENT_REQUIRED

#: BIL-11 metered dimensions. Defined in ``app.models.plan`` alongside the rest
#: of the catalogue and re-exported here for the callers that already import
#: them from this module.

#: (entitlement key, row label, usage event backing it) for the usage table.
_USAGE_ROW_DEFS: tuple[tuple[str, str, str], ...] = (
    (ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH, "Envelopes", UsageEventType.document_created.value),
    (ENTITLEMENT_MAX_API_CALLS_PER_MONTH, "API calls", UsageEventType.api_call.value),
    (ENTITLEMENT_MAX_STORAGE_BYTES, "Storage", UsageEventType.storage_bytes_added.value),
    (ENTITLEMENT_MAX_SMS_PER_MONTH, "SMS sent", UsageEventType.sms_sent.value),
)


def _format_bytes(value: int) -> str:
    step = 1024.0
    amount = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if amount < step or unit == "TB":
            return f"{amount:,.1f} {unit}" if unit != "B" else f"{int(amount)} B"
        amount /= step
    return f"{amount:,.1f} TB"


def _format_count(value: int) -> str:
    return f"{value:,}"

#: Which usage aggregate backs each numeric entitlement key.
_USAGE_SOURCES: dict[str, tuple[UsageEventType, bool]] = {
    # key -> (usage event type, scoped to the current billing period?)
    ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH: (UsageEventType.document_created, True),
    ENTITLEMENT_MAX_STORAGE_BYTES: (UsageEventType.storage_bytes_added, False),
    ENTITLEMENT_MAX_API_CALLS_PER_MONTH: (UsageEventType.api_call, True),
    ENTITLEMENT_MAX_SMS_PER_MONTH: (UsageEventType.sms_sent, True),
}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _calendar_month_window(moment: datetime) -> tuple[datetime, datetime]:
    start = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last_day = monthrange(moment.year, moment.month)[1]
    end = moment.replace(day=last_day, hour=23, minute=59, second=59, microsecond=999999)
    return start, end


@dataclass
class EntitlementContext:
    organization_id: str
    plan_code: str
    plan_name: str
    subscription_status: str
    entitlements: dict
    period_start: datetime
    period_end: datetime
    subscription: Subscription | None = None
    plan: Plan | None = None

    @property
    def can_perform_billable_actions(self) -> bool:
        """Whether outbound/billable work (create, send, upload) is permitted.

        Reading and downloading already-executed documents is deliberately NOT
        gated on this -- customers must always be able to retrieve contracts
        they have already signed.
        """
        return self.subscription_status in ACTIVE_SUBSCRIPTION_STATUSES

    def limit(self, key: str):
        return self.entitlements.get(key, FALLBACK_ENTITLEMENTS.get(key))


class EntitlementService:
    # ---------------------------------------------------------------- resolve
    def get_free_plan(self, db: Session) -> Plan | None:
        return db.scalar(select(Plan).where(Plan.code == FREE_PLAN_CODE))

    def get_subscription(self, db: Session, organization_id: str) -> Subscription | None:
        return db.scalar(
            select(Subscription)
            .where(Subscription.organization_id == organization_id)
            .order_by(Subscription.created_at.desc())
        )

    def resolve(self, db: Session, organization_id: str) -> EntitlementContext:
        """Resolve the effective entitlements for an organization.

        Organizations that predate the subscriptions table have no row; they
        fall back to the free plan rather than crashing or being locked out.
        """
        now = _utcnow()
        subscription = self.get_subscription(db, organization_id)

        if subscription is None:
            plan = self.get_free_plan(db)
            start, end = _calendar_month_window(now)
            return EntitlementContext(
                organization_id=organization_id,
                plan_code=plan.code if plan else FREE_PLAN_CODE,
                plan_name=plan.name if plan else "Free",
                subscription_status=SubscriptionStatus.active,
                entitlements=dict(plan.entitlements) if plan else dict(FALLBACK_ENTITLEMENTS),
                period_start=start,
                period_end=end,
                plan=plan,
            )

        plan = subscription.plan or self.get_free_plan(db)
        effective_status = self.effective_status(subscription, now=now)
        period_start = _as_aware(subscription.current_period_start)
        period_end = _as_aware(subscription.current_period_end)
        if period_start is None or period_end is None:
            period_start, period_end = _calendar_month_window(now)

        return EntitlementContext(
            organization_id=organization_id,
            plan_code=plan.code if plan else FREE_PLAN_CODE,
            plan_name=plan.name if plan else "Free",
            subscription_status=effective_status,
            entitlements=dict(plan.entitlements) if plan else dict(FALLBACK_ENTITLEMENTS),
            period_start=period_start,
            period_end=period_end,
            subscription=subscription,
            plan=plan,
        )

    def effective_status(self, subscription: Subscription, *, now: datetime | None = None) -> str:
        """Status with the clock applied -- a lapsed period reads as expired."""
        now = now or _utcnow()
        if subscription.status in {SubscriptionStatus.canceled, SubscriptionStatus.expired}:
            return subscription.status
        trial_ends_at = _as_aware(subscription.trial_ends_at)
        if subscription.status == SubscriptionStatus.trialing and trial_ends_at and trial_ends_at < now:
            return SubscriptionStatus.expired
        period_end = _as_aware(subscription.current_period_end)
        if period_end and period_end < now:
            return SubscriptionStatus.expired
        return subscription.status

    # ------------------------------------------------------------------ usage
    def usage_for(self, db: Session, context: EntitlementContext, key: str) -> int:
        if key == ENTITLEMENT_MAX_USERS:
            return int(
                db.scalar(
                    select(func.count(User.id)).where(User.organization_id == context.organization_id)
                )
                or 0
            )
        source = _USAGE_SOURCES.get(key)
        if source is None:
            return 0
        event_type, period_scoped = source
        query = select(func.coalesce(func.sum(UsageEvent.quantity), 0)).where(
            UsageEvent.organization_id == context.organization_id,
            UsageEvent.event_type == event_type,
        )
        if period_scoped:
            query = query.where(
                UsageEvent.occurred_at >= context.period_start,
                UsageEvent.occurred_at <= context.period_end,
            )
        return int(db.scalar(query) or 0)

    def usage_summary(self, db: Session, organization_id: str) -> dict:
        """Current-period usage vs. plan limits. Shared by billing + dashboard."""
        context = self.resolve(db, organization_id)
        limits: dict[str, dict] = {}
        for key in (
            ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH,
            ENTITLEMENT_MAX_USERS,
            ENTITLEMENT_MAX_STORAGE_BYTES,
            ENTITLEMENT_MAX_API_CALLS_PER_MONTH,
            ENTITLEMENT_MAX_SMS_PER_MONTH,
        ):
            limit = context.limit(key)
            used = self.usage_for(db, context, key)
            limits[key] = {
                "limit": limit,
                "used": used,
                "remaining": None if limit is None else max(limit - used, 0),
                "exceeded": limit is not None and used >= limit,
            }
        limits[ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT] = {
            "limit": context.limit(ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT),
            "used": 0,
            "remaining": None,
            "exceeded": False,
        }

        totals = {
            event_type.value: int(
                db.scalar(
                    select(func.coalesce(func.sum(UsageEvent.quantity), 0)).where(
                        UsageEvent.organization_id == organization_id,
                        UsageEvent.event_type == event_type,
                        UsageEvent.occurred_at >= context.period_start,
                        UsageEvent.occurred_at <= context.period_end,
                    )
                )
                or 0
            )
            for event_type in UsageEventType
        }
        return {
            "organization_id": organization_id,
            "plan_code": context.plan_code,
            "plan_name": context.plan_name,
            "subscription_status": context.subscription_status,
            "period_start": context.period_start,
            "period_end": context.period_end,
            "limits": limits,
            "period_totals": totals,
            "features": {
                key: value
                for key, value in context.entitlements.items()
                if isinstance(value, bool)
            },
            "rows": self._usage_rows(context, limits, totals),
        }

    def _usage_rows(self, context: EntitlementContext, limits: dict, totals: dict) -> list[dict]:
        """Presentation-ready metering rows (BIL-11).

        Derived from the same limits/totals the enforcement path uses, so the
        table can never disagree with what a 402 says.
        """
        rows: list[dict] = []
        for key, label, event_type in _USAGE_ROW_DEFS:
            entry = limits.get(key)
            if entry is not None:
                limit = entry["limit"]
                used = entry["used"]
            else:
                limit = context.entitlements.get(key)
                if isinstance(limit, bool):
                    limit = None
                used = int(totals.get(event_type, 0))
            fmt = _format_bytes if key == ENTITLEMENT_MAX_STORAGE_BYTES else _format_count
            if limit:
                pct = min(100, int(round(used * 100 / limit)))
                display = f"{fmt(used)} of {fmt(limit)}"
            else:
                pct = 0
                display = f"{fmt(used)} of unlimited"
            rows.append(
                {"key": key, "label": label, "used": used, "limit": limit, "pct": pct, "display": display}
            )
        return rows

    def record_usage(
        self,
        db: Session,
        *,
        organization_id: str,
        event_type: UsageEventType,
        quantity: int = 1,
        document_id: str | None = None,
        metadata: dict | None = None,
    ) -> UsageEvent:
        """Append a metering row. Caller owns the commit, as elsewhere."""
        event = UsageEvent(
            organization_id=organization_id,
            document_id=document_id,
            event_type=event_type,
            quantity=quantity,
            event_metadata=metadata,
        )
        db.add(event)
        return event

    # ----------------------------------------------------------------- checks
    def ensure_active(self, db: Session, organization_id: str) -> EntitlementContext:
        context = self.resolve(db, organization_id)
        if not context.can_perform_billable_actions:
            raise HTTPException(
                status_code=PAYMENT_REQUIRED,
                detail={
                    "error": "subscription_inactive",
                    "message": (
                        "Your subscription is "
                        f"{context.subscription_status}. Existing documents remain readable and "
                        "downloadable; reactivate your plan to send new documents."
                    ),
                    "plan": context.plan_code,
                    "subscription_status": context.subscription_status,
                },
            )
        return context

    def check_entitlement(
        self,
        db: Session,
        organization_id: str,
        key: str,
        amount: int = 1,
    ) -> EntitlementContext:
        """Assert org may consume ``amount`` of ``key``. Raises 402 otherwise."""
        context = self.ensure_active(db, organization_id)
        limit = context.limit(key)

        if isinstance(limit, bool):
            if not limit:
                raise HTTPException(
                    status_code=PAYMENT_REQUIRED,
                    detail={
                        "error": "feature_not_available",
                        "feature": key,
                        "message": f"The '{key}' feature is not included in the {context.plan_name} plan.",
                        "plan": context.plan_code,
                        "subscription_status": context.subscription_status,
                    },
                )
            return context

        if limit is None:  # unlimited
            return context

        if key == ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT:
            used = 0
            projected = amount
        else:
            used = self.usage_for(db, context, key)
            projected = used + amount

        if projected > limit:
            raise HTTPException(
                status_code=PAYMENT_REQUIRED,
                detail={
                    "error": "entitlement_limit_reached",
                    "limit": key,
                    "limit_value": limit,
                    "current_usage": used,
                    "requested": amount,
                    "plan": context.plan_code,
                    "plan_name": context.plan_name,
                    "subscription_status": context.subscription_status,
                    "message": (
                        f"The {context.plan_name} plan allows {limit} for '{key}'. "
                        "Upgrade your plan to continue."
                    ),
                },
            )
        return context

    def has_headroom(self, db: Session, organization_id: str, key: str, amount: int = 1) -> bool:
        """Non-raising form of :meth:`check_entitlement`.

        For metered work that must degrade rather than fail -- an exhausted SMS
        allowance falls back to emailing the code instead of blocking a signer
        mid-session.
        """
        context = self.resolve(db, organization_id)
        limit = context.limit(key)
        if isinstance(limit, bool):
            return limit
        if limit is None:
            return True
        return self.usage_for(db, context, key) + amount <= limit

    def has_feature(self, db: Session, organization_id: str, key: str) -> bool:
        return bool(self.resolve(db, organization_id).entitlements.get(key))

    # ------------------------------------------------------------- dependency
    def requires(self, key: str, amount: int = 1) -> Callable:
        """FastAPI dependency wrapper: ``Depends(entitlement_service.requires(k))``."""

        def dependency(
            db: Session = Depends(get_db),
            user: User = Depends(get_current_user),
        ) -> EntitlementContext:
            return self.check_entitlement(db, user.organization_id, key, amount)

        return dependency

    def requires_active_subscription(self) -> Callable:
        def dependency(
            db: Session = Depends(get_db),
            user: User = Depends(get_current_user),
        ) -> EntitlementContext:
            return self.ensure_active(db, user.organization_id)

        return dependency


entitlement_service = EntitlementService()
