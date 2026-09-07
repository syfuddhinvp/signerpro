from datetime import datetime

from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import DocumentStatus, FieldType, RecipientStatus, SignatureType, WorkflowType
from app.schemas.field import FieldResponse


class PublicDocument(BaseModel):
    title: str
    status: DocumentStatus
    workflow_type: WorkflowType
    page_count: int


class PublicRecipient(BaseModel):
    name: str
    email: EmailStr
    role_name: str | None
    #: Typed role: sign | approve | copy | inperson. A ``copy`` recipient gets
    #: a read-only copy and is never asked to sign (RTE-3).
    role: str = "sign"
    status: RecipientStatus


class FieldPlacementResponse(BaseModel):
    """A *redacted* view of a field belonging to somebody else (SIGN-1).

    The signing surface legitimately needs to know that a region of the page is
    already spoken for, so it can lay the sheet out and grey the box out rather
    than drawing this signer's inputs on top of it. It does **not** need — and
    must never receive — the other recipient's label, captured value, options,
    placeholder or recipient id: those are exactly the salary/SSN
    payloads finding SIGN-1 recorded leaking. Geometry, page and coarse type
    are all that survive the redaction.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    type: FieldType
    page_number: int
    x: Decimal
    y: Decimal
    width: Decimal
    height: Decimal


class AnnotationResponse(BaseModel):
    """One of the sender's own marks on the page — a pen drawing or a text box.

    Annotations are document content, not an obligation, so every recipient
    sees them whoever they happen to be assigned to. They are exposed on their
    own rather than folded into ``other_field_placements`` because the mark
    itself (the strokes, or the text and its face) is the point — redacted
    geometry would draw an empty box — and because they carry nothing a
    recipient entered, so there is nothing to leak.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    type: FieldType
    page_number: int
    x: Decimal
    y: Decimal
    width: Decimal
    height: Decimal
    #: A text box's text. A drawing has none.
    default_value: str | None = None
    #: The normalised annotation payload — see ``app/core/annotations.py``.
    options: dict[str, Any] | list[Any] | None = None


class SigningSessionResponse(BaseModel):
    document: PublicDocument
    recipient: PublicRecipient
    current_recipient_id: str
    #: Only the fields assigned to *this* recipient, in full.
    fields: list[FieldResponse]
    #: Redacted geometry for every other recipient's fields — layout context
    #: only, no labels and no values. See ``FieldPlacementResponse``.
    other_field_placements: list[FieldPlacementResponse] = Field(default_factory=list)
    #: The sender's page annotations, shown to every recipient (ANN-1).
    annotations: list[AnnotationResponse] = Field(default_factory=list)
    read_only: bool
    expires_at: datetime
    pdf_url: str
    required_total: int
    required_completed: int
    otp_required: bool = False
    consent_required: bool = False
    # Bootstrap extras (SIGN-2/SIGN-4/SIGN-6) — additive, safe defaults.
    document_id: str = ""
    assigned_field_ids: list[str] = Field(default_factory=list)
    consent_accepted: bool = False
    consent_accepted_at: datetime | None = None
    consent_version: str = "1.0"
    can_decline: bool = True
    can_reassign: bool = True


class FieldValueRequest(BaseModel):
    value: str | bool


class SignatureRequest(BaseModel):
    signature_type: SignatureType
    signature_text: str | None = Field(default=None, max_length=255)
    signature_image_base64: str | None = None


class CompletionResponse(BaseModel):
    document_status: DocumentStatus
    recipient_status: RecipientStatus
    final_pdf_url: str | None = None


class DeclineRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class ReassignRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    reason: str = Field(min_length=1, max_length=500)


class ReassignResponse(BaseModel):
    recipient_id: str
    previous_email: EmailStr
    new_email: EmailStr
    signing_url: str


class OtpVerifyRequest(BaseModel):
    code: str = Field(min_length=4, max_length=10)


class AttachmentUploadResponse(BaseModel):
    """Result of a signer uploading a file into an ``attachment`` field."""

    field_id: str
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
