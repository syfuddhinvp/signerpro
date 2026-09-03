from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin, now_utc


class SubscriptionStatus(StrEnum):
    trialing = "trialing"
    active = "active"
    past_due = "past_due"
    canceled = "canceled"
    expired = "expired"


#: Statuses that still permit billable/outbound actions (sending, creating).
ACTIVE_SUBSCRIPTION_STATUSES = frozenset(
    {SubscriptionStatus.trialing, SubscriptionStatus.active, SubscriptionStatus.past_due}
)


class Subscription(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "subscriptions"
    __table_args__ = (
        Index("ix_subscriptions_organization_id", "organization_id"),
        Index("ix_subscriptions_plan_id", "plan_id"),
    )

    organization_id: Mapped[str] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[str] = mapped_column(ForeignKey("plans.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=SubscriptionStatus.active)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Payment provider seam (see app/services/billing_service.py). All nullable:
    # the NullPaymentProvider used in development never populates them.
    provider: Mapped[str | None] = mapped_column(String(50), nullable=True)
    provider_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)

    plan: Mapped["Plan"] = relationship("Plan", lazy="joined")


class ProcessedWebhookEvent(Base, UUIDPrimaryKeyMixin):
    """Idempotency ledger for inbound payment-provider webhooks."""

    __tablename__ = "billing_webhook_events"
    __table_args__ = (
        Index("uq_billing_webhook_events_provider_event", "provider", "event_id", unique=True),
    )

    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # REV-5: surfaced by GET /api/saas/billing-events
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
