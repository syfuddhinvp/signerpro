from datetime import datetime
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Organization(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), nullable=False)

    # Multi-tenant SMTP Configuration
    smtp_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_port: Mapped[int | None] = mapped_column(nullable=True)
    smtp_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    smtp_from_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Multi-tenant SMS Configuration (Twilio / Telnyx)
    sms_provider: Mapped[str | None] = mapped_column(String(50), nullable=True) # "twilio" or "telnyx"
    twilio_account_sid: Mapped[str | None] = mapped_column(String(255), nullable=True)
    twilio_auth_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    twilio_from_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    
    telnyx_api_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    telnyx_from_number: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # SaaS Subscriptions
    subscription_tier: Mapped[str] = mapped_column(String(50), nullable=False, default="free")  # "free", "growth", "enterprise"
    subscription_status: Mapped[str] = mapped_column(String(50), nullable=False, default="active")  # "active", "trialing", "past_due", "canceled", "expired"
    subscription_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)

    users: Mapped[list["User"]] = relationship(back_populates="organization", cascade="all, delete-orphan")
    documents: Mapped[list["Document"]] = relationship(back_populates="organization", cascade="all, delete-orphan")

