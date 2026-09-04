from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


class UserSession(Base, UUIDPrimaryKeyMixin):
    """A refresh-token session (AUTH-1, AUTH-2, AUTH-9). Hash only."""

    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("ix_user_sessions_user_id", "user_id"),
        Index("ix_user_sessions_refresh_hash", "refresh_token_hash", unique=True),
    )

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    refresh_token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    device: Mapped[str | None] = mapped_column(String(120), nullable=True)
    browser: Mapped[str | None] = mapped_column(String(80), nullable=True)
    os: Mapped[str | None] = mapped_column(String(80), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(80), nullable=True)
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: Set only when this row was retired by a *refresh rotation*, never by a
    #: logout or an admin revoke. The distinction is the whole point: a spent
    #: rotated token presented again is either the loser of a concurrent
    #: refresh (benign, and only within a few seconds) or a replayed stolen
    #: token (not benign, ever). A logged-out token is neither.
    rotated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    #: The session this one rotated into, so a refresh chain can be walked and
    #: revoked as a unit when a spent token is replayed.
    replaced_by_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
