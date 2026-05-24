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


class OtpVerifyRequest(BaseModel):
    code: str = Field(min_length=4, max_length=10)
