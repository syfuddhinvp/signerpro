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
from typing import Any, Callable
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.charge import Charge
from app.models.enums import WalletEntryKind
from app.models.invoice import Invoice, InvoiceStatus
from app.models.organization import Organization
from app.models.payment_method import PaymentMethod
from app.models.plan import (
    DEFAULT_PLANS,
    ENTITLEMENT_MAX_USERS,
    FREE_PLAN_CODE,
    Plan,
)
from app.models.subscription import (
    ProcessedWebhookEvent,
    Subscription,
    SubscriptionStatus,
)
from app.models.user import User
from app.services.entitlement_service import entitlement_service
from app.services.notification_service import notify_org_admins
from app.services.plan_change_service import (
    PlanChangeDirection,
    PlanChangeEffective,
    plan_change_assessor,
)
from app.services.wallet_service import wallet_service


logger = get_logger("app.services.billing")



def _coerce_effective(value: str | None) -> "PlanChangeEffective | None":
    """Parse the caller's ``effective`` flag, or ``None`` to take the default.

    An unrecognised value falls back to the default rather than raising: the
    direction-based default is always the safe one, and a typo in a query
    string should not be able to apply a downgrade a caller meant to schedule.
    """
    if not value:
        return None
    try:
        return PlanChangeEffective(value)
    except ValueError:
        return None


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

#: Payment terms on a period-close invoice.
INVOICE_DUE_DAYS = 7

#: The annual-commitment discount the pricing page advertises ("save 12%").
#: Every annual figure in this service derives from it, so the catalogue and
#: the checkout can never disagree.
ANNUAL_DISCOUNT_RATE = 0.12


def webhook_secret() -> str:
    return get_settings().billing_webhook_secret


# --------------------------------------------------------------------------
# Provider abstraction
# --------------------------------------------------------------------------


@dataclass
class CheckoutSession:
    """One checkout or setup session.

    ``url`` and ``client_secret`` are alternatives, not both: Stripe's hosted
    mode returns a redirect ``url`` and no client secret, embedded mode returns
    a ``client_secret`` the browser mounts an iframe with and no url. Callers
    must treat either as sufficient.
    """

    session_id: str
    provider: str
    plan_code: str
    url: str | None = None
    client_secret: str | None = None
    #: ``subscription`` (buy a plan) or ``setup`` (save an instrument only).
    mode: str = "subscription"
    #: ``hosted`` (redirect) or ``embedded`` (iframe in our own modal).
    ui_mode: str = "hosted"
    #: The provider customer the session was opened against, when there is one.
    #: The caller persists it on ``subscriptions.provider_customer_id``.
    customer_id: str | None = None
    #: False for a Stripe *test-mode* session. Surfaced to the UI so a test
    #: payment is never mistaken for a real one.
    livemode: bool = False


@dataclass
class CheckoutSessionStatus:
    """What the provider says about a session, read back after the return_url.

    The browser landing on a return url proves nothing -- the user can type it.
    Every claim of success in the UI is made from one of these, fetched
    server-side with the secret key.
    """

    session_id: str
    #: ``open`` | ``complete`` | ``expired``
    status: str
    mode: str = "subscription"
    payment_status: str | None = None
    subscription_id: str | None = None
    customer_id: str | None = None
    plan_code: str | None = None
    payment_method_id: str | None = None

    @property
    def complete(self) -> bool:
        return self.status == "complete"


@dataclass
class ProviderInvoice:
    """A provider's own invoice, as carried on a webhook or read back from its
    API.

    The provider is the source of truth for these figures: on a subscription
    the money is charged by Stripe, not by us, so mirroring its numbers is the
    only way the local row can agree with what the customer was actually
    billed. ``amount_*`` are minor units (cents).
    """

    provider_invoice_id: str
    currency: str = "USD"
    subtotal_cents: int = 0
    tax_cents: int = 0
    total_cents: int = 0
    amount_paid_cents: int = 0
    #: The provider's own human-facing number, when it has assigned one. A
    #: draft has none, so the local numbering series is used instead.
    number: str | None = None
    #: ``paid`` | ``open`` | ``past_due`` | ``void`` | ``draft`` --
    #: already mapped to :class:`InvoiceStatus` by the provider adapter.
    status: str = InvoiceStatus.open
    hosted_url: str | None = None
    payment_intent_id: str | None = None
    period_start: datetime | None = None
    period_end: datetime | None = None
    issued_at: datetime | None = None
    due_at: datetime | None = None
    paid_at: datetime | None = None
    line_items: list[dict[str, Any]] = field(default_factory=list)
    customer_id: str | None = None
    subscription_id: str | None = None
    organization_id: str | None = None


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
    #: Set on setup-mode checkout completions and setup_intent events, so the
    #: instrument the user just saved can be persisted from the webhook alone.
    payment_method_id: str | None = None
    customer_id: str | None = None
    #: ``subscription`` | ``setup`` | ``payment`` for a checkout session event.
    mode: str | None = None
    #: The provider's invoice, on the ``invoice.*`` events that carry one.
    #: ``_apply_event`` mirrors it into a local row -- without this a
    #: Stripe-billed subscription produced no local invoice at all until the
    #: renewal cron closed its first period, roughly a month after the customer
    #: paid.
    invoice: "ProviderInvoice | None" = None
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
    holder_name: str | None = None


@dataclass
class ProviderChargeResult:
    provider_payment_id: str
    status: str  # succeeded | failed
    method_label: str | None = None
    decline_code: str | None = None

    @property
    def succeeded(self) -> bool:
        return self.status == "succeeded"


@dataclass
class ProviderBalance:
    """The money a provider is actually holding, as the provider reports it.

    This is deliberately *not* derived from the local charge ledger. The two
    disagree for reasons that are entirely normal -- provider fees, refunds,
    reserves, payouts already made, charges that settled before this system
    existed -- and when an operator asks "what is in the account", the ledger's
    answer is a guess and the provider's is the fact.

    ``dispute_rate_pct`` is ``None`` when the provider exposes disputes but no
    trustworthy denominator to divide them by. A rate computed from a
    provider numerator over a local-ledger denominator would be a number made
    of two different books, so none is reported at all.

    ``other_currencies`` names balances held in currencies *other* than
    ``currency``, which the single-currency figures here necessarily omit. An
    empty list means the figures are the whole balance.
    """

    currency: str = "USD"
    available_cents: int = 0
    pending_cents: int = 0
    pending_settles_at: datetime | None = None
    next_payout_cents: int = 0
    next_payout_at: datetime | None = None
    disputes_cents: int = 0
    dispute_count: int = 0
    dispute_rate_pct: float | None = None
    other_currencies: list[str] = field(default_factory=list)


class PaymentProvider(ABC):
    name: str = "abstract"

    @abstractmethod
    def create_checkout_session(
        self,
        *,
        organization_id: str,
        plan: Plan,
        success_url: str,
        cancel_url: str,
        ui_mode: str = "hosted",
        return_url: str | None = None,
        customer_id: str | None = None,
    ) -> CheckoutSession: ...

    def create_setup_session(
        self,
        *,
        organization_id: str,
        customer_id: str | None,
        return_url: str,
        ui_mode: str = "embedded",
    ) -> CheckoutSession:
        """A session that saves an instrument without taking a payment.

        This is what replaces the card form the app used to render: the PAN is
        entered in the provider's own iframe and never exists in our DOM.
        """
        raise NotImplementedError

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSessionStatus:
        """Read a session back from the provider. Never trust the browser."""
        raise NotImplementedError

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
        customer_id: str | None = None,
    ) -> ProviderPaymentMethod:
        raise NotImplementedError

    def detach_payment_method(self, *, payment_method: "PaymentMethod") -> None:
        raise NotImplementedError

    def set_default_payment_method(
        self, *, organization_id: str, payment_method: "PaymentMethod", customer_id: str | None
    ) -> None:
        """Make ``payment_method`` the provider-side default for the customer.

        ``customer_id`` is threaded through because the provider needs it and
        only the caller can look it up. It was previously absent from this
        signature, which left the Stripe implementation unable to do anything
        at all -- the local default moved and the provider's did not.
        """
        raise NotImplementedError

    def update_seats(self, *, subscription: Subscription, seats: int) -> None:
        raise NotImplementedError

    def set_billing_cycle(self, *, subscription: Subscription, cycle: str) -> None:
        raise NotImplementedError

    def list_invoices(self, *, customer_id: str, limit: int = 100) -> list[ProviderInvoice]:
        """The provider's own invoices for one customer.

        Empty for a provider that does not raise its own invoices -- the local
        rows are then already the only ones there are.
        """
        return []

    def charge_invoice(
        self, *, invoice: "Invoice", payment_method: "PaymentMethod | None"
    ) -> ProviderChargeResult:
        raise NotImplementedError

    def fetch_balance(self) -> ProviderBalance | None:
        """What the provider is holding, or ``None`` if it holds nothing.

        ``None`` is not an error: a provider that never takes custody of money
        (the development one) has no balance to report, and the caller falls
        back to deriving figures from the local charge ledger.
        """
        return None


