from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto import EncryptedString
from app.core.database import Base
from app.models.enums import UserRole
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class User(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_email", "email", unique=True),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), nullable=False, default=UserRole.sender)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    # MFA (AUTH-3, AUTH-4, AUTH-5)
    mfa_method: Mapped[str | None] = mapped_column(String(20), nullable=True)  # "totp" | "sms"
    mfa_secret: Mapped[str | None] = mapped_column(EncryptedString(255), nullable=True)
    mfa_enrolled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    mfa_recovery_codes: Mapped[list | None] = mapped_column(JSON, nullable=True)  # hashed
    #: Highest TOTP step already redeemed. A code for this step or earlier is a
    #: replay and must be rejected. Wave 1 kept this inside ``preferences``;
    #: a real column is indexable, comparable and not user-facing.
    mfa_last_used_step: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Profile / preferences (AUTH-9, AUTH-10, PREF-1)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    locale: Mapped[str | None] = mapped_column(String(20), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # active | invited | deprovisioned
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")
    preferences: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="users")
    documents: Mapped[list["Document"]] = relationship(
        back_populates="sender", foreign_keys="Document.sender_id"
    )
    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user")
    sent_invitations: Mapped[list["Invitation"]] = relationship(back_populates="invited_by")

