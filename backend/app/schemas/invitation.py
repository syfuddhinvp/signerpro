from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import UserRole


class InvitationCreate(BaseModel):
    email: EmailStr
    role: UserRole = UserRole.sender


class InvitationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    email: EmailStr
    role: UserRole
    invited_by_user_id: str
    expires_at: datetime
    accepted_at: datetime | None = None
    created_at: datetime


class InvitationCreateResponse(BaseModel):
    invitation: InvitationResponse
    invite_link: str


class InvitationAcceptRequest(BaseModel):
    token: str = Field(min_length=8, max_length=512)
    name: str = Field(min_length=2, max_length=255)
    password: str = Field(min_length=8, max_length=128)
