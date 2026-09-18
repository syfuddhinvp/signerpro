from datetime import date

from sqlalchemy import Boolean, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class SecurityPosture(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Platform-wide security toggles (FLG-5) — SEC_DEFS in the prototype."""

    __tablename__ = "security_posture"
    __table_args__ = (Index("ix_security_posture_key", "key", unique=True),)

    # sso | scim | ipAllow | residency | keyRotation | dlp
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    label: Mapped[str] = mapped_column(String(160), nullable=False)
    # Text, not String(255): the seeded copy states exactly what each control
    # does and does not enforce, and three of the six defaults are longer than
    # 255 characters. On Postgres the varchar cap made ensure_security_posture
    # fail its insert, so the console rendered "Security posture unavailable".
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    updated_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class IpAllowlistEntry(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A CIDR range permitted to reach the platform admin console.

    Backs the ``ipAllow`` security-posture row. Enforcement lives in
    ``app.api.deps.require_platform_admin``: it is only consulted when the
    posture row is enabled *and* at least one row exists here — an empty
    table must never lock every admin out.
    """

    __tablename__ = "platform_ip_allowlist"
    __table_args__ = (Index("ix_platform_ip_allowlist_cidr", "cidr", unique=True),)

    cidr: Mapped[str] = mapped_column(String(64), nullable=False)
    label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


class Certification(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """An operator-maintained compliance record.

    The platform cannot substantiate an audit, so every field here is a claim
    the operator entered. ``certified`` is only meaningful alongside the
    evidence columns — who issued the attestation, when, until when, and where
    the report lives — which is why the API refuses a bare "certified".
    """

    __tablename__ = "certifications"
    __table_args__ = (Index("ix_certifications_name", "name", unique=True),)

    name: Mapped[str] = mapped_column(String(80), nullable=False)
    # not_assessed | in_process | certified
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_assessed", server_default="not_assessed")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    #: Name of the firm that issued the attestation.
    auditor: Mapped[str | None] = mapped_column(String(160), nullable=True)
    #: When the attestation was issued, and when it lapses. A ``certified`` row
    #: past ``expires_on`` reports as expired rather than as current evidence.
    assessed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    expires_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    #: Where the report itself can be read.
    evidence_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
