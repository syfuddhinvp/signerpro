from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin

#: Scope catalogue (API-6). Kept next to the model so routes and docs agree.
API_KEY_SCOPES: list[tuple[str, str]] = [
    ("users:read", "Read organization members"),
    ("contacts:read", "Read the address book"),
    ("contacts:write", "Create and update contacts"),
    ("documents:read", "Read documents, fields and recipients"),
    ("documents:write", "Create and update documents, fields and recipients"),
    ("envelopes:send", "Send documents for signature"),
    ("audit:read", "Read audit trails"),
]


class ApiKey(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A tenant API credential.

    Only a SHA-256 hash of the secret is stored, plus a display prefix and the
    last four characters so the UI can render a masked value. The full secret
    is returned exactly once, by the route that creates or rolls the key.
    """

    __tablename__ = "api_keys"
    __table_args__ = (
        Index("ix_api_keys_organization_id", "organization_id"),
        Index("ix_api_keys_key_hash", "key_hash", unique=True),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # live | test
    mode: Mapped[str] = mapped_column(String(10), nullable=False, default="test", server_default="test")
    # e.g. "sk_live_9f2b" — the part the UI shows before the mask
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    last_four: Mapped[str] = mapped_column(String(4), nullable=False, default="", server_default="")
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    scopes: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def masked(self) -> str:
        return f"{self.prefix}{'•' * 20}{self.last_four}"
