"""Stripe Connect (Express) adapter: tenants connect their OWN Stripe account.

This is deliberately separate from ``billing_service.StripePaymentProvider``,
which charges *the platform's* Stripe account for a tenant's subscription.
Here the tenant is the merchant of record: a signer pays the tenant directly
during signing (a deposit, an invoice, a retainer), and the money settles
straight into the tenant's own Stripe balance and bank account.

That is why every charge this adapter enables is a **direct charge on the
connected account**, not a destination charge routed through the platform's
balance -- and why the platform takes no application fee. It is the tenant's
transaction, in full.

Network access reuses the exact injectable-transport seam
``billing_service.StripePaymentProvider`` established: ``transport`` is an
overridable class attribute, tests substitute a callable returning
``(status_code, json)`` and no test here touches the network. Requests that
act *as* the connected account (reading its balance, its own resources) carry
a ``Stripe-Account`` header; requests that create/manage the connection
itself do not.

Account creation and onboarding links go through Accounts v2
(``/v2/core/accounts``, ``/v2/core/account_links``) -- Stripe no longer
accepts new connected accounts through v1 -- while status reads (``GET
/v1/accounts/{id}``) and the ``account.updated`` webhook stay on v1, which
Stripe documents as still valid against a v2-created account id.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.organization import Organization
from app.models.payment_account import PaymentAccount
from app.schemas.payment import PaymentAccountLinkResponse
from app.services.billing_service import (
    STRIPE_API_BASE,
    STRIPE_REQUEST_TIMEOUT_SECONDS,
    STRIPE_SIGNATURE_TOLERANCE_SECONDS,
    StripeApiError,
    StripeTransport,
    _flatten_form,
    _stripe_setting,
    stripe_key_mode,
    verify_stripe_key_is_safe_here,
)

#: Stripe requires accounts created after their v1 sunset to go through
#: Accounts v2 (``/v2/core/*``), which is versioned independently of the v1
#: surface this file otherwise uses -- a v1 ``Stripe-Version`` header on a v2
#: call is simply the wrong dialect, not a compatible fallback.
STRIPE_API_VERSION_V2 = "2026-08-26.dahlia"

#: Stripe returns this error code when Accounts v2 is not yet turned on for
#: the platform's own Stripe account -- a merchant-console setting, not
#: something a request parameter can work around.
_ACCOUNTS_V2_BLOCKED_CODE = "accounts_v2_access_blocked"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _stripe_http_transport_v1_or_v2(
    method: str, url: str, params: dict[str, Any], headers: dict[str, str]
) -> tuple[int, dict[str, Any]]:
    """One production transport for both API generations this file speaks.

    v1 sends a form body (already ``_flatten_form``'d by the caller); Accounts
    v2 is JSON and would reject a form body outright. Both go through the
    same overridable ``transport`` attribute -- matching
    ``StripePaymentProvider.transport``'s single-seam shape exactly -- so this
    dispatches purely on the ``Content-Type`` the caller already set, rather
    than adding a second attribute for tests to know about.
    """
    import httpx

    if headers.get("Content-Type") == "application/json":
        response = httpx.request(
            method, url, json=params or None, headers=headers, timeout=STRIPE_REQUEST_TIMEOUT_SECONDS
        )
    else:
        body = params if method.upper() not in {"GET", "HEAD"} else None
        query = params if body is None else None
        response = httpx.request(
            method, url, data=body or None, params=query or None, headers=headers,
            timeout=STRIPE_REQUEST_TIMEOUT_SECONDS,
        )
    try:
        body = response.json()
    except ValueError:
        body = {}
    return response.status_code, (body if isinstance(body, dict) else {})


class StripeConnectService:
    """Onboards, syncs, and gates a tenant's connected Stripe (Express) account."""

    #: Overridable seam, following ``StripePaymentProvider.transport`` exactly:
    #: production uses httpx, tests substitute a fake. Both v1 (form) and
    #: Accounts v2 (JSON) calls share this one attribute.
    transport: StripeTransport = staticmethod(_stripe_http_transport_v1_or_v2)

    # ------------------------------------------------------------- transport
    def _secret_key(self) -> str:
        secret_key = _stripe_setting("stripe_secret_key", "STRIPE_SECRET_KEY")
        if not secret_key:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stripe is not configured on this platform (STRIPE_SECRET_KEY unset).",
            )
        # Same live/test guard used to construct `StripePaymentProvider` --
        # a live key outside production must not be reachable from here either.
        verify_stripe_key_is_safe_here(secret_key)
        return secret_key

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        connected_account_id: str | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self._secret_key()}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": "2024-06-20",
        }
        if connected_account_id:
            # Marks this request as acting *as* the connected account, e.g.
            # for direct charges made on its behalf.
            headers["Stripe-Account"] = connected_account_id
        status_code, body = type(self).transport(
            method, f"{STRIPE_API_BASE}{path}", _flatten_form(params or {}), headers
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

    def _request_v2(self, method: str, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """POST/GET against ``/v2/core/*``: JSON body, v2 ``Stripe-Version``.

        Accounts v2 lives on its own API generation -- distinct request
        signing, distinct header, distinct body encoding -- so this does not
        share ``_request``'s form-encoding path at all.
        """
        headers = {
            "Authorization": f"Bearer {self._secret_key()}",
            "Content-Type": "application/json",
            "Stripe-Version": STRIPE_API_VERSION_V2,
        }
        status_code, body = type(self).transport(
            method, f"{STRIPE_API_BASE}{path}", params or {}, headers
        )
        if status_code >= 400:
            error = (body or {}).get("error") or {}
            code = error.get("code") or error.get("decline_code")
            if code == _ACCOUNTS_V2_BLOCKED_CODE:
                raise StripeApiError(
                    status_code=status_code,
                    message=(
                        "Accounts v2 is not enabled for this Stripe account. "
                        "Turn it on in the Stripe Dashboard under "
                        "Settings > Connect > Accounts v2 access before "
                        "connecting a tenant."
                    ),
                    code=code,
                    body=body or {},
                )
            raise StripeApiError(
                status_code=status_code,
                message=str(error.get("message") or "Stripe request failed"),
                code=code,
                body=body or {},
            )
        return body or {}

    def dashboard_mode(self) -> str:
        """``live`` | ``test`` | ``unknown`` for the platform key in effect.

        Surfaced so the connect-settings UI can warn a tenant who is about to
        onboard a real bank account against a test-mode platform key (or vice
        versa) before they go through Stripe's hosted flow.
        """
        return stripe_key_mode(_stripe_setting("stripe_secret_key", "STRIPE_SECRET_KEY"))

    # --------------------------------------------------------------- lookups
    def get_account(self, db: Session, organization_id: str) -> PaymentAccount | None:
        return (
            db.query(PaymentAccount)
            .filter(PaymentAccount.organization_id == organization_id)
            .first()
        )

    # -------------------------------------------------------------- onboard
    def ensure_account(
        self, db: Session, *, organization: Organization, user_email: str | None = None
    ) -> PaymentAccount:
        """Create the tenant's Express account on first call; idempotent after."""
        existing = self.get_account(db, organization.id)
        if existing is not None:
            return existing
        params: dict[str, Any] = {
            "display_name": organization.name,
            "dashboard": "express",
            "configuration": {"merchant": {"capabilities": {"card_payments": {"requested": True}}}},
            # `identity` is deliberately omitted: hosted onboarding (the
            # account link below) collects it. And per Stripe, v2 returns
            # null for most properties unless their group is named here.
            "include": ["configuration.merchant", "requirements"],
        }
        if user_email:
            params["contact_email"] = user_email
        created = self._request_v2("POST", "/v2/core/accounts", params)
        fields = self._fields_from_v2(created)
        account = PaymentAccount(
            organization_id=organization.id,
            provider="stripe",
            provider_account_id=str(created.get("id") or ""),
            charges_enabled=fields["charges_enabled"],
            payouts_enabled=fields["payouts_enabled"],
            details_submitted=fields["details_submitted"],
            default_currency=fields["default_currency"],
            livemode=bool(created.get("livemode")),
            disabled_reason=fields["disabled_reason"],
            last_synced_at=_utcnow(),
        )
        db.add(account)
        db.commit()
        db.refresh(account)
        return account

    @staticmethod
    def _fields_from_v2(payload: dict[str, Any]) -> dict[str, Any]:
        """Map a v2 account/`account.updated`-shaped payload onto our v1-named columns.

        Kept separate from ``_mirror`` (which reads v1's top-level
        ``charges_enabled``/``payouts_enabled``): a v2 create response never
        has those, only ``configuration.merchant.capabilities``.
        """
        merchant = ((payload.get("configuration") or {}).get("merchant")) or {}
        capabilities = merchant.get("capabilities") or {}
        card_payments = capabilities.get("card_payments") or {}
        stripe_balance = (capabilities.get("stripe_balance") or {}).get("payouts") or {}
        status_details = card_payments.get("status_details") or []
        disabled_reason = None
        if status_details:
            first = status_details[0] if isinstance(status_details, list) else {}
            disabled_reason = (first or {}).get("code") if isinstance(first, dict) else None
        return {
            "charges_enabled": card_payments.get("status") == "active",
            "payouts_enabled": stripe_balance.get("status") == "active",
            "details_submitted": bool(merchant.get("applied")),
            "disabled_reason": disabled_reason,
            "default_currency": (payload.get("defaults") or {}).get("currency"),
        }

    def create_onboarding_link(
        self, db: Session, *, organization: Organization, return_url: str, refresh_url: str
    ) -> PaymentAccountLinkResponse:
        """A one-time hosted Stripe onboarding url for the tenant's account."""
        account = self.ensure_account(db, organization=organization)
        created = self._request_v2(
            "POST",
            "/v2/core/account_links",
            {
                "account": account.provider_account_id,
                "use_case": {
                    "type": "account_onboarding",
                    "account_onboarding": {
                        # Must match the configurations the account was
                        # created with (``merchant``), or Stripe rejects the
                        # link with `configs_must_match_to_use_account_links`.
                        "configurations": ["merchant"],
                        "return_url": return_url,
                        "refresh_url": refresh_url,
                    },
                },
            },
        )
        expires_at = created.get("expires_at")
        return PaymentAccountLinkResponse(
            url=str(created.get("url") or ""),
            expires_at=(
                # v2 returns an ISO-8601 string, unlike v1's unix integer.
                datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                if isinstance(expires_at, str) and expires_at
                else _utcnow()
            ),
        )

    # ---------------------------------------------------------------- sync
    def _mirror(self, account: PaymentAccount, payload: dict[str, Any]) -> None:
        """Copy Stripe's account fields onto the local row.

        ``onboarded_at`` is stamped the first time ``charges_enabled`` flips
        true and never touched again, so it records the moment the tenant
        actually became payable rather than the moment we last checked.
        """
        charges_enabled = bool(payload.get("charges_enabled"))
        was_enabled = account.charges_enabled
        account.charges_enabled = charges_enabled
        account.payouts_enabled = bool(payload.get("payouts_enabled"))
        account.details_submitted = bool(payload.get("details_submitted"))
        account.default_currency = payload.get("default_currency") or account.default_currency
        account.livemode = bool(payload.get("livemode"))
        requirements = payload.get("requirements") or {}
        account.disabled_reason = requirements.get("disabled_reason")
        account.last_synced_at = _utcnow()
        if charges_enabled and not was_enabled and account.onboarded_at is None:
            account.onboarded_at = _utcnow()

    def refresh_status(self, db: Session, *, organization: Organization) -> PaymentAccount:
        """Poll Stripe for the current account state (the return-from-onboarding path)."""
        account = self.get_account(db, organization.id)
        if account is None or not account.provider_account_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No connected Stripe account for this organization.",
            )
        payload = self._request("GET", f"/v1/accounts/{account.provider_account_id}")
        self._mirror(account, payload)
        db.add(account)
        db.commit()
        db.refresh(account)
        return account

    def apply_account_updated(
        self, db: Session, *, account_payload: dict[str, Any]
    ) -> PaymentAccount | None:
        """The webhook-driven counterpart to `refresh_status`, for `account.updated`."""
        provider_account_id = str(account_payload.get("id") or "")
        if not provider_account_id:
            return None
        account = (
            db.query(PaymentAccount)
            .filter(PaymentAccount.provider_account_id == provider_account_id)
            .first()
        )
        if account is None:
            return None
        self._mirror(account, account_payload)
        db.add(account)
        db.commit()
        db.refresh(account)
        return account

    # ----------------------------------------------------------- disconnect
    def disconnect(self, db: Session, *, organization: Organization) -> None:
        """Drop our link to the tenant's connected account.

        This deliberately does NOT delete the account on Stripe: it holds the
        tenant's real transaction history and is where their payouts land.
        Deleting it would destroy money-movement records that outlive our
        relationship with the tenant. We only remove the local row, so a
        re-connect starts a fresh onboarding (a new `acct_...`), and the old
        one is left exactly as Stripe and the tenant's bank see it.
        """
        account = self.get_account(db, organization.id)
        if account is None:
            return
        db.delete(account)
        db.commit()

    # ------------------------------------------------------------- gating
    def require_payable_account(self, db: Session, *, organization_id: str) -> PaymentAccount:
        """The account or a 409 telling the caller to connect Stripe first.

        Used to gate envelope sending: a document with a payment field must
        not be sendable until the tenant can actually be paid.
        """
        account = self.get_account(db, organization_id)
        if account is None or not account.charges_enabled:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Connect a Stripe account in Settings before sending a payment request.",
            )
        return account

    # -------------------------------------------------------------- webhook
    def _connect_webhook_secret(self) -> str | None:
        settings = get_settings()
        return (settings.stripe_connect_webhook_secret or "").strip() or settings.stripe_webhook_secret

    def verify_connect_webhook(self, *, raw_body: bytes, signature: str | None) -> bool:
        """Stripe's ``Stripe-Signature: t=<ts>,v1=<hex>`` scheme, constant-time.

        Mirrors ``StripePaymentProvider.verify_webhook`` exactly, including
        the timestamp tolerance -- a Connect webhook is exactly as forgeable
        as a billing one if the tolerance is dropped or the comparison is not
        constant-time.
        """
        secret = self._connect_webhook_secret()
        if not secret or not signature:
            return False
        parts = dict(item.split("=", 1) for item in signature.split(",") if "=" in item)
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
            secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, provided.strip())

    def parse_connect_event(self, *, raw_body: bytes) -> dict[str, Any]:
        try:
            payload = json.loads(raw_body.decode() or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed webhook payload"
            ) from exc
        if not isinstance(payload, dict):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Malformed webhook payload")
        return payload


stripe_connect_service = StripeConnectService()
