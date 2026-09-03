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
    formula = "formula"
    datetime = "datetime"


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
