from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class BrandingTheme(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A named set of sender branding, chosen per envelope (ORG-7).

    The organization's own ``accent_color``/``logo_url`` remain the tenant's
    identity inside the app. A theme is about what a *recipient* sees: the
    invitation email and the signing page. A tenant that sends on behalf of
    several brands needs more than one, which is why this is a table and not
    more columns on ``organizations``.

    Exactly one theme per tenant may carry ``is_default``; it is the one an
    envelope uses when it names none. The service layer enforces that -- a
    partial unique index would say it better, but SQLite (the test database)
    does not support one.
    """

    __tablename__ = "branding_themes"
    __table_args__ = (
        Index("ix_branding_themes_organization_id", "organization_id"),
        Index("uq_branding_themes_org_name", "organization_id", "name", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    #: The theme an envelope falls back to. See the class docstring.
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    # ── Logo ──
    #: An externally hosted logo. Kept for tenants (and API clients) that
    #: already point at their own CDN; the UI uploads instead.
    logo_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    #: Storage key for an uploaded logo. Wins over ``logo_url`` when both are
    #: set, because it is the one the tenant chose most recently through the UI.
    logo_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    #: left | center | right -- where the logo sits in the email header.
    logo_position: Mapped[str] = mapped_column(String(10), nullable=False, default="left", server_default="left")

    # ── Button colours ──
    #: Hex, with the leading '#'. Applies to the email's call-to-action button
    #: and to the signing page's primary actions, so the two match.
    primary_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    primary_text_color: Mapped[str | None] = mapped_column(String(9), nullable=True)

    # ── Email copy ──
    #: Replaces the stock "You were invited to review and sign a document".
    headline: Mapped[str | None] = mapped_column(String(255), nullable=True)
    #: Added to every invitation body. A document's own ``invite_message``
    #: is more specific and is appended after this one.
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Where "Contact sender" replies go, when it is not the sender's own
    #: address -- a shared processing inbox, typically.
    contact_sender_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    footer_signature: Mapped[str | None] = mapped_column(Text, nullable=True)
