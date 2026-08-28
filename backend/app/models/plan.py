from enum import StrEnum

from sqlalchemy import Boolean, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class BillingInterval(StrEnum):
    month = "month"
    year = "year"


# Entitlement keys. Numeric limits use ``None`` (JSON null) to mean "unlimited".
ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH = "max_documents_per_month"
ENTITLEMENT_MAX_USERS = "max_users"
ENTITLEMENT_MAX_STORAGE_BYTES = "max_storage_bytes"
ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT = "max_recipients_per_document"
ENTITLEMENT_CUSTOM_BRANDING = "custom_branding"
ENTITLEMENT_API_ACCESS = "api_access"
ENTITLEMENT_WEBHOOKS = "webhooks"

# The catalogue mirrors the product design: three per-seat plans.
# Prices are per seat per month, in integer cents.
DEFAULT_PLANS: list[dict] = [
    {
        "code": "team",
        "name": "Team",
        "description": "Self-serve e-signature for small teams.",
        "price_cents": 1200,
        "seat_price_cents": 1200,
        "is_seat_based": True,
        "tag": "Self-serve",
        "billing_interval": BillingInterval.month,
        "trial_days": 14,
        "sort_order": 0,
        "marketing_lines": [
            {"label": "Envelopes / seat", "value": "25 / mo"},
            {"label": "Templates", "value": "10"},
            {"label": "Routing", "value": "Sequential"},
            {"label": "Retention", "value": "1 year"},
        ],
        "entitlements": {
            ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH: 5,
            ENTITLEMENT_MAX_USERS: 2,
            ENTITLEMENT_MAX_STORAGE_BYTES: 100 * 1024 * 1024,
            ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT: 3,
            ENTITLEMENT_CUSTOM_BRANDING: False,
            ENTITLEMENT_API_ACCESS: False,
            ENTITLEMENT_WEBHOOKS: False,
        },
    },
    {
        "code": "business",
        "name": "Business",
        "description": "For teams sending contracts every week.",
        "price_cents": 2800,
        "seat_price_cents": 2800,
        "is_seat_based": True,
        "tag": "Most adopted",
        "billing_interval": BillingInterval.month,
        "trial_days": 14,
        "sort_order": 1,
        "marketing_lines": [
            {"label": "Envelopes / seat", "value": "Unlimited"},
            {"label": "Templates", "value": "Unlimited"},
            {"label": "Routing", "value": "Seq + parallel"},
            {"label": "Retention", "value": "3 years"},
        ],
        "entitlements": {
            ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH: 250,
            ENTITLEMENT_MAX_USERS: 10,
            ENTITLEMENT_MAX_STORAGE_BYTES: 25 * 1024 * 1024 * 1024,
            ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT: 10,
            ENTITLEMENT_CUSTOM_BRANDING: True,
            ENTITLEMENT_API_ACCESS: True,
            ENTITLEMENT_WEBHOOKS: True,
        },
    },
    {
        "code": "enterprise",
        "name": "Enterprise",
        "description": "Unlimited volume with SSO, SCIM and data residency.",
        "price_cents": 4400,
        "seat_price_cents": 4400,
        "is_seat_based": True,
        "tag": "SSO · SCIM · residency",
        "billing_interval": BillingInterval.month,
        "trial_days": 0,
        "sort_order": 2,
        "marketing_lines": [
            {"label": "Envelopes / seat", "value": "Unlimited"},
            {"label": "API rate", "value": "500 rps"},
            {"label": "Routing", "value": "All + approvals"},
            {"label": "Retention", "value": "7 years + legal hold"},
        ],
        "entitlements": {
            ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH: None,
            ENTITLEMENT_MAX_USERS: None,
            ENTITLEMENT_MAX_STORAGE_BYTES: None,
            ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT: None,
            ENTITLEMENT_CUSTOM_BRANDING: True,
            ENTITLEMENT_API_ACCESS: True,
            ENTITLEMENT_WEBHOOKS: True,
        },
    },
]

#: The plan an organization lands on with no subscription row.
DEFAULT_PLAN_CODE = "team"
#: Backwards-compatible alias for the entry-level plan code.
FREE_PLAN_CODE = DEFAULT_PLAN_CODE
# Used when an organization has no subscription row and no plan rows exist yet.
FALLBACK_ENTITLEMENTS: dict = DEFAULT_PLANS[0]["entitlements"]


class Plan(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "plans"

    code: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    billing_interval: Mapped[str] = mapped_column(String(20), nullable=False, default=BillingInterval.month)
    trial_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    external_price_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    entitlements: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    # Marketing presentation (BIL-1)
    tag: Mapped[str | None] = mapped_column(String(60), nullable=True)
    marketing_lines: Mapped[list | None] = mapped_column(JSON, nullable=True)
    seat_price_cents: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_seat_based: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
