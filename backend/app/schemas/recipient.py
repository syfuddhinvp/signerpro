from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models.enums import RecipientStatus, WorkflowType


RecipientRole = Literal["sign", "approve", "copy", "inperson"]


class RecipientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    role_name: str | None = Field(default=None, max_length=120)
    signing_order: int = Field(default=1, ge=1)
    otp_enabled: bool = Field(default=False)
    phone_number: str | None = Field(default=None, max_length=30)
    role: RecipientRole = "sign"
    color: str | None = Field(default=None, max_length=9)
    contact_id: str | None = None


class RecipientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    role_name: str | None = Field(default=None, max_length=120)
    signing_order: int | None = Field(default=None, ge=1)
    otp_enabled: bool | None = None
    phone_number: str | None = Field(default=None, max_length=30)
    role: RecipientRole | None = None
    color: str | None = Field(default=None, max_length=9)
    contact_id: str | None = None


class RecipientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    name: str
    # `""`, not just EmailStr: a template's recipients are role placeholders
    # ("Employee", "Employer representative") that carry no address until the
    # sender assigns real people. `recipients.email` is NOT NULL, so blank is
    # how a placeholder is spelled -- and a bare EmailStr here made GET
    # /recipients raise a ResponseValidationError for any such template.
    # Only the response is relaxed: RecipientCreate/Update still demand a real
    # address, so no caller can write a blank one through the API.
    email: EmailStr | Literal[""]
    role_name: str | None
    role: str
    color: str | None
    contact_id: str | None
    signing_order: int
    status: RecipientStatus
    viewed_at: datetime | None
    completed_at: datetime | None
    declined_at: datetime | None
    decline_reason: str | None
    otp_enabled: bool
    phone_number: str | None
    otp_verified: bool
    consent_accepted: bool
    consent_accepted_at: datetime | None
    created_at: datetime
    updated_at: datetime



class RecipientSetItem(RecipientCreate):
    """One recipient in a full-list replace. ``id`` keeps the existing row
    (and its signing progress); omitting it creates a new recipient."""

    id: str | None = None


class RecipientSetRequest(BaseModel):
    recipients: list[RecipientSetItem] = Field(default_factory=list, max_length=100)
    workflow_type: WorkflowType | None = None


class RecipientReorderRequest(BaseModel):
    recipient_ids: list[str] = Field(min_length=1, max_length=100)


class RecipientBulkRequest(BaseModel):
    recipients: list[RecipientCreate] = Field(default_factory=list, max_length=100)
    from_contact_ids: list[str] = Field(default_factory=list, max_length=100)


class SigningLinkResponse(BaseModel):
    """A freshly minted signing URL for one recipient.

    Minting revokes whatever link was live for that recipient (see
    ``token_service.create_for_recipient``), so this is only ever returned
    from an endpoint that mints on demand -- never cached or replayed.
    """

    url: str
    expires_at: datetime
