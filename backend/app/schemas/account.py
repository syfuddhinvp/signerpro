"""Account-level preference schemas (SIGN-3, PREF-1…PREF-4, ACT-4)."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class AvatarUpdate(BaseModel):
    """A profile photo, as a data URL or bare base64 (PNG or JPEG)."""

    image_base64: str = Field(min_length=1)


class SavedSignatureCreate(BaseModel):
    label: str | None = Field(default=None, max_length=120)
    signature_type: str = Field(default="drawn", pattern="^(drawn|typed|uploaded)$")
    signature_text: str | None = Field(default=None, max_length=255)
    type_face: str | None = Field(default=None, max_length=60)
    signature_image_base64: str | None = None
    is_passkey_bound: bool = False
    # Adopt this as the default in the same request that creates it.
    is_default: bool = False


class SavedSignatureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    label: str
    signature_type: str
    signature_text: str | None = None
    type_face: str | None = None
    is_passkey_bound: bool = False
    is_default: bool = False
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


class FieldFavoritesResponse(BaseModel):
    """The field types this user pinned to the builder palette's Favourites tab."""

    types: list[str] = []


class FieldFavoritesUpdate(BaseModel):
    # The whole set, not a delta: the palette knows its own state, and a
    # replace is idempotent when a star is double-clicked or two tabs disagree.
    types: list[str] = Field(default_factory=list, max_length=40)


class IntegrationResponse(BaseModel):
    """A connector as the account screen sees it.

    Deliberately carries no credential of any kind: the OAuth tokens behind a
    connected integration are encrypted at rest and never serialised.
    ``account_email`` is the only thing about the remote account that leaves
    the backend, and it exists so a user can tell *which* Drive they attached.
    """

    provider: str
    label: str
    detail: str | None = None
    connected: bool = False
    connected_at: datetime | None = None
    #: The deployment has a client id/secret for this provider. Without it the
    #: connect button has nothing to talk to, so the UI disables it.
    configured: bool = False
    account_email: str | None = None
    #: Tokens exist but the grant is dead; the tenant has to consent again.
    needs_reauth: bool = False
    last_error: str | None = None


class AuthorizeResponse(BaseModel):
    """Where to send the browser, plus the signed state it must come back with."""

    authorization_url: str
    state: str


class OAuthCallbackRequest(BaseModel):
    code: str = Field(min_length=1, max_length=2048)
    state: str = Field(min_length=1, max_length=4096)


class CloudExportItem(BaseModel):
    id: str
    provider: str
    document_id: str
    document_title: str | None = None
    #: "pending" | "succeeded" | "failed"
    status: str
    attempts: int = 0
    remote_path: str | None = None
    remote_file_id: str | None = None
    last_error: str | None = None
    created_at: datetime
    completed_at: datetime | None = None


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
    #: Who performed the event: the acting user's email, else the recipient's,
    #: else ``None`` for system-generated entries. Resolved by joining the
    #: users/recipients tables -- the feed spans documents this user sent, so
    #: the actor is frequently *not* the requesting user.
    actor: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None
    log_metadata: dict[str, Any] | None = None
    created_at: datetime


class AccountAuditFeed(BaseModel):
    items: list[AccountAuditEntry]
    #: Entries matching the active filters -- the count the pager divides.
    total: int
    #: Every distinct event type and actor across the *unfiltered* feed, so the
    #: filter dropdowns offer the whole trail rather than only the page in hand.
    event_types: list[str] = []
    actors: list[str] = []
