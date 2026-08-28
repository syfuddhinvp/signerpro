from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ApiKeyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    mode: str
    prefix: str
    masked: str
    scopes: list[str]
    created_at: datetime
    last_used_at: datetime | None = None
    revoked_at: datetime | None = None


class ApiKeyCreated(ApiKeyResponse):
    #: The full plaintext secret. Returned exactly once — it is never recoverable.
    secret: str


class ApiKeyCreate(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    mode: Literal["live", "test"] = "test"
    scopes: list[str] = Field(default_factory=list)


class ApiKeyScopesRequest(BaseModel):
    scopes: list[str] = Field(default_factory=list)


class ApiKeyScopeResponse(BaseModel):
    scope: str
    label: str
    description: str


class ApiKeyUsageResponse(BaseModel):
    requests_24h: int
    p95_latency_ms: int
    error_rate_pct: float
    error_count: int
    active_key_count: int
    revoked_key_count: int
    embed_sessions_24h: int
    embed_avg_seconds: float


class ApiSettingsResponse(BaseModel):
    allowed_origins: list[str] = Field(default_factory=list)
    default_return_url: str | None = None
    live_mode_enabled: bool = True


class ApiSettingsUpdate(BaseModel):
    allowed_origins: list[str] | None = None
    default_return_url: str | None = Field(default=None, max_length=1024)
    live_mode_enabled: bool | None = None