class NullPaymentProvider(PaymentProvider):
    """Development provider: no network calls, state transitions happen locally.

    Checkout returns an in-app URL; the caller is expected to confirm it via the
    webhook endpoint (or ``billing_service.activate_subscription``) so the
    development flow exercises exactly the same code path production will.
    """

    name = "null"

    def create_checkout_session(
        self,
        *,
        organization_id: str,
        plan: Plan,
        success_url: str,
        cancel_url: str,
        ui_mode: str = "hosted",
        return_url: str | None = None,
        customer_id: str | None = None,
    ) -> CheckoutSession:
        session_id = f"cs_null_{uuid4().hex}"
        if ui_mode == "embedded":
            # No provider iframe exists offline, so there is no client secret to
            # invent. The caller sees `client_secret is None` and says so rather
            # than mounting an empty frame.
            return CheckoutSession(
                session_id=session_id,
                provider=self.name,
                plan_code=plan.code,
                mode="subscription",
                ui_mode="embedded",
                customer_id=customer_id,
            )
        separator = "&" if "?" in success_url else "?"
        return CheckoutSession(
            session_id=session_id,
            url=f"{success_url}{separator}checkout_session={session_id}&plan={plan.code}",
            provider=self.name,
            plan_code=plan.code,
        )

    def create_setup_session(
        self,
        *,
        organization_id: str,
        customer_id: str | None,
        return_url: str,
        ui_mode: str = "embedded",
    ) -> CheckoutSession:
        return CheckoutSession(
            session_id=f"seti_null_{uuid4().hex}",
            provider=self.name,
            plan_code="",
            mode="setup",
            ui_mode=ui_mode,
            customer_id=customer_id or self._stable("cus_null", organization_id),
        )

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSessionStatus:
        """Offline sessions are never confirmed: there was no provider to
        complete them. Reporting ``open`` keeps the UI honest."""
        return CheckoutSessionStatus(
            session_id=session_id,
            status="open",
            mode="setup" if session_id.startswith("seti_") else "subscription",
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
        customer_id: str | None = None,
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
        self, *, organization_id: str, payment_method: "PaymentMethod", customer_id: str | None
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


# --------------------------------------------------------------------------
# Stripe provider
# --------------------------------------------------------------------------
#
# Implemented against the documented Stripe REST API rather than the SDK, so
# the adapter has no import-time dependency and -- more importantly -- so the
# network call is a single injectable seam. ``StripePaymentProvider.transport``
# follows exactly the pattern ``webhook_service._http_transport`` established:
# production uses httpx, tests substitute a callable that returns canned
# ``(status_code, json)`` pairs. No test in this repo touches the network.

STRIPE_API_BASE = "https://api.stripe.com"
STRIPE_REQUEST_TIMEOUT_SECONDS = 20.0
#: Stripe rejects a signature whose timestamp is older than this.
STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300

#: (method, url, form params, headers) -> (http status, decoded JSON body)
StripeTransport = Callable[[str, str, dict[str, Any], dict[str, str]], tuple[int, dict[str, Any]]]


def _stripe_http_transport(
    method: str, url: str, params: dict[str, Any], headers: dict[str, str]
) -> tuple[int, dict[str, Any]]:
    import httpx

    # Stripe reads a form body on writes and the query string on reads; a GET
    # with `expand[]`/`lookup_keys[]` in the body is silently ignored.
    body = params if method.upper() not in {"GET", "HEAD"} else None
    query = params if body is None else None
    response = httpx.request(
        method,
        url,
        data=body or None,
        params=query or None,
        headers=headers,
        timeout=STRIPE_REQUEST_TIMEOUT_SECONDS,
    )
    try:
        body = response.json()
    except ValueError:
        body = {}
    return response.status_code, (body if isinstance(body, dict) else {})


class StripeConfigurationError(RuntimeError):
    """Raised when the Stripe provider is selected without its credentials."""


class LiveStripeKeyOutsideProduction(StripeConfigurationError):
    """A live secret key in a non-production environment.

    This is the one misconfiguration that spends other people's money by
    accident: a developer pastes the wrong key out of the dashboard and the
    next click on "Upgrade" is a real charge on a real card. It is refused at
    construction, loudly, rather than warned about.
    """


#: Stripe's own prefixes. ``rk_`` is a restricted key, which carries the same
#: live/test split in its second segment.
LIVE_STRIPE_KEY_PREFIXES = ("sk_live_", "rk_live_")
TEST_STRIPE_KEY_PREFIXES = ("sk_test_", "rk_test_")


def is_live_stripe_key(secret_key: str | None) -> bool:
    return (secret_key or "").startswith(LIVE_STRIPE_KEY_PREFIXES)


def stripe_key_mode(secret_key: str | None) -> str:
    """``live`` | ``test`` | ``unknown``. Never guesses in favour of test."""
    if is_live_stripe_key(secret_key):
        return "live"
    if (secret_key or "").startswith(TEST_STRIPE_KEY_PREFIXES):
        return "test"
    return "unknown"


def verify_stripe_key_is_safe_here(secret_key: str, environment: str | None = None) -> None:
    """Refuse a live key outside production; warn about a test key inside it.

    The test/live distinction is otherwise invisible -- both keys work, both
    return 200s, and only one of them moves money. Making it explicit at
    construction is what stops a real payment being taken by accident.
    """
    import logging

    from app.core.config import is_production

    settings = get_settings()
    environment = environment if environment is not None else getattr(settings, "environment", "development")
    mode = stripe_key_mode(secret_key)
    if mode == "live" and not is_production(environment):
        raise LiveStripeKeyOutsideProduction(
            f"STRIPE_SECRET_KEY is a LIVE key but ENVIRONMENT={environment!r}. "
            "A live key outside production takes real payments from real cards. "
            "Use a sk_test_… key from the Stripe dashboard's test mode, or set "
            "ENVIRONMENT=production if this really is production."
        )
    if mode == "test" and is_production(environment):
        logging.getLogger("app.billing").warning(
            "billing.stripe.test_key_in_production",
            extra={"environment": environment},
        )
    if mode == "unknown":
        raise StripeConfigurationError(
            "STRIPE_SECRET_KEY does not look like a Stripe secret key "
            "(expected an sk_test_…/sk_live_…/rk_… prefix)."
        )


def _stripe_setting(name: str, env_name: str) -> str | None:
    settings = get_settings()
    value = getattr(settings, name, None)
    if not value:
        import os

        value = os.environ.get(env_name)
    return (value or "").strip() or None


class StripePaymentProvider(PaymentProvider):
    """Stripe adapter.

    Selected with ``BILLING_PROVIDER=stripe``. Credentials come from
    ``STRIPE_SECRET_KEY`` and ``STRIPE_WEBHOOK_SECRET`` (falling back to
    ``BILLING_WEBHOOK_SECRET``); a missing secret key raises at construction so
    a misconfigured deployment fails at boot rather than silently not billing.
    """

    name = "stripe"

    #: Overridable seam. Tests replace this; production uses httpx.
    transport: StripeTransport = staticmethod(_stripe_http_transport)

    def __init__(self, *, secret_key: str | None = None, webhook_secret: str | None = None) -> None:
        self._secret_key = secret_key or _stripe_setting("stripe_secret_key", "STRIPE_SECRET_KEY")
        if not self._secret_key:
            raise StripeConfigurationError(
                "BILLING_PROVIDER=stripe requires STRIPE_SECRET_KEY to be set."
            )
        verify_stripe_key_is_safe_here(self._secret_key)
        self._webhook_secret = (
            webhook_secret
            # `webhook_secret` is the parameter here, so the module-level
            # function of the same name has to be reached explicitly -- it used
            # to read `webhook_secret()`, which called None.
            or _stripe_setting("stripe_webhook_secret", "STRIPE_WEBHOOK_SECRET")
            or get_settings().billing_webhook_secret
        )

    @property
    def is_live_key(self) -> bool:
        """True when this adapter is holding real money's credentials."""
        return is_live_stripe_key(self._secret_key)

    @property
    def mode(self) -> str:
        return "live" if self.is_live_key else "test"

    # ------------------------------------------------------------- transport
    def _request(self, method: str, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        status_code, body = type(self).transport(
            method,
            f"{STRIPE_API_BASE}{path}",
            _flatten_form(params or {}),
            {
                "Authorization": f"Bearer {self._secret_key}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Stripe-Version": "2024-06-20",
            },
        )
        if status_code >= 400:
            error = (body or {}).get("error") or {}
            raise StripeApiError(
                status_code=status_code,
                message=str(error.get("message") or "Stripe request failed"),
                code=error.get("code") or error.get("decline_code"),
                body=body or {},
            )
        return body or {}

    # ------------------------------------------------------------- customers
    def _customer_id(self, subscription: Subscription) -> str:
        if subscription.provider_customer_id:
            return subscription.provider_customer_id
        created = self._request(
            "POST", "/v1/customers", {"metadata[organization_id]": subscription.organization_id}
        )
        subscription.provider_customer_id = created.get("id")
        return subscription.provider_customer_id or ""

    def _customer_for_organization(self, organization_id: str) -> str:
        created = self._request(
            "POST", "/v1/customers", {"metadata[organization_id]": organization_id}
        )
        return str(created.get("id") or "")

    # -------------------------------------------------------------- checkout
    def create_checkout_session(
        self,
        *,
        organization_id: str,
        plan: Plan,
        success_url: str,
        cancel_url: str,
        ui_mode: str = "hosted",
        return_url: str | None = None,
        customer_id: str | None = None,
    ) -> CheckoutSession:
        if not plan.external_price_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    f"Plan '{plan.code}' has no Stripe price id configured. "
                    "Run scripts/provision_stripe_plans.py."
                ),
            )
        params: dict[str, Any] = {
            "mode": "subscription",
            "line_items[0][price]": plan.external_price_id,
            "line_items[0][quantity]": 1,
            "client_reference_id": organization_id,
            "metadata[organization_id]": organization_id,
            "metadata[plan_code]": plan.code,
            # Copied onto the Subscription itself, so `customer.subscription.*`
            # webhooks carry the org and plan too -- not only the session event.
            "subscription_data[metadata][organization_id]": organization_id,
            "subscription_data[metadata][plan_code]": plan.code,
        }
        if customer_id:
            params["customer"] = customer_id
        if ui_mode == "embedded":
            # Embedded mode takes a single `return_url` and rejects
            # success_url/cancel_url outright.
            params["ui_mode"] = "embedded"
            params["return_url"] = self._return_url(return_url or success_url)
        else:
            params["success_url"] = success_url
            params["cancel_url"] = cancel_url
        session = self._request("POST", "/v1/checkout/sessions", params)
        return self._session_from(session, plan_code=plan.code, fallback_url=success_url)

    def create_setup_session(
        self,
        *,
        organization_id: str,
        customer_id: str | None,
        return_url: str,
        ui_mode: str = "embedded",
    ) -> CheckoutSession:
        # Stripe requires a customer for `mode=setup`; there is nothing to
        # attach the resulting payment method to otherwise.
        customer = customer_id or self._customer_for_organization(organization_id)
        params: dict[str, Any] = {
            "mode": "setup",
            "customer": customer,
            "currency": "usd",
            "metadata[organization_id]": organization_id,
            "setup_intent_data[metadata][organization_id]": organization_id,
        }
        if ui_mode == "embedded":
            params["ui_mode"] = "embedded"
            params["return_url"] = self._return_url(return_url)
        else:
            params["success_url"] = return_url
            params["cancel_url"] = return_url
        session = self._request("POST", "/v1/checkout/sessions", params)
        result = self._session_from(session, plan_code="", fallback_url=return_url)
        result.mode = "setup"
        result.customer_id = result.customer_id or customer
        return result

    @staticmethod
    def _return_url(url: str) -> str:
        """Stripe substitutes ``{CHECKOUT_SESSION_ID}`` on the way back, which
        is how the landing page knows which session to confirm server-side."""
        if "{CHECKOUT_SESSION_ID}" in url:
            return url
        separator = "&" if "?" in url else "?"
        return f"{url}{separator}session_id={{CHECKOUT_SESSION_ID}}"

    def _session_from(
        self, session: dict[str, Any], *, plan_code: str, fallback_url: str
    ) -> CheckoutSession:
        ui_mode = str(session.get("ui_mode") or "hosted")
        client_secret = session.get("client_secret")
        customer = session.get("customer")
        if isinstance(customer, dict):
            customer = customer.get("id")
        return CheckoutSession(
            session_id=str(session.get("id") or ""),
            provider=self.name,
            plan_code=plan_code,
            # Embedded sessions carry no url at all; a fabricated one would
            # send the browser somewhere that proves nothing.
            url=(str(session.get("url")) if session.get("url") else (None if ui_mode == "embedded" else fallback_url)),
            client_secret=str(client_secret) if client_secret else None,
            mode=str(session.get("mode") or "subscription"),
            ui_mode=ui_mode,
            customer_id=str(customer) if customer else None,
            livemode=bool(session.get("livemode", self.is_live_key)),
        )

    def retrieve_checkout_session(self, session_id: str) -> CheckoutSessionStatus:
        session = self._request(
            "GET",
            f"/v1/checkout/sessions/{session_id}",
            {"expand[0]": "setup_intent"},
        )
        metadata = session.get("metadata") or {}
        setup_intent = session.get("setup_intent")
        payment_method: Any = None
        if isinstance(setup_intent, dict):
            payment_method = setup_intent.get("payment_method")
        if isinstance(payment_method, dict):
            payment_method = payment_method.get("id")
        customer = session.get("customer")
        if isinstance(customer, dict):
            customer = customer.get("id")
        subscription = session.get("subscription")
        if isinstance(subscription, dict):
            subscription = subscription.get("id")
        return CheckoutSessionStatus(
            session_id=str(session.get("id") or session_id),
            status=str(session.get("status") or "open"),
            mode=str(session.get("mode") or "subscription"),
            payment_status=session.get("payment_status"),
            subscription_id=str(subscription) if subscription else None,
            customer_id=str(customer) if customer else None,
            plan_code=metadata.get("plan_code") or None,
            payment_method_id=str(payment_method) if payment_method else None,
        )

    # ----------------------------------------------------------- provisioning
    #
    # Used by scripts/provision_stripe_plans.py. Both calls are idempotent by
    # construction rather than by convention: the product carries an id we
    # choose, and the price carries a lookup key derived from its own amount,
    # so re-running creates nothing and changing a price creates exactly one
    # new price rather than mutating the old one (Stripe prices are immutable).

    @staticmethod
    def product_id_for(plan_code: str) -> str:
        return f"signforge_{plan_code}"

    @staticmethod
    def price_lookup_key(plan_code: str, interval: str, unit_amount: int, currency: str) -> str:
        return f"signforge_{plan_code}_{interval}_{currency.lower()}_{unit_amount}"

    def ensure_product(self, *, plan_code: str, name: str, description: str | None) -> dict[str, Any]:
        product_id = self.product_id_for(plan_code)
        try:
            return self._request("GET", f"/v1/products/{product_id}")
        except StripeApiError as exc:
            if exc.status_code != 404:
                raise
        return self._request(
            "POST",
            "/v1/products",
            {
                "id": product_id,
                "name": name,
                "description": description or "",
                "metadata[plan_code]": plan_code,
                "metadata[managed_by]": "signforge",
            },
        )

    def ensure_price(
        self,
        *,
        plan_code: str,
        product_id: str,
        unit_amount: int,
        currency: str,
        interval: str,
    ) -> dict[str, Any]:
        lookup_key = self.price_lookup_key(plan_code, interval, unit_amount, currency)
        found = self._request("GET", "/v1/prices", {"lookup_keys[0]": lookup_key, "limit": 1})
        for price in (found.get("data") or []):
            if price.get("active", True):
                return price
        return self._request(
            "POST",
            "/v1/prices",
            {
                "product": product_id,
                "unit_amount": unit_amount,
                "currency": currency.lower(),
                "recurring[interval]": interval,
                "lookup_key": lookup_key,
                "metadata[plan_code]": plan_code,
                "metadata[managed_by]": "signforge",
            },
        )

    # --------------------------------------------------------- subscriptions
    def cancel_subscription(self, *, subscription: Subscription, at_period_end: bool) -> None:
        remote = subscription.provider_subscription_id
        if not remote:
            return None
        if at_period_end:
            self._request("POST", f"/v1/subscriptions/{remote}", {"cancel_at_period_end": "true"})
        else:
            self._request("DELETE", f"/v1/subscriptions/{remote}", {})
        return None

    def change_plan(self, *, subscription: Subscription, plan: Plan) -> None:
        remote = subscription.provider_subscription_id
        if not remote:
            return None
        if not plan.external_price_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Plan '{plan.code}' has no Stripe price id configured",
            )
        current = self._request("GET", f"/v1/subscriptions/{remote}")
        items = ((current.get("items") or {}).get("data")) or []
        item_id = items[0].get("id") if items else None
        params: dict[str, Any] = {
            # This application computes, invoices and collects proration
            # itself (``preview_plan_change`` / ``change_plan``). Letting
            # Stripe prorate as well billed the same difference twice.
            "proration_behavior": "none",
            "items[0][price]": plan.external_price_id,
        }
        if item_id:
            params["items[0][id]"] = item_id
        self._request("POST", f"/v1/subscriptions/{remote}", params)
        return None

    def update_seats(self, *, subscription: Subscription, seats: int) -> None:
        remote = subscription.provider_subscription_id
        if not remote:
            return None
        current = self._request("GET", f"/v1/subscriptions/{remote}")
        items = ((current.get("items") or {}).get("data")) or []
        if not items:
            return None
        self._request(
            "POST",
            f"/v1/subscriptions/{remote}",
            {
                "items[0][id]": items[0].get("id"),
                "items[0][quantity]": max(seats, 1),
                # Same reason as ``change_plan``: ``change_seats`` already
                # invoices the prorated difference locally.
                "proration_behavior": "none",
            },
        )
        return None

    def set_billing_cycle(self, *, subscription: Subscription, cycle: str) -> None:
        # The interval lives on the Stripe price, so a cycle switch is a plan
        # change to the annual price. Modelled locally until annual price ids
        # exist in the catalogue; nothing remote to do.
        return None

    # ------------------------------------------------------------ instruments
    def attach_payment_method(
        self,
        *,
        organization_id: str,
        type: str,
        provider_token: str | None,
        holder_name: str | None = None,
        country: str | None = None,
        customer_id: str | None = None,
    ) -> ProviderPaymentMethod:
        if not provider_token:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A Stripe payment-method token is required",
            )
        existing = self._request("GET", f"/v1/payment_methods/{provider_token}")
        already_on = existing.get("customer")
        if isinstance(already_on, dict):
            already_on = already_on.get("id")
        if already_on:
            # A setup-mode Checkout session has already attached it. Attaching
            # again -- worse, to a second customer minted here -- would orphan
            # the instrument the user actually saved.
            attached = existing
        else:
            customer = customer_id or self._customer_for_organization(organization_id)
            attached = self._request(
                "POST", f"/v1/payment_methods/{provider_token}/attach", {"customer": customer}
            )
        # The instrument details hang off a block named for the kind of
        # instrument -- `card`, `us_bank_account`, `sepa_debit` -- so read the
        # one this payment method actually carries rather than assuming a card.
        kind = str(attached.get("type") or type)
        details = attached.get(kind) or attached.get("card") or {}
        billing = attached.get("billing_details") or {}
        # `brand` is the network (Visa) or the bank; when Stripe sends neither,
        # leave it unset instead of storing the instrument type as a brand --
        # a stored brand of "Card" renders as a card face with no issuer.
        brand = details.get("brand") or details.get("bank_name") or None
        last4 = details.get("last4")
        holder = holder_name or billing.get("name") or None
        # Stripe sends the network lower-cased (``visa``) and a bank name with
        # underscores; the stored brand is what the UI renders, so it is cased
        # once here rather than at every call site.
        display_brand = str(brand).replace("_", " ").title() if brand else kind.replace("_", " ").title()
        label = f"{display_brand} •••• {last4}" if last4 else display_brand
        return ProviderPaymentMethod(
            provider_payment_method_id=str(attached.get("id") or provider_token),
            label=label,
            brand=display_brand if brand else None,
            last4=last4,
            exp_month=details.get("exp_month"),
            exp_year=details.get("exp_year"),
            country=details.get("country") or (billing.get("address") or {}).get("country") or country,
            holder_name=holder,
        )

    def detach_payment_method(self, *, payment_method: "PaymentMethod") -> None:
        if payment_method.provider_payment_method_id:
            self._request(
                "POST", f"/v1/payment_methods/{payment_method.provider_payment_method_id}/detach", {}
            )
        return None

    def set_default_payment_method(
        self, *, organization_id: str, payment_method: "PaymentMethod", customer_id: str | None
    ) -> None:
        # Sets `invoice_settings.default_payment_method`, which is what Stripe
        # itself bills against -- subscription renewals and anything raised in
        # the customer portal. Without it the local default and the provider's
        # silently disagree: this application always names the instrument
        # explicitly when it charges (see charge_invoice), so the divergence is
        # invisible until something bills on Stripe's side.
        #
        # A missing customer id is not fatal and must not be: no customer
        # exists until the organization has been through checkout, and the
        # instrument is still persisted locally. Deliberately does NOT create
        # one -- a write path that silently provisions billing objects as a
        # side effect of a settings change is worse than the divergence.
        if not customer_id or not payment_method.provider_payment_method_id:
            return None
        self._request(
            "POST",
            f"/v1/customers/{customer_id}",
            {
                "invoice_settings[default_payment_method]": payment_method.provider_payment_method_id
            },
        )
        return None

    # -------------------------------------------------------------- charging
    def charge_invoice(
        self, *, invoice: "Invoice", payment_method: "PaymentMethod | None"
    ) -> ProviderChargeResult:
        if payment_method is None or not payment_method.provider_payment_method_id:
            return ProviderChargeResult(
                provider_payment_id="",
                status="failed",
                decline_code="no_payment_method",
            )
        try:
            intent = self._request(
                "POST",
                "/v1/payment_intents",
                {
                    "amount": invoice.amount_due_cents,
                    "currency": invoice.currency.lower(),
                    "payment_method": payment_method.provider_payment_method_id,
                    "confirm": "true",
                    "off_session": "true",
                    "description": f"Invoice {invoice.number}",
                    "metadata[invoice_id]": invoice.id,
                    "metadata[organization_id]": invoice.organization_id,
                },
            )
        except StripeApiError as exc:
            return ProviderChargeResult(
                provider_payment_id=str((exc.body.get("error") or {}).get("payment_intent", {}).get("id") or ""),
                status="failed",
                method_label=payment_method.label or None,
                decline_code=exc.code or "card_declined",
            )
        succeeded = intent.get("status") == "succeeded"
        return ProviderChargeResult(
            provider_payment_id=str(intent.get("id") or ""),
            status="succeeded" if succeeded else "failed",
            method_label=payment_method.label or None,
            decline_code=None if succeeded else str(intent.get("status") or "requires_action"),
        )

    # -------------------------------------------------------------- webhooks
    # ------------------------------------------------------------- invoices
    #: Stripe invoice status -> ``InvoiceStatus``. Stripe has no ``past_due``;
    #: an unpaid invoice past its due date stays ``open`` there, and
    #: ``Invoice.is_overdue`` derives the same thing locally from ``due_at``.
    _INVOICE_STATUS = {
        "draft": InvoiceStatus.draft,
        "open": InvoiceStatus.open,
        "paid": InvoiceStatus.paid,
        "void": InvoiceStatus.void,
        "uncollectible": InvoiceStatus.uncollectible,
    }

    @classmethod
    def invoice_from_object(cls, obj: dict[str, Any]) -> ProviderInvoice:
        """Map one Stripe ``invoice`` object onto :class:`ProviderInvoice`."""
        total = int(obj.get("total") or obj.get("amount_due") or 0)
        paid = int(obj.get("amount_paid") or 0)
        metadata = obj.get("metadata") or {}
        lines = ((obj.get("lines") or {}).get("data")) or []
        line_items = [
            {
                "description": str(line.get("description") or "Subscription"),
                "quantity": int(line.get("quantity") or 1),
                "unit_cents": int(
                    (line.get("price") or {}).get("unit_amount")
                    or (int(line.get("amount") or 0) // max(1, int(line.get("quantity") or 1)))
                ),
                "amount_cents": int(line.get("amount") or 0),
            }
            for line in lines
            if isinstance(line, dict)
        ]
        # Stripe puts the period on the line items, not on the invoice, for a
        # subscription; `period_start`/`period_end` on the invoice itself are
        # the *billing* window and are absent on some invoice shapes.
        first_period = next(
            (line.get("period") for line in lines if isinstance(line, dict) and line.get("period")),
            {},
        ) or {}
        subscription_id = _stripe_id(obj.get("subscription"))
        if not subscription_id:
            subscription_id = next(
                (
                    _stripe_id(line.get("subscription"))
                    for line in lines
                    if isinstance(line, dict) and line.get("subscription")
                ),
                None,
            )
        return ProviderInvoice(
            provider_invoice_id=str(obj.get("id") or ""),
            currency=str(obj.get("currency") or "usd").upper(),
            subtotal_cents=int(obj.get("subtotal") if obj.get("subtotal") is not None else total),
            tax_cents=int(obj.get("tax") or 0),
            total_cents=total,
            amount_paid_cents=paid,
            number=str(obj.get("number")) if obj.get("number") else None,
            status=cls._INVOICE_STATUS.get(str(obj.get("status") or ""), InvoiceStatus.open),
            hosted_url=str(obj.get("hosted_invoice_url")) if obj.get("hosted_invoice_url") else None,
            payment_intent_id=_stripe_id(obj.get("payment_intent")),
            period_start=_stripe_timestamp(first_period.get("start") or obj.get("period_start")),
            period_end=_stripe_timestamp(first_period.get("end") or obj.get("period_end")),
            issued_at=_stripe_timestamp(obj.get("created")),
            due_at=_stripe_timestamp(obj.get("due_date")),
            paid_at=_stripe_timestamp(
                (obj.get("status_transitions") or {}).get("paid_at")
            ),
            line_items=line_items,
            customer_id=_stripe_id(obj.get("customer")),
            subscription_id=subscription_id,
            organization_id=metadata.get("organization_id"),
        )

    def list_invoices(self, *, customer_id: str, limit: int = 100) -> list[ProviderInvoice]:
        """Every invoice Stripe holds for one customer, newest first.

        Used by the backfill (``scripts/backfill_provider_invoices.py``) to
        recover invoices for payments that settled before the webhook mirrored
        them.
        """
        invoices: list[ProviderInvoice] = []
        starting_after: str | None = None
        while True:
            params: dict[str, Any] = {"customer": customer_id, "limit": min(100, limit)}
            if starting_after:
                params["starting_after"] = starting_after
            page = self._request("GET", "/v1/invoices", params)
            rows = [row for row in (page.get("data") or []) if isinstance(row, dict)]
            invoices.extend(self.invoice_from_object(row) for row in rows)
            if not page.get("has_more") or not rows or len(invoices) >= limit:
                break
            starting_after = str(rows[-1].get("id"))
        return invoices[:limit]

    #: Dispute statuses that still represent money genuinely at risk. A
    #: `won`/`lost` dispute is settled -- counting it as "open" overstates
    #: exposure forever, since Stripe never deletes the row.
    OPEN_DISPUTE_STATUSES = frozenset(
        {"warning_needs_response", "warning_under_review", "needs_response", "under_review"}
    )

    def fetch_balance(self) -> ProviderBalance:
        """Stripe's own balance, next payout and open disputes.

        Four reads, because Stripe splits the answer four ways: `/v1/account`
        for the settlement currency, `/v1/balance` for the funds, `/v1/payouts`
        for what is scheduled to leave, `/v1/disputes` for what is contested.

        Stripe reports balances *per currency*, and this endpoint's figures are
        single-currency scalars. Rather than sum currencies into a meaningless
        total, the account's own default currency is reported and any other
        currency held is named in ``other_currencies`` so the omission is
        visible instead of silent.
        """
        account = self._request("GET", "/v1/account")
        currency = str(account.get("default_currency") or "usd").upper()
        balance = self._request("GET", "/v1/balance")

        def _sum(bucket: str) -> int:
            return sum(
                int(row.get("amount") or 0)
                for row in (balance.get(bucket) or [])
                if isinstance(row, dict) and str(row.get("currency") or "").upper() == currency
            )

        held = {
            str(row.get("currency") or "").upper()
            for bucket in ("available", "pending")
            for row in (balance.get(bucket) or [])
            if isinstance(row, dict) and int(row.get("amount") or 0) != 0
        }

        pending_cents = _sum("pending")
        # `connect_reserved` is money Stripe is holding back, which is not
        # available and not in transit -- it is simply not ours to pay out.
        available_cents = _sum("available")

        next_payout_cents, next_payout_at = self._next_payout(currency)

        disputes = self._request("GET", "/v1/disputes", {"limit": 100})
        open_disputes = [
            row
            for row in (disputes.get("data") or [])
            if isinstance(row, dict) and str(row.get("status") or "") in self.OPEN_DISPUTE_STATUSES
        ]

        return ProviderBalance(
            currency=currency,
            available_cents=available_cents,
            pending_cents=pending_cents,
            # Stripe attaches no settlement date to the pending bucket itself;
            # the next payout is the soonest that money can actually leave.
            pending_settles_at=next_payout_at if pending_cents else None,
            next_payout_cents=next_payout_cents,
            next_payout_at=next_payout_at,
            disputes_cents=sum(
                int(row.get("amount") or 0)
                for row in open_disputes
                if str(row.get("currency") or "").upper() == currency
            ),
            dispute_count=len(open_disputes),
            # Stripe offers no cheap count of settled charges for all time, and
            # dividing by the local ledger would mix two books. See
            # ``ProviderBalance.dispute_rate_pct``.
            dispute_rate_pct=None,
            other_currencies=sorted(held - {currency}),
        )

    def _next_payout(self, currency: str) -> tuple[int, datetime | None]:
        """The soonest payout not yet paid out, in ``currency``.

        Stripe splits "scheduled" across two statuses -- `pending` (created,
        not yet sent) and `in_transit` (sent, not yet arrived) -- and querying
        one of them misses payouts sitting in the other.
        """
        scheduled: list[tuple[datetime, int]] = []
        for status_name in ("pending", "in_transit"):
            # `/v1/payouts` has no `currency` filter -- passing one is a hard
            # 400 ("Received unknown parameter"), not an ignored hint -- so the
            # currency is matched on the rows that come back.
            page = self._request("GET", "/v1/payouts", {"limit": 100, "status": status_name})
            for row in page.get("data") or []:
                if not isinstance(row, dict):
                    continue
                if str(row.get("currency") or "").upper() != currency:
                    continue
                arrives_at = _stripe_timestamp(row.get("arrival_date"))
                # A payout with no arrival date cannot be called the *next*
                # one, so it is not a candidate for this figure.
                if arrives_at is not None:
                    scheduled.append((arrives_at, int(row.get("amount") or 0)))
        if not scheduled:
            return 0, None
        arrives_at, amount_cents = min(scheduled, key=lambda item: item[0])
        return amount_cents, arrives_at

        return soonest_cents, soonest_at

    def verify_webhook(self, *, raw_body: bytes, signature: str | None) -> bool:
        """Stripe's ``Stripe-Signature: t=<ts>,v1=<hex>`` scheme, constant-time."""
        if not signature:
            return False
        parts = dict(
            item.split("=", 1) for item in signature.split(",") if "=" in item
        )
        timestamp = parts.get("t")
        provided = parts.get("v1")
        if not timestamp or not provided:
            return False
        try:
            age = abs(int(_utcnow().timestamp()) - int(timestamp))
        except ValueError:
            return False
        if age > STRIPE_SIGNATURE_TOLERANCE_SECONDS:
            return False
        expected = hmac.new(
            self._webhook_secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, provided.strip())

    #: Stripe event type -> the provider-neutral type ``_apply_event`` handles.
    _EVENT_MAP = {
        "checkout.session.completed": "checkout.completed",
        "checkout.session.async_payment_succeeded": "checkout.completed",
        # A card saved without a purchase. `_apply_event` persists the
        # instrument so GET /api/billing/payment-methods reflects reality
        # whether the browser came back from the return_url or not.
        "setup_intent.succeeded": "setup.succeeded",
        "payment_method.attached": "setup.succeeded",
        "customer.subscription.created": "subscription.activated",
        "customer.subscription.updated": "subscription.updated",
        "customer.subscription.deleted": "subscription.canceled",
        "invoice.paid": "invoice.paid",
        "invoice.payment_succeeded": "invoice.paid",
        "invoice.payment_failed": "invoice.payment_failed",
    }

    def parse_webhook(self, *, raw_body: bytes) -> ProviderEvent:
        try:
            payload = json.loads(raw_body.decode() or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed webhook payload"
            ) from exc
        if not isinstance(payload, dict):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed webhook payload"
            )
        obj = ((payload.get("data") or {}).get("object")) or {}
        metadata = obj.get("metadata") or {}
        period_end = obj.get("current_period_end")
        parsed_end = (
            datetime.fromtimestamp(period_end, tz=timezone.utc)
            if isinstance(period_end, (int, float))
            else None
        )
        subscription_id = _stripe_id(obj.get("subscription")) or (
            str(obj.get("id")) if str(obj.get("object") or "") == "subscription" else None
        )
        # `setup_intent.succeeded` carries the instrument directly;
        # `payment_method.attached` *is* the instrument.
        payment_method_id = _stripe_id(obj.get("payment_method")) or (
            str(obj.get("id")) if str(obj.get("object") or "") == "payment_method" else None
        )
        invoice = (
            self.invoice_from_object(obj) if str(obj.get("object") or "") == "invoice" else None
        )
        if invoice and not subscription_id:
            subscription_id = invoice.subscription_id
        return ProviderEvent(
            event_id=str(payload.get("id") or ""),
            event_type=self._EVENT_MAP.get(str(payload.get("type") or ""), str(payload.get("type") or "")),
            provider=self.name,
            subscription_id=subscription_id,
            organization_id=metadata.get("organization_id") or obj.get("client_reference_id"),
            plan_code=metadata.get("plan_code"),
            period_end=parsed_end,
            payment_method_id=payment_method_id,
            customer_id=_stripe_id(obj.get("customer")),
            mode=str(obj.get("mode")) if obj.get("mode") else None,
            invoice=invoice,
            raw=payload,
        )


