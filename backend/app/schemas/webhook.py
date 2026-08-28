from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class WebhookEndpointCreate(BaseModel):
    url: str = Field(max_length=2048)
    description: str | None = Field(default=None, max_length=255)
    event_types: list[str] | None = None
    is_active: bool = True


class WebhookEndpointUpdate(BaseModel):
    url: str | None = Field(default=None, max_length=2048)
    description: str | None = Field(default=None, max_length=255)
    event_types: list[str] | None = None
    is_active: bool | None = None


class WebhookEndpointResponse(BaseModel):
    """The secret is deliberately omitted; it is shown once on creation."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    url: str
    description: str | None
    event_types: list[str] | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class WebhookEndpointCreated(WebhookEndpointResponse):
    secret: str


class WebhookDeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    endpoint_id: str
    event_id: str
    event_type: str
    document_id: str | None
    payload: dict | None
    attempt: int
    status: str
    status_code: int | None
    error: str | None
    delivered_at: datetime | None
    next_retry_at: datetime | None
    created_at: datetime
    updated_at: datetime


class WebhookEventTypeResponse(BaseModel):
    event_type: str
    description: str
