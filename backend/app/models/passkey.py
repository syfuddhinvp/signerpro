from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class Passkey(Base, UUIDPrimaryKeyMixin):
    """A registered WebAuthn credential (AUTH-12).

    Only the *public* key is stored, which is the entire point of the scheme:
    there is no shared secret to leak, so a database disclosure does not let
    anyone authenticate as the user -- unlike a TOTP seed, which does.
    """

    __tablename__ = "passkeys"
    __table_args__ = (
        Index("ix_passkeys_user_id", "user_id"),
        Index("ix_passkeys_credential_id", "credential_id", unique=True),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    #: Base64url of the raw credential id the authenticator returns.
    credential_id: Mapped[str] = mapped_column(String(512), nullable=False)
    public_key: Mapped[str] = mapped_column(String(1024), nullable=False)
    #: The authenticator's signature counter. A counter that fails to advance
    #: is how a cloned authenticator is detected, so it is stored and checked.
    sign_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