class StripeApiError(RuntimeError):
    def __init__(self, *, status_code: int, message: str, code: str | None, body: dict[str, Any]) -> None:
        super().__init__(f"Stripe {status_code}: {message}")
        self.status_code = status_code
        self.code = code
        self.body = body


def _stripe_timestamp(value: Any) -> datetime | None:
    """A Stripe unix timestamp as an aware datetime; ``None`` stays ``None``."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc)


def _stripe_id(value: Any) -> str | None:
    """Stripe returns a related object as either a bare id or an expanded dict."""
    if isinstance(value, dict):
        value = value.get("id")
    return str(value) if value else None


def _flatten_form(params: dict[str, Any]) -> dict[str, str]:
    return {key: ("" if value is None else str(value)) for key, value in params.items()}


def sign_webhook_body(raw_body: bytes) -> str:
    """Helper for tests and local tooling: produce a valid signature header."""
    return "sha256=" + hmac.new(webhook_secret().encode(), raw_body, hashlib.sha256).hexdigest()


_PROVIDERS: dict[str, type[PaymentProvider]] = {
    "null": NullPaymentProvider,
    "stripe": StripePaymentProvider,
}


class BillingProviderMisconfigured(RuntimeError):
    """``BILLING_PROVIDER`` names a provider that does not exist."""


def get_payment_provider() -> PaymentProvider:
    """Resolve the configured provider, or refuse to start.

    Previously an unknown value silently fell back to ``NullPaymentProvider``,
    which in production means every plan change succeeds and no money is ever
    collected. A typo must be loud (AUDIT_REPORT.md section 7, finding 3).
    """
    name = (get_settings().billing_provider or "").strip().lower()
    provider = _PROVIDERS.get(name)
    if provider is None:
        raise BillingProviderMisconfigured(
            f"BILLING_PROVIDER={name!r} is not a known payment provider. "
            f"Known providers: {', '.join(sorted(_PROVIDERS))}."
        )
    return provider()


#: Values that must never be the live inbound-webhook signing secret.
INSECURE_BILLING_WEBHOOK_SECRETS = {"dev-billing-webhook-secret", "changeme", "secret", ""}
MIN_BILLING_WEBHOOK_SECRET_LENGTH = 32


class InsecureBillingWebhookSecret(RuntimeError):
    """The inbound-webhook secret is a shipped default in production."""


def verify_billing_webhook_secret_configured() -> None:
    """Startup guard, mirroring ``crypto.verify_jwt_secret_configured``.

    The inbound billing webhook grants plans. With the shipped default in
    place, anyone who has read this repository can sign
    ``{"type": "subscription.activated", "plan_code": "enterprise"}`` and
    entitle themselves permanently (AUDIT_REPORT.md section 7, finding 8).
    """
    from app.core.config import is_production

    settings = get_settings()
    if not is_production(getattr(settings, "environment", "development")):
        return
    if (settings.billing_provider or "").strip().lower() == "null":
        raise BillingProviderMisconfigured(
            "BILLING_PROVIDER=null disables payment collection; it must not be used in production."
        )
    secret = (settings.billing_webhook_secret or "").strip()
    if secret.lower() in INSECURE_BILLING_WEBHOOK_SECRETS:
        raise InsecureBillingWebhookSecret(
            "BILLING_WEBHOOK_SECRET is the shipped development default; set a unique secret."
        )
    if len(secret) < MIN_BILLING_WEBHOOK_SECRET_LENGTH:
        raise InsecureBillingWebhookSecret(
            f"BILLING_WEBHOOK_SECRET must be at least {MIN_BILLING_WEBHOOK_SECRET_LENGTH} characters."
        )


def verify_payment_provider_configured() -> None:
    """Startup guard for the *outbound* credential.

    ``verify_billing_webhook_secret_configured`` covers the inbound secret. This
    covers the one that spends money: with ``BILLING_PROVIDER=stripe`` the
    secret key must exist, must look like a Stripe key, and must not be a live
    key outside production. Constructing the provider performs all three.
    """
    if (get_settings().billing_provider or "").strip().lower() != "stripe":
        return
    StripePaymentProvider()


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
        self,
        db: Session,
        *,
        organization_id: str,
        plan_code: str,
        success_url: str,
        cancel_url: str,
        ui_mode: str = "hosted",
        return_url: str | None = None,
    ) -> CheckoutSession:
        """Open a checkout session for an organization's **first** purchase.

        A Checkout Session in ``subscription`` mode *creates a new subscription
        at the provider*; it does not modify an existing one. Using it for a
        plan change therefore left the previous subscription live and billing,
        with its id overwritten locally and so unreachable by anything that
        could cancel it -- an organization on one plan here accumulated one
        live provider subscription per plan change, all charging monthly. Six
        days of switching produced four concurrent subscriptions on one
        customer.

        So an organization that already has a provider subscription cannot
        reach this path: a plan change modifies the subscription it has, which
        is ``change_plan``.
        """
        plan = self.get_plan_by_code(db, plan_code)
        if not plan.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Plan is not available")
        subscription = self.get_or_create_subscription(db, organization_id)
        if subscription.provider_subscription_id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "subscription_exists",
                    "plan_code": plan.code,
                    "message": (
                        "This organization already has a subscription. "
                        "Change the plan instead of starting a new checkout."
                    ),
                },
            )
        session = self.provider.create_checkout_session(
            organization_id=organization_id,
            plan=plan,
            success_url=success_url,
            cancel_url=cancel_url,
            ui_mode=ui_mode,
            return_url=return_url,
            customer_id=subscription.provider_customer_id,
        )
        self._remember_customer(db, subscription=subscription, customer_id=session.customer_id)
        return session

    def start_setup_session(
        self, db: Session, *, organization_id: str, return_url: str, ui_mode: str = "embedded"
    ) -> CheckoutSession:
        """Open a session that saves an instrument and takes no payment.

        This is the whole of "add a payment method": the PAN is typed into the
        provider's iframe, and the only thing that ever reaches this API is the
        session id it hands back.
        """
        subscription = self.get_or_create_subscription(db, organization_id)
        session = self.provider.create_setup_session(
            organization_id=organization_id,
            customer_id=subscription.provider_customer_id,
            return_url=return_url,
            ui_mode=ui_mode,
        )
        self._remember_customer(db, subscription=subscription, customer_id=session.customer_id)
        return session

    def _remember_customer(
        self, db: Session, *, subscription: Subscription, customer_id: str | None
    ) -> None:
        """One provider customer per organization, created lazily and kept.

        Without this every setup session would mint a fresh customer and the
        cards would scatter across all of them.
        """
        if not customer_id or subscription.provider_customer_id == customer_id:
            return
        subscription.provider_customer_id = customer_id
        db.add(subscription)
        db.commit()

    def confirm_checkout_session(
        self, db: Session, *, organization_id: str, session_id: str
    ) -> dict[str, Any]:
        """Read a session back from the provider and apply what it proves.

        The browser landing on the return url is not evidence of anything; this
        is. An incomplete session is reported as ``pending`` rather than
        rounded up to success.
        """
        subscription = self.get_or_create_subscription(db, organization_id)
        state = self.provider.retrieve_checkout_session(session_id)
        payment_method_id: str | None = None
        if not state.complete:
            return {
                "session_id": state.session_id,
                "status": state.status,
                "mode": state.mode,
                "applied": False,
                "payment_method_id": None,
            }
        self._remember_customer(db, subscription=subscription, customer_id=state.customer_id)
        if state.payment_method_id:
            stored = self._store_provider_payment_method(
                db,
                organization_id=organization_id,
                provider_payment_method_id=state.payment_method_id,
                customer_id=state.customer_id or subscription.provider_customer_id,
            )
            payment_method_id = stored.id
        if state.mode == "subscription":
            # Same transition the webhook applies, so a fast return and a slow
            # webhook cannot disagree; `_apply_event` is idempotent on state.
            self._apply_event(
                db,
                ProviderEvent(
                    event_id=f"confirm:{state.session_id}",
                    event_type="checkout.completed",
                    provider=self.provider.name,
                    subscription_id=state.subscription_id,
                    organization_id=organization_id,
                    plan_code=state.plan_code,
                ),
            )
            # The provider raised and settled an invoice for this purchase, and
            # the session carries no copy of it -- so until a webhook arrived
            # (which in a self-hosted install may be never) the plan was active
            # with no invoice or receipt anywhere the tenant or the platform
            # admin could see it. Mirror it here, off the same customer record.
            self._mirror_customer_invoices(
                db,
                organization_id=organization_id,
                customer_id=state.customer_id or subscription.provider_customer_id,
            )
        db.commit()
        return {
            "session_id": state.session_id,
            "status": state.status,
            "mode": state.mode,
            "applied": True,
            "payment_method_id": payment_method_id,
        }

    def _sync_organization_billing(
        self, db: Session, *, subscription: Subscription, plan: Plan | None = None
    ) -> None:
        """Keep ``organizations.subscription_*`` in step with the subscription.

        ``Organization.subscription_status`` is a denormalised copy that the
        platform dashboard (``saas.py``) counts and the tenant list
        (``tenants.py``) filters on, and which billing never used to write --
        so a cancelled tenant kept being counted as paying (AUDIT_REPORT.md
        section 7, finding 7). Every state transition now writes it, using the
        same clock-applied status entitlements resolve from.
        """
        org = db.get(Organization, subscription.organization_id)
        if org is None:
            return
        plan = plan or subscription.plan
        org.subscription_status = entitlement_service.effective_status(subscription)
        if plan is not None:
            org.subscription_tier = plan.code
        org.subscription_expires_at = subscription.current_period_end
        db.add(org)

    def _apply_plan_change(
        self, db: Session, *, subscription: Subscription, plan: Plan
    ) -> Subscription:
        """The local state transition only. Never call this without having
        either collected payment or established that none is owed.

        Local state is committed *before* the provider is told. The other
        order -- which this used to use -- leaves Stripe on the new plan and
        this database on the old one whenever the commit fails, and there is
        no way to tell afterwards which of the two is right.
        """
        previous_plan = subscription.plan
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
        # Any scheduled change is superseded by one that actually lands.
        subscription.pending_plan_id = None
        subscription.pending_plan_effective_at = None
        subscription.pending_plan_requested_at = None
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
        db.add(subscription)
        db.flush()
        db.refresh(subscription)
        self._sync_organization_billing(db, subscription=subscription, plan=plan)
        db.commit()
        db.refresh(subscription)

        # Told last, and a failure here is logged rather than raised: the
        # money has already moved and the tenant is already entitled. Undoing
        # a paid change because a provider call timed out is the worse
        # outcome, and the next webhook or renewal reconciles the remote side.
        try:
            self.provider.change_plan(subscription=subscription, plan=plan)
        except Exception:  # noqa: BLE001 - provider drift must not undo a paid change
            logger.exception(
                "provider plan change failed after local commit",
                extra={
                    "organization_id": subscription.organization_id,
                    "subscription_id": subscription.id,
                    "plan_code": plan.code,
                },
            )
        return subscription

    def schedule_plan_change(
        self, db: Session, *, subscription: Subscription, plan: Plan, effective_at: datetime
    ) -> Subscription:
        """Record a change to apply at ``effective_at``; charge nothing now.

        Nothing is said to the provider yet. The remote subscription is still
        correct -- the tenant really is on the old plan until the period ends.
        """
        subscription.pending_plan_id = plan.id
        subscription.pending_plan_effective_at = effective_at
        subscription.pending_plan_requested_at = _utcnow()
        db.add(subscription)
        db.commit()
        db.refresh(subscription)
        return subscription

    def cancel_pending_plan_change(self, db: Session, *, organization_id: str) -> Subscription:
        """Undo a scheduled change. Idempotent: no pending change is not an error."""
        subscription = self.get_or_create_subscription(db, organization_id)
        subscription.pending_plan_id = None
        subscription.pending_plan_effective_at = None
        subscription.pending_plan_requested_at = None
        db.add(subscription)
        db.commit()
        db.refresh(subscription)
        return subscription

    def apply_pending_plan_change(
        self, db: Session, *, subscription: Subscription, now: datetime | None = None
    ) -> bool:
        """Land a due scheduled change. Returns whether anything moved.

        Feasibility is re-checked *here*, not only when the change was
        requested: an organization that hired twelve people during the period
        would otherwise be silently dropped onto a plan that cannot hold them.
        In that case the scheduled change is abandoned and the tenant keeps
        the plan they are on, which costs them money but does not lock anyone
        out of their own account.
        """
        now = now or _utcnow()
        effective_at = _aware(subscription.pending_plan_effective_at)
        if not subscription.pending_plan_id or effective_at is None or effective_at > now:
            return False

        target = db.get(Plan, subscription.pending_plan_id)
        if target is None:
            subscription.pending_plan_id = None
            subscription.pending_plan_effective_at = None
            db.add(subscription)
            return False

        current = subscription.plan or self.get_plan_by_code(db, FREE_PLAN_CODE)
        assessment = plan_change_assessor.assess(
            db,
            organization_id=subscription.organization_id,
            current=current,
            target=target,
            direction=PlanChangeDirection.downgrade,
            effective_mode=PlanChangeEffective.immediately,
            effective_at=now,
        )
        if assessment.blockers:
            logger.warning(
                "scheduled plan change abandoned; organization outgrew the target plan",
                extra={
                    "organization_id": subscription.organization_id,
                    "plan_code": target.code,
                    "blockers": [issue.code for issue in assessment.blockers],
                },
            )
            notify_org_admins(
                db,
                organization_id=subscription.organization_id,
                title="Scheduled plan change could not be applied",
                detail=(
                    f"The switch to {target.name} was cancelled because "
                    f"{assessment.blockers[0].message} Your plan is unchanged."
                ),
            )
            subscription.pending_plan_id = None
            subscription.pending_plan_effective_at = None
            subscription.pending_plan_requested_at = None
            db.add(subscription)
            return False

        subscription.plan_id = target.id
        subscription.pending_plan_id = None
        subscription.pending_plan_effective_at = None
        subscription.pending_plan_requested_at = None
        db.add(subscription)
        db.flush()
        self._sync_organization_billing(db, subscription=subscription, plan=target)
        try:
            self.provider.change_plan(subscription=subscription, plan=target)
        except Exception:  # noqa: BLE001 - see _apply_plan_change
            logger.exception(
                "provider plan change failed while applying a scheduled change",
                extra={"organization_id": subscription.organization_id, "plan_code": target.code},
            )
        return True

    def change_plan(
        self,
        db: Session,
        *,
        organization_id: str,
        plan_code: str,
        payment_method_id: str | None = None,
        require_payment: bool = True,
        effective: str | None = None,
        quoted_amount_cents: int | None = None,
        force: bool = False,
    ) -> Subscription:
        """Move an organization onto ``plan_code``, or schedule the move.

        **An upgrade is gated on payment.** The order is the whole point: the
        invoice is issued and collected *before* the subscription row moves,
        and ``collect_invoice`` raises on a decline, so there is no
        interleaving that leaves an organization entitled-but-unpaid. Before
        this, any org admin could self-serve onto Enterprise for nothing (C7).

        **A downgrade waits.** The tenant has paid through
        ``current_period_end``; taking capacity away before then is charging
        for something and not delivering it. The change is recorded and
        ``run_renewals`` applies it when the period actually ends. Passing
        ``effective="immediately"`` overrides that, and the forfeited
        remainder is credited to the organization's balance instead of
        vanishing -- it is never refunded to a card (BIL-12).

        An upgrade does not restart the cycle: the tenant keeps the period
        they already paid for and the difference is prorated. The period only
        restarts when the old one has lapsed or the billing interval changes,
        and in the latter case the abandoned remainder is credited too.

        ``quoted_amount_cents`` is the figure the tenant was shown. If the
        real amount has moved since -- somebody added seats between the
        preview and the click -- the change is refused rather than charging a
        number nobody agreed to.
        """
        plan = self.get_plan_by_code(db, plan_code)
        subscription = self.get_or_create_subscription(db, organization_id)
        preview = self.preview_plan_change(
            db, organization_id=organization_id, plan_code=plan_code, effective=effective
        )

        if preview["blockers"] and not force:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "plan_change_blocked",
                    "target_plan": plan.code,
                    "blockers": preview["blockers"],
                    "message": preview["blockers"][0]["message"],
                },
            )

        amount_due = int(preview["amount_due_cents"])
        if quoted_amount_cents is not None and int(quoted_amount_cents) != amount_due:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "error": "quote_expired",
                    "quoted_cents": int(quoted_amount_cents),
                    "actual_cents": amount_due,
                    "message": (
                        "The price changed while you were deciding. "
                        "Review the new total and try again."
                    ),
                },
            )

        if preview["scheduled"]:
            effective_at = preview["effective_at"] or _aware(subscription.current_period_end)
            if effective_at is not None:
                return self.schedule_plan_change(
                    db, subscription=subscription, plan=plan, effective_at=effective_at
                )

        credit_cents = int(preview["wallet_credit_cents"])

        if not require_payment or amount_due <= 0:
            subscription = self._apply_plan_change(db, subscription=subscription, plan=plan)
            self._credit_change(db, subscription=subscription, preview=preview, amount=credit_cents)
            return subscription

        payment_method = self._require_payment_method(
            db,
            organization_id=organization_id,
            payment_method_id=payment_method_id,
            reason="upgrade",
        )
        invoice = self.issue_invoice(
            db,
            organization_id=organization_id,
            amount_cents=amount_due,
            line_items=[
                {
                    "description": (
                        f"Upgrade to {plan.name} — prorated for the remainder of the period"
                    ),
                    "quantity": 1,
                    "unit_cents": amount_due,
                    "amount_cents": amount_due,
                }
            ],
            currency=plan.currency,
            period_start=_aware(subscription.current_period_start),
            period_end=_aware(subscription.current_period_end),
            period_label=f"Upgrade to {plan.name}",
            due_at=_utcnow() + timedelta(days=INVOICE_DUE_DAYS),
            # A double-submitted upgrade finds the invoice it already issued
            # instead of issuing and collecting a second one.
            idempotency_key=f"plan-change:{organization_id}:{plan.code}:"
            f"{(_aware(subscription.current_period_start) or _utcnow()).date()}",
        )
        # Raises 402 on a decline, leaving the subscription on the old plan.
        # Draws down any balance the organization holds before the card.
        self.collect_invoice(db, invoice=invoice, payment_method_id=payment_method.id)
        subscription = self._apply_plan_change(db, subscription=subscription, plan=plan)
        self._credit_change(db, subscription=subscription, preview=preview, amount=credit_cents)
        return subscription

    def _credit_change(
        self,
        db: Session,
        *,
        subscription: Subscription,
        preview: dict[str, Any],
        amount: int,
    ) -> None:
        """Bank the value an immediate change gave up (BIL-12).

        Credit, never a refund: the money stays spendable inside the
        application, which is the whole design of the wallet.
        """
        if amount <= 0:
            return
        direction = preview["direction"]
        kind = (
            WalletEntryKind.interval_switch_remainder
            if direction == PlanChangeDirection.interval_switch.value
            else WalletEntryKind.downgrade_proration
        )
        description = (
            f"Unused remainder of {preview['current_plan_name']} "
            f"after switching to {preview['target_plan_name']}"
        )
        wallet_service.credit(
            db,
            organization_id=subscription.organization_id,
            amount_cents=amount,
            kind=kind,
            description=description,
            currency=preview.get("currency") or "USD",
            # The same plan change replayed credits once.
            idempotency_key=(
                f"plan-change-credit:{subscription.organization_id}:"
                f"{preview['current_plan_code']}->{preview['target_plan_code']}:"
                f"{(_aware(subscription.current_period_start) or _utcnow()).isoformat()}"
            ),
        )
        db.commit()

    def _require_payment_method(
        self,
        db: Session,
        *,
        organization_id: str,
        payment_method_id: str | None,
        reason: str,
    ) -> PaymentMethod:
        if payment_method_id:
            return self.get_payment_method(
                db, organization_id=organization_id, payment_method_id=payment_method_id
            )
        payment_method = self.default_payment_method(db, organization_id)
        if payment_method is None:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "error": "payment_method_required",
                    "reason": reason,
                    "message": (
                        "Add a payment method before "
                        f"you {'upgrade' if reason == 'upgrade' else 'purchase seats'}."
                    ),
                },
            )
        return payment_method

    # ------------------------------------------------------------- invoicing
    def _next_invoice_number(self, db: Session, *, moment: datetime) -> str:
        year = moment.year
        prefix = f"INV-{year}-"
        count = int(
            db.scalar(
                select(func.count(Invoice.id)).where(Invoice.number.like(f"{prefix}%"))
            )
            or 0
        )
        return f"{prefix}{count + 1:04d}"

    def issue_invoice(
        self,
        db: Session,
        *,
        organization_id: str,
        amount_cents: int,
        line_items: list[dict[str, Any]],
        currency: str = "USD",
        period_start: datetime | None = None,
        period_end: datetime | None = None,
        period_label: str | None = None,
        due_at: datetime | None = None,
        tax_cents: int = 0,
        idempotency_key: str | None = None,
    ) -> Invoice:
        """Create and persist an ``open`` invoice.

        This is the only constructor of ``Invoice`` in the application. Before
        it existed, every invoice in a running system came from the seed script
        (AUDIT_REPORT.md section 7, finding 1).

        ``idempotency_key`` makes the call safe to repeat: a second request
        carrying a key that has already been used returns the original invoice
        rather than issuing a duplicate. Callers that then collect will find it
        already paid, because ``collect_invoice`` is itself idempotent.
        """
        now = _utcnow()
        if idempotency_key:
            existing = db.scalar(
                select(Invoice).where(Invoice.idempotency_key == idempotency_key)
            )
            if existing is not None:
                return existing
        subtotal = int(amount_cents)
        for _ in range(5):  # numbering races are retried, not swallowed
            invoice = Invoice(
                organization_id=organization_id,
                number=self._next_invoice_number(db, moment=now),
                status=InvoiceStatus.open,
                currency=currency,
                subtotal_cents=subtotal,
                tax_cents=tax_cents,
                total_cents=subtotal + tax_cents,
                amount_paid_cents=0,
                period_start=period_start,
                period_end=period_end,
                period_label=period_label,
                issued_at=now,
                due_at=due_at or now,
                line_items=line_items,
                provider=self.provider.name,
                idempotency_key=idempotency_key,
            )
            db.add(invoice)
            try:
                db.commit()
            except IntegrityError:
                db.rollback()
                if idempotency_key:
                    # The clash may have been the key rather than the number,
                    # which means a concurrent request already issued this
                    # invoice. Returning theirs is the correct answer.
                    existing = db.scalar(
                        select(Invoice).where(Invoice.idempotency_key == idempotency_key)
                    )
                    if existing is not None:
                        return existing
                continue
            db.refresh(invoice)
            return invoice
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Could not allocate an invoice number"
        )

    def _invoice_number_for(self, db: Session, *, provider_number: str | None, moment: datetime) -> str:
        """The provider's own number when it has one and it is free locally.

        Falling back to the local series keeps the unique index satisfied even
        if a provider number somehow collides, so a mirror never fails over
        cosmetics.
        """
        if provider_number:
            taken = db.scalar(select(Invoice.id).where(Invoice.number == provider_number))
            if not taken:
                return provider_number
        return self._next_invoice_number(db, moment=moment)

    def record_provider_invoice(
        self,
        db: Session,
        *,
        organization_id: str,
        invoice: ProviderInvoice,
    ) -> Invoice | None:
        """Mirror a provider-raised invoice into the local ``invoices`` table.

        Idempotent on ``provider_invoice_id``: a redelivered ``invoice.paid``,
        or a backfill run over invoices the webhook already mirrored, updates
        the existing row rather than creating a second one. That matters
        because Stripe sends both ``invoice.paid`` and
        ``invoice.payment_succeeded`` for a single settlement -- two distinct
        event ids, so webhook-level de-duplication does not catch it.

        Amounts and status come from the provider, which did the charging.
        Flushes but does not commit: the caller owns the transaction.
        """
        if not invoice.provider_invoice_id:
            return None
        now = _utcnow()
        existing = db.scalar(
            select(Invoice).where(
                Invoice.provider_invoice_id == invoice.provider_invoice_id,
                Invoice.provider == self.provider.name,
            )
        )
        row = existing or Invoice(
            organization_id=organization_id,
            number=self._invoice_number_for(
                db, provider_number=invoice.number, moment=invoice.issued_at or now
            ),
            provider=self.provider.name,
            provider_invoice_id=invoice.provider_invoice_id,
        )
        # A void invoice locally is a deliberate act (POST /invoices/{id}/void)
        # and outranks whatever the provider now says.
        if existing is not None and existing.status == InvoiceStatus.void:
            return existing
        row.currency = invoice.currency
        row.subtotal_cents = invoice.subtotal_cents
        row.tax_cents = invoice.tax_cents
        row.total_cents = invoice.total_cents
        row.amount_paid_cents = invoice.amount_paid_cents
        row.status = invoice.status
        row.period_start = invoice.period_start
        row.period_end = invoice.period_end
        row.issued_at = invoice.issued_at or row.issued_at or now
        row.due_at = invoice.due_at or row.issued_at
        row.paid_at = invoice.paid_at or (
            row.paid_at or (now if invoice.status == InvoiceStatus.paid else None)
        )
        row.line_items = invoice.line_items or row.line_items
        row.hosted_url = invoice.hosted_url or row.hosted_url
        row.provider_payment_intent_id = invoice.payment_intent_id or row.provider_payment_intent_id
        if row.period_start is not None and not row.period_label:
            row.period_label = row.period_start.strftime("%b %Y")
        db.add(row)
        db.flush()
        return row

    def _mirror_customer_invoices(
        self, db: Session, *, organization_id: str, customer_id: str | None, limit: int = 5
    ) -> int:
        """Mirror this customer's most recent provider invoices, best effort.

        Called on the return from a checkout, where the purchase has already
        been applied: the invoice is the record of it, not the thing being
        waited on, so a provider that is slow, unreachable, or has not raised
        the invoice yet must not fail the confirmation. Whatever is missed here
        is picked up by the ``invoice.paid`` webhook or by
        ``scripts/backfill_provider_invoices.py``, both idempotent on
        ``provider_invoice_id`` -- so mirroring twice is not double-billing.
        """
        if not customer_id:
            return 0
        try:
            remote = self.provider.list_invoices(customer_id=customer_id, limit=limit)
        except Exception:  # provider down, or a stub without invoices
            logger.exception("billing.invoice_mirror_failed", extra={"organization_id": organization_id})
            return 0
        mirrored = 0
        for invoice in remote:
            if invoice.status == InvoiceStatus.draft:
                continue
            if self.record_provider_invoice(db, organization_id=organization_id, invoice=invoice):
                mirrored += 1
        return mirrored

    def backfill_provider_invoices(
        self, db: Session, *, organization_id: str | None = None, limit: int = 100
    ) -> dict[str, Any]:
        """Mirror every invoice the provider already holds (BIL: recovery).

        For each subscription with a provider customer id, read that customer's
        invoices back from the provider and record them. Idempotent, so it is
        safe to re-run; it exists because invoices settled before the webhook
        mirrored them left no local trace.
        """
        report: dict[str, Any] = {"organizations": 0, "created": 0, "updated": 0, "skipped": 0}
        query = select(Subscription).where(Subscription.provider_customer_id.is_not(None))
        if organization_id:
            query = query.where(Subscription.organization_id == organization_id)
        for subscription in db.scalars(query):
            customer_id = subscription.provider_customer_id
            if not customer_id:
                continue
            report["organizations"] += 1
            for remote in self.provider.list_invoices(customer_id=customer_id, limit=limit):
                if remote.status == InvoiceStatus.draft:
                    report["skipped"] += 1
                    continue
                seen = db.scalar(
                    select(Invoice.id).where(
                        Invoice.provider_invoice_id == remote.provider_invoice_id,
                        Invoice.provider == self.provider.name,
                    )
                )
                recorded = self.record_provider_invoice(
                    db,
                    organization_id=subscription.organization_id,
                    invoice=remote,
                )
                if recorded is None:
                    report["skipped"] += 1
                else:
                    report["updated" if seen else "created"] += 1
            db.commit()
        return report

    def close_period(
        self, db: Session, *, subscription: Subscription, now: datetime | None = None
    ) -> Invoice:
        """Issue the invoice for the period that has just ended and roll the
        subscription forward one period."""
        now = now or _utcnow()
        organization_id = subscription.organization_id
        upcoming = self.next_invoice(db, organization_id)
        period_start = _aware(subscription.current_period_start) or now
        period_end = _aware(subscription.current_period_end) or now
        invoice = self.issue_invoice(
            db,
            organization_id=organization_id,
            amount_cents=int(upcoming["subtotal_cents"]),
            line_items=upcoming["line_items"],
            currency=upcoming["currency"],
            period_start=period_start,
            period_end=period_end,
            period_label=period_start.strftime("%b %Y"),
            due_at=now + timedelta(days=INVOICE_DUE_DAYS),
        )
        length = timedelta(days=365 if upcoming["cycle"] == "annual" else 30)
        subscription.current_period_start = period_end
        subscription.current_period_end = period_end + length
        db.add(subscription)
        db.commit()
        db.refresh(subscription)
        return invoice

    def run_renewals(self, db: Session, *, now: datetime | None = None) -> dict[str, Any]:
        """Period-close / renewal driver (cron: ``scripts/run_billing_cycle.py``).

        For every subscription whose period has ended: issue the invoice for it,
        attempt collection when the tenant has autopay and an instrument, and
        roll the period forward. A decline leaves the subscription ``past_due``
        with an unpaid invoice, which is exactly what the dunning driver picks
        up next.
        """
        now = now or _utcnow()
        report = {
            "closed": 0,
            "invoiced": [],
            "collected": 0,
            "failed": 0,
            "expired": 0,
            "plan_changes_applied": 0,
        }
        subscriptions = list(
            db.scalars(
                select(Subscription).where(
                    Subscription.status.in_(
                        [
                            SubscriptionStatus.active,
                            SubscriptionStatus.trialing,
                            SubscriptionStatus.past_due,
                        ]
                    )
                )
            )
        )
        for subscription in subscriptions:
            period_end = _aware(subscription.current_period_end)
            if period_end is None or period_end > now:
                continue
            if subscription.cancel_at_period_end:
                subscription.status = SubscriptionStatus.canceled
                subscription.canceled_at = now
                db.add(subscription)
                self._sync_organization_billing(db, subscription=subscription)
                db.commit()
                report["expired"] += 1
                continue
            # A scheduled downgrade lands *before* the invoice is cut, so the
            # renewal is priced on the plan the tenant is actually renewing
            # onto rather than the one they have been leaving all period.
            if self.apply_pending_plan_change(db, subscription=subscription, now=now):
                report["plan_changes_applied"] += 1
                db.commit()
                db.refresh(subscription)
            invoice = self.close_period(db, subscription=subscription, now=now)
            report["closed"] += 1
            report["invoiced"].append(invoice.number)
            org = db.get(Organization, subscription.organization_id)
            payment_method = self.default_payment_method(db, subscription.organization_id)
            if org is not None and org.autopay and payment_method is not None:
                try:
                    self.collect_invoice(db, invoice=invoice, payment_method_id=payment_method.id)
                    report["collected"] += 1
                    subscription.status = SubscriptionStatus.active
                except HTTPException:
                    report["failed"] += 1
                    subscription.status = SubscriptionStatus.past_due
            else:
                report["failed"] += 1
                subscription.status = SubscriptionStatus.past_due
            db.add(subscription)
            self._sync_organization_billing(db, subscription=subscription)
            db.commit()
        return report

    def due_dunning_charges(self, db: Session, *, now: datetime | None = None) -> list[Charge]:
        """Failed charges whose ``next_attempt_at`` has come due.

        ``collect_invoice`` has always written ``next_attempt_at`` and nothing
        ever read it, so dunning only advanced when a human clicked retry
        (AUDIT_REPORT.md section 7, finding 5).
        """
        now = now or _utcnow()
        charges = list(
            db.scalars(
                select(Charge)
                .where(Charge.status == "failed", Charge.next_attempt_at.is_not(None))
                .order_by(Charge.occurred_at)
            )
        )
        latest: dict[str, Charge] = {}
        for charge in charges:
            if charge.invoice_id:
                latest[charge.invoice_id] = charge
        due: list[Charge] = []
        for charge in latest.values():
            attempt_at = _aware(charge.next_attempt_at)
            if attempt_at is None or attempt_at > now:
                continue
            invoice = db.get(Invoice, charge.invoice_id) if charge.invoice_id else None
            if invoice is None or invoice.status not in {
                InvoiceStatus.open,
                InvoiceStatus.past_due,
            }:
                continue
            due.append(charge)
        return due

    def run_dunning(self, db: Session, *, now: datetime | None = None) -> dict[str, Any]:
        """Retry every collection whose scheduled attempt has come due."""
        now = now or _utcnow()
        report = {"attempted": 0, "recovered": 0, "failed": 0, "invoices": []}
        for charge in self.due_dunning_charges(db, now=now):
            invoice = db.get(Invoice, charge.invoice_id)
            if invoice is None:
                continue
            report["attempted"] += 1
            report["invoices"].append(invoice.number)
            try:
                self.collect_invoice(db, invoice=invoice)
                report["recovered"] += 1
            except HTTPException:
                report["failed"] += 1
        return report

    def change_plan_with_proration(
        self,
        db: Session,
        *,
        organization_id: str,
        plan_code: str,
        payment_method_id: str | None = None,
        effective: str | None = None,
        force: bool = False,
    ) -> tuple[Subscription, dict[str, Any]]:
        """``change_plan`` plus the figures the preview promised.

        The preview is taken first and passed to ``change_plan`` as the quote,
        so the tenant is charged the number they were shown or nothing at all.
        """
        preview = self.preview_plan_change(
            db, organization_id=organization_id, plan_code=plan_code, effective=effective
        )
        subscription = self.change_plan(
            db,
            organization_id=organization_id,
            plan_code=plan_code,
            payment_method_id=payment_method_id,
            effective=effective,
            quoted_amount_cents=int(preview["amount_due_cents"]),
            force=force,
        )
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
        db.add(subscription)
        db.flush()
        self._sync_organization_billing(db, subscription=subscription)
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
        db.add(subscription)
        db.flush()
        self._sync_organization_billing(db, subscription=subscription)
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
        if event.customer_id and not subscription.provider_customer_id:
            subscription.provider_customer_id = event.customer_id
            db.add(subscription)
        # A saved card, with or without a purchase attached. Handled before the
        # subscription transitions because a setup-mode checkout completion is
        # not an activation -- no money moved and no plan was bought.
        saved_instrument = event.payment_method_id and (
            event.event_type == "setup.succeeded"
            or (event.event_type == "checkout.completed" and event.mode == "setup")
        )
        if saved_instrument:
            self._store_provider_payment_method(
                db,
                organization_id=subscription.organization_id,
                provider_payment_method_id=str(event.payment_method_id),
                customer_id=event.customer_id or subscription.provider_customer_id,
            )
            db.flush()
            return True
        if event.event_type == "setup.succeeded":
            return False
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
            self._supersede_provider_subscription(
                subscription, new_subscription_id=event.subscription_id
            )
            subscription.provider_subscription_id = event.subscription_id
        subscription.provider = event.provider
        db.add(subscription)
        # The provider's invoice for this event, mirrored locally. Without it
        # a subscription billed by the provider showed no invoice until the
        # renewal cron closed its first period.
        if event.invoice is not None:
            self.record_provider_invoice(
                db,
                organization_id=subscription.organization_id,
                invoice=event.invoice,
            )
        db.flush()
        self._sync_organization_billing(db, subscription=subscription)
        return True

    def _supersede_provider_subscription(
        self, subscription: Subscription, *, new_subscription_id: str
    ) -> None:
        """Cancel the remote subscription this one is about to replace.

        Overwriting ``provider_subscription_id`` used to be all that happened,
        which orphaned the old subscription: still active at the provider,
        still billing every month, and no longer referenced by any row here,
        so nothing could ever cancel it. The id is the only handle on it, so
        it has to be used before it is lost.

        A failure is logged rather than raised. The event being applied is a
        payment that has already succeeded; refusing to record it because the
        cleanup call failed would be the worse outcome, and the reconciliation
        script (``scripts/reconcile_provider_subscriptions.py``) exists to find
        whatever this misses.
        """
        previous = subscription.provider_subscription_id
        if not previous or previous == new_subscription_id:
            return
        try:
            self.provider.cancel_subscription(
                subscription=subscription, at_period_end=False
            )
            logger.warning(
                "cancelled a superseded provider subscription",
                extra={
                    "organization_id": subscription.organization_id,
                    "previous_subscription_id": previous,
                    "new_subscription_id": new_subscription_id,
                },
            )
        except Exception:  # noqa: BLE001 - see docstring
            logger.exception(
                "could not cancel a superseded provider subscription; it may still be billing",
                extra={
                    "organization_id": subscription.organization_id,
                    "previous_subscription_id": previous,
                },
            )

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
        """What a single invoice for ``cycle`` costs.

        The UI sells "Annual (save 12%)"; this is where that discount is
        actually applied. It used to be a flat ``monthly x 12``, which made the
        advertised saving a lie (AUDIT_REPORT.md section 7, finding 6).
        """
        monthly = cls.monthly_amount_cents(plan, seats)
        if cycle != "annual":
            return monthly
        return round(monthly * 12 * (1 - ANNUAL_DISCOUNT_RATE))

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
            # Same discount the plan-change preview and every invoice apply.
            unit = round(unit * 12 * (1 - ANNUAL_DISCOUNT_RATE))
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
    def preview_plan_change(
        self,
        db: Session,
        *,
        organization_id: str,
        plan_code: str,
        effective: str | None = None,
    ) -> dict[str, Any]:
        """What changing to ``plan_code`` costs, when it lands, and what breaks.

        Read-only, and the single source of these numbers: ``change_plan``
        calls this and then honours what it returned, rather than recomputing
        and charging whatever the second computation happened to say.
        """
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

        direction = plan_change_assessor.direction(
            current=current,
            target=target,
            current_amount=current_amount,
            target_amount=target_amount,
        )
        requested = _coerce_effective(effective)
        mode = requested or plan_change_assessor.default_effective_mode(direction)
        period_end = _aware(subscription.current_period_end)
        if mode == PlanChangeEffective.period_end and period_end is None:
            # Nothing to wait for: a subscription with no period cannot defer.
            mode = PlanChangeEffective.immediately
        effective_at = _utcnow() if mode == PlanChangeEffective.immediately else period_end

        assessment = plan_change_assessor.assess(
            db,
            organization_id=organization_id,
            current=current,
            target=target,
            direction=direction,
            effective_mode=mode,
            effective_at=effective_at,
        )

        # A scheduled change costs nothing today and forfeits nothing: the
        # tenant uses what they bought, right up to the period end.
        scheduled = mode == PlanChangeEffective.period_end
        amount_due = 0 if scheduled else max(0, proration)
        credit = 0 if scheduled else self._credit_for(
            direction=direction,
            proration_cents=proration,
            current_plan=current,
            seats=licensed,
            cycle=cycle,
            fraction=fraction,
        )

        balance = wallet_service.balance_cents(db, organization_id)
        wallet_applied = min(balance, amount_due)

        return {
            "current_plan_code": current.code,
            "current_plan_name": current.name,
            "target_plan_code": target.code,
            "target_plan_name": target.name,
            "cycle": cycle,
            "currency": target.currency,
            "seats_licensed": licensed,
            "current_amount_cents": current_amount,
            "target_amount_cents": target_amount,
            "proration_cents": proration,
            "remaining_fraction": round(fraction, 6),
            "effective_at": effective_at,
            "next_invoice_total_cents": target_amount,
            "next_invoice_at": period_end,
            "is_downgrade": target_amount < current_amount,
            # BIL-12 additions.
            "direction": direction.value,
            "effective_mode": mode.value,
            "scheduled": scheduled,
            #: What the tenant pays now, before balance is applied.
            "amount_due_cents": amount_due,
            #: How much of that the wallet covers, and what the card is left.
            "wallet_balance_cents": balance,
            "wallet_applied_cents": wallet_applied,
            "charge_cents": max(0, amount_due - wallet_applied),
            #: Balance this change *adds*. Always 0 for a scheduled change.
            "wallet_credit_cents": credit,
            "blockers": [issue.as_dict() for issue in assessment.blockers],
            "warnings": [issue.as_dict() for issue in assessment.warnings],
            "allowed": assessment.allowed,
        }

    @staticmethod
    def _credit_for(
        *,
        direction: PlanChangeDirection,
        proration_cents: int,
        current_plan: Plan,
        seats: int,
        cycle: str,
        fraction: float,
    ) -> int:
        """Balance an immediate change hands back (BIL-12).

        An immediate downgrade returns the difference it gave up. An interval
        switch returns the *whole* unused remainder, because the period
        restarts: the old month is abandoned outright, not partially used, and
        silently keeping that money was the bug.
        """
        if direction == PlanChangeDirection.interval_switch:
            return max(
                0,
                round(BillingService.invoice_amount_cents(current_plan, seats, cycle) * fraction),
            )
        return max(0, -proration_cents)


    # ------------------------------------------------------- seat capacity
    def cheapest_plan_for_users(self, db: Session, *, users: int) -> Plan | None:
        """The least expensive active plan whose ``max_users`` holds ``users``.

        Used to answer "upgrade to what?" with a specific plan rather than
        sending the tenant to the pricing page to work it out themselves.
        """
        candidates = []
        for plan in self.list_plans(db):
            limit = (plan.entitlements or {}).get(ENTITLEMENT_MAX_USERS)
            if limit is None or int(limit) >= users:
                candidates.append(plan)
        if not candidates:
            return None
        return min(candidates, key=lambda p: self.monthly_unit_cents(p))

    def check_seat_capacity(self, db: Session, *, organization_id: str, amount: int = 1) -> None:
        """Assert the organization can take ``amount`` more members.

        There are two different ceilings here and conflating them produces an
        error nobody can act on:

        * ``max_users`` is the **plan's** cap. Past it, the only remedy is a
          different plan.
        * ``seats_licensed`` is how many of that cap the organization has
          **bought**. Past it, the remedy is buying a seat -- a prorated
          charge, no plan change, no renegotiation.

        The invite path used to check only the first, so an organization could
        quietly take on members it was not paying for, and the entitlement
        error it eventually hit said "upgrade your plan" when the actual
        answer was "you need one more seat".
        """
        # Plan cap first: if the plan cannot hold them, buying a seat cannot
        # help and offering it would be a dead end.
        try:
            entitlement_service.check_entitlement(
                db, organization_id, ENTITLEMENT_MAX_USERS, amount=amount
            )
        except HTTPException as exc:
            if not isinstance(exc.detail, dict):
                raise
            _, activated_now = self.seat_counts(db, organization_id)
            suggestion = self.cheapest_plan_for_users(db, users=activated_now + amount)
            detail = dict(exc.detail)
            detail["error"] = "plan_upgrade_required"
            if suggestion is not None:
                # Name the plan that actually fits. "Upgrade your plan" on its
                # own leaves the tenant to work out which one, and get it wrong.
                detail["suggested_plan"] = suggestion.code
                detail["suggested_plan_name"] = suggestion.name
                detail["message"] = (
                    f"This plan allows {detail.get('limit_value')} users. "
                    f"Switch to {suggestion.name} to add more."
                )
            raise HTTPException(status_code=exc.status_code, detail=detail) from exc

        org = self.organization(db, organization_id)
        # ``seat_counts`` reports an organization that has never bought seats
        # as licensing exactly what it uses, which is the right answer for
        # pricing and the wrong one for a ceiling: read that way, every first
        # invite is "out of seats". Only an explicitly purchased count is a
        # ceiling; otherwise the plan cap above is the only limit, as before.
        purchased = int(org.seats_licensed or 0)
        if purchased <= 0:
            return

        licensed, activated = self.seat_counts(db, organization_id)
        if activated + amount <= licensed:
            return

        subscription = self.get_or_create_subscription(db, organization_id)
        plan = subscription.plan or self.get_plan_by_code(db, FREE_PLAN_CODE)
        cycle = org.billing_cycle or "monthly"
        needed = activated + amount - licensed
        fraction = self.remaining_fraction(subscription)
        before = self.invoice_amount_cents(plan, licensed, cycle)
        after = self.invoice_amount_cents(plan, licensed + needed, cycle)
        proration = max(0, round((after - before) * fraction))

        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "seat_purchase_required",
                "seats_licensed": licensed,
                "seats_activated": activated,
                "seats_needed": needed,
                "plan": plan.code,
                "plan_name": plan.name,
                #: What buying them costs today, so the client can put a real
                #: number on the button rather than "add a seat".
                "proration_cents": proration,
                "currency": plan.currency,
                "message": (
                    f"All {licensed} licensed seats are in use. "
                    f"Add {needed} seat{'s' if needed != 1 else ''} to continue."
                ),
            },
        )

    # ---------------------------------------------------------------- seats
    def change_seats(
        self,
        db: Session,
        *,
        organization_id: str,
        delta: int,
        payment_method_id: str | None = None,
    ) -> dict[str, Any]:
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

        if proration > 0:
            # Buying seats is a sale. Same gate as an upgrade: collect first,
            # then licence. A decline raises 402 and the seat count is untouched.
            payment_method = self._require_payment_method(
                db,
                organization_id=organization_id,
                payment_method_id=payment_method_id,
                reason="seats",
            )
            invoice = self.issue_invoice(
                db,
                organization_id=organization_id,
                amount_cents=proration,
                line_items=[
                    {
                        "description": f"{delta} additional {plan.name} seat(s), prorated",
                        "quantity": delta,
                        "unit_cents": round(proration / max(delta, 1)),
                        "amount_cents": proration,
                    }
                ],
                currency=plan.currency,
                period_start=_aware(subscription.current_period_start),
                period_end=_aware(subscription.current_period_end),
                period_label=f"{delta} seat(s)",
                due_at=_utcnow() + timedelta(days=INVOICE_DUE_DAYS),
            )
            self.collect_invoice(db, invoice=invoice, payment_method_id=payment_method.id)

        credited = 0
        if proration < 0:
            # Releasing seats mid-period hands back time already paid for.
            # It becomes balance, not a refund (BIL-12).
            entry = wallet_service.credit(
                db,
                organization_id=organization_id,
                amount_cents=-proration,
                kind=WalletEntryKind.seat_reduction,
                description=(
                    f"{abs(delta)} released {plan.name} seat(s), "
                    "prorated for the remainder of the period"
                ),
                currency=plan.currency,
                idempotency_key=(
                    f"seat-credit:{organization_id}:{licensed}->{target}:"
                    f"{(_aware(subscription.current_period_start) or _utcnow()).isoformat()}"
                ),
            )
            credited = -proration if entry is not None else 0

        self.provider.update_seats(subscription=subscription, seats=target)
        org.seats_licensed = target
        db.add(org)
        db.commit()
        db.refresh(subscription)
        return {
            "wallet_credit_cents": credited,
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
        customer_id: str | None = None,
    ) -> PaymentMethod:
        pm = self._attach_and_store(
            db,
            organization_id=organization_id,
            type=type,
            provider_token=provider_token,
            holder_name=holder_name,
            country=country,
            po_number=po_number,
            make_default=make_default,
            customer_id=customer_id,
        )
        db.commit()
        db.refresh(pm)
        return pm

    def _attach_and_store(
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
        customer_id: str | None = None,
        dedupe: bool = False,
    ) -> PaymentMethod:
        """Everything ``add_payment_method`` does except the commit.

        Split out so the webhook and the return-url confirmation can persist an
        instrument inside their own transaction instead of duplicating the row
        construction (and the defaulting rules) a second and third time.
        """
        provider = self.provider
        details = provider.attach_payment_method(
            organization_id=organization_id,
            type=type,
            provider_token=provider_token,
            holder_name=holder_name,
            country=country,
            customer_id=customer_id,
        )
        existing = self.list_payment_methods(db, organization_id)
        # Only the provider-driven paths dedupe. A manual add of the same
        # token twice is a deliberate second instrument and stays one.
        already = next(
            (
                pm
                for pm in existing
                if dedupe
                and details.provider_payment_method_id
                and pm.provider_payment_method_id == details.provider_payment_method_id
            ),
            None,
        )
        if already is not None:
            # The webhook and the return-url confirmation both arrive for the
            # same saved card; storing it twice would show the user two.
            if make_default and not already.is_default:
                self._promote_default(db, organization_id=organization_id, payment_method=already)
            return already
        pm = PaymentMethod(
            organization_id=organization_id,
            type=type,
            brand=details.brand,
            last4=details.last4,
            exp_month=details.exp_month,
            exp_year=details.exp_year,
            holder_name=details.holder_name or holder_name,
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
        return pm

    def _store_provider_payment_method(
        self,
        db: Session,
        *,
        organization_id: str,
        provider_payment_method_id: str,
        customer_id: str | None = None,
    ) -> PaymentMethod:
        """Persist an instrument the provider saved for us (setup mode).

        Goes through the same ``attach_payment_method`` path as a manual add,
        so the stored brand/last4/expiry are the provider's, never ours.
        """
        return self._attach_and_store(
            db,
            organization_id=organization_id,
            type="card",
            provider_token=provider_payment_method_id,
            customer_id=customer_id,
            make_default=True,
            dedupe=True,
        )

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
        # Read the customer id off the existing subscription rather than
        # creating one; see the Stripe implementation for why.
        subscription = (
            db.query(Subscription)
            .filter(Subscription.organization_id == organization_id)
            .one_or_none()
        )
        self.provider.set_default_payment_method(
            organization_id=organization_id,
            payment_method=payment_method,
            customer_id=subscription.provider_customer_id if subscription else None,
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
        # A sandbox organization must never reach the payment provider
        # (API-11). Refusing before ``charge_invoice`` means no card is
        # touched and no provider call is made, rather than relying on the
        # provider being in its own test mode.
        from app.services.sandbox_service import is_sandbox_organization

        if is_sandbox_organization(db, invoice.organization_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invoices cannot be collected in the sandbox; no payment provider is contacted there",
            )
        if invoice.status == InvoiceStatus.paid:
            return invoice
        if invoice.status in {InvoiceStatus.void, InvoiceStatus.uncollectible}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"An invoice with status '{invoice.status}' cannot be paid",
            )

        organization_id = invoice.organization_id

        # Balance is spent before a card is touched (BIL-12). An invoice a
        # tenant's own credit covers is settled here, with no provider call at
        # all -- which also means autopay keeps working for an organization
        # that has balance but no instrument on file.
        applied = wallet_service.spend_on_invoice(db, invoice=invoice)
        if applied:
            invoice.amount_paid_cents = invoice.amount_paid_cents + applied
            db.add(invoice)
            db.flush()
        if invoice.amount_due_cents <= 0:
            invoice.status = InvoiceStatus.paid
            invoice.paid_at = _utcnow()
            invoice.payment_method_label = "Account balance"
            db.add(invoice)
            db.commit()
            db.refresh(invoice)
            return invoice

        if payment_method_id:
            payment_method = self.get_payment_method(
                db, organization_id=organization_id, payment_method_id=payment_method_id
            )
        else:
            payment_method = self.default_payment_method(db, organization_id)

        # Only the remainder reaches the provider: ``charge_invoice`` bills
        # ``amount_due_cents``, which the draw above has already reduced. A
        # decline leaves that draw in place as a genuine partial payment
        # rather than bouncing the credit back and forth.
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
        """Record a payment received outside the provider (wire, cheque, credit).

        A wire that overshoots the invoice is common and used to be recorded
        as ``amount_paid_cents > total_cents``, which quietly kept the excess:
        it appeared nowhere a tenant could see it and was never applied to
        anything. The overshoot is now credited to their balance (BIL-12), so
        it comes off the next invoice instead.
        """
        if invoice.status == InvoiceStatus.void:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A void invoice cannot be paid")
        received = invoice.total_cents if amount_cents is None else int(amount_cents)
        overpaid = max(0, received - invoice.total_cents)
        invoice.amount_paid_cents = min(received, invoice.total_cents)
        if overpaid:
            wallet_service.credit(
                db,
                organization_id=invoice.organization_id,
                amount_cents=overpaid,
                kind=WalletEntryKind.overpayment,
                description=f"Overpayment on invoice {invoice.number}",
                currency=invoice.currency,
                invoice_id=invoice.id,
                idempotency_key=f"overpayment:{invoice.id}:{received}",
            )
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
        """The tenant-facing invoice or receipt (BIL-13).

        Laid out with the shared ``pdf_layout.Sheet``, so a platform invoice,
        a signer receipt and an audit certificate arrive looking like documents
        from one company. Every figure still comes from the invoice row -- the
        presentation changed, nothing upstream of it did.
        """
        from app.services import pdf_layout

        org = db.get(Organization, invoice.organization_id)
        kind = "Receipt" if receipt else "Invoice"
        currency = (invoice.currency or "usd").upper()

        def money(cents: int | None) -> str:
            return f"{(cents or 0) / 100:,.2f} {currency}"

        sheet = pdf_layout.Sheet(footer=f"{kind} {invoice.number} · SignerPro")
        billed_to = org.name if org else invoice.organization_id
        sheet.header(
            eyebrow="SignerPro",
            title=kind,
            reference=invoice.number,
            issuer=f"Billed to {billed_to}",
            issued=f"Issued {invoice.issued_at.strftime('%d %b %Y')}",
        )

        # Paid, open and past due are three different things to the person
        # reading this, and only one of them asks anything of them.
        status = (invoice.status or "").lower()
        if receipt or status == "paid":
            sheet.badge("PAID", pdf_layout.POSITIVE)
        elif status in {"past_due", "uncollectible"}:
            sheet.badge(status.replace("_", " ").upper(), pdf_layout.NEGATIVE)
        else:
            sheet.badge(status.replace("_", " ").upper() or "OPEN", pdf_layout.WARNING)

        sheet.section("Details")
        sheet.rows(
            [
                ("Billing period", invoice.period_label),
                ("Due", invoice.due_at.strftime("%d %b %Y") if invoice.due_at else None),
                ("Payment method", invoice.payment_method_label),
            ]
        )

        sheet.section("Line items")
        sheet.table(
            headers=("Description", "Amount"),
            lines=[
                (str(item.get("description", "")), money(item.get("amount_cents", 0)))
                for item in (invoice.line_items or [])
            ],
        )

        entries: list[tuple[str, str, bool]] = [
            ("Subtotal", money(invoice.subtotal_cents), False),
            ("Tax", money(invoice.tax_cents), False),
            ("Total", money(invoice.total_cents), True),
            ("Paid", money(invoice.amount_paid_cents), False),
        ]
        # An amount still owed is the one number the reader must act on, so it
        # is emphasised -- but only when there is one. A settled invoice ending
        # on a bold "Due 0.00" reads like a demand.
        if invoice.amount_due_cents:
            entries.append(("Amount due", money(invoice.amount_due_cents), True))
        sheet.totals(entries)

        sheet.fine_print(
            [
                f"{kind} {invoice.number} for {billed_to}.",
                "Questions about this invoice? Reply to your SignerPro billing contact.",
            ]
        )
        return sheet.save()

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
