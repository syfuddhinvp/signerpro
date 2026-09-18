from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import PaymentReceiptStatus, PaymentSplitMode, SignerPaymentStatus

#: Stripe declines any charge attempt below 50 cents (in a zero-decimal-free
#: currency like USD); allocations and payments are validated against this so
#: a bad amount surfaces at request time, not as an opaque provider error.
STRIPE_MINIMUM_CHARGE_CENTS = 50


# --- PAY-1: the validated shape of a payment Field's `options` JSON --------


class PaymentFieldConfig(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    amount_mode: Literal["fixed", "signer_entered"] = "fixed"
    amount_cents: int | None = None
    min_cents: int | None = None
    max_cents: int | None = None
    currency: str = Field(default="USD", min_length=3, max_length=3)
    memo: str | None = None
    payment_request_id: str | None = None


# --- PaymentAccount (Stripe Connect) ----------------------------------------


class PaymentAccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    provider: str
    provider_account_id: str | None = None
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool
    default_currency: str | None = None
    livemode: bool
    onboarded_at: datetime | None = None
    last_synced_at: datetime | None = None
    disabled_reason: str | None = None


class PaymentAccountLinkResponse(BaseModel):
    """A one-time hosted onboarding url (Stripe account link)."""

    url: str
    expires_at: datetime


# --- PaymentRequest ----------------------------------------------------------


class PaymentAllocationInput(BaseModel):
    recipient_id: str
    amount_cents: int = Field(ge=0)


class PaymentRequestCreate(BaseModel):
    total_cents: int = Field(ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    memo: str | None = Field(default=None, max_length=255)
    split_mode: PaymentSplitMode = PaymentSplitMode.single
    allocations: list[PaymentAllocationInput] = Field(default_factory=list)


class PaymentRequestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    organization_id: str
    total_cents: int
    currency: str
    memo: str | None = None
    split_mode: PaymentSplitMode
    created_by_user_id: str | None = None
    #: Sum of `SignerPayment.amount_cents` across succeeded attempts, and the
    #: number of allocations that have and have not yet paid -- the fields a
    #: partial-collection status view needs without re-querying payments.
    collected_cents: int = 0
    paid_count: int = 0
    allocation_count: int = 0


# --- SignerPayment -----------------------------------------------------------


class SignerPaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    document_id: str
    recipient_id: str
    field_id: str
    payment_request_id: str | None = None
    amount_cents: int
    currency: str
    status: SignerPaymentStatus
    provider: str | None = None
    provider_payment_intent_id: str | None = None
    provider_charge_id: str | None = None
    receipt_url: str | None = None
    failure_code: str | None = None
    failure_message: str | None = None
    paid_at: datetime | None = None
    refunded_at: datetime | None = None
    refunded_amount_cents: int
    description: str | None = None
    created_at: datetime
    #: The tenant's own receipt for this payment (PAY-2), when one exists.
    #: A forward reference because `PaymentReceiptResponse` is declared below;
    #: `model_rebuild` at the end of that block resolves it. Populated
    #: explicitly by the routes -- there is no ORM relationship to hydrate it
    #: from, and an accidental lazy load per payment row would N+1 the ledger.
    receipt: "PaymentReceiptResponse | None" = None


# --- PaymentReceipt (PAY-2) ---------------------------------------------------


class PaymentReceiptResponse(BaseModel):
    """The tenant's own financial record of one settled signer payment.

    ``verified`` is computed, not stored: it is the answer to "does this row
    still match the checksum it was sealed with", and a client must never be
    able to render an edited receipt as an intact one.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    signer_payment_id: str
    document_id: str | None = None
    document_ref: str | None = None
    recipient_id: str | None = None
    number: str
    status: PaymentReceiptStatus
    currency: str
    subtotal_cents: int
    tax_cents: int
    total_cents: int
    refunded_amount_cents: int
    net_cents: int
    payer_name: str | None = None
    payer_email: str | None = None
    document_title: str | None = None
    issuer_name: str | None = None
    description: str | None = None
    line_items: list | None = None
    provider: str | None = None
    provider_account_id: str | None = None
    provider_payment_intent_id: str | None = None
    provider_charge_id: str | None = None
    provider_receipt_url: str | None = None
    issued_at: datetime
    paid_at: datetime | None = None
    refunded_at: datetime | None = None
    checksum: str | None = None
    audit_log_id: str | None = None
    #: Set by the route from `payment_receipt_service.verify`.
    verified: bool = False


# Resolves `SignerPaymentResponse.receipt`, declared above this class.
SignerPaymentResponse.model_rebuild()


class PaymentLedgerEntry(BaseModel):
    """One row of the tenant-wide payments ledger.

    A flattened join rather than a `SignerPaymentResponse`: the ledger's whole
    purpose is to be readable without opening each envelope, so the payer and
    document names travel with the row. Refunding used to be reachable only
    from a single envelope's audit page, which is why money collected across
    many envelopes had no one place it could be reviewed or returned from.
    """

    model_config = ConfigDict(from_attributes=True)

    payment: SignerPaymentResponse
    receipt: PaymentReceiptResponse | None = None
    document_id: str
    document_title: str | None = None
    document_status: str | None = None
    payer_name: str | None = None
    payer_email: str | None = None


class PaymentLedgerPage(BaseModel):
    """A page of the ledger plus the totals a finance reviewer needs.

    Totals are computed over the *whole* filtered set, not the page: a
    "collected" figure that silently meant "collected on this page" is the
    kind of number someone files a tax return against.
    """

    entries: list[PaymentLedgerEntry]
    total: int
    limit: int
    offset: int
    #: Net of refunds, per currency -- never summed across currencies.
    collected_cents_by_currency: dict[str, int] = {}
    refunded_cents_by_currency: dict[str, int] = {}
    succeeded_count: int = 0
    refunded_count: int = 0
    failed_count: int = 0


class PaymentIntentResponse(BaseModel):
    """What the signing client needs to mount Stripe's payment element."""

    client_secret: str
    publishable_key: str
    connected_account_id: str
    amount_cents: int
    currency: str
    description: str | None = None


# --- Allocation validation ---------------------------------------------------


def validate_allocations(
    total_cents: int,
    allocations: list[PaymentAllocationInput],
    split_mode: PaymentSplitMode,
) -> None:
    """Raise ``ValueError`` when a `PaymentRequestCreate` is not collectible.

    Every split mode needs at least one allocation -- a request nobody is
    asked to pay is not a request. ``custom`` additionally must sum exactly
    to the total (equal/single splits are computed, not author-supplied, so
    they cannot drift). Every allocation is checked against Stripe's minimum
    so a doomed charge never reaches the provider.
    """
    if not allocations:
        raise ValueError("A payment request needs at least one allocation.")

    for allocation in allocations:
        if allocation.amount_cents < STRIPE_MINIMUM_CHARGE_CENTS:
            raise ValueError(
                f"Allocation for recipient {allocation.recipient_id} is below the "
                f"minimum chargeable amount of {STRIPE_MINIMUM_CHARGE_CENTS} cents."
            )

    if split_mode == PaymentSplitMode.custom:
        allocated_total = sum(allocation.amount_cents for allocation in allocations)
        if allocated_total != total_cents:
            raise ValueError(
                f"Custom allocations sum to {allocated_total} cents, which does not "
                f"match the request total of {total_cents} cents."
            )
