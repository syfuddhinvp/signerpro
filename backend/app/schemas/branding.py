"""Sender branding themes (ORG-7).

A theme is what a *recipient* sees -- the invitation email and the signing
page -- as opposed to ``OrganizationResponse.accent_color``, which is the
tenant's identity inside the app.
"""

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


HEX_COLOR = r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$"
LOGO_POSITIONS = ("left", "center", "right")
LOGO_POSITION_PATTERN = r"^(?:left|center|right)$"


class BrandingThemeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    is_default: bool = False
    logo_url: str | None = Field(default=None, max_length=1024)
    logo_position: str = Field(default="left", pattern=LOGO_POSITION_PATTERN)
    primary_color: str | None = Field(default=None, pattern=HEX_COLOR)
    primary_text_color: str | None = Field(default=None, pattern=HEX_COLOR)
    headline: str | None = Field(default=None, max_length=255)
    message: str | None = Field(default=None, max_length=4000)
    contact_sender_email: EmailStr | None = None
    footer_signature: str | None = Field(default=None, max_length=2000)


class BrandingThemeUpdate(BaseModel):
    """Every field optional: an omitted key is left alone, so two open tabs
    editing different halves of a theme do not overwrite each other."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    is_default: bool | None = None
    logo_url: str | None = Field(default=None, max_length=1024)
    logo_position: str | None = Field(default=None, pattern=LOGO_POSITION_PATTERN)
    primary_color: str | None = Field(default=None, pattern=HEX_COLOR)
    primary_text_color: str | None = Field(default=None, pattern=HEX_COLOR)
    headline: str | None = Field(default=None, max_length=255)
    message: str | None = Field(default=None, max_length=4000)
    contact_sender_email: EmailStr | None = None
    footer_signature: str | None = Field(default=None, max_length=2000)


class BrandingLogoUpload(BaseModel):
    """A data URL or bare base64 payload, matching the profile-photo upload."""

    image_base64: str = Field(min_length=1)


class BrandingThemeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    name: str
    is_default: bool
    #: Absolute URL a recipient's mail client can fetch: the uploaded logo
    #: when there is one, otherwise whatever the tenant hosts themselves.
    logo_url: str | None
    logo_position: str
    primary_color: str | None
    primary_text_color: str | None
    headline: str | None
    message: str | None
    contact_sender_email: str | None
    footer_signature: str | None
    created_at: datetime
    updated_at: datetime
    #: How many envelopes name this theme. Derived, so the delete confirmation
    #: can say what it is about to unbrand.
    document_count: int = 0
    #: Whether ``logo_url`` points at a logo uploaded here (rather than one the
    #: tenant hosts). Lets the editor offer "Replace"/"Remove" instead of a
    #: text field it cannot fill in.
    logo_uploaded: bool = False
