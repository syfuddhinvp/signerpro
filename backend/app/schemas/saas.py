from datetime import datetime
from pydantic import BaseModel, Field


class SaaSOrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    subscription_tier: str | None = Field(default=None, max_length=50)
    subscription_status: str | None = Field(default=None, max_length=50)
    subscription_expires_at: datetime | None = None


class SaaSUserUpdate(BaseModel):
    role: str = Field(max_length=50)


class SaaSMetrics(BaseModel):
    total_organizations: int
    total_users: int
    total_documents: int
    active_subscriptions: int
    tier_counts: dict[str, int]


class SaaSOrganizationResponse(BaseModel):
    id: str
    name: str
    subscription_tier: str
    subscription_status: str
    subscription_expires_at: datetime | None = None
    created_at: datetime
    users_count: int
    documents_count: int

    class Config:
        from_attributes = True


class SaaSUserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    created_at: datetime
    organization_id: str
    organization_name: str

    class Config:
        from_attributes = True
