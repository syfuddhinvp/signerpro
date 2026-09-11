"""Pay-then-sign (PAY-1): a signer pays their allocated amount before they can

submit their signature, and the money goes straight to the tenant's own
connected Stripe account.

This file owns three distinct concerns that must never be confused:

* the *sender* side -- turning a `PaymentRequestCreate` into a `PaymentRequest`
  row and per-recipient allocations written onto each payment `Field`'s
  ``options``;
* the *signer* side -- creating/reconciling a Stripe PaymentIntent for one
  field, always as a **direct charge on the tenant's connected account** with
  no application fee, because the tenant -- not this platform -- is the
  merchant of record;
* the *gate* -- the two small helpers ``signing_service`` calls to refuse a
  signature until the money has actually, verifiably, arrived.

Network access reuses the exact injectable-transport seam established by
``billing_service.StripePaymentProvider`` and ``stripe_connect_service``:
``transport`` is an overridable class attribute, tests substitute a callable
returning ``(status_code, json)`` pairs, and production uses httpx. No test in
this repo touches the network.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.document import Document
from app.models.enums import (
    DocumentStatus,
    FieldType,
    PaymentSplitMode,
    RecipientStatus,
    SignerPaymentStatus,
    is_signing_role,
)
from app.models.field import Field
from app.models.payment_request import PaymentRequest
from app.models.recipient import Recipient
from app.models.signer_payment import SignerPayment
from app.schemas.payment import (
    STRIPE_MINIMUM_CHARGE_CENTS,
    PaymentAllocationInput,
    PaymentFieldConfig,
    PaymentIntentResponse,
    PaymentRequestCreate,
    PaymentRequestResponse,
    validate_allocations,
)
from app.services.audit_service import audit_service
from app.services.billing_service import (
    STRIPE_API_BASE,
    StripeApiError,
    StripeTransport,
    _flatten_form,
    _stripe_http_transport,
    _stripe_setting,
)
from app.services.field_service import field_service
from app.services.signing_service import signing_service
from app.services.stripe_connect_service import stripe_connect_service

#: Non-terminal `SignerPayment` states: an attempt that has not yet either
#: succeeded or definitively failed/refunded. ``create_intent`` reuses a row
#: in one of these states instead of minting a second PaymentIntent, which is
#: the whole defence against a double-click double charge.
_NON_TERMINAL_STATUSES = (SignerPaymentStatus.requires_payment, SignerPaymentStatus.processing)
_SETTLED_STATUSES = (SignerPaymentStatus.succeeded, SignerPaymentStatus.refunded)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _idempotency_key(*, field_id: str, amount_cents: int) -> str:
    """Stable per (field, amount) so retries/double-clicks hit the same intent.

    Deliberately excludes anything client-supplied beyond the already-clamped
    ``amount_cents`` (e.g. no timestamp, no request id): the whole point is
    that calling ``create_intent`` twice for the same field with the same
    resolved amount produces the *same* key, so Stripe (and our own row
    lookup) collapse the second call onto the first attempt rather than
    charging the card twice.
    """
    return hashlib.sha256(f"signer-payment:{field_id}:{amount_cents}".encode()).hexdigest()[:80]


class SignerPaymentService:
    """Sender-side allocation, signer-side charging, and the settlement gate."""

    #: Overridable seam, matching ``StripePaymentProvider.transport`` /
    #: ``StripeConnectService.transport`` exactly.
    transport: StripeTransport = staticmethod(_stripe_http_transport)

    # ------------------------------------------------------------- transport
    def _secret_key(self) -> str:
        secret_key = _stripe_setting("stripe_secret_key", "STRIPE_SECRET_KEY")
        if not secret_key:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stripe is not configured on this platform (STRIPE_SECRET_KEY unset).",
            )
        return secret_key

    def _publishable_key(self) -> str:
        """The publishable key the signing client mounts Stripe Elements with.

        There is no ``Settings`` field for this (it is not a secret, but it is
        also not something any other part of the app has needed until now),
        so it is read straight out of the environment the same way
        ``_stripe_setting`` reads the secret key, without touching
        ``config.py``.
        """
        import os

        settings = get_settings()
        key = (
            getattr(settings, "stripe_publishable_key", None) or os.environ.get("STRIPE_PUBLISHABLE_KEY") or ""
        ).strip()
        if not key:
            # Returning an empty key would hand the signer a modal that cannot
            # mount Stripe Elements: a blank box with a Pay button that can
            # never work. Failing here at least says why, and says it to the
            # operator's logs rather than only to the signer's console.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Stripe is not configured on this platform (STRIPE_PUBLISHABLE_KEY unset).",
            )
        return key

    def _request(
        self,
        method: str,
        path: str,
        params: dict[str, Any] | None = None,
        *,
        connected_account_id: str | None = None,
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self._secret_key()}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Stripe-Version": "2024-06-20",
        }
        if connected_account_id:
            # A DIRECT charge: this request acts *as* the connected account,
            # so the PaymentIntent (and its money) belongs to the tenant, not
            # the platform.
            headers["Stripe-Account"] = connected_account_id
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
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

    # ================================================================
    # Sender side
    # ================================================================

    def field_config(self, field: Field) -> PaymentFieldConfig:
        """Parse/validate a payment `Field`'s ``options`` JSON.

        A field of any other type has no business being handed to this
        method; a malformed/missing config is exactly as unusable as one, so
        both are a 400, never a silent default that would let a signer be
        charged the wrong amount (or nothing at all).
        """
        if field.type != FieldType.payment:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field is not a payment field")
        try:
            return PaymentFieldConfig.model_validate(field.options or {})
        except ValidationError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Malformed payment field configuration: {exc}",
            ) from exc

    def _split_equal(self, total_cents: int, recipient_ids: list[str]) -> list[PaymentAllocationInput]:
        """Divide ``total_cents`` across ``recipient_ids`` to the exact penny.

        A naive ``total // n`` (or worse, a float division) silently loses
        money whenever the total does not divide evenly -- e.g. $100.00 split
        three ways at $33.33 each drops a cent that nobody ever collects. The
        remainder is instead handed out one cent at a time to the earliest
        recipients (in the order the sender listed them) so
        ``sum(allocations) == total_cents`` always, exactly.
        """
        count = len(recipient_ids)
        base, remainder = divmod(total_cents, count)
        return [
            PaymentAllocationInput(
                recipient_id=recipient_id,
                amount_cents=base + (1 if index < remainder else 0),
            )
            for index, recipient_id in enumerate(recipient_ids)
        ]

    def sync_request(
        self, db: Session, *, document: Document, payload: PaymentRequestCreate, user: Any = None
    ) -> PaymentRequest:
        """Create/update the envelope's `PaymentRequest` and per-recipient allocations.

        The allocation amounts are written onto each recipient's *existing*
        payment `Field.options` -- there is no separate allocation table (see
        `PaymentRequest`'s docstring) -- so a field must already be placed for
        every recipient the sender wants to charge. This also refuses to ask a
        `copy`/CC recipient for money: they never signed up for a signing
        obligation, and to a signer "asked to pay" and "asked to sign" are the
        same kind of obligation.
        """
        if not payload.allocations:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A payment request needs at least one allocation.")

        recipient_ids = [allocation.recipient_id for allocation in payload.allocations]
        if len(set(recipient_ids)) != len(recipient_ids):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Duplicate recipient in payment allocations.")

        recipients_by_id: dict[str, Recipient] = {recipient.id: recipient for recipient in document.recipients}
        payment_fields_by_recipient: dict[str, list[Field]] = {}
        for field in document.fields:
            if field.type == FieldType.payment:
                payment_fields_by_recipient.setdefault(field.recipient_id, []).append(field)

        for recipient_id in recipient_ids:
            recipient = recipients_by_id.get(recipient_id)
            if recipient is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Recipient {recipient_id} is not on this document.")
            if not is_signing_role(recipient.role):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{recipient.name} receives a copy only and cannot be asked to pay.",
                )
            if recipient_id not in payment_fields_by_recipient:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Place a payment field for {recipient.name} before allocating an amount to them.",
                )

        if payload.split_mode == PaymentSplitMode.single:
            if len(payload.allocations) != 1:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A single-payer split needs exactly one allocation.")
            # Computed, not author-supplied: the one payer owes the whole total.
            resolved = [PaymentAllocationInput(recipient_id=recipient_ids[0], amount_cents=payload.total_cents)]
        elif payload.split_mode == PaymentSplitMode.equal:
            resolved = self._split_equal(payload.total_cents, recipient_ids)
        else:
            resolved = list(payload.allocations)

        try:
            validate_allocations(payload.total_cents, resolved, payload.split_mode)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

        payment_request = (
            db.query(PaymentRequest).filter(PaymentRequest.document_id == document.id).first()
        )
        if payment_request is None:
            payment_request = PaymentRequest(
                document_id=document.id,
                organization_id=document.organization_id,
                created_by_user_id=getattr(user, "id", None),
            )
        payment_request.total_cents = payload.total_cents
        payment_request.currency = payload.currency
        payment_request.memo = payload.memo
        payment_request.split_mode = payload.split_mode
        db.add(payment_request)
        db.flush()  # need payment_request.id before writing it onto fields

        for allocation in resolved:
            # A recipient is only ever validated to have at least one payment
            # field; if they were somehow given more than one, the first is
            # the one this request allocates to, and the rest are left alone.
            field = payment_fields_by_recipient[allocation.recipient_id][0]
            config = self.field_config(field)
            updated = config.model_copy(
                update={
                    # An allocation is an obligation -- "you owe 333.34 of the
                    # 1000.00" -- so an allocated field is always `fixed`,
                    # whatever it was authored as. Leaving a `signer_entered`
                    # mode in place here let an allocated payer charge
                    # themselves `min_cents` and sign, paying a fraction of
                    # their share: `create_intent` reads the mode, not the
                    # allocation, when deciding the amount.
                    "amount_mode": "fixed",
                    "amount_cents": allocation.amount_cents,
                    "currency": payload.currency,
                    "payment_request_id": payment_request.id,
                }
            )
            field.options = updated.model_dump()
            # An allocated payment field is REQUIRED, whatever it was authored
            # as. The settlement gate only considers required payment fields
            # (see `outstanding_payment_fields`), so an optional one allocated
            # a share of the total produces the worst possible outcome: the
            # signer is shown a Pay button, is told they owe money, and can
            # sign without paying it. Forcing it here means the obligation and
            # the gate can never disagree.
            field.required = True
            db.add(field)

        db.commit()
        db.refresh(payment_request)

        audit_service.log(
            db,
            document_id=document.id,
            event_type="payment_request_synced",
            event_message=f"Payment request for {payload.total_cents} {payload.currency} across {len(resolved)} recipient(s).",
            user_id=getattr(user, "id", None),
            metadata={"payment_request_id": payment_request.id, "split_mode": str(payload.split_mode)},
        )
        return payment_request

    def document_summary(self, db: Session, *, document: Document) -> PaymentRequestResponse | None:
        """The sender's view of collection progress, or ``None`` if unrequested."""
        payment_request = db.query(PaymentRequest).filter(PaymentRequest.document_id == document.id).first()
        if payment_request is None:
            return None

        payments = (
            db.query(SignerPayment).filter(SignerPayment.payment_request_id == payment_request.id).all()
        )
        settled = [payment for payment in payments if payment.status in _SETTLED_STATUSES]
        collected_cents = sum(payment.amount_cents - payment.refunded_amount_cents for payment in settled)
        paid_count = len({payment.recipient_id for payment in settled})
        allocation_count = sum(
            1
            for field in document.fields
            if field.type == FieldType.payment
            and isinstance(field.options, dict)
            and field.options.get("payment_request_id") == payment_request.id
        )

        response = PaymentRequestResponse.model_validate(payment_request)
        response.collected_cents = collected_cents
        response.paid_count = paid_count
        response.allocation_count = allocation_count
        return response

    def refund(
        self, db: Session, *, payment: SignerPayment, actor_user_id: str | None = None, amount_cents: int | None = None
    ) -> SignerPayment:
        """Refund a settled `SignerPayment`, in full or in part.

        This exists because pay-then-sign lets a signer pay for an envelope
        that is later voided or declined -- the money already moved to the
        tenant's connected account before anyone knew the deal was off.
        Without a refund path here that is a chargeback waiting to happen
        (which costs the tenant a fee on top of the money itself, and dings
        their Stripe account's dispute rate).
        """
        if payment.status not in _SETTLED_STATUSES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only a succeeded payment can be refunded.")
        remaining = payment.amount_cents - payment.refunded_amount_cents
        amount = amount_cents if amount_cents is not None else remaining
        if amount <= 0 or amount > remaining:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Refund amount must be between 1 and {remaining} cents.",
            )
        if not payment.provider_account_id or not payment.provider_payment_intent_id:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Payment has no provider intent to refund.")

        body = self._request(
            "POST",
            "/v1/refunds",
            {"payment_intent": payment.provider_payment_intent_id, "amount": amount},
            connected_account_id=payment.provider_account_id,
        )

        payment.refunded_amount_cents += amount
        payment.refunded_at = _utcnow()
        if payment.refunded_amount_cents >= payment.amount_cents:
            payment.status = SignerPaymentStatus.refunded
        db.add(payment)
        db.commit()
        db.refresh(payment)

        audit_service.log(
            db,
            document_id=payment.document_id,
            recipient_id=payment.recipient_id,
            event_type="signer_payment_refunded",
            event_message=f"Refunded {amount} cents of a {payment.amount_cents}-cent payment.",
            user_id=actor_user_id,
            metadata={"payment_id": payment.id, "amount_cents": amount, "stripe_refund_id": body.get("id")},
        )
        return payment

    # ================================================================
    # Signer side
    # ================================================================

    def _existing_reusable_payment(self, db: Session, *, field_id: str, amount_cents: int) -> SignerPayment | None:
        candidate = (
            db.query(SignerPayment)
            .filter(SignerPayment.field_id == field_id, SignerPayment.status.in_(_NON_TERMINAL_STATUSES))
            .order_by(SignerPayment.created_at.desc())
            .first()
        )
        if candidate is not None and candidate.amount_cents == amount_cents:
            return candidate
        return None

    def _latest_succeeded_or_processing(self, db: Session, *, field_id: str) -> SignerPayment | None:
        return (
            db.query(SignerPayment)
            .filter(SignerPayment.field_id == field_id)
            .order_by(SignerPayment.created_at.desc())
            .first()
        )

    def _collected_cents(self, db: Session, *, field_id: str) -> int:
        """Money actually collected on this field so far, net of refunds.

        Summed across every succeeded row rather than read off the latest one,
        so a field topped up in two charges is judged on the total.
        """
        rows = (
            db.query(SignerPayment)
            .filter(
                SignerPayment.field_id == field_id,
                SignerPayment.status == SignerPaymentStatus.succeeded,
            )
            .all()
        )
        return sum(max(row.amount_cents - (row.refunded_amount_cents or 0), 0) for row in rows)

    def create_intent(
        self, db: Session, *, raw_token: str, field_id: str, amount_cents: int | None = None
    ) -> PaymentIntentResponse:
        """Create (or reuse) the Stripe PaymentIntent for one payment field.

        THE CRITICAL RULE: the charged amount always comes from the FIELD's
        server-side config, never from the request body. For
        ``amount_mode="fixed"`` any client-supplied ``amount_cents`` is
        ignored outright. For ``amount_mode="signer_entered"`` a
        client-supplied amount is only *accepted* after being clamped/
        validated against the field's ``min_cents``/``max_cents`` and
        Stripe's own minimum -- a client that lies about the amount can only
        ever end up paying a value the sender already agreed was acceptable,
        never an arbitrary one.

        Reuses a non-terminal `SignerPayment` row for this field (same field,
        same resolved amount) instead of minting a second PaymentIntent on
        every button click, and passes a stable idempotency key derived from
        the field id and amount, so a double-click cannot double-charge --
        this matters more than anything else in this method.

        The PaymentIntent is created as a DIRECT charge on the tenant's
        connected account with NO application fee: the tenant is the merchant
        of record here, and the platform takes no cut of a signer's money.
        """
        signing_token, document, recipient = signing_service.load_session(db, raw_token=raw_token)
        field = signing_service._get_owned_field(document, recipient, field_id)
        config = self.field_config(field)

        if document.status == DocumentStatus.completed or recipient.status == RecipientStatus.completed:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This envelope is already completed.")

        # Refuse only when the field is genuinely *settled*, not merely when
        # some succeeded row exists. Those are different questions once the
        # amount owed can move: if the sender raises the allocation, or an
        # admin partially refunds, an earlier succeeded charge stops covering
        # the obligation. Keying the refusal off "a succeeded row exists"
        # deadlocked exactly that case -- the signer could not pay (409, this
        # is already paid) and could not sign (402, payment required), with no
        # way out of either. What they owe now is the shortfall.
        if self.settled_payment(db, field=field) is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This field has already been paid.")

        already_collected = self._collected_cents(db, field_id=field.id)

        if config.amount_mode == "fixed":
            if config.amount_cents is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Payment field is missing a fixed amount.")
            amount = config.amount_cents - already_collected
        elif config.payment_request_id and config.amount_cents is not None:
            # Belt and braces for point 1: a field whose `options` were written
            # straight through the fields API could still claim
            # `signer_entered` while carrying an allocation. The allocation
            # wins -- it is what the envelope says this signer owes.
            amount = config.amount_cents - already_collected
        else:
            lower_bound = max(config.min_cents or STRIPE_MINIMUM_CHARGE_CENTS, STRIPE_MINIMUM_CHARGE_CENTS)
            upper_bound = config.max_cents
            proposed = amount_cents if amount_cents is not None else lower_bound
            if proposed < lower_bound or (upper_bound is not None and proposed > upper_bound):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Amount must be between {lower_bound} and {upper_bound if upper_bound is not None else 'no limit'} cents.",
                )
            amount = proposed

        if amount < STRIPE_MINIMUM_CHARGE_CENTS:
            if already_collected > 0:
                # A remainder Stripe will not accept as its own charge. Saying
                # so beats both a silent write-off and a Pay button that
                # 400s forever with a message about minimums the signer can do
                # nothing about.
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "The remaining balance on this payment is too small to charge separately. "
                        "Please contact the sender to have it adjusted or refunded."
                    ),
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Amount is below the minimum chargeable amount of {STRIPE_MINIMUM_CHARGE_CENTS} cents.",
            )

        account = stripe_connect_service.require_payable_account(db, organization_id=document.organization_id)
        idempotency_key = _idempotency_key(field_id=field.id, amount_cents=amount)

        reusable = self._existing_reusable_payment(db, field_id=field.id, amount_cents=amount)
        if reusable is not None:
            payment = reusable
            if payment.provider_payment_intent_id:
                # Same field, same amount, same in-flight attempt: retrieve
                # the existing intent rather than creating a second one.
                body = self._request(
                    "GET",
                    f"/v1/payment_intents/{payment.provider_payment_intent_id}",
                    connected_account_id=payment.provider_account_id or account.provider_account_id,
                )
            else:
                body = self._create_payment_intent(
                    account_id=account.provider_account_id,
                    amount=amount,
                    config=config,
                    document=document,
                    recipient=recipient,
                    field=field,
                    idempotency_key=idempotency_key,
                )
                payment.provider_payment_intent_id = body.get("id")
                payment.provider_account_id = account.provider_account_id
                payment.idempotency_key = idempotency_key
                db.add(payment)
        else:
            body = self._create_payment_intent(
                account_id=account.provider_account_id,
                amount=amount,
                config=config,
                document=document,
                recipient=recipient,
                field=field,
                idempotency_key=idempotency_key,
            )
            payment = SignerPayment(
                organization_id=document.organization_id,
                document_id=document.id,
                recipient_id=recipient.id,
                field_id=field.id,
                payment_request_id=config.payment_request_id,
                amount_cents=amount,
                currency=config.currency,
                status=SignerPaymentStatus.requires_payment,
                provider="stripe",
                provider_payment_intent_id=body.get("id"),
                provider_account_id=account.provider_account_id,
                idempotency_key=idempotency_key,
                description=config.memo,
            )
            db.add(payment)

        db.commit()
        db.refresh(payment)

        return PaymentIntentResponse(
            client_secret=str(body.get("client_secret") or ""),
            publishable_key=self._publishable_key(),
            connected_account_id=account.provider_account_id or "",
            amount_cents=amount,
            currency=config.currency,
            description=config.memo,
        )

    def _create_payment_intent(
        self,
        *,
        account_id: str | None,
        amount: int,
        config: PaymentFieldConfig,
        document: Document,
        recipient: Recipient,
        field: Field,
        idempotency_key: str,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "amount": amount,
            "currency": config.currency.lower(),
            # Identifiable on both the signer's card statement and the
            # tenant's own Stripe dashboard.
            "description": config.memo or "Signer payment",
            "automatic_payment_methods[enabled]": "true",
            "metadata[document_id]": document.id,
            "metadata[recipient_id]": recipient.id,
            "metadata[field_id]": field.id,
            # Deliberately NO application_fee_amount: this is a direct charge,
            # the tenant is the merchant of record, and the platform takes no
            # cut of a signer's money.
        }
        return self._request(
            "POST", "/v1/payment_intents", params, connected_account_id=account_id, idempotency_key=idempotency_key
        )

    def refresh_payment(self, db: Session, *, raw_token: str, field_id: str) -> SignerPayment:
        """Reconcile a `SignerPayment` against Stripe's own view of the intent.

        This is the fallback that matters. Webhooks arrive late (or never, in
        development, where nothing points a live Stripe endpoint back at a
        local machine) while the signer is standing there watching the Pay
        button, waiting for it to turn green. Polling this once after Stripe
        confirms the client-side charge closes that gap without depending on
        the webhook at all.
        """
        signing_token, document, recipient = signing_service.load_session(db, raw_token=raw_token)
        field = signing_service._get_owned_field(document, recipient, field_id)
        payment = self._latest_succeeded_or_processing(db, field_id=field.id)
        if payment is None or not payment.provider_payment_intent_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No payment attempt found for this field.")
        if payment.status in _SETTLED_STATUSES:
            return payment

        body = self._request(
            "GET",
            f"/v1/payment_intents/{payment.provider_payment_intent_id}",
            connected_account_id=payment.provider_account_id,
        )
        self._reconcile(db, payment=payment, body=body, field=field)
        db.commit()
        db.refresh(payment)
        return payment

    def _latest_charge(self, body: dict[str, Any]) -> dict[str, Any]:
        """Pull a receipt/charge id out of a PaymentIntent body, either API shape."""
        charges = (body.get("charges") or {}).get("data") or []
        if charges:
            return charges[-1] if isinstance(charges[-1], dict) else {}
        latest = body.get("latest_charge")
        return latest if isinstance(latest, dict) else {}

    def _reconcile(
        self, db: Session, *, payment: SignerPayment, body: dict[str, Any], field: Field | None, event_type: str | None = None
    ) -> None:
        stripe_status = body.get("status")
        if stripe_status == "succeeded" or event_type == "payment_intent.succeeded":
            if payment.status != SignerPaymentStatus.succeeded:
                payment.status = SignerPaymentStatus.succeeded
                payment.paid_at = _utcnow()
                charge = self._latest_charge(body)
                payment.provider_charge_id = charge.get("id") or payment.provider_charge_id
                payment.receipt_url = charge.get("receipt_url") or payment.receipt_url
                if field is not None:
                    # The existing required-field completion gate only knows
                    # how to check `Field.value`, so a settled payment has to
                    # write one -- prefixed so it can never be confused with a
                    # signer-typed answer.
                    field.value = f"paid:{payment.provider_payment_intent_id}"
                    db.add(field)
            db.add(payment)
        elif event_type == "payment_intent.payment_failed" or stripe_status in {"canceled"}:
            last_error = body.get("last_payment_error") or {}
            payment.status = SignerPaymentStatus.failed
            payment.failure_code = last_error.get("code")
            payment.failure_message = last_error.get("message")
            db.add(payment)
        else:
            payment.status = SignerPaymentStatus.processing
            db.add(payment)

    def apply_webhook_event(self, db: Session, *, event: dict[str, Any]) -> SignerPayment | None:
        """Reconcile a `payment_intent.succeeded`/`.payment_failed` webhook.

        Looked up by ``provider_payment_intent_id``; ``None`` when the event
        does not concern a `SignerPayment` this app created (e.g. a stray
        PaymentIntent on the connected account created outside SignerPro).
        Must be idempotent -- Stripe redelivers events, sometimes more than
        once for the same delivery attempt -- so an already-settled row is
        left untouched rather than re-applied.
        """
        event_type = event.get("type")
        if event_type not in {"payment_intent.succeeded", "payment_intent.payment_failed"}:
            return None
        data_object = ((event.get("data") or {}).get("object")) or {}
        intent_id = data_object.get("id")
        if not intent_id:
            return None

        payment = (
            db.query(SignerPayment).filter(SignerPayment.provider_payment_intent_id == intent_id).first()
        )
        if payment is None:
            return None
        if payment.status in _SETTLED_STATUSES:
            return payment

        field = db.get(Field, payment.field_id)
        self._reconcile(db, payment=payment, body=data_object, field=field, event_type=event_type)
        db.commit()
        db.refresh(payment)
        return payment

    # ================================================================
    # Gate helpers (called by signing_service before a signature is accepted)
    # ================================================================

    def outstanding_payment_fields(self, document: Document, recipient: Recipient) -> list[Field]:
        """This recipient's payment fields that must be settled before signing.

        Mirrors ``signing_service._outstanding_required_fields``: a
        conditionally-hidden payment field is skipped, because the signer is
        forbidden from acting on it at all.
        """
        return [
            field
            for field in document.fields
            if field.recipient_id == recipient.id
            and field.type == FieldType.payment
            and field.required
            # Consistency with `signing_service._outstanding_required_fields`,
            # which also filters on `required`. When these two disagree the
            # signer gets the worst of both: a submit button the session
            # counters render as enabled, which then 402s on click.
            and field_service.condition_is_met(document, field)
        ]

    def amount_owed(self, field: Field) -> int | None:
        """What ``field`` obliges this signer to pay, or ``None`` if open-ended.

        A `fixed` field and an allocated split both name an exact figure. A
        pure `signer_entered` field (a donation, an open deposit) names none,
        so any amount that cleared Stripe's minimum settles it.
        """
        config = self.field_config(field)
        if config.payment_request_id and config.amount_cents is None:
            # An allocation with no figure is a misconfigured field, and the
            # safe reading of "we do not know what is owed" is *not* "any
            # amount will do" -- that let 50 cents settle a field the sender
            # meant to carry a share of the total. Fail closed and name it.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Payment field '{field.label}' is allocated but has no amount.",
            )
        if config.amount_mode == "fixed" or config.payment_request_id:
            return config.amount_cents
        return None

    def settled_payment(self, db: Session, *, field: Field) -> SignerPayment | None:
        """The succeeded `SignerPayment` that actually covers ``field``.

        The amount comparison is the point: a succeeded row on its own only
        proves *some* money arrived, not that the sum owed did. Without this,
        a payer allocated 333.34 of a split could settle the field with a
        50-cent charge and sign, and the envelope would report itself paid.
        """
        owed = self.amount_owed(field)
        latest = (
            db.query(SignerPayment)
            .filter(
                SignerPayment.field_id == field.id,
                SignerPayment.status == SignerPaymentStatus.succeeded,
            )
            .order_by(SignerPayment.created_at.desc())
            .first()
        )
        if latest is None:
            return None
        if owed is None:
            # An open-amount field (a donation, an open deposit): any charge
            # that cleared Stripe's minimum settles it.
            return latest
        # Summed across every succeeded row, NOT judged one row at a time.
        # `create_intent` charges the shortfall when the amount owed moves, so
        # a topped-up field legitimately holds two smaller charges that only
        # cover the debt together. Comparing row-by-row here refused all of
        # them and re-created, one step later, the exact deadlock charging the
        # shortfall was meant to resolve: paid in full, still unable to sign.
        if self._collected_cents(db, field_id=field.id) >= owed:
            return latest
        return None

    def assert_payments_settled(self, db: Session, *, document: Document, recipient: Recipient) -> None:
        """Raise 402 unless every one of this recipient's payment fields is paid.

        This re-verifies against the `SignerPayment` table rather than
        trusting `Field.value`. `Field.value` is writable through the
        ordinary field-value endpoint that every other field type uses, so it
        must never be the sole proof that money arrived -- a signer (or a
        replayed request) could otherwise write ``paid:pi_fake`` into the
        field directly and sign for free. The succeeded row in
        `SignerPayment`, populated only by Stripe's own confirmation
        (webhook or `refresh_payment`), is the actual source of truth.
        """
        outstanding = self.outstanding_payment_fields(document, recipient)
        unpaid = [field for field in outstanding if self.settled_payment(db, field=field) is None]
        if unpaid:
            labels = ", ".join(field.label for field in unpaid)
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=f"Payment required before signing: {labels}",
            )


signer_payment_service = SignerPaymentService()
