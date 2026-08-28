"""Account-level preference schemas (SIGN-3, PREF-1…PREF-4, ACT-4)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class SavedSignatureCreate(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    signature_type: str = Field(default="drawn", pattern="^(drawn|typed|uploaded)$")
    signature_text: str | None = Field(default=None, max_length=255)
    type_face: str | None = Field(default=None, max_length=60)
    signature_image_base64: str | None = None
    is_passkey_bound: bool = False


class SavedSignatureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    signature_type: str
    signature_text: str | None = None
    type_face: str | None = None
    is_passkey_bound: bool = False
    adopted_at: datetime
    preview_url: str | None = None

    # Prototype-facing aliases (`method` / `face`) kept as plain fields so the
    # frontend can read either name.
    method: str | None = None
    face: str | None = None


class NotificationPreferenceResponse(BaseModel):
    event_key: str
    label: str
    enabled: bool
    extra_recipients: list[str] = []


class NotificationPreferencesUpdate(BaseModel):
    prefs: dict[str, bool] = {}
    extra_recipients: list[EmailStr] | None = None


class IntegrationResponse(BaseModel):
    provider: str
    label: str
    detail: str | None = None
    connected: bool = False
    connected_at: datetime | None = None


class IntegrationConnectRequest(BaseModel):
    label: str | None = Field(default=None, max_length=80)
    detail: str | None = Field(default=None, max_length=255)
    # OAuth callback payload. Persisted through EncryptedString; never returned.
    credentials: dict[str, Any] | None = None
    config: dict[str, Any] | None = None


class CloudTargetItem(BaseModel):
    provider: str = Field(max_length=40)
    path: str | None = Field(default=None, max_length=512)
    enabled: bool = False


class CloudTargetsUpdate(BaseModel):
    targets: list[CloudTargetItem]


class AccountAuditEntry(BaseModel):
    id: str
    document_id: str | None = None
    document_title: str | None = None
    event_type: str
    event_message: str
    ip_address: str | None = None
    user_agent: str | None = None
    log_metadata: dict[str, Any] | None = None
    created_at: datetime


class AccountAuditFeed(BaseModel):
    items: list[AccountAuditEntry]
    total: int
