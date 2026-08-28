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
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.charge import Charge
from app.models.invoice import Invoice, InvoiceStatus
from app.models.organization import Organization
from app.models.payment_method import PaymentMethod
from app.models.plan import DEFAULT_PLANS, FREE_PLAN_CODE, Plan
from app.models.subscription import (
    ProcessedWebhookEvent,
    Subscription,
    SubscriptionStatus,
)
from app.models.user import User
from app.services.entitlement_service import entitlement_service


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; every comparison here is in UTC."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


#: A payment method carrying this in ``meta`` always declines under the
#: development provider. Nothing else in the app treats it specially.
DEV_DECLINE_MARKER = "dev_decline"

#: How many collection attempts before an invoice is handed to a human.
MAX_DUNNING_STEP = 4


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


@dataclass
class ProviderPaymentMethod:
    """Display metadata for a tokenised instrument. Never holds a PAN."""

    provider_payment_method_id: str
    label: str
    brand: str | None = None
    last4: str | None = None
    exp_month: int | None = None
    exp_year: int | None = None
    country: str | None = None


@dataclass
class ProviderChargeResult:
    provider_payment_id: str
    status: str  # succeeded | failed
    method_label: str | None = None
    decline_code: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded"


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

    # -- Instruments, seats and collection ---------------------------------
    # Deliberately concrete-with-NotImplementedError rather than @abstractmethod:
    # a provider adapter can be written incrementally without breaking import.

    def attach_payment_method(
        self,
        *,
        organization_id: str,
        type: str,
        provider_token: str | None,
        holder_name: str | None = None,
        country: str | None = None,
    ) -> ProviderPaymentMethod:
        raise NotImplementedError

    def detach_payment_method(self, *, payment_method: "PaymentMethod") -> None:
        raise NotImplementedError

    def set_default_payment_method(
        self, *, organization_id: str, payment_method: "PaymentMethod"
    ) -> None:
        raise NotImplementedError

    def update_seats(self, *, subscription: Subscription, seats: int) -> None:
        raise NotImplementedError

    def set_billing_cycle(self, *, subscription: Subscription, cycle: str) -> None:
        raise NotImplementedError

    def charge_invoice(
        self, *, invoice: "Invoice", payment_method: "PaymentMethod | None"
    ) -> ProviderChargeResult:
        raise NotImplementedError


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

    # ---- instruments, seats and collection (deterministic, offline) -------

    _BRANDS = {"card": "Visa", "ach": "ACH", "sepa": "SEPA", "invoice": "Invoice"}

    @staticmethod
    def _stable(prefix: str, *parts: str) -> str:
        digest = hashlib.sha256("|".join(parts).encode()).hexdigest()
        return f"{prefix}_{digest[:24]}"

    def attach_payment_method(
        self,
        *,
        organization_id: str,
        type: str,
        provider_token: str | None,
        holder_name: str | None = None,
        country: str | None = None,
    ) -> ProviderPaymentMethod:
        seed = provider_token or f"{organization_id}:{type}"
        digest = hashlib.sha256(seed.encode()).hexdigest()
        # Deterministic, obviously-synthetic display data. Same token in ->
        # same instrument out, which is what makes the dev flow reproducible.
        last4 = f"{int(digest[:8], 16) % 10000:04d}"
        brand = self._BRANDS.get(type, type.upper())
        if type == "invoice":
            label = "Invoice / wire transfer"
            last4 = None
            exp_month = exp_year = None
        else:
            label = f"{brand} •••• {last4}"
            exp_month = (int(digest[8:10], 16) % 12) + 1
            exp_year = _utcnow().year + 3
        return ProviderPaymentMethod(
            provider_payment_method_id=self._stable("pm_null", seed),
            label=label,
            brand=brand,
            last4=last4,
            exp_month=exp_month,
            exp_year=exp_year,
            country=country,
        )

    def detach_payment_method(self, *, payment_method: "PaymentMethod") -> None:
        return None

    def set_default_payment_method(
        self, *, organization_id: str, payment_method: "PaymentMethod"
    ) -> None:
        return None

    def update_seats(self, *, subscription: Subscription, seats: int) -> None:
        return None

    def set_billing_cycle(self, *, subscription: Subscription, cycle: str) -> None:
        return None

    def charge_invoice(
        self, *, invoice: "Invoice", payment_method: "PaymentMethod | None"
    ) -> ProviderChargeResult:
        """Always succeeds, except for the two deterministic failure cases:
        no instrument at all, or the reserved ``dev_decline`` marker (which
        lets a developer or a test exercise the dunning path)."""
        if payment_method is None:
            return ProviderChargeResult(
                provider_payment_id=self._stable("pi_null", invoice.id, "nopm"),
                status="failed",
                decline_code="no_payment_method",
            )
        if (payment_method.meta or "") == DEV_DECLINE_MARKER:
            return ProviderChargeResult(
                provider_payment_id=self._stable("pi_null", invoice.id, payment_method.id),
                status="failed",
                method_label=payment_method.label or None,
                decline_code="card_declined",
            )
        return ProviderChargeResult(
            provider_payment_id=self._stable("pi_null", invoice.id, payment_method.id),
            status="succeeded",
            method_label=payment_method.label or None,
        )

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
        """Move an organization onto ``plan_code``, keeping its billing period.

        A mid-cycle plan change does not restart the cycle: the tenant keeps
        the period they already paid for and the difference is prorated (see
        ``preview_plan_change``). The period only restarts when the old one has
        lapsed or the billing interval itself changes.
        """
        plan = self.get_plan_by_code(db, plan_code)
        subscription = self.get_or_create_subscription(db, organization_id)
        previous_plan = subscription.plan
        self.provider.change_plan(subscription=subscription, plan=plan)
        now = _utcnow()
        period_end = _aware(subscription.current_period_end)
        keeps_period = (
            period_end is not None
            and period_end > now
            and subscription.current_period_start is not None
            and (previous_plan is None or previous_plan.billing_interval == plan.billing_interval)
        )
        subscription.plan_id = plan.id
        subscription.cancel_at_period_end = False
        subscription.canceled_at = None
        if plan.trial_days and subscription.status != SubscriptionStatus.active:
            subscription.status = SubscriptionStatus.trialing
            subscription.trial_ends_at = now + timedelta(days=plan.trial_days)
        else:
            subscription.status = SubscriptionStatus.active
        if not keeps_period:
            subscription.current_period_start = now
            subscription.current_period_end = now + timedelta(
                days=365 if plan.billing_interval == "year" else 30
            )
        db.commit()
        db.refresh(subscription)
        return subscription

    def change_plan_with_proration(
        self, db: Session, *, organization_id: str, plan_code: str
    ) -> tuple[Subscription, dict[str, Any]]:
        """``change_plan`` plus the proration figures the preview promised."""
        preview = self.preview_plan_change(db, organization_id=organization_id, plan_code=plan_code)
        subscription = self.change_plan(db, organization_id=organization_id, plan_code=plan_code)
        return subscription, preview

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
        record.processed = bool(handled)
        record.status_code = 200 if handled else 202
        db.add(record)
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


    # ------------------------------------------------------------ tenant math
    #
    # Money is derived, never stored twice. Every figure below falls out of
    # `plans` (unit price) x `organizations.seats_licensed` (quantity) x
    # `organizations.billing_cycle` (period), so changing a plan row changes
    # every number the UI shows without a backfill.

    def organization(self, db: Session, organization_id: str) -> Organization:
        org = db.get(Organization, organization_id)
        if org is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
        return org

    def seat_counts(self, db: Session, organization_id: str) -> tuple[int, int]:
        """``(seats_licensed, seats_activated)``.

        ``seats_activated`` is the real user count. ``seats_licensed`` is what
        the tenant pays for; organizations predating the column have 0, which
        reads as "licensed exactly what is in use" rather than as free.
        """
        activated = int(
            db.scalar(select(func.count(User.id)).where(User.organization_id == organization_id)) or 0
        )
        org = self.organization(db, organization_id)
        licensed = org.seats_licensed or 0
        if licensed <= 0:
            licensed = max(activated, 1)
        return licensed, activated

    @staticmethod
    def monthly_unit_cents(plan: Plan) -> int:
        """Price of one unit (one seat, or the whole plan) for one month."""
        unit = plan.seat_price_cents if (plan.is_seat_based and plan.seat_price_cents is not None) else plan.price_cents
        if plan.billing_interval == "year":
            return round(unit / 12)
        return unit

    @classmethod
    def monthly_amount_cents(cls, plan: Plan, seats: int) -> int:
        unit = cls.monthly_unit_cents(plan)
        return unit * max(seats, 1) if plan.is_seat_based else unit

    @classmethod
    def invoice_amount_cents(cls, plan: Plan, seats: int, cycle: str) -> int:
        """What a single invoice for ``cycle`` costs. Annual is 12x monthly;
        there is no annual discount in the catalogue today."""
        monthly = cls.monthly_amount_cents(plan, seats)
        return monthly * 12 if cycle == "annual" else monthly

    @staticmethod
    def remaining_fraction(subscription: Subscription | None, now: datetime | None = None) -> float:
        """Unused share of the current period, in [0, 1]. 1.0 when unknown."""
        now = now or _utcnow()
        if subscription is None:
            return 1.0
        start = _aware(subscription.current_period_start)
        end = _aware(subscription.current_period_end)
        if start is None or end is None or end <= start:
            return 1.0
        span = (end - start).total_seconds()
        left = (end - now).total_seconds()
        return max(0.0, min(1.0, left / span))

    def next_invoice(self, db: Session, organization_id: str) -> dict[str, Any]:
        """The upcoming-invoice preview (BIL-4). Pure computation, no writes."""
        subscription = self.get_or_create_subscription(db, organization_id)
        plan = subscription.plan or self.get_plan_by_code(db, FREE_PLAN_CODE)
        org = self.organization(db, organization_id)
        cycle = org.billing_cycle or "monthly"
        licensed, activated = self.seat_counts(db, organization_id)

        unit = self.monthly_unit_cents(plan)
        if cycle == "annual":
            unit *= 12
        quantity = licensed if plan.is_seat_based else 1
        suffix = "year" if cycle == "annual" else "month"
        line_items = [
            {
                "description": (
                    f"{plan.name} plan — {quantity} seat{'s' if quantity != 1 else ''} / {suffix}"
                    if plan.is_seat_based
                    else f"{plan.name} plan / {suffix}"
                ),
                "quantity": quantity,
                "unit_cents": unit,
                "amount_cents": unit * quantity,
            }
        ]
        subtotal = sum(item["amount_cents"] for item in line_items)
        return {
            "organization_id": organization_id,
            "plan_code": plan.code,
            "plan_name": plan.name,
            "cycle": cycle,
            "seats_licensed": licensed,
            "seats_activated": activated,
            "period_start": _aware(subscription.current_period_start),
            "period_end": _aware(subscription.current_period_end),
            "currency": plan.currency,
            "line_items": line_items,
            "subtotal_cents": subtotal,
            # No tax engine is wired up; the field exists so the client never
            # has to guess where tax will appear.
            "tax_cents": 0,
            "total_cents": subtotal,
            "due_at": _aware(subscription.current_period_end),
        }

    # ------------------------------------------------------- plan transitions
    def preview_plan_change(self, db: Session, *, organization_id: str, plan_code: str) -> dict[str, Any]:
        target = self.get_plan_by_code(db, plan_code)
        subscription = self.get_or_create_subscription(db, organization_id)
        current = subscription.plan or self.get_plan_by_code(db, FREE_PLAN_CODE)
        org = self.organization(db, organization_id)
        cycle = org.billing_cycle or "monthly"
        licensed, _ = self.seat_counts(db, organization_id)

        current_amount = self.invoice_amount_cents(current, licensed, cycle)
        target_amount = self.invoice_amount_cents(target, licensed, cycle)
        fraction = self.remaining_fraction(subscription)
        proration = round((target_amount - current_amount) * fraction)
        return {
            "current_plan_code": current.code,
            "current_plan_name": current.name,
            "target_plan_code": target.code,
            "target_plan_name": target.name,
            "cycle": cycle,
            "seats_licensed": licensed,
            "current_amount_cents": current_amount,
            "target_amount_cents": target_amount,
            "proration_cents": proration,
            "remaining_fraction": round(fraction, 6),
            "effective_at": _utcnow(),
            "next_invoice_total_cents": target_amount,
            "next_invoice_at": _aware(subscription.current_period_end),
            "is_downgrade": target_amount < current_amount,
        }

    # ---------------------------------------------------------------- seats
    def change_seats(self, db: Session, *, organization_id: str, delta: int) -> dict[str, Any]:
        """Add or remove licensed seats (BIL-8).

        Seats can never drop below the number of users actually provisioned:
        removing a seat someone is sitting in would silently lock them out.
        """
        subscription = self.get_or_create_subscription(db, organization_id)
        plan = subscription.plan or self.get_plan_by_code(db, FREE_PLAN_CODE)
        org = self.organization(db, organization_id)
        licensed, activated = self.seat_counts(db, organization_id)
        target = licensed + delta
        floor = max(activated, 1)
        if target < floor:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Cannot reduce to {target} seats: {activated} are in use. "
                    "Remove members first."
                ),
            )
        if delta > 0:
            entitlement_service.check_entitlement(db, organization_id, "max_users", amount=delta)

        cycle = org.billing_cycle or "monthly"
        before = self.invoice_amount_cents(plan, licensed, cycle)
        after = self.invoice_amount_cents(plan, target, cycle)
        fraction = self.remaining_fraction(subscription)
        proration = round((after - before) * fraction)

        self.provider.update_seats(subscription=subscription, seats=target)
        org.seats_licensed = target
        db.add(org)
        db.commit()
        db.refresh(subscription)
        return {
            "seats_licensed": target,
            "seats_activated": activated,
            "proration_cents": proration,
            "effective_at": _utcnow(),
            "subscription": subscription,
        }

    def set_billing_cycle(self, db: Session, *, organization_id: str, cycle: str) -> Organization:
        subscription = self.get_or_create_subscription(db, organization_id)
        org = self.organization(db, organization_id)
        if cycle not in {"monthly", "annual"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown billing cycle")
        self.provider.set_billing_cycle(subscription=subscription, cycle=cycle)
        org.billing_cycle = cycle
        db.add(org)
        db.commit()
        db.refresh(org)
        return org

    def update_settings(self, db: Session, *, organization_id: str, changes: dict[str, Any]) -> Organization:
        org = self.organization(db, organization_id)
        if "cycle" in changes and changes["cycle"] is not None:
            self.set_billing_cycle(db, organization_id=organization_id, cycle=changes["cycle"])
            db.refresh(org)
        for field_name in ("autopay", "billing_email", "tax_id"):
            if field_name in changes and changes[field_name] is not None:
                setattr(org, field_name, changes[field_name])
        pm_id = changes.get("default_payment_method_id")
        if pm_id:
            self.set_default_payment_method(db, organization_id=organization_id, payment_method_id=pm_id)
            db.refresh(org)
        po_number = changes.get("po_number")
        if po_number is not None and org.default_payment_method_id:
            default = db.get(PaymentMethod, org.default_payment_method_id)
            if default is not None and default.organization_id == organization_id:
                default.po_number = po_number
                db.add(default)
        db.add(org)
        db.commit()
        db.refresh(org)
        return org

    def settings_response(self, db: Session, organization_id: str) -> dict[str, Any]:
        org = self.organization(db, organization_id)
        po_number = None
        if org.default_payment_method_id:
            default = db.get(PaymentMethod, org.default_payment_method_id)
            po_number = default.po_number if default else None
        return {
            "organization_id": org.id,
            "autopay": bool(org.autopay),
            "billing_email": org.billing_email,
            "tax_id": org.tax_id,
            "cycle": org.billing_cycle or "monthly",
            "default_payment_method_id": org.default_payment_method_id,
            "po_number": po_number,
            "currency": "USD",
        }

    # ------------------------------------------------------- payment methods
    def list_payment_methods(self, db: Session, organization_id: str) -> list[PaymentMethod]:
        return list(
            db.scalars(
                select(PaymentMethod)
                .where(PaymentMethod.organization_id == organization_id)
                .order_by(PaymentMethod.is_default.desc(), PaymentMethod.created_at)
            )
        )

    def get_payment_method(self, db: Session, *, organization_id: str, payment_method_id: str) -> PaymentMethod:
        pm = db.get(PaymentMethod, payment_method_id)
        # Cross-tenant id is a 404, never a 403 (see documents/invoices).
        if pm is None or pm.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment method not found")
        return pm

    def add_payment_method(
        self,
        db: Session,
        *,
        organization_id: str,
        type: str,
        provider_token: str | None = None,
        holder_name: str | None = None,
        country: str | None = None,
        po_number: str | None = None,
        make_default: bool = False,
    ) -> PaymentMethod:
        provider = self.provider
        details = provider.attach_payment_method(
            organization_id=organization_id,
            type=type,
            provider_token=provider_token,
            holder_name=holder_name,
            country=country,
        )
        existing = self.list_payment_methods(db, organization_id)
        pm = PaymentMethod(
            organization_id=organization_id,
            type=type,
            brand=details.brand,
            last4=details.last4,
            exp_month=details.exp_month,
            exp_year=details.exp_year,
            holder_name=holder_name,
            country=details.country or country,
            label=details.label,
            po_number=po_number,
            provider=provider.name,
            provider_payment_method_id=details.provider_payment_method_id,
            is_default=False,
        )
        db.add(pm)
        db.flush()
        if make_default or not existing:
            self._promote_default(db, organization_id=organization_id, payment_method=pm)
        db.commit()
        db.refresh(pm)
        return pm

    def _promote_default(self, db: Session, *, organization_id: str, payment_method: PaymentMethod) -> None:
        for other in self.list_payment_methods(db, organization_id):
            if other.id != payment_method.id and other.is_default:
                other.is_default = False
                db.add(other)
        payment_method.is_default = True
        db.add(payment_method)
        org = self.organization(db, organization_id)
        org.default_payment_method_id = payment_method.id
        db.add(org)
        self.provider.set_default_payment_method(
            organization_id=organization_id, payment_method=payment_method
        )

    def set_default_payment_method(
        self, db: Session, *, organization_id: str, payment_method_id: str
    ) -> PaymentMethod:
        pm = self.get_payment_method(
            db, organization_id=organization_id, payment_method_id=payment_method_id
        )
        self._promote_default(db, organization_id=organization_id, payment_method=pm)
        db.commit()
        db.refresh(pm)
        return pm

    def remove_payment_method(self, db: Session, *, organization_id: str, payment_method_id: str) -> None:
        pm = self.get_payment_method(
            db, organization_id=organization_id, payment_method_id=payment_method_id
        )
        self.provider.detach_payment_method(payment_method=pm)
        org = self.organization(db, organization_id)
        was_default = pm.is_default or org.default_payment_method_id == pm.id
        db.delete(pm)
        db.flush()
        if was_default:
            org.default_payment_method_id = None
            db.add(org)
            remaining = self.list_payment_methods(db, organization_id)
            if remaining:
                self._promote_default(db, organization_id=organization_id, payment_method=remaining[0])
        db.commit()

    def default_payment_method(self, db: Session, organization_id: str) -> PaymentMethod | None:
        org = self.organization(db, organization_id)
        if org.default_payment_method_id:
            pm = db.get(PaymentMethod, org.default_payment_method_id)
            if pm is not None and pm.organization_id == organization_id:
                return pm
        methods = self.list_payment_methods(db, organization_id)
        return methods[0] if methods else None

    # -------------------------------------------------------------- charges
    def list_charges(
        self, db: Session, organization_id: str, *, limit: int = 50, offset: int = 0
    ) -> list[Charge]:
        return list(
            db.scalars(
                select(Charge)
                .where(Charge.organization_id == organization_id)
                .order_by(Charge.occurred_at.desc())
                .limit(limit)
                .offset(offset)
            )
        )

    # ------------------------------------------------------------- invoices
    def collect_invoice(
        self, db: Session, *, invoice: Invoice, payment_method_id: str | None = None
    ) -> Invoice:
        """Attempt collection on an invoice (BIL-10 / retry-payment).

        Idempotent: an already-paid invoice is returned untouched rather than
        charged twice. A failure leaves the invoice ``past_due`` with a
        ``failed`` charge row behind it, which is what feeds the dunning queue.
        """
        if invoice.status == InvoiceStatus.paid:
            return invoice
        if invoice.status in {InvoiceStatus.void, InvoiceStatus.uncollectible}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"An invoice with status '{invoice.status}' cannot be paid",
            )

        organization_id = invoice.organization_id
        if payment_method_id:
            payment_method = self.get_payment_method(
                db, organization_id=organization_id, payment_method_id=payment_method_id
            )
        else:
            payment_method = self.default_payment_method(db, organization_id)

        result = self.provider.charge_invoice(invoice=invoice, payment_method=payment_method)
        now = _utcnow()
        was_overdue = invoice.status == InvoiceStatus.past_due or invoice.is_overdue
        previous_failures = int(
            db.scalar(
                select(func.count(Charge.id)).where(
                    Charge.invoice_id == invoice.id, Charge.status == "failed"
                )
            )
            or 0
        )

        charge = Charge(
            organization_id=organization_id,
            invoice_id=invoice.id,
            amount_cents=invoice.amount_due_cents,
            currency=invoice.currency,
            status=("recovered" if was_overdue else "succeeded") if result.succeeded else "failed",
            provider=self.provider.name,
            provider_payment_id=result.provider_payment_id,
            method_label=result.method_label or (payment_method.label if payment_method else None),
            decline_code=result.decline_code,
            description=f"Invoice {invoice.number}",
            occurred_at=now,
        )
        invoice.provider = self.provider.name
        invoice.provider_payment_intent_id = result.provider_payment_id
        if payment_method is not None:
            invoice.payment_method_label = payment_method.label or invoice.payment_method_label

        if result.succeeded:
            invoice.amount_paid_cents = invoice.total_cents
            invoice.status = InvoiceStatus.paid
            invoice.paid_at = now
        else:
            step = min(previous_failures + 1, MAX_DUNNING_STEP)
            charge.dunning_step = step
            charge.next_attempt_at = now + timedelta(days=3 * step)
            invoice.status = (
                InvoiceStatus.uncollectible if step >= MAX_DUNNING_STEP else InvoiceStatus.past_due
            )

        db.add_all([charge, invoice])
        db.commit()
        db.refresh(invoice)

        if not result.succeeded:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error": "payment_failed",
                    "invoice_id": invoice.id,
                    "invoice_status": invoice.status,
                    "decline_code": result.decline_code,
                    "dunning_step": charge.dunning_step,
                    "next_attempt_at": charge.next_attempt_at.isoformat() if charge.next_attempt_at else None,
                    "message": "The payment attempt was declined.",
                },
            )
        return invoice

    def mark_invoice_paid(self, db: Session, *, invoice: Invoice, amount_cents: int | None = None) -> Invoice:
        """Record a payment received outside the provider (wire, cheque, credit)."""
        if invoice.status == InvoiceStatus.void:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A void invoice cannot be paid")
        invoice.amount_paid_cents = invoice.total_cents if amount_cents is None else amount_cents
        if invoice.amount_paid_cents >= invoice.total_cents:
            invoice.status = InvoiceStatus.paid
            invoice.paid_at = _utcnow()
        elif invoice.status == InvoiceStatus.uncollectible:
            # A partial payment on a written-off invoice puts it back in play.
            invoice.status = InvoiceStatus.past_due
        db.add(invoice)
        db.commit()
        db.refresh(invoice)
        return invoice

    def void_invoice(self, db: Session, *, invoice: Invoice, reason: str | None = None) -> Invoice:
        if invoice.status == InvoiceStatus.paid:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A paid invoice cannot be voided; issue a credit note instead",
            )
        if invoice.status == InvoiceStatus.void:
            return invoice  # idempotent
        invoice.status = InvoiceStatus.void
        invoice.amount_paid_cents = 0
        invoice.paid_at = None
        db.add(invoice)
        db.commit()
        db.refresh(invoice)
        return invoice

    def render_invoice_pdf(self, db: Session, *, invoice: Invoice, receipt: bool = False) -> bytes:
        """Minimal server-rendered invoice/receipt (BIL-13).

        A stub in presentation only: every figure comes from the invoice row,
        so swapping in a designed template changes nothing upstream.
        """
        from io import BytesIO

        from reportlab.pdfgen import canvas as pdf_canvas

        org = db.get(Organization, invoice.organization_id)
        buffer = BytesIO()
        pdf = pdf_canvas.Canvas(buffer, pagesize=(612, 792))
        y = 740
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(60, y, ("Receipt " if receipt else "Invoice ") + invoice.number)
        pdf.setFont("Helvetica", 10)
        y -= 26
        for label, value in (
            ("Organization", org.name if org else invoice.organization_id),
            ("Status", invoice.status),
            ("Period", invoice.period_label or ""),
            ("Issued", invoice.issued_at.strftime("%Y-%m-%d")),
            ("Due", invoice.due_at.strftime("%Y-%m-%d") if invoice.due_at else "—"),
            ("Payment method", invoice.payment_method_label or "—"),
        ):
            pdf.drawString(60, y, f"{label}: {value}")
            y -= 16
        y -= 10
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(60, y, "Description")
        pdf.drawRightString(540, y, "Amount")
        pdf.setFont("Helvetica", 10)
        y -= 16
        for item in invoice.line_items or []:
            pdf.drawString(60, y, str(item.get("description", "")))
            pdf.drawRightString(540, y, f"{item.get('amount_cents', 0) / 100:,.2f} {invoice.currency}")
            y -= 14
        y -= 10
        for label, cents in (
            ("Subtotal", invoice.subtotal_cents),
            ("Tax", invoice.tax_cents),
            ("Total", invoice.total_cents),
            ("Paid", invoice.amount_paid_cents),
            ("Due", invoice.amount_due_cents),
        ):
            pdf.drawRightString(480, y, label)
            pdf.drawRightString(540, y, f"{cents / 100:,.2f}")
            y -= 14
        pdf.showPage()
        pdf.save()
        return buffer.getvalue()

    # ------------------------------------------------------- webhook replay
    def replay_webhook_event(self, db: Session, *, event: ProcessedWebhookEvent) -> ProcessedWebhookEvent:
        """Re-apply a stored provider event (REV-5).

        Replay reuses ``_apply_event`` rather than the HTTP path, so a replay
        and a live delivery can never diverge.
        """
        payload = event.payload or {}
        try:
            parsed = self.provider.parse_webhook(raw_body=json.dumps(payload).encode())
        except HTTPException:
            parsed = None
        if parsed is None:
            event.processed = False
            event.status_code = 400
            event.error = "Stored payload is not replayable"
        else:
            try:
                handled = self._apply_event(db, parsed)
                event.processed = bool(handled)
                event.status_code = 200 if handled else 202
                event.error = None if handled else "No subscription matched this event"
            except HTTPException as exc:
                db.rollback()
                event = db.get(ProcessedWebhookEvent, event.id)
                event.processed = False
                event.status_code = exc.status_code
                event.error = str(exc.detail)
        event.received_at = event.received_at
        db.add(event)
        db.commit()
        db.refresh(event)
        return event


billing_service = BillingService()
