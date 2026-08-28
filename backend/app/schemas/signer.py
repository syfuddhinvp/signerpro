from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

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
    status: RecipientStatus


class SigningSessionResponse(BaseModel):
    document: PublicDocument
    recipient: PublicRecipient
    current_recipient_id: str
    fields: list[FieldResponse]
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
