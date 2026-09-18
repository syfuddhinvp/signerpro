from enum import StrEnum


class UserRole(StrEnum):
    admin = "admin"
    sender = "sender"


class DocumentStatus(StrEnum):
    draft = "draft"
    prepared = "prepared"
    sent = "sent"
    viewed = "viewed"
    partially_completed = "partially_completed"
    completed = "completed"
    declined = "declined"
    expired = "expired"
    voided = "voided"


class RecipientStatus(StrEnum):
    waiting = "waiting"
    sent = "sent"
    #: Terminal state for a recipient with no signing obligation (``copy``).
    #: They were delivered a copy and that is all that is ever expected of
    #: them, so they do not hold up the completion gate — but they are also
    #: not "completed", which would falsely imply they signed. Wave 1 had to
    #: write ``completed`` here because this member did not exist.
    notified = "notified"
    viewed = "viewed"
    completed = "completed"
    declined = "declined"
    expired = "expired"


class WorkflowType(StrEnum):
    parallel = "parallel"
    sequential = "sequential"


class FieldType(StrEnum):
    signature = "signature"
    initials = "initials"
    full_name = "full_name"
    date = "date"
    text = "text"
    email = "email"
    phone = "phone"
    checkbox = "checkbox"
    dropdown = "dropdown"
    title = "title"
    company = "company"
    address = "address"
    currency = "currency"
    number = "number"
    radio = "radio"
    # FLD-1: prototype palette additions. The prototype's `name` type maps to
    # `full_name` in the client mapper.
    stamp = "stamp"
    attachment = "attachment"
    datetime = "datetime"
    # ANN-1: the sender's own marks on the page -- a freehand pen drawing and a
    # text box with a chosen face and size. Both are authored content, never a
    # recipient obligation: `app/core/annotations.py` holds the shape they
    # carry and the rules that keep them read-only.
    drawing = "drawing"
    textbox = "textbox"
    # PAY-1: a signer-facing amount the recipient pays during signing (deposit
    # or invoice). See `PaymentAccount` / `PaymentRequest` / `SignerPayment`.
    payment = "payment"


class PaymentSplitMode(StrEnum):
    """How a `PaymentRequest`'s total is divided across recipients."""

    #: One recipient pays the whole total.
    single = "single"
    #: The total is divided evenly across every allocation.
    equal = "equal"
    #: Each allocation carries its own amount, validated to sum to the total.
    custom = "custom"


class SignerPaymentStatus(StrEnum):
    """Lifecycle of one `SignerPayment` attempt, mirroring a Stripe PaymentIntent."""

    requires_payment = "requires_payment"
    processing = "processing"
    succeeded = "succeeded"
    failed = "failed"
    refunded = "refunded"


class PaymentReceiptStatus(StrEnum):
    """Lifecycle of one `PaymentReceipt` (PAY-2).

    Separate from `SignerPaymentStatus` because a receipt only ever exists
    for money that actually arrived: there is no ``failed`` or ``processing``
    receipt. A partial refund is its own state rather than being folded into
    ``refunded``, because "we returned some of this" and "we returned all of
    this" are materially different answers to a tax authority or a court.
    """

    issued = "issued"
    partially_refunded = "partially_refunded"
    refunded = "refunded"


class SignatureType(StrEnum):
    drawn = "drawn"
    typed = "typed"


class DocumentVersionType(StrEnum):
    original = "original"
    prepared = "prepared"
    final = "final"


class RecipientRole(StrEnum):
    """Canonical values for ``Recipient.role`` (RTE-3).

    The column stays a plain ``String(20)`` (no migration); this enum exists so
    behaviour keys off named constants instead of scattered string literals.
    """

    sign = "sign"
    approve = "approve"
    copy = "copy"
    inperson = "inperson"


#: Roles that carry a signing obligation: they are gated by required fields,
#: they hold up sequential routing, and the envelope is not complete until they
#: finish. ``copy`` is deliberately absent — a CC recipient receives a
#: read-only copy and never blocks execution.
SIGNING_ROLES = frozenset({RecipientRole.sign, RecipientRole.approve, RecipientRole.inperson})


def is_signing_role(role: str | None) -> bool:
    """True when a recipient's role obliges them to act on the envelope.

    Unknown/legacy values default to *signing*, so an unrecognised role can
    never silently drop a recipient out of the completion gate.
    """
    return (role or RecipientRole.sign) != RecipientRole.copy


class WalletEntryKind(StrEnum):
    """Why one `WalletEntry` moved money into or out of an org's balance.

    The kinds are deliberately specific rather than a generic
    ``credit``/``debit`` pair: a balance line a tenant cannot account for is
    a support ticket, and "where did this $37 come from" has to be answerable
    from the ledger alone, without reconstructing the plan change that
    produced it.
    """

    #: Unused remainder of the old plan, credited when a downgrade is applied
    #: immediately rather than scheduled for the period end.
    downgrade_proration = "downgrade_proration"
    #: Unused remainder of the paid period when the billing interval changes
    #: and the period therefore restarts.
    interval_switch_remainder = "interval_switch_remainder"
    #: Prorated value of seats released mid-period.
    seat_reduction = "seat_reduction"
    #: Money collected beyond what an invoice was owed.
    overpayment = "overpayment"
    #: Issued by a platform admin, with a reason, audited.
    platform_grant = "platform_grant"
    #: A debit: balance spent on an invoice.
    invoice_payment = "invoice_payment"
    #: Correction of an earlier entry. Entries are never edited or deleted,
    #: so an erroneous credit is undone by a matching negative entry.
    reversal = "reversal"
