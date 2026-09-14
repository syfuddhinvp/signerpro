"""Schemas for the platform-administration surface.

Covers tenant management (ORG-4…ORG-7, ORG-9, ORG-10), the cross-tenant
directory, feature flags / security posture (FLG-1…FLG-6) and the log and
audit streams (ACT-1…ACT-3).
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


# --- Tenants ---------------------------------------------------------------


class TenantRow(BaseModel):
    """One row of the platform tenant table."""

    id: str
    name: str
    slug: str | None = None
    region: str | None = None
    company_size: str | None = None
    owner_email: str | None = None
    owner_name: str | None = None
    plan_code: str | None = None
    plan_name: str
    subscription_tier: str
    subscription_status: str
    # ``suspended`` when the tenant is suspended, else the subscription status.
    status: str
    suspended_at: datetime | None = None
    suspension_reason: str | None = None
    seats_licensed: int = 0
    seats_activated: int = 0
    envelope_volume_30d: int = 0
    documents_count: int = 0
    users_count: int = 0
    mrr_cents: int = 0
    subscription_expires_at: datetime | None = None
    created_at: datetime


class TenantPage(BaseModel):
    items: list[TenantRow]
    total: int


class TenantDetail(TenantRow):
    accent_color: str | None = None
    logo_url: str | None = None
    billing_email: str | None = None
    billing_cycle: str | None = None
    live_mode_enabled: bool = True
    open_ticket_count: int = 0
    incidents_90d: int = 0
    flag_overrides: list["TenantFlagOverride"] = []
    admins: list["DirectoryUser"] = []


class TenantCreate(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    slug: str | None = Field(default=None, max_length=80)
    region: str | None = Field(default=None, max_length=40)
    company_size: str | None = Field(default=None, max_length=30)
    seats_licensed: int = Field(default=0, ge=0, le=100000)
    plan_code: str | None = Field(default=None, max_length=50)
    owner_email: EmailStr
    owner_name: str = Field(min_length=1, max_length=255)


class TenantSuspend(BaseModel):
    reason: str = Field(min_length=3, max_length=255)


class TenantFlagOverride(BaseModel):
    flag_id: str
    key: str
    enabled: bool


class TenantFlagOverrideUpdate(BaseModel):
    """Force a flag on/off for one tenant. ``enabled=None`` clears it."""

    key: str = Field(max_length=120)
    enabled: bool | None = None


class ImpersonationStart(BaseModel):
    justification: str = Field(min_length=5, max_length=255)
    ttl_seconds: int = Field(default=900, ge=60, le=3600)
    scopes: list[str] | None = None


class ImpersonationSessionResponse(BaseModel):
    id: str
    access_token: str
    token_type: str = "bearer"
    organization_id: str
    organization_name: str
    impersonated_user_id: str
    impersonated_user_email: str
    impersonated_user_name: str
    impersonated_user_role: str
    justification: str
    scopes: list[str] = []
    expires_at: datetime
    ended_at: datetime | None = None


class ImpersonationEnded(BaseModel):
    ended_sessions: int


# --- Directory & roles -----------------------------------------------------


class DirectoryUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: EmailStr
    role: str
    # "super" for platform admins, else the tenant role.
    role_key: str
    role_label: str
    is_platform_admin: bool
    organization_id: str
    organization_name: str
    organization_slug: str | None = None
    status: str
    mfa_enabled: bool
    mfa_method: str | None = None
    last_active_at: datetime | None = None
    created_at: datetime


class DirectoryPage(BaseModel):
    items: list[DirectoryUser]
    total: int


class DirectoryRoleUpdate(BaseModel):
    # "super" promotes to platform admin; "admin"/"sender" are tenant roles.
    role: str = Field(max_length=20)


class PermissionRow(BaseModel):
    label: str
    allowed: list[bool]


class PermissionMatrix(BaseModel):
    columns: list[str]
    column_labels: list[str]
    permissions: list[PermissionRow]


# --- Platform overview -----------------------------------------------------


class PlatformHealthRow(BaseModel):
    component: str
    detail: str
    tone: str


class PlatformTenantCounts(BaseModel):
    total: int
    trial: int
    suspended: int
    active: int


class PlatformSeatCounts(BaseModel):
    provisioned: int
    activated: int


class PlatformOverview(BaseModel):
    tenants: PlatformTenantCounts
    seats: PlatformSeatCounts
    envelopes_30d: int
    mrr_cents: int
    incidents_90d: int
    #: ``None`` until a real availability signal exists. Nothing in this
    #: system measures uptime, so a number here would be fabricated.
    uptime_pct: float | None = None
    #: The real, derived figure that used to be laundered into ``uptime_pct``.
    errors_24h: int = 0
    mrr_series: list[int]
    health: list[PlatformHealthRow]


# --- Feature flags ---------------------------------------------------------


class FeatureFlagResponse(BaseModel):
    id: str
    key: str
    description: str | None = None
    environment: str
    enabled: bool
    rollout_pct: int
    updated_at: datetime
    updated_by: str | None = None
    override_count: int = 0


class FeatureFlagUpdate(BaseModel):
    enabled: bool | None = None
    rollout_pct: int | None = Field(default=None, ge=0, le=100)
    environment: str | None = Field(default=None, max_length=20)
    description: str | None = Field(default=None, max_length=500)


class FlagOverridesResponse(BaseModel):
    key: str
    organization_ids: list[str]


class FlagOverridesUpdate(BaseModel):
    organization_ids: list[str] = []


class SecurityPostureRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    key: str
    label: str
    detail: str | None = None
    enabled: bool
    #: False when nothing in the codebase enforces this control. The console
    #: previously rendered every row as a live switch; enabling "IP allowlist
    #: for admin console" changed a boolean and nothing else.
    implemented: bool = False
    #: ``enabled`` is only meaningful when the control exists.
    enforced: bool = False


class SecurityPostureUpdate(BaseModel):
    """Only the keys present are changed."""

    sso: bool | None = None
    scim: bool | None = None
    ipAllow: bool | None = None
    residency: bool | None = None
    keyRotation: bool | None = None
    dlp: bool | None = None


class IpAllowlistEntryRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    cidr: str
    label: str | None = None
    created_at: datetime


class IpAllowlistEntryCreate(BaseModel):
    cidr: str
    label: str | None = None


class CertificationRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    status: str


class ComplianceResponse(BaseModel):
    certifications: list[CertificationRow]
    #: ``None`` unless a rotation actually happened. There is no rotation job,
    #: so this used to be derived from an interval and presented as a fact.
    last_key_rotation_at: datetime | None = None
    rotation_interval_days: int
    #: False while no key-rotation job exists.
    key_rotation_implemented: bool = False
    #: Explains, in the payload itself, what the certification statuses mean.
    disclaimer: str = (
        "Certification statuses are operator-maintained records, not assertions "
        "made by this system. Nothing here is evidence of an audit."
    )


# --- Logs & audit ----------------------------------------------------------


class SystemLogRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    occurred_at: datetime
    level: str
    source: str
    message: str
    status_code: int | None = None
    latency_ms: int | None = None
    request_id: str | None = None
    actor_email: str | None = None
    ip_address: str | None = None
    organization_id: str | None = None
    organization_slug: str | None = None
    organization_name: str | None = None
    payload: dict | list | None = None


class SystemLogPage(BaseModel):
    items: list[SystemLogRow]
    total: int
    sources: list[str]
    levels: list[str]


class PlatformAuditRow(BaseModel):
    id: str
    action: str
    actor_email: str | None = None
    detail: str | None = None
    ip_address: str | None = None
    organization_id: str | None = None
    organization_name: str | None = None
    metadata: dict | None = None
    occurred_at: datetime


class PlatformAuditPage(BaseModel):
    items: list[PlatformAuditRow]
    total: int


TenantDetail.model_rebuild()
