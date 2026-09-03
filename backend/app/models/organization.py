from datetime import datetime

from sqlalchemy import Boolean, DateTime, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto import EncryptedString
from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Organization(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "organizations"
    __table_args__ = (Index("ix_organizations_slug", "slug", unique=True),)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Tenant identity / profile (ORG-1, ORG-4)
    # Nullable so pre-existing rows and the register flow stay valid; the
    # service layer backfills it from the name. Unique when present.
    slug: Mapped[str | None] = mapped_column(String(80), nullable=True)
    region: Mapped[str | None] = mapped_column(String(40), nullable=True)
    company_size: Mapped[str | None] = mapped_column(String(30), nullable=True)
    seats_licensed: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    accent_color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    logo_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Plain String, not a FK: users.organization_id already points here and a
    # real FK both ways is a circular dependency for table creation.
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    suspension_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Billing settings (BIL-6)
    autopay: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    billing_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    tax_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    billing_cycle: Mapped[str] = mapped_column(String(20), nullable=False, default="monthly", server_default="monthly")
    default_payment_method_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    # Embed / API settings (API-9)
    allowed_origins: Mapped[list | None] = mapped_column(JSON, nullable=True)
    default_return_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    live_mode_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")

    # Multi-tenant SMTP Configuration
    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(nullable=True)
    smtp_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(EncryptedString(255), nullable=True)
    smtp_from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Multi-tenant SMS Configuration (Twilio / Telnyx)
    sms_provider: Mapped[str | None] = mapped_column(String(50), nullable=True) # "twilio" or "telnyx"
    twilio_account_sid: Mapped[str | None] = mapped_column(String(255), nullable=True)
    twilio_auth_token: Mapped[str | None] = mapped_column(EncryptedString(255), nullable=True)
    twilio_from_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
    telnyx_api_key: Mapped[str | None] = mapped_column(EncryptedString(255), nullable=True)
    telnyx_from_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # SaaS Subscriptions
    subscription_tier: Mapped[str] = mapped_column(String(50), nullable=False, default="free")  # "free", "growth", "enterprise"
    subscription_status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")  # "active", "trialing", "past_due", "canceled", "expired"
    subscription_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)

    users: Mapped[list["User"]] = relationship(
        back_populates="organization", cascade="all, delete-orphan", passive_deletes=True
    )
    # Signed documents are legally retained records: deleting a tenant must
    # never cascade into them. "save-update, merge" is the non-destructive
    # default, and passive_deletes="all" stops SQLAlchemy from nulling the FK,
    # so deleting an org that still owns documents raises a FK violation
    # instead of silently destroying executed records.
    documents: Mapped[list["Document"]] = relationship(
        back_populates="organization",
        cascade="save-update, merge",
        passive_deletes="all",
    )

