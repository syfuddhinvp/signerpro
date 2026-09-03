from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class Contact(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Tenant address book entry (CNT-1…CNT-8).

    ``envelope_count`` is deliberately not stored: it is derived by counting
    recipients with the same email inside the tenant.
    """

    __tablename__ = "contacts"
    __table_args__ = (
        Index("ix_contacts_organization_id", "organization_id"),
        Index("uq_contacts_org_email", "organization_id", "email", unique=True),
        Index("ix_contacts_group", "group_key"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    default_role: Mapped[str] = mapped_column(String(20), nullable=False, default="sign", server_default="sign")
    group_key: Mapped[str] = mapped_column(String(40), nullable=False, default="customers", server_default="customers")
    # crm | scim | api | manual
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual", server_default="manual")
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)
    color: Mapped[str | None] = mapped_column(String(9), nullable=True)
    last_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class ContactGroup(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "contact_groups"
    __table_args__ = (Index("uq_contact_groups_org_key", "organization_id", "key", unique=True),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(80), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
