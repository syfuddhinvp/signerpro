"""Tenant-facing organization schemas (ORG-1, ORG-2).

Secrets are write-only: SMTP/Twilio/Telnyx credentials can be *set* through
``OrganizationSettingsUpdate`` but are never echoed back by
``OrganizationResponse`` -- only the non-sensitive identifiers are.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


SLUG_PATTERN = r"^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$"


class OrganizationSettingsUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)

    # Tenant identity / profile (ORG-1). Self-service: an org admin owns these,
    # the platform admin surface is not required to change them.
    slug: str | None = Field(
        default=None,
        pattern=SLUG_PATTERN,
        description="Lowercase URL identifier, unique across tenants.",
    )
    region: str | None = Field(default=None, max_length=40)
    company_size: str | None = Field(default=None, max_length=30)
    seats_licensed: int | None = Field(default=None, ge=0, le=100_000)
    accent_color: str | None = Field(
        default=None,
        pattern=r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$",
        description="Brand accent as a hex colour, e.g. #1d4ed8.",
    )
    logo_url: str | None = Field(default=None, max_length=1024)

    # Builder field palette (ORG-6). The whole set, not a delta: the settings
    # form knows its own state, so a replace is idempotent when two tabs
    # disagree. An explicit ``null`` restores the full palette; omitting the
    # key leaves the current choice alone.
    enabled_field_types: list[str] | None = Field(
        default=None,
        max_length=60,
        description=(
            "Field types the builder palette offers. Omit to leave unchanged, "
            "null to offer every type."
        ),
    )

    # SMTP
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = Field(default=None)
    smtp_username: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(default=None, max_length=255)
    smtp_from_email: str | None = Field(default=None, max_length=255)

    # SMS
    sms_provider: str | None = Field(default=None, max_length=50)  # "twilio" or "telnyx"
    twilio_account_sid: str | None = Field(default=None, max_length=255)
    twilio_auth_token: str | None = Field(default=None, max_length=255)
    twilio_from_number: str | None = Field(default=None, max_length=50)

    telnyx_api_key: str | None = Field(default=None, max_length=255)
    telnyx_from_number: str | None = Field(default=None, max_length=50)


class OrganizationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str

    # Tenant identity / profile (ORG-1)
    slug: str | None = None
    region: str | None = None
    company_size: str | None = None
    seats_licensed: int = 0
    accent_color: str | None = None
    logo_url: str | None = None

    # Builder field palette (ORG-6). ``None`` means every type is offered.
    enabled_field_types: list[str] | None = None

    # Non-sensitive SMTP details
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_from_email: str | None = None

    # Non-sensitive SMS details
    sms_provider: str | None = None
    twilio_account_sid: str | None = None
    twilio_from_number: str | None = None
    telnyx_from_number: str | None = None


# --- Tenant overview (ORG-2) ----------------------------------------------


class OverviewStats(BaseModel):
    action_required: int
    out_for_signature: int
    seats_activated: int
    seats_licensed: int
    completion_rate: float


class AttentionItem(BaseModel):
    title: str
    detail: str
    #: Front-end route the card links to.
    screen: str
    tone: str


class SpendLine(BaseModel):
    label: str
    amount_cents: int


class TeamActivityRow(BaseModel):
    name: str
    role_label: str
    last_active_at: datetime | None = None
    sent_count: int


class OrganizationOverview(BaseModel):
    """The tenant dashboard aggregate behind the Overview screen.

    Every figure is derived from rows at request time -- there is no stored
    copy to drift. ``series`` is always twelve buckets so the sparkline never
    has to reshape: the bucket width follows ``range``.
    """

    range: str
    stats: OverviewStats
    series: list[int]
    attention: list[AttentionItem]
    spend_lines: list[SpendLine]
    team: list[TeamActivityRow]
