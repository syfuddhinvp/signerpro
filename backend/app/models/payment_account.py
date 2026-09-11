from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class PaymentAccount(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """A tenant's connected Stripe account (PAY-1), one row per organization.

    ``provider_account_id`` holds a Stripe `acct_...` id. That id is an
    identifier, not a secret -- it is meaningless without the platform's own
    API key -- so it is stored as plain ``String`` with no `EncryptedString`,
    unlike the OAuth tokens on `Integration`.

    ``charges_enabled`` is a first-class, queryable column rather than a key
    inside `Integration.config` because sending an envelope with a payment
    field is gated on it: the route needs to filter/read it directly, and
    folding it into an opaque JSON blob would force a full-table JSON scan
    (or app-side desync) every time that gate is checked.
    """

    __tablename__ = "payment_accounts"
    __table_args__ = (Index("uq_payment_accounts_organization_id", "organization_id", unique=True),)

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="stripe", server_default="stripe")
    provider_account_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    charges_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    payouts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    details_submitted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    default_currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    livemode: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    onboarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)
