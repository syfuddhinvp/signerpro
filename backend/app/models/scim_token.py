from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class ScimToken(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A per-organization SCIM 2.0 bearer credential.

    Mirrors ``ApiKey``: only a SHA-256 hash of the secret is stored, plus a
    display prefix so the UI can render a masked value. The full secret is
    returned exactly once, by the route that creates or rolls it.
    """

    __tablename__ = "scim_tokens"
    __table_args__ = (
        Index("ix_scim_tokens_organization_id", "organization_id"),
        Index("ix_scim_tokens_token_hash", "token_hash", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False, default="SCIM provisioning", server_default="SCIM provisioning")
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def masked(self) -> str:
        return f"{self.prefix}{'•' * 24}"
