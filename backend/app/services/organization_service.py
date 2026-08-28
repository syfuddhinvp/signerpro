"""Tenant-facing organization logic (ORG-1, ORG-2).

The overview aggregate is *derived at request time* from documents, users,
subscriptions and invoices. Nothing here is stored: a second copy of a number
is a second thing to be wrong.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.enums import DocumentStatus, RecipientStatus, UserRole
from app.models.invoice import Invoice, InvoiceStatus
from app.models.organization import Organization
from app.models.recipient import Recipient
from app.models.user import User
from app.services import platform_service
from app.schemas.organization import (
    AttentionItem,
    OrganizationOverview,
    OrganizationSettingsUpdate,
    OverviewStats,
    SpendLine,
    TeamActivityRow,
)

#: ``range`` query value -> (days covered, label). Twelve buckets always.
RANGES: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}

#: Statuses that mean "still out with a signer".
_OPEN_STATUSES = (
    DocumentStatus.sent,
    DocumentStatus.viewed,
    DocumentStatus.partially_completed,
)

#: Reuses the platform role labels so the tenant Overview and the platform
#: directory never disagree about what a role is called.
_ROLE_LABELS = {
    UserRole.admin: platform_service.ROLE_LABELS["orgadmin"],
    UserRole.sender: platform_service.ROLE_LABELS["sender"],
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OrganizationService:
    # ------------------------------------------------------------- settings
    def get(self, db: Session, *, organization_id: str) -> Organization:
        org = db.get(Organization, organization_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
        return org

    def update_settings(
        self, db: Session, *, org: Organization, payload: OrganizationSettingsUpdate
    ) -> Organization:
        data = payload.model_dump(exclude_unset=True)
        slug = data.get("slug")
        if slug is not None and slug != org.slug:
            # The column is uniquely indexed; check first so the caller gets a
            # 409 rather than an IntegrityError.
            taken = db.scalar(
                select(func.count())
                .select_from(Organization)
                .where(Organization.slug == slug, Organization.id != org.id)
            )
            if taken:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT, detail="That slug is already taken"
                )
        for field, value in data.items():
            setattr(org, field, value)
        db.add(org)
        db.commit()
        db.refresh(org)
        return org

    # ------------------------------------------------------------- overview
    def overview(self, db: Session, *, user: User, range_key: str = "30d") -> OrganizationOverview:
        if range_key not in RANGES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported range")
        org = self.get(db, organization_id=user.organization_id)
        now = _now()
        days = RANGES[range_key]
        window_start = now - timedelta(days=days)

        live = (Document.organization_id == org.id, Document.deleted_at.is_(None), Document.is_template.is_(False))

        def count(*clauses) -> int:
            return int(db.scalar(select(func.count(Document.id)).where(*live, *clauses)) or 0)

        out_for_signature = count(Document.status.in_(_OPEN_STATUSES))
        # ``prepared`` is still a draft from the sender's point of view: it has
        # fields but has never been sent.
        drafts = count(Document.status.in_((DocumentStatus.draft, DocumentStatus.prepared)))
        expiring = count(
            Document.status.in_(_OPEN_STATUSES),
            Document.expires_at.is_not(None),
            Document.expires_at <= now + timedelta(days=3),
        )
        expired = count(Document.status == DocumentStatus.expired)
        declined = count(Document.status == DocumentStatus.declined)
        completed_in_window = count(
            Document.status == DocumentStatus.completed, Document.created_at >= window_start
        )
        created_in_window = count(Document.created_at >= window_start)

        # "Action required" = documents waiting on somebody in this tenant:
        # drafts the sender never sent, plus envelopes whose current signer is
        # a member of this organization.
        awaiting_us = int(
            db.scalar(
                select(func.count(func.distinct(Document.id)))
                .select_from(Document)
                .join(Recipient, Recipient.document_id == Document.id)
                .join(User, User.email == Recipient.email)
                .where(
                    *live,
                    Document.status.in_(_OPEN_STATUSES),
                    Recipient.status.in_((RecipientStatus.sent, RecipientStatus.viewed)),
                    User.organization_id == org.id,
                )
            )
            or 0
        )

        seats_activated = int(
            db.scalar(
                select(func.count(User.id)).where(
                    User.organization_id == org.id, User.status == "active"
                )
            )
            or 0
        )

        stats = OverviewStats(
            action_required=drafts + awaiting_us,
            out_for_signature=out_for_signature,
            seats_activated=seats_activated,
            seats_licensed=org.seats_licensed or seats_activated,
            completion_rate=(
                round(completed_in_window * 100 / created_in_window, 1) if created_in_window else 0.0
            ),
        )

        attention: list[AttentionItem] = []
        if expiring:
            attention.append(
                AttentionItem(
                    title=f"{expiring} envelope(s) expiring within 3 days",
                    detail="Send a reminder or extend the deadline before the link dies.",
                    screen="documents?quick=expiring",
                    tone="warn",
                )
            )
        if declined:
            attention.append(
                AttentionItem(
                    title=f"{declined} envelope(s) declined",
                    detail="A signer refused to sign; the envelope needs a decision.",
                    screen="documents?status=declined",
                    tone="bad",
                )
            )
        if expired:
            attention.append(
                AttentionItem(
                    title=f"{expired} envelope(s) expired",
                    detail="These were never completed and must be re-sent.",
                    screen="documents?status=expired",
                    tone="warn",
                )
            )
        if stats.seats_licensed and seats_activated >= stats.seats_licensed:
            attention.append(
                AttentionItem(
                    title="Every licensed seat is in use",
                    detail=f"{seats_activated} of {stats.seats_licensed} seats activated.",
                    screen="settings/billing",
                    tone="warn",
                )
            )
        unpaid = int(
            db.scalar(
                select(func.count(Invoice.id)).where(
                    Invoice.organization_id == org.id,
                    Invoice.status.in_((InvoiceStatus.past_due, InvoiceStatus.open)),
                )
            )
            or 0
        )
        if unpaid:
            attention.append(
                AttentionItem(
                    title=f"{unpaid} invoice(s) awaiting payment",
                    detail="Settle them to avoid the subscription lapsing.",
                    screen="settings/billing",
                    tone="warn",
                )
            )

        return OrganizationOverview(
            range=range_key,
            stats=stats,
            series=self._series(db, organization_id=org.id, now=now, days=days),
            attention=attention,
            spend_lines=self._spend_lines(db, organization_id=org.id, since=window_start),
            team=self._team_activity(db, organization_id=org.id, since=window_start),
        )

    def _series(self, db: Session, *, organization_id: str, now: datetime, days: int) -> list[int]:
        """Envelopes created per bucket, twelve buckets covering ``days``."""
        width = max(days / 12, 1 / 24)
        series: list[int] = []
        for index in range(12):
            start = now - timedelta(days=width * (12 - index))
            end = now - timedelta(days=width * (11 - index))
            series.append(
                int(
                    db.scalar(
                        select(func.count(Document.id)).where(
                            Document.organization_id == organization_id,
                            Document.is_template.is_(False),
                            Document.deleted_at.is_(None),
                            Document.created_at >= start,
                            Document.created_at < end,
                        )
                    )
                    or 0
                )
            )
        return series

    def _spend_lines(self, db: Session, *, organization_id: str, since: datetime) -> list[SpendLine]:
        """Invoiced spend in the window, grouped by invoice line description."""
        invoices = list(
            db.scalars(
                select(Invoice).where(
                    Invoice.organization_id == organization_id,
                    Invoice.issued_at >= since,
                    Invoice.status != InvoiceStatus.void,
                )
            ).unique()
        )
        grouped: dict[str, int] = {}
        for invoice in invoices:
            for line in invoice.line_items or []:
                label = str(line.get("description") or "Subscription")
                grouped[label] = grouped.get(label, 0) + int(line.get("amount_cents") or 0)
            if not invoice.line_items:
                grouped["Subscription"] = grouped.get("Subscription", 0) + invoice.total_cents
        return [SpendLine(label=label, amount_cents=amount) for label, amount in sorted(grouped.items())]

    def _team_activity(self, db: Session, *, organization_id: str, since: datetime) -> list[TeamActivityRow]:
        users = list(
            db.scalars(
                select(User).where(User.organization_id == organization_id).order_by(User.created_at)
            ).unique()
        )
        sent_counts = {
            row[0]: row[1]
            for row in db.execute(
                select(Document.sender_id, func.count(Document.id))
                .where(
                    Document.organization_id == organization_id,
                    Document.is_template.is_(False),
                    Document.deleted_at.is_(None),
                    Document.sent_at.is_not(None),
                    Document.sent_at >= since,
                )
                .group_by(Document.sender_id)
            ).all()
        }
        return [
            TeamActivityRow(
                name=member.name,
                role_label=_ROLE_LABELS.get(member.role, str(member.role)),
                last_active_at=member.last_active_at,
                sent_count=int(sent_counts.get(member.id, 0)),
            )
            for member in users
        ]


organization_service = OrganizationService()
