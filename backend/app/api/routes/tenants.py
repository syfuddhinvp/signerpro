"""Platform tenant management, directory and roles (ORG-4…ORG-7, ORG-9, ORG-10).

Every endpoint here is platform-only: a tenant administrator, however senior
inside their own organization, gets 403 from ``require_platform_admin``.
"""

from __future__ import annotations

import re
from datetime import timedelta
from secrets import token_urlsafe

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.api.deps import request_ip, require_platform_admin
from app.core.database import get_db
from app.core.security import hash_password
from app.models.api_key import ApiKey
from app.models.charge import Charge
from app.models.contact import Contact
from app.models.document import Document
from app.models.enums import SignerPaymentStatus, UserRole, WalletEntryKind
from app.models.folder import Folder
from app.models.invoice import Invoice, InvoiceStatus
from app.models.payment_account import PaymentAccount
from app.models.platform_audit import PlatformAuditEntry
from app.models.signer_payment import SignerPayment
from app.models.team import Team
from app.models.webhook import WebhookEndpoint
from app.models.feature_flag import FeatureFlag, FeatureFlagOverride
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.plan import Plan
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.support import SupportTicket, TicketStatus
from app.models.system_log import SystemLog
from app.models.user import User
from app.schemas.platform import (
    DirectoryPage,
    DirectoryRoleUpdate,
    DirectoryUser,
    ImpersonationEnded,
    ImpersonationSessionResponse,
    ImpersonationStart,
    PermissionMatrix,
    PermissionRow,
    PlatformHealthRow,
    PlatformAuditRow,
    PlatformOverview,
    PlatformSeatCounts,
    PlatformTenantCounts,
    TenantApiKeyRow,
    TenantChargeRow,
    TenantCounts,
    TenantCreate,
    TenantDetail,
    TenantDocumentRow,
    TenantFlagOverride,
    TenantFlagOverrideUpdate,
    TenantInvoiceRow,
    TenantPage,
    TenantPaymentAccountInfo,
    TenantProfile,
    TenantRow,
    TenantSignerPaymentRow,
    TenantSignerPaymentTotals,
    TenantSubscriptionInfo,
    TenantSuspend,
    TenantWebhookRow,
)
from app.schemas.billing import WalletCreditRequest, WalletEntryResponse, WalletResponse
from app.services import platform_service
from app.services.wallet_service import wallet_service

router = APIRouter(prefix="/api/saas", tags=["tenants"])


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:80] or "tenant"


def _unique_slug(db: Session, value: str) -> str:
    base = _slugify(value)
    slug = base
    suffix = 2
    while db.scalar(select(func.count()).select_from(Organization).where(Organization.slug == slug)):
        slug = f"{base[:74]}-{suffix}"
        suffix += 1
    return slug


def _tenant_query(q: str | None, status_filter: str | None, plan: str | None):
    query = select(Organization)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(
            or_(func.lower(Organization.name).like(term), func.lower(Organization.slug).like(term))
        )
    if status_filter and status_filter != "all":
        if status_filter == "suspended":
            query = query.where(Organization.suspended_at.is_not(None))
        else:
            query = query.where(
                Organization.suspended_at.is_(None),
                Organization.subscription_status == status_filter,
            )
    if plan and plan != "all":
        query = query.where(Organization.subscription_tier == plan)
    return query


def _directory_user(user: User, org: Organization | None) -> DirectoryUser:
    role_key = "super" if user.is_platform_admin else ("orgadmin" if user.role == UserRole.admin else "sender")
    return DirectoryUser(
        id=user.id,
        name=user.name,
        email=user.email,
        role=str(user.role),
        role_key=role_key,
        role_label=platform_service.ROLE_LABELS[role_key],
        is_platform_admin=user.is_platform_admin,
        organization_id=user.organization_id,
        organization_name=org.name if org else "Unknown organization",
        organization_slug=org.slug if org else None,
        status=user.status,
        mfa_enabled=user.mfa_enrolled_at is not None,
        mfa_method=user.mfa_method,
        last_active_at=user.last_active_at,
        created_at=user.created_at,
    )


# --- Tenants ---------------------------------------------------------------


