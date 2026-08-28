from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class PlanResponse(BaseModel):
    id: str
    code: str
    name: str
    description: str | None = None
    price_cents: int
    currency: str
    billing_interval: str
    trial_days: int
    is_active: bool
    entitlements: dict[str, Any]

    class Config:
        from_attributes = True


class SubscriptionResponse(BaseModel):
    id: str | None = None
    organization_id: str
    plan_code: str
    plan_name: str
    status: str
    current_period_start: datetime | None = None
    current_period_end: datetime | None = None
    trial_ends_at: datetime | None = None
    cancel_at_period_end: bool = False
    canceled_at: datetime | None = None
    provider: str | None = None
    entitlements: dict[str, Any] = Field(default_factory=dict)


class UsageLimit(BaseModel):
    limit: int | None = None
    used: int = 0
    remaining: int | None = None
    exceeded: bool = False


class UsageResponse(BaseModel):
    organization_id: str
    plan_code: str
    plan_name: str
    subscription_status: str
    period_start: datetime
    period_end: datetime
    limits: dict[str, UsageLimit]
    period_totals: dict[str, int]
    features: dict[str, bool]


class CheckoutRequest(BaseModel):
    plan_code: str = Field(max_length=50)
    success_url: str | None = None
    cancel_url: str | None = None


class CheckoutResponse(BaseModel):
    session_id: str
    url: str
    provider: str
    plan_code: str


class ChangePlanRequest(BaseModel):
    plan_code: str = Field(max_length=50)


class CancelRequest(BaseModel):
    at_period_end: bool = True
