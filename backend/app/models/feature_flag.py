from sqlalchemy import Boolean, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class FeatureFlag(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "feature_flags"
    __table_args__ = (Index("ix_feature_flags_key", "key", unique=True),)

    key: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # prod | staging | canary
    environment: Mapped[str] = mapped_column(String(20), nullable=False, default="prod", server_default="prod")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    rollout_pct: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    updated_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class FeatureFlagOverride(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "feature_flag_overrides"
    __table_args__ = (Index("uq_flag_override", "flag_id", "organization_id", unique=True),)

    flag_id: Mapped[str] = mapped_column(ForeignKey("feature_flags.id"), nullable=False)
    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="1")
