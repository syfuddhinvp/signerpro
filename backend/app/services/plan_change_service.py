"""Whether a plan change is allowed, when it lands, and what it costs (BIL-12).

`change_seats` has always refused to cut below the seats actually in use --
removing a seat someone is sitting in locks them out. `change_plan` had no
equivalent, so an organization with forty users and live webhooks could drop
onto a five-seat plan and only discover it when the entitlement service began
returning 402s on work that had been succeeding a minute earlier.

This module answers the question *before* the change, and splits the answer in
two:

* **blockers** -- capacity the organization is already over. Refused (409),
  with the remedy stated in numbers, because there is no coherent state on the
  other side of the change.
* **warnings** -- features that stop working on the effective date. Allowed on
  confirmation: losing custom branding is a choice a tenant is entitled to
  make, losing access to twelve of their own users is not.

It also decides *when*. An upgrade is immediate and paid for now; a downgrade
is scheduled for the period end the tenant has already paid for, unless they
explicitly ask for it now and accept the credit instead.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.api_key import ApiKey
from app.models.branding_theme import BrandingTheme
from app.models.plan import (
    ENTITLEMENT_API_ACCESS,
    ENTITLEMENT_CUSTOM_BRANDING,
    ENTITLEMENT_MAX_STORAGE_BYTES,
    ENTITLEMENT_MAX_USERS,
    ENTITLEMENT_WEBHOOKS,
    Plan,
)
from app.models.webhook import WebhookEndpoint
from app.services.entitlement_service import entitlement_service


class PlanChangeDirection(StrEnum):
    upgrade = "upgrade"
    downgrade = "downgrade"
    #: Same price, different plan -- or the same plan. Applied immediately,
    #: charged nothing.
    lateral = "lateral"
    #: Month <-> year. Priced as its own thing because the period restarts.
    interval_switch = "interval_switch"


class PlanChangeEffective(StrEnum):
    immediately = "immediately"
    period_end = "period_end"


@dataclass
class PlanChangeIssue:
    """One reason a change is refused, or one consequence of allowing it."""

    code: str
    #: The entitlement key this concerns, so a client can link to the right
    #: settings screen rather than parsing the message.
    key: str
    message: str
    #: Present for capacity issues; ``None`` for feature ones.
    current: int | None = None
    limit: int | None = None
    #: What the tenant must do. Stated in numbers where there is a number.
    remedy: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "key": self.key,
            "message": self.message,
            "current": self.current,
            "limit": self.limit,
            "remedy": self.remedy,
        }


@dataclass
class PlanChangeAssessment:
    direction: PlanChangeDirection
    effective_mode: PlanChangeEffective
    effective_at: datetime | None
    blockers: list[PlanChangeIssue] = field(default_factory=list)
    warnings: list[PlanChangeIssue] = field(default_factory=list)

    @property
    def allowed(self) -> bool:
        return not self.blockers

    def as_dict(self) -> dict[str, Any]:
        return {
            "direction": self.direction.value,
            "effective_mode": self.effective_mode.value,
            "effective_at": self.effective_at,
            "blockers": [issue.as_dict() for issue in self.blockers],
            "warnings": [issue.as_dict() for issue in self.warnings],
            "allowed": self.allowed,
        }


def _format_bytes(value: int) -> str:
    step = 1024.0
    amount = float(value)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(amount) < step:
            return f"{amount:.0f} {unit}" if unit == "B" else f"{amount:.1f} {unit}"
        amount /= step
    return f"{amount:.1f} PB"


class PlanChangeAssessor:
    # ------------------------------------------------------------ direction

    def direction(
        self, *, current: Plan, target: Plan, current_amount: int, target_amount: int
    ) -> PlanChangeDirection:
        """Classify by price, then by interval.

        Price rather than a plan ranking, because the catalogue has no rank
        and inventing one would go stale the first time a plan is repriced.
        """
        if current.billing_interval != target.billing_interval:
            return PlanChangeDirection.interval_switch
        if target_amount > current_amount:
            return PlanChangeDirection.upgrade
        if target_amount < current_amount:
            return PlanChangeDirection.downgrade
        return PlanChangeDirection.lateral

    def default_effective_mode(self, direction: PlanChangeDirection) -> PlanChangeEffective:
        """A downgrade waits; everything else lands now.

        The tenant has already paid through ``current_period_end``. Taking the
        capacity away before then is charging for something and not delivering
        it, and refunding the difference is worse for both sides than simply
        letting them use what they bought.
        """
        return (
            PlanChangeEffective.period_end
            if direction == PlanChangeDirection.downgrade
            else PlanChangeEffective.immediately
        )

    # -------------------------------------------------------------- feasibility

    def assess(
        self,
        db: Session,
        *,
        organization_id: str,
        current: Plan,
        target: Plan,
        direction: PlanChangeDirection,
        effective_mode: PlanChangeEffective,
        effective_at: datetime | None,
    ) -> PlanChangeAssessment:
        assessment = PlanChangeAssessment(
            direction=direction,
            effective_mode=effective_mode,
            effective_at=effective_at,
        )
        # Only a reduction in entitlements can be infeasible. An upgrade is
        # checked anyway rather than short-circuited, because a "larger" plan
        # is only larger on the dimensions it is larger on -- a cheaper plan
        # with more storage exists the moment somebody adds one to the
        # catalogue, and a false green light there is the same defect.
        entitlements = target.entitlements or {}
        current_entitlements = current.entitlements or {}

        self._check_users(db, organization_id, entitlements, assessment)
        self._check_storage(db, organization_id, entitlements, assessment)
        self._check_features(db, organization_id, current_entitlements, entitlements, assessment)
        return assessment

    def _check_users(
        self,
        db: Session,
        organization_id: str,
        entitlements: dict,
        assessment: PlanChangeAssessment,
    ) -> None:
        limit = entitlements.get(ENTITLEMENT_MAX_USERS)
        if limit is None:
            return
        from app.models.user import User

        activated = int(
            db.scalar(select(func.count(User.id)).where(User.organization_id == organization_id))
            or 0
        )
        if activated <= limit:
            return
        excess = activated - limit
        assessment.blockers.append(
            PlanChangeIssue(
                code="over_user_limit",
                key=ENTITLEMENT_MAX_USERS,
                current=activated,
                limit=limit,
                message=(
                    f"This plan allows {limit} users and the organization has {activated}."
                ),
                remedy=f"Remove {excess} member{'s' if excess != 1 else ''} first.",
            )
        )

    def _check_storage(
        self,
        db: Session,
        organization_id: str,
        entitlements: dict,
        assessment: PlanChangeAssessment,
    ) -> None:
        limit = entitlements.get(ENTITLEMENT_MAX_STORAGE_BYTES)
        if limit is None:
            return
        context = entitlement_service.resolve(db, organization_id)
        used = entitlement_service.usage_for(db, context, ENTITLEMENT_MAX_STORAGE_BYTES)
        if used <= limit:
            return
        assessment.blockers.append(
            PlanChangeIssue(
                code="over_storage_limit",
                key=ENTITLEMENT_MAX_STORAGE_BYTES,
                current=used,
                limit=limit,
                message=(
                    f"This plan includes {_format_bytes(limit)} of storage and "
                    f"{_format_bytes(used)} is in use."
                ),
                remedy=f"Free up {_format_bytes(used - limit)} first.",
            )
        )

    def _check_features(
        self,
        db: Session,
        organization_id: str,
        current_entitlements: dict,
        entitlements: dict,
        assessment: PlanChangeAssessment,
    ) -> None:
        """Feature loss is a warning, never a blocker.

        The distinction is deliberate and is the one product call encoded
        here: being over a capacity limit has no coherent state on the other
        side of the change, whereas a feature switching off is a consequence a
        tenant is allowed to accept. What is not acceptable is for it to be a
        surprise, so each warning names what stops and counts what is affected.
        """
        checks = (
            (
                ENTITLEMENT_CUSTOM_BRANDING,
                "custom_branding_lost",
                lambda: int(
                    db.scalar(
                        select(func.count(BrandingTheme.id)).where(
                            BrandingTheme.organization_id == organization_id
                        )
                    )
                    or 0
                ),
                "branding theme",
                "Envelopes will use the default branding",
            ),
            (
                ENTITLEMENT_API_ACCESS,
                "api_access_lost",
                lambda: int(
                    db.scalar(
                        select(func.count(ApiKey.id)).where(
                            ApiKey.organization_id == organization_id,
                            ApiKey.revoked_at.is_(None),
                        )
                    )
                    or 0
                ),
                "active API key",
                "API requests will be rejected",
            ),
            (
                ENTITLEMENT_WEBHOOKS,
                "webhooks_lost",
                lambda: int(
                    db.scalar(
                        select(func.count(WebhookEndpoint.id)).where(
                            WebhookEndpoint.organization_id == organization_id,
                            WebhookEndpoint.is_active.is_(True),
                        )
                    )
                    or 0
                ),
                "active webhook endpoint",
                "Deliveries will stop",
            ),
        )

        for key, code, counter, noun, consequence in checks:
            keeps = bool(entitlements.get(key, False))
            had = bool(current_entitlements.get(key, False))
            if keeps or not had:
                continue
            in_use = counter()
            if in_use <= 0:
                # The feature is being lost but nothing depends on it. Not
                # worth a confirmation dialog.
                continue
            plural = "s" if in_use != 1 else ""
            assessment.warnings.append(
                PlanChangeIssue(
                    code=code,
                    key=key,
                    current=in_use,
                    limit=None,
                    message=(
                        f"{in_use} {noun}{plural} will stop working on this plan. "
                        f"{consequence}."
                    ),
                    remedy=None,
                )
            )


plan_change_assessor = PlanChangeAssessor()
