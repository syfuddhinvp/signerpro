"""Billing orchestration and the payment-provider seam.

There is no live payment provider wired up. Following the same pattern as
``app/core/email.py`` and ``app/core/storage.py``, the provider is an
abstraction with a working development implementation (``NullPaymentProvider``)
that transitions subscription state locally. Swapping in Stripe means writing
one class and setting ``BILLING_PROVIDER``; nothing else in the app changes.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.plan import DEFAULT_PLANS, FREE_PLAN_CODE, Plan
from app.models.subscription import (
    ProcessedWebhookEvent,
    Subscription,
    SubscriptionStatus,
)
from app.services.entitlement_service import entitlement_service


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def webhook_secret() -> str:
    return get_settings().billing_webhook_secret


# --------------------------------------------------------------------------
# Provider abstraction
# --------------------------------------------------------------------------


@dataclass
class CheckoutSession:
    session_id: str
    url: str
    provider: str
    plan_code: str


@dataclass
class ProviderEvent:
    """Provider-neutral webhook event."""

    event_id: str
    event_type: str
    provider: str
    subscription_id: str | None = None
    organization_id: str | None = None
    plan_code: str | None = None
    period_end: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class PaymentProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    def create_checkout_session(
        self, *, organization_id: str, plan: Plan, success_url: str, cancel_url: str
    ) -> CheckoutSession: ...

    @abstractmethod
    def cancel_subscription(self, *, subscription: Subscription, at_period_end: bool) -> None: ...

    @abstractmethod
    def change_plan(self, *, subscription: Subscription, plan: Plan) -> None: ...

    @abstractmethod
    def verify_webhook(self, *, raw_body: bytes, signature: str | None) -> bool: ...

    @abstractmethod
    def parse_webhook(self, *, raw_body: bytes) -> ProviderEvent: ...


class NullPaymentProvider(PaymentProvider):
    """Development provider: no network calls, state transitions happen locally.

    Checkout returns an in-app URL; the caller is expected to confirm it via the
    webhook endpoint (or ``billing_service.activate_subscription``) so the
    development flow exercises exactly the same code path production will.
    """

    name = "null"

    def create_checkout_session(
        self, *, organization_id: str, plan: Plan, success_url: str, cancel_url: str
    ) -> CheckoutSession:
        session_id = f"cs_null_{uuid4().hex}"
        separator = "&" if "?" in success_url else "?"
        return CheckoutSession(
            session_id=session_id,
            url=f"{success_url}{separator}checkout_session={session_id}&plan={plan.code}",
            provider=self.name,
            plan_code=plan.code,
        )

    def cancel_subscription(self, *, subscription: Subscription, at_period_end: bool) -> None:
        return None

    def change_plan(self, *, subscription: Subscription, plan: Plan) -> None:
        return None

    def verify_webhook(self, *, raw_body: bytes, signature: str | None) -> bool:
        if not signature:
            return False
        expected = hmac.new(webhook_secret().encode(), raw_body, hashlib.sha256).hexdigest()
        provided = signature.split("=", 1)[-1].strip()
        return hmac.compare_digest(expected, provided)

    def parse_webhook(self, *, raw_body: bytes) -> ProviderEvent:
        try:
            payload = json.loads(raw_body.decode() or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed webhook payload"
            ) from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed webhook payload")
        data = payload.get("data") or {}
        period_end = data.get("current_period_end")
        parsed_end: datetime | None = None
        if isinstance(period_end, str):
            try:
                parsed_end = datetime.fromisoformat(period_end)
            except ValueError:
                parsed_end = None
        elif isinstance(period_end, (int, float)):
            parsed_end = datetime.fromtimestamp(period_end, tz=timezone.utc)
        return ProviderEvent(
            event_id=str(payload.get("id") or ""),
            event_type=str(payload.get("type") or ""),
            provider=self.name,
            subscription_id=data.get("subscription_id"),
            organization_id=data.get("organization_id"),
            plan_code=data.get("plan_code"),
            period_end=parsed_end,
            raw=payload,
        )


def sign_webhook_body(raw_body: bytes) -> str:
    """Helper for tests and local tooling: produce a valid signature header."""
    return "sha256=" + hmac.new(webhook_secret().encode(), raw_body, hashlib.sha256).hexdigest()


_PROVIDERS: dict[str, type[PaymentProvider]] = {"null": NullPaymentProvider}


def get_payment_provider() -> PaymentProvider:
    name = get_settings().billing_provider.lower()
    return _PROVIDERS.get(name, NullPaymentProvider)()


# --------------------------------------------------------------------------
# Billing service
# --------------------------------------------------------------------------


class BillingService:
    def __init__(self, provider: PaymentProvider | None = None) -> None:
        self._provider = provider

    @property
    def provider(self) -> PaymentProvider:
        return self._provider or get_payment_provider()

    # ------------------------------------------------------------- catalogue
    def ensure_default_plans(self, db: Session) -> list[Plan]:
        """Idempotently seed the plan catalogue. Safe to call at any time."""
        created: list[Plan] = []
        for spec in DEFAULT_PLANS:
            existing = db.scalar(select(Plan).where(Plan.code == spec["code"]))
            if existing:
                continue
            plan = Plan(
                code=spec["code"],
                name=spec["name"],
                description=spec["description"],
                price_cents=spec["price_cents"],
                billing_interval=spec["billing_interval"],
                trial_days=spec["trial_days"],
                sort_order=spec["sort_order"],
                entitlements=spec["entitlements"],
                tag=spec.get("tag"),
                marketing_lines=spec.get("marketing_lines"),
                seat_price_cents=spec.get("seat_price_cents"),
                is_seat_based=spec.get("is_seat_based", False),
            )
            db.add(plan)
            created.append(plan)
        if created:
            try:
                db.commit()
            except IntegrityError:  # concurrent seeding
                db.rollback()
        return created

    def list_plans(self, db: Session, *, include_inactive: bool = False) -> list[Plan]:
        query = select(Plan).order_by(Plan.sort_order, Plan.price_cents)
        if not include_inactive:
            query = query.where(Plan.is_active == True, Plan.is_public == True)  # noqa: E712
        plans = list(db.scalars(query))
        if not plans and not include_inactive:
            self.ensure_default_plans(db)
            plans = list(db.scalars(query))
        return plans

    def get_plan_by_code(self, db: Session, code: str) -> Plan:
        plan = db.scalar(select(Plan).where(Plan.code == code))
        if plan is None:
            self.ensure_default_plans(db)
            plan = db.scalar(select(Plan).where(Plan.code == code))
        if plan is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Unknown plan '{code}'")
        return plan

    # ---------------------------------------------------------- subscriptions
    def get_or_create_subscription(self, db: Session, organization_id: str) -> Subscription:
        """Every org needs a subscription; orgs predating this table get free."""
        subscription = entitlement_service.get_subscription(db, organization_id)
        if subscription:
            return subscription
        plan = self.get_plan_by_code(db, FREE_PLAN_CODE)
        now = _utcnow()
        subscription = Subscription(
            organization_id=organization_id,
            plan_id=plan.id,
            status=SubscriptionStatus.active,
            current_period_start=now,
            current_period_end=now + timedelta(days=30),
            provider=self.provider.name,
        )
        db.add(subscription)
        db.commit()
        db.refresh(subscription)
        return subscription

    def start_checkout(
        self, db: Session, *, organization_id: str, plan_code: str, success_url: str, cancel_url: str
    ) -> CheckoutSession:
        plan = self.get_plan_by_code(db, plan_code)
        if not plan.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan is not available")
        self.get_or_create_subscription(db, organization_id)
        return self.provider.create_checkout_session(
            organization_id=organization_id, plan=plan, success_url=success_url, cancel_url=cancel_url
        )

    def change_plan(self, db: Session, *, organization_id: str, plan_code: str) -> Subscription:
        plan = self.get_plan_by_code(db, plan_code)
        subscription = self.get_or_create_subscription(db, organization_id)
        self.provider.change_plan(subscription=subscription, plan=plan)
        now = _utcnow()
        subscription.plan_id = plan.id
        subscription.cancel_at_period_end = False
        subscription.canceled_at = None
        if plan.trial_days and subscription.status != SubscriptionStatus.active:
            subscription.status = SubscriptionStatus.trialing
            subscription.trial_ends_at = now + timedelta(days=plan.trial_days)
        else:
            subscription.status = SubscriptionStatus.active
        subscription.current_period_start = now
        subscription.current_period_end = now + timedelta(days=365 if plan.billing_interval == "year" else 30)
        db.commit()
        db.refresh(subscription)
        return subscription

    def cancel(self, db: Session, *, organization_id: str, at_period_end: bool = True) -> Subscription:
        subscription = self.get_or_create_subscription(db, organization_id)
        self.provider.cancel_subscription(subscription=subscription, at_period_end=at_period_end)
        subscription.canceled_at = _utcnow()
        if at_period_end:
            subscription.cancel_at_period_end = True
        else:
            subscription.status = SubscriptionStatus.canceled
            subscription.cancel_at_period_end = False
        db.commit()
        db.refresh(subscription)
        return subscription

    def resume(self, db: Session, *, organization_id: str) -> Subscription:
        subscription = self.get_or_create_subscription(db, organization_id)
        subscription.cancel_at_period_end = False
        subscription.canceled_at = None
        if subscription.status in {SubscriptionStatus.canceled, SubscriptionStatus.expired}:
            now = _utcnow()
            subscription.status = SubscriptionStatus.active
            subscription.current_period_start = now
            subscription.current_period_end = now + timedelta(days=30)
        db.commit()
        db.refresh(subscription)
        return subscription

    # --------------------------------------------------------------- webhooks
    def handle_webhook(self, db: Session, *, raw_body: bytes, signature: str | None) -> dict[str, Any]:
        provider = self.provider
        if not provider.verify_webhook(raw_body=raw_body, signature=signature):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature"
            )
        event = provider.parse_webhook(raw_body=raw_body)
        if not event.event_id or not event.event_type:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook is missing id or type"
            )

        already = db.scalar(
            select(ProcessedWebhookEvent).where(
                ProcessedWebhookEvent.provider == event.provider,
                ProcessedWebhookEvent.event_id == event.event_id,
            )
        )
        if already:
            return {"status": "duplicate", "event_id": event.event_id}

        record = ProcessedWebhookEvent(
            provider=event.provider,
            event_id=event.event_id,
            event_type=event.event_type,
            payload=event.raw,
        )
        db.add(record)
        try:
            db.flush()
        except IntegrityError:  # raced with a concurrent delivery
            db.rollback()
            return {"status": "duplicate", "event_id": event.event_id}

        handled = self._apply_event(db, event)
        db.commit()
        return {"status": "processed" if handled else "ignored", "event_id": event.event_id}

    def _apply_event(self, db: Session, event: ProviderEvent) -> bool:
        subscription = self._resolve_subscription(db, event)
        if subscription is None:
            return False
        now = _utcnow()
        if event.event_type in {"checkout.completed", "subscription.activated", "invoice.paid"}:
            if event.plan_code:
                subscription.plan_id = self.get_plan_by_code(db, event.plan_code).id
            subscription.status = SubscriptionStatus.active
            subscription.current_period_start = now
            subscription.current_period_end = event.period_end or (now + timedelta(days=30))
            subscription.canceled_at = None
            subscription.cancel_at_period_end = False
        elif event.event_type in {"invoice.payment_failed", "subscription.past_due"}:
            subscription.status = SubscriptionStatus.past_due
        elif event.event_type in {"subscription.canceled", "subscription.deleted"}:
            subscription.status = SubscriptionStatus.canceled
            subscription.canceled_at = now
            subscription.cancel_at_period_end = False
        elif event.event_type == "subscription.expired":
            subscription.status = SubscriptionStatus.expired
        elif event.event_type == "subscription.updated" and event.plan_code:
            subscription.plan_id = self.get_plan_by_code(db, event.plan_code).id
            if event.period_end:
                subscription.current_period_end = event.period_end
        else:
            return False
        if event.subscription_id:
            subscription.provider_subscription_id = event.subscription_id
        subscription.provider = event.provider
        return True

    def _resolve_subscription(self, db: Session, event: ProviderEvent) -> Subscription | None:
        if event.subscription_id:
            found = db.scalar(
                select(Subscription).where(
                    Subscription.provider_subscription_id == event.subscription_id
                )
            )
            if found:
                return found
        if event.organization_id:
            return self.get_or_create_subscription(db, event.organization_id)
        return None


billing_service = BillingService()
