from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import now_utc


class MfaChallenge(Base):
    """Single-use record of an issued MFA challenge token (replay defence).

    Wave 1 kept this state in ``users.preferences`` because it could not add a
    migration. That worked but wrote replay state into a user-facing JSON
    column that the database can neither index nor expire. This table is the
    proper home:

    * ``jti`` is the primary key, so consuming a challenge is an atomic
      ``UPDATE ... WHERE consumed_at IS NULL`` rather than a JSON rewrite;
    * ``expires_at`` is indexed, so a sweep can delete expired rows in one
      statement instead of pruning a list on every login.
    """

    __tablename__ = "mfa_challenges"
    __table_args__ = (
        Index("ix_mfa_challenges_user_id", "user_id"),
        # Retention sweep: DELETE FROM mfa_challenges WHERE expires_at < now().
        Index("ix_mfa_challenges_expires_at", "expires_at"),
    )

    #: The ``jti`` claim of the scoped MFA token. Primary key: a token can be
    #: recorded, and therefore consumed, exactly once.
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: Set the moment the challenge is redeemed. NULL means still redeemable.
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
