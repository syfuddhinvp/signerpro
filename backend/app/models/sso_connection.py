from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import EncryptedString
from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class SsoConnection(Base, UUIDPrimaryKeyMixin):
    """A tenant's SAML identity provider (AUTH-13).

    ``allowed_email_domains`` is the security boundary, not a convenience. A
    SAML assertion is just XML the IdP signed; nothing in the protocol stops
    Acme's IdP asserting ``admin@rival.example``. Without a domain binding,
    every tenant that configures SSO could log in as any user of any other
    tenant. Sign-in is therefore refused unless the asserted address is inside
    one of these domains *and* resolves within this organization.
    """

    __tablename__ = "sso_connections"
    __table_args__ = (
        Index("ix_sso_connections_organization_id", "organization_id", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    idp_entity_id: Mapped[str] = mapped_column(String(512), nullable=False)
    idp_sso_url: Mapped[str] = mapped_column(String(1024), nullable=False)
    #: The IdP's signing certificate. Encrypted at rest like every other
    #: tenant-supplied credential.
    idp_x509_cert: Mapped[str] = mapped_column(EncryptedString(8192), nullable=False)
    #: Comma-separated. See the class docstring -- this is load-bearing.
    allowed_email_domains: Mapped[str] = mapped_column(String(1024), nullable=False, default="")
    #: When true, password login is refused for this organization's members.
    enforced: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    #: Auto-create a user on first successful sign-in, within the domains above.
    auto_provision: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_utc, onupdate=now_utc, nullable=False
    )