@router.get("/tenants", response_model=TenantPage)
def list_tenants(
    q: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    plan: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantPage:
    """Paged tenant table with seat usage, plan, status and MRR."""
    query = _tenant_query(q, status_filter, plan)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    orgs = list(db.scalars(query.order_by(Organization.created_at.desc()).limit(limit).offset(offset)))
    return TenantPage(
        items=[TenantRow(**row) for row in platform_service.build_tenant_rows(db, orgs)], total=total
    )


@router.post("/tenants", response_model=TenantDetail, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    """Provision a tenant and its owner. The owner lands in ``invited`` status."""
    if db.scalar(select(User).where(func.lower(User.email) == payload.owner_email.lower())):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Owner email already in use")

    org = Organization(
        name=payload.name,
        slug=_unique_slug(db, payload.slug or payload.name),
        region=payload.region,
        company_size=payload.company_size,
        seats_licensed=payload.seats_licensed,
    )
    db.add(org)
    db.flush()

    owner = User(
        organization_id=org.id,
        name=payload.owner_name,
        email=str(payload.owner_email),
        password_hash=hash_password(token_urlsafe(24)),
        role=UserRole.admin,
        status="invited",
    )
    db.add(owner)
    db.flush()
    org.owner_user_id = owner.id

    if payload.plan_code:
        plan = db.scalar(select(Plan).where(Plan.code == payload.plan_code))
        if not plan:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown plan code")
        db.add(
            Subscription(
                organization_id=org.id, plan_id=plan.id, status=SubscriptionStatus.trialing
            )
        )
        org.subscription_tier = plan.code
        org.subscription_status = SubscriptionStatus.trialing

    platform_service.record_platform_audit(
        db,
        action="tenant.created",
        actor=admin,
        organization_id=org.id,
        detail=f"Created tenant {org.name} ({org.slug})",
        ip_address=request_ip(request),
        metadata={"owner_email": str(payload.owner_email), "plan_code": payload.plan_code},
    )
    db.commit()
    db.refresh(org)
    return _detail(db, org)


def _detail(db: Session, org: Organization) -> TenantDetail:
    base = platform_service.build_tenant_rows(db, [org])[0]
    overrides = db.execute(
        select(FeatureFlagOverride, FeatureFlag)
        .join(FeatureFlag, FeatureFlag.id == FeatureFlagOverride.flag_id)
        .where(FeatureFlagOverride.organization_id == org.id)
    ).all()
    open_tickets = db.scalar(
        select(func.count())
        .select_from(SupportTicket)
        .where(
            SupportTicket.organization_id == org.id,
            SupportTicket.status != TicketStatus.resolved,
        )
    ) or 0
    incidents = db.scalar(
        select(func.count())
        .select_from(SystemLog)
        .where(
            SystemLog.organization_id == org.id,
            SystemLog.level == "error",
            SystemLog.occurred_at >= now_utc() - timedelta(days=90),
        )
    ) or 0
    admins = db.scalars(
        select(User)
        .where(User.organization_id == org.id, User.role == UserRole.admin)
        .order_by(User.created_at)
    ).all()
    return TenantDetail(
        **base,
        accent_color=org.accent_color,
        logo_url=org.logo_url,
        billing_email=org.billing_email,
        billing_cycle=org.billing_cycle,
        live_mode_enabled=org.live_mode_enabled,
        open_ticket_count=open_tickets,
        incidents_90d=incidents,
        flag_overrides=[
            TenantFlagOverride(flag_id=flag.id, key=flag.key, enabled=override.enabled)
            for override, flag in overrides
        ],
        admins=[_directory_user(user, org) for user in admins],
    )


def _get_org(db: Session, org_id: str) -> Organization:
    org = db.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return org


@router.get("/tenants/{org_id}", response_model=TenantDetail)
def get_tenant(
    org_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    return _detail(db, _get_org(db, org_id))


#: How many rows of each list the profile carries. The page is a record of a
#: tenant, not an export of it: every list below links on to the screen that
#: owns the full history, so a cap here costs nothing and an uncapped list on a
#: tenant with 200k envelopes would cost everything.
PROFILE_LIMIT = 25
USER_LIMIT = 200


def _profile(db: Session, org: Organization) -> TenantProfile:
    """Everything the platform knows about one tenant, in one response."""
    detail = _detail(db, org)

    users = list(
        db.scalars(
            select(User)
            .where(User.organization_id == org.id)
            .order_by(User.created_at.desc())
            .limit(USER_LIMIT)
        )
    )
    active_users = db.scalar(
        select(func.count())
        .select_from(User)
        .where(User.organization_id == org.id, User.status == "active")
    ) or 0

    # Documents: the status histogram is computed in the database, so it counts
    # every envelope rather than only the page of recent ones shown below.
    status_rows = db.execute(
        select(Document.status, func.count())
        .where(Document.organization_id == org.id, Document.deleted_at.is_(None))
        .group_by(Document.status)
    ).all()
    documents_by_status = {str(status): count for status, count in status_rows}
    templates = db.scalar(
        select(func.count())
        .select_from(Document)
        .where(
            Document.organization_id == org.id,
            Document.deleted_at.is_(None),
            Document.is_template.is_(True),
        )
    ) or 0

    sender = aliased(User)
    recent_documents = db.execute(
        select(Document, sender.email)
        .join(sender, sender.id == Document.sender_id, isouter=True)
        .where(Document.organization_id == org.id, Document.deleted_at.is_(None))
        .order_by(Document.created_at.desc())
        .limit(PROFILE_LIMIT)
    ).all()

    creator = aliased(User)
    api_keys = db.execute(
        select(ApiKey, creator.email)
        .join(creator, creator.id == ApiKey.created_by_user_id, isouter=True)
        .where(ApiKey.organization_id == org.id)
        .order_by(ApiKey.created_at.desc())
        .limit(PROFILE_LIMIT)
    ).all()
    active_api_keys = db.scalar(
        select(func.count())
        .select_from(ApiKey)
        .where(ApiKey.organization_id == org.id, ApiKey.revoked_at.is_(None))
    ) or 0

    invoices = list(
        db.scalars(
            select(Invoice)
            .where(Invoice.organization_id == org.id)
            .order_by(Invoice.issued_at.desc())
            .limit(PROFILE_LIMIT)
        )
    )
    # Totals span every invoice, not just the page above, and exclude the ones
    # that were never owed: a voided or uncollectible invoice is not revenue.
    billable = (
        select(Invoice)
        .where(
            Invoice.organization_id == org.id,
            Invoice.status.notin_([InvoiceStatus.void, InvoiceStatus.draft]),
        )
        .subquery()
    )
    invoiced_cents = db.scalar(select(func.coalesce(func.sum(billable.c.total_cents), 0))) or 0
    invoice_paid_cents = (
        db.scalar(select(func.coalesce(func.sum(billable.c.amount_paid_cents), 0))) or 0
    )
    invoice_count = db.scalar(
        select(func.count()).select_from(Invoice).where(Invoice.organization_id == org.id)
    ) or 0

    charges = list(
        db.scalars(
            select(Charge)
            .where(Charge.organization_id == org.id)
            .order_by(Charge.occurred_at.desc())
            .limit(PROFILE_LIMIT)
        )
    )

    payments = db.execute(
        select(SignerPayment, Document.title)
        .join(Document, Document.id == SignerPayment.document_id, isouter=True)
        .where(SignerPayment.organization_id == org.id)
        .order_by(SignerPayment.created_at.desc())
        .limit(PROFILE_LIMIT)
    ).all()
    payment_count = db.scalar(
        select(func.count())
        .select_from(SignerPayment)
        .where(SignerPayment.organization_id == org.id)
    ) or 0
    # Grouped by currency and never added across them, for the same reason the
    # tenant's own payments ledger refuses to: two currencies have no sum. A
    # refund is subtracted from what was collected rather than shown beside it.
    totals_rows = db.execute(
        select(
            SignerPayment.currency,
            func.coalesce(func.sum(SignerPayment.amount_cents), 0),
            func.coalesce(func.sum(SignerPayment.refunded_amount_cents), 0),
            func.count(),
        )
        .where(
            SignerPayment.organization_id == org.id,
            SignerPayment.status.in_(
                [SignerPaymentStatus.succeeded, SignerPaymentStatus.refunded]
            ),
        )
        .group_by(SignerPayment.currency)
    ).all()

    webhooks = list(
        db.scalars(
            select(WebhookEndpoint)
            .where(WebhookEndpoint.organization_id == org.id)
            .order_by(WebhookEndpoint.created_at.desc())
            .limit(PROFILE_LIMIT)
        )
    )

    subscription, plan = platform_service.subscription_map(db, [org.id]).get(org.id, (None, None))
    account = db.scalar(select(PaymentAccount).where(PaymentAccount.organization_id == org.id))

    audit = list(
        db.scalars(
            select(PlatformAuditEntry)
            .where(PlatformAuditEntry.organization_id == org.id)
            .order_by(PlatformAuditEntry.created_at.desc())
            .limit(PROFILE_LIMIT)
        )
    )

    def _count(model) -> int:
        return db.scalar(
            select(func.count()).select_from(model).where(model.organization_id == org.id)
        ) or 0

    return TenantProfile(
        tenant=detail,
        counts=TenantCounts(
            users=len(users) if len(users) < USER_LIMIT else detail.users_count,
            active_users=active_users,
            documents=sum(documents_by_status.values()),
            templates=templates,
            contacts=_count(Contact),
            folders=_count(Folder),
            teams=_count(Team),
            api_keys=_count(ApiKey),
            active_api_keys=active_api_keys,
            webhooks=_count(WebhookEndpoint),
            invoices=invoice_count,
            signer_payments=payment_count,
        ),
        documents_by_status=documents_by_status,
        users=[_directory_user(user, org) for user in users],
        recent_documents=[
            TenantDocumentRow(
                id=doc.id,
                title=doc.title,
                status=str(doc.status),
                is_template=doc.is_template,
                sender_email=email,
                created_at=doc.created_at,
                sent_at=doc.sent_at,
                completed_at=doc.completed_at,
            )
            for doc, email in recent_documents
        ],
        api_keys=[
            TenantApiKeyRow(
                id=key.id,
                label=key.label,
                mode=key.mode,
                # The hash never leaves the database; the mask is all the
                # console has ever been able to show, and all it needs.
                masked=key.masked,
                scopes=list(key.scopes or []),
                created_by_email=email,
                last_used_at=key.last_used_at,
                revoked_at=key.revoked_at,
                created_at=key.created_at,
            )
            for key, email in api_keys
        ],
        invoices=[
            TenantInvoiceRow(
                id=inv.id,
                number=inv.number,
                status=inv.status,
                currency=inv.currency,
                total_cents=inv.total_cents,
                amount_paid_cents=inv.amount_paid_cents,
                issued_at=inv.issued_at,
                due_at=inv.due_at,
                paid_at=inv.paid_at,
            )
            for inv in invoices
        ],
        charges=[
            TenantChargeRow(
                id=charge.id,
                amount_cents=charge.amount_cents,
                currency=charge.currency,
                status=charge.status,
                method_label=charge.method_label,
                description=charge.description,
                decline_code=charge.decline_code,
                occurred_at=charge.occurred_at,
            )
            for charge in charges
        ],
        signer_payments=[
            TenantSignerPaymentRow(
                id=payment.id,
                document_id=payment.document_id,
                document_title=title,
                amount_cents=payment.amount_cents,
                refunded_amount_cents=payment.refunded_amount_cents,
                currency=payment.currency,
                status=str(payment.status),
                paid_at=payment.paid_at,
                created_at=payment.created_at,
            )
            for payment, title in payments
        ],
        signer_payment_totals=[
            TenantSignerPaymentTotals(
                currency=currency,
                collected_cents=collected - refunded,
                refunded_cents=refunded,
                count=count,
            )
            for currency, collected, refunded, count in totals_rows
        ],
        webhooks=[
            TenantWebhookRow(
                id=hook.id,
                url=hook.url,
                is_active=hook.is_active,
                event_types=list(hook.event_types) if hook.event_types else None,
                description=hook.description,
                created_at=hook.created_at,
            )
            for hook in webhooks
        ],
        subscription=(
            TenantSubscriptionInfo(
                plan_code=plan.code if plan else None,
                plan_name=platform_service.plan_display_name(org, plan),
                status=subscription.status,
                price_cents=plan.price_cents if plan else None,
                current_period_start=subscription.current_period_start,
                current_period_end=subscription.current_period_end,
                trial_ends_at=subscription.trial_ends_at,
                canceled_at=subscription.canceled_at,
                cancel_at_period_end=subscription.cancel_at_period_end,
                provider=subscription.provider,
            )
            if subscription
            else None
        ),
        payment_account=(
            TenantPaymentAccountInfo(
                provider=account.provider,
                charges_enabled=account.charges_enabled,
                payouts_enabled=account.payouts_enabled,
                details_submitted=account.details_submitted,
                livemode=account.livemode,
                default_currency=account.default_currency,
                disabled_reason=account.disabled_reason,
                onboarded_at=account.onboarded_at,
            )
            if account
            else None
        ),
        audit=[
            PlatformAuditRow(
                id=entry.id,
                action=entry.action,
                actor_email=entry.actor_email,
                detail=entry.detail,
                ip_address=entry.ip_address,
                organization_id=entry.organization_id,
                organization_name=org.name,
                metadata=entry.entry_metadata,
                occurred_at=entry.created_at,
            )
            for entry in audit
        ],
        invoiced_cents=invoiced_cents,
        invoice_paid_cents=invoice_paid_cents,
        invoice_outstanding_cents=max(invoiced_cents - invoice_paid_cents, 0),
        invoice_currency=invoices[0].currency if invoices else "USD",
    )


@router.get("/tenants/{org_id}/profile", response_model=TenantProfile)
def get_tenant_profile(
    org_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantProfile:
    """The tenant record page: members, envelopes, credentials and money."""
    return _profile(db, _get_org(db, org_id))


@router.post("/tenants/{org_id}/suspend", response_model=TenantDetail)
def suspend_tenant(
    org_id: str,
    payload: TenantSuspend,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    org = _get_org(db, org_id)
    if org.suspended_at is None:
        org.suspended_at = now_utc()
    org.suspension_reason = payload.reason
    db.add(org)
    ip = request_ip(request)
    platform_service.record_platform_audit(
        db,
        action="tenant.suspended",
        actor=admin,
        organization_id=org.id,
        detail=payload.reason,
        ip_address=ip,
    )
    platform_service.record_system_log(
        db,
        message=f"Tenant {org.name} suspended",
        level="warn",
        organization_id=org.id,
        actor_email=admin.email,
        ip_address=ip,
        payload={"reason": payload.reason},
    )
    db.commit()
    db.refresh(org)
    return _detail(db, org)


@router.post("/tenants/{org_id}/wallet/credit", response_model=WalletResponse)
def credit_tenant_wallet(
    org_id: str,
    payload: WalletCreditRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> WalletResponse:
    """Grant account balance to a tenant (BIL-12).

    The only way balance is created outside the billing engine, so it is
    audited with a mandatory reason and attributed to the admin who issued it.
    Balance is spendable on this application's invoices and nothing else --
    this is not a refund mechanism and there is no path from here to a bank.
    """
    org = _get_org(db, org_id)
    wallet_service.credit(
        db,
        organization_id=org.id,
        amount_cents=payload.amount_cents,
        kind=WalletEntryKind.platform_grant,
        description=f"Credit issued by {admin.email}",
        reason=payload.reason,
        actor_user_id=admin.id,
    )
    ip = request_ip(request)
    platform_service.record_platform_audit(
        db,
        action="tenant.wallet_credited",
        actor=admin,
        organization_id=org.id,
        detail=f"{payload.amount_cents} cents: {payload.reason}",
        ip_address=ip,
    )
    db.commit()
    summary = wallet_service.summary(db, org.id)
    entries, total = wallet_service.history(db, org.id, limit=50)
    return WalletResponse(
        balance_cents=summary["balance_cents"],
        currency=summary["currency"],
        withdrawable=summary["withdrawable"],
        total=total,
        entries=[WalletEntryResponse.model_validate(entry) for entry in entries],
    )


@router.post("/tenants/{org_id}/resume", response_model=TenantDetail)
def resume_tenant(
    org_id: str,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TenantDetail:
    org = _get_org(db, org_id)
    org.suspended_at = None
    org.suspension_reason = None
    db.add(org)
    ip = request_ip(request)
    platform_service.record_platform_audit(
        db,
        action="tenant.reinstated",
        actor=admin,
        organization_id=org.id,
        detail=f"Reinstated tenant {org.name}",
        ip_address=ip,
    )
    platform_service.record_system_log(
        db,
        message=f"Tenant {org.name} reinstated",
        organization_id=org.id,
        actor_email=admin.email,
        ip_address=ip,
    )
    db.commit()
    db.refresh(org)
    return _detail(db, org)


# --- Per-tenant flag overrides (FLG-3, per tenant) --------------------------


@router.get("/tenants/{org_id}/flags", response_model=list[TenantFlagOverride])
def list_tenant_flag_overrides(
    org_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[TenantFlagOverride]:
    _get_org(db, org_id)
    rows = db.execute(
        select(FeatureFlagOverride, FeatureFlag)
        .join(FeatureFlag, FeatureFlag.id == FeatureFlagOverride.flag_id)
        .where(FeatureFlagOverride.organization_id == org_id)
    ).all()
    return [
        TenantFlagOverride(flag_id=flag.id, key=flag.key, enabled=override.enabled)
        for override, flag in rows
    ]


@router.put("/tenants/{org_id}/flags", response_model=list[TenantFlagOverride])
def set_tenant_flag_override(
    org_id: str,
    payload: TenantFlagOverrideUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[TenantFlagOverride]:
    """Force one flag on or off for this tenant; ``enabled: null`` clears it."""
    org = _get_org(db, org_id)
    flag = db.scalar(select(FeatureFlag).where(FeatureFlag.key == payload.key))
    if not flag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Feature flag not found")

    override = db.scalar(
        select(FeatureFlagOverride).where(
            FeatureFlagOverride.flag_id == flag.id,
            FeatureFlagOverride.organization_id == org.id,
        )
    )
    if payload.enabled is None:
        if override:
            db.delete(override)
    elif override:
        override.enabled = payload.enabled
        db.add(override)
    else:
        db.add(
            FeatureFlagOverride(flag_id=flag.id, organization_id=org.id, enabled=payload.enabled)
        )

    platform_service.record_platform_audit(
        db,
        action="flag.override_set",
        actor=admin,
        organization_id=org.id,
        detail=f"{flag.key} override = {payload.enabled}",
        ip_address=request_ip(request),
        metadata={"key": flag.key, "enabled": payload.enabled},
    )
    db.commit()
    return list_tenant_flag_overrides(org_id, db=db, admin=admin)


# --- Impersonation (ORG-7) -------------------------------------------------


@router.post("/tenants/{org_id}/impersonate", response_model=ImpersonationSessionResponse)
def impersonate_tenant(
    org_id: str,
    payload: ImpersonationStart,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ImpersonationSessionResponse:
    """Issue a short-lived token acting as the tenant's owner.

    The session is recorded in ``impersonation_sessions`` and in the platform
    audit trail before the token is handed out, so a token can never exist
    without a trace of who took it and why.
    """
    org = _get_org(db, org_id)
    target = platform_service.owner_map(db, [org]).get(org.id)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Tenant has no user to impersonate"
        )

    session, token = platform_service.start_impersonation(
        db,
        admin=admin,
        org=org,
        target=target,
        justification=payload.justification,
        ttl_seconds=payload.ttl_seconds,
        scopes=payload.scopes,
        ip_address=request_ip(request),
    )
    db.commit()
    db.refresh(session)
    return ImpersonationSessionResponse(
        id=session.id,
        access_token=token,
        organization_id=org.id,
        organization_name=org.name,
        impersonated_user_id=target.id,
        impersonated_user_email=target.email,
        impersonated_user_name=target.name or target.email,
        impersonated_user_role=str(target.role or "sender"),
        justification=session.justification,
        scopes=list(session.scopes or []),
        expires_at=session.expires_at,
        ended_at=session.ended_at,
    )


@router.delete("/impersonation", response_model=ImpersonationEnded)
def stop_impersonation(
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> ImpersonationEnded:
    ended = platform_service.end_impersonation(db, admin=admin, ip_address=request_ip(request))
    db.commit()
    return ImpersonationEnded(ended_sessions=ended)


# --- Directory & roles (ORG-10) --------------------------------------------


@router.get("/directory", response_model=DirectoryPage)
def list_directory(
    q: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    role: str | None = Query(default=None, description="super | admin | sender"),
    mfa: bool | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> DirectoryPage:
    """Cross-tenant user directory with role and MFA status."""
    query = select(User)
    if q:
        term = f"%{q.lower()}%"
        query = query.where(or_(func.lower(User.name).like(term), func.lower(User.email).like(term)))
    if organization_id:
        query = query.where(User.organization_id == organization_id)
    if role and role != "all":
        if role == "super":
            query = query.where(User.is_platform_admin.is_(True))
        else:
            query = query.where(User.role == role, User.is_platform_admin.is_(False))
    if mfa is not None:
        query = query.where(
            User.mfa_enrolled_at.is_not(None) if mfa else User.mfa_enrolled_at.is_(None)
        )

    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    users = list(db.scalars(query.order_by(User.created_at.desc()).limit(limit).offset(offset)))
    orgs = {
        org.id: org
        for org in db.scalars(
            select(Organization).where(Organization.id.in_({user.organization_id for user in users}))
        )
    } if users else {}
    return DirectoryPage(
        items=[_directory_user(user, orgs.get(user.organization_id)) for user in users], total=total
    )


@router.patch("/directory/{user_id}/role", response_model=DirectoryUser)
def assign_directory_role(
    user_id: str,
    payload: DirectoryRoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> DirectoryUser:
    """Assign a platform or tenant role. ``super`` grants platform access."""
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    platform_service.apply_role_assignment(
        db, admin=admin, user=user, role=payload.role, ip_address=request_ip(request)
    )
    db.commit()
    db.refresh(user)
    return _directory_user(user, db.get(Organization, user.organization_id))


@router.get("/roles", response_model=PermissionMatrix)
def permission_matrix(admin: User = Depends(require_platform_admin)) -> PermissionMatrix:
    """The permission matrix the design shows, owned by the server."""
    return PermissionMatrix(
        columns=platform_service.ROLE_COLUMNS,
        column_labels=platform_service.ROLE_COLUMN_LABELS,
        permissions=[
            PermissionRow(label=label, allowed=allowed)
            for label, allowed in platform_service.PERMISSION_MATRIX
        ],
    )


# --- Platform overview (ORG-9) ---------------------------------------------


@router.get("/overview", response_model=PlatformOverview)
def platform_overview(
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> PlatformOverview:
    orgs = list(db.scalars(select(Organization)))
    rows = platform_service.build_tenant_rows(db, orgs)
    suspended = sum(1 for row in rows if row["status"] == "suspended")
    trial = sum(1 for row in rows if row["status"] == SubscriptionStatus.trialing)
    active = sum(1 for row in rows if row["status"] == SubscriptionStatus.active)

    since = now_utc() - timedelta(days=30)
    envelopes = db.scalar(
        select(func.count()).select_from(Document).where(Document.created_at >= since)
    ) or 0
    incidents = db.scalar(
        select(func.count())
        .select_from(SystemLog)
        .where(SystemLog.level == "error", SystemLog.occurred_at >= now_utc() - timedelta(days=90))
    ) or 0

    mrr = sum(row["mrr_cents"] for row in rows)
    # Twelve-month series reconstructed from the tenants that existed in each
    # month, so the chart is derived from rows rather than invented.
    series: list[int] = []
    for months_ago in range(11, -1, -1):
        cutoff = now_utc() - timedelta(days=30 * months_ago)
        series.append(
            sum(
                row["mrr_cents"]
                for row in rows
                if platform_service.as_aware(row["created_at"]) <= cutoff
            )
        )

    # Health and the error count behind uptime come from platform_service, the
    # single derivation shared with GET /api/saas/health.
    errors_24h = platform_service.error_count_since(db, days=1)
    health = [PlatformHealthRow(**row) for row in platform_service.component_health(db)]

    return PlatformOverview(
        tenants=PlatformTenantCounts(
            total=len(rows), trial=trial, suspended=suspended, active=active
        ),
        seats=PlatformSeatCounts(
            provisioned=sum(row["seats_licensed"] for row in rows),
            activated=sum(row["seats_activated"] for row in rows),
        ),
        envelopes_30d=envelopes,
        mrr_cents=mrr,
        incidents_90d=incidents,
        # No availability signal exists in this system - no probe, no
        # synthetic check, no incident feed. The previous value was
        # ``100 - errors_24h * 0.01``, an invented figure presented as a
        # measured SLA. ``None`` is the honest answer until one exists.
        uptime_pct=None,
        errors_24h=errors_24h,
        mrr_series=series,
        health=health,
    )
