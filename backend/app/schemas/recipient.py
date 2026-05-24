from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import RecipientStatus


class RecipientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    role_name: str | None = Field(default=None, max_length=120)
    signing_order: int = Field(default=1, ge=1)
    otp_enabled: bool = Field(default=False)
    phone_number: str | None = Field(default=None, max_length=30)


class RecipientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    role_name: str | None = Field(default=None, max_length=120)
    signing_order: int | None = Field(default=None, ge=1)
    otp_enabled: bool | None = None
    phone_number: str | None = Field(default=None, max_length=30)


class RecipientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    name: str
    email: EmailStr
    role_name: str | None
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

