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


class SignatureType(StrEnum):
    drawn = "drawn"
    typed = "typed"


class DocumentVersionType(StrEnum):
    original = "original"
    prepared = "prepared"
    final = "final"

