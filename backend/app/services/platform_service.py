"""Platform-administration domain logic.

Everything that is *not* a request concern for the platform surface lives
here: the administrative audit trail, the system-log writer, tenant metric
derivation, feature-flag resolution and impersonation tokens.

The audit trail matters more than it looks: suspension, impersonation and
flag flips are the actions an auditor asks about, so every one of them writes
a ``PlatformAuditEntry`` **in the same transaction as the change itself**.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any, Iterable

import jwt
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from fastapi import HTTPException, status

from app.core.security import IMPERSONATION_TOKEN_PURPOSE, JWT_ALGORITHM
from app.models.document import Document
from app.models.feature_flag import FeatureFlag, FeatureFlagOverride
from app.models.impersonation import ImpersonationSession
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.plan import Plan
from app.models.platform_audit import PlatformAuditEntry
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.system_log import SystemLog
from app.models.enums import UserRole
from app.models.user import User

# Role keys used by the permission matrix and the directory (ORG-10).
ROLE_COLUMNS = ["super", "orgadmin", "sender", "viewer"]
ROLE_COLUMN_LABELS = ["Platform super admin", "Organization admin", "Sender", "Viewer"]
ROLE_LABELS = {
    "super": "Platform super admin",
    "orgadmin": "Organization admin",
    "sender": "Sender",
    "viewer": "Viewer",
}

#: Mirrors the actual dependency checks in ``app.api.deps`` and the routers, so
#: the matrix the UI renders cannot drift from what the API enforces.
PERMISSION_MATRIX: list[tuple[str, list[bool]]] = [
    ("Manage tenants and suspensions", [True, False, False, False]),
    ("Impersonate a tenant", [True, False, False, False]),
    ("Toggle feature flags and security posture", [True, False, False, False]),
    ("Read platform-wide logs and audit", [True, False, False, False]),
    ("Assign platform roles", [True, False, False, False]),
    ("Manage organization settings and branding", [True, True, False, False]),
    ("Invite and deprovision members", [True, True, False, False]),
    ("Assign roles inside the organization", [True, True, False, False]),
    ("Manage billing and invoices", [True, True, False, False]),
    ("Change ticket priority and assignee", [True, False, False, False]),
    ("Send envelopes for signature", [True, True, True, False]),
    ("Create and edit templates", [True, True, True, False]),
    ("Void or delete own envelopes", [True, True, True, False]),
    ("Open support tickets", [True, True, True, True]),
    ("View organization documents and reports", [True, True, True, True]),
]

#: Security-posture rows the platform ships with (FLG-5).
#:
#: **None of these controls is implemented.** There is no SAML/OIDC handler, no
#: SCIM endpoint, no IP allowlist check on any dependency, no residency
#: routing, no key-rotation job and no DLP scanner. The rows exist because the
#: console renders a roadmap tracker; they are shipped *disabled* and every
#: response marks them ``implemented=False`` / ``enforced=False`` so nobody can
#: read a toggle here as a control that is actually in force.
SECURITY_POSTURE_DEFAULTS: list[dict[str, Any]] = [
    {
        "key": "sso",
        "label": "SAML 2.0 single sign-on",
        "detail": (
            "SAML 2.0 is implemented per organization (login, ACS, and connection config), "
            "with enforcement that refuses password login, password reset, and invitation "
            "acceptance for that organization once enabled. OIDC is not implemented."
        ),
        "enabled": False,
    },
    {"key": "scim", "label": "SCIM 2.0 provisioning", "detail": "Partially implemented — /scim/v2/Users supports list/filter, get, create, replace and PATCH/DELETE deactivation, bearer-token authenticated and scoped per organization; deactivation actually revokes sessions. Groups and role/attribute sync are not implemented, and tokens do not expire — revoking one is the only way to retire it.", "enabled": False},
    {"key": "ipAllow", "label": "IP allowlist for admin console", "detail": "Enforced in require_platform_admin: when this row is enabled and at least one CIDR is configured, platform-admin requests from outside every configured range are refused. An empty allowlist never denies (it cannot lock the console out), and X-Forwarded-For is honoured only from a configured trusted proxy. Applies to the platform admin surface only, not tenant APIs.", "enabled": False},
    {"key": "residency", "label": "Regional data residency pinning", "detail": "Not implemented — all tenants share one region.", "enabled": False},
    {"key": "keyRotation", "label": "HSM key rotation (90 days)", "detail": "Not implemented — there is no rotation job and no HSM integration.", "enabled": False},
    {"key": "dlp", "label": "DLP scanning on uploaded documents", "detail": "Scans text extracted from uploaded PDFs for four fixed patterns — Luhn-checked card numbers, US SSNs, IBANs and email addresses — and blocks the send on the first three. No OCR (image-only pages are not scanned), no ML classification; names, addresses and phone numbers are invisible to it. Matched values are never stored or logged.", "enabled": False},
]

#: Posture keys backed by code that actually enforces something. Adding a key
#: here is the signal that the control became real -- the console renders a
#: live switch for these and a static "Not implemented" state for the rest, so
#: a key must not appear here until something refuses a request without it.
#:
#: "residency" and "keyRotation" are deliberately absent and cannot be added by
#: writing application code: residency pinning is a property of where the
#: deployment actually stores data (there is one region), and key rotation
#: needs an HSM/KMS that this repo does not integrate with. Marking either one
#: implemented would put a green control in front of an operator with nothing
#: behind it.
IMPLEMENTED_SECURITY_CONTROLS: frozenset[str] = frozenset({"sso", "scim", "ipAllow", "dlp"})


def security_posture_view(row) -> dict[str, Any]:
    """The row as the API reports it, with enforcement stated explicitly."""
    implemented = row.key in IMPLEMENTED_SECURITY_CONTROLS
    return {
        "key": row.key,
        "label": row.label,
        "detail": row.detail,
        "enabled": bool(row.enabled),
        "implemented": implemented,
        "enforced": implemented and bool(row.enabled),
    }


#: Compliance records the *operator* maintains. The platform cannot substantiate
#: a certification, so it ships asserting none: a row saying "certified" here
#: could be shown to a customer as evidence of an audit that never happened.
CERTIFICATION_DEFAULTS: list[dict[str, Any]] = [
    {"name": "SOC 2 Type II", "status": "not_assessed", "sort_order": 0},
    {"name": "ISO 27001", "status": "not_assessed", "sort_order": 1},
    {"name": "ISO 27018", "status": "not_assessed", "sort_order": 2},
    {"name": "HIPAA", "status": "not_assessed", "sort_order": 3},
    {"name": "21 CFR Part 11", "status": "not_assessed", "sort_order": 4},
    {"name": "eIDAS QES", "status": "not_assessed", "sort_order": 5},
    {"name": "GDPR", "status": "not_assessed", "sort_order": 6},
    {"name": "FedRAMP", "status": "not_assessed", "sort_order": 7},
]

#: Feature-flag catalogue (FLG-1) — the prototype's FLAG_META.
FEATURE_FLAG_DEFAULTS: list[dict[str, Any]] = [
    {
        "key": "signing.passkey_reuse",
        "environment": "prod",
        "description": "One-click re-use of a device-bound signature for authenticated signers.",
        "enabled": True,
        "rollout_pct": 100,
    },
    {
        "key": "builder.conditional_logic_v2",
        "environment": "prod",
        "description": "Nested conditional rules with multi-trigger AND/OR groups in the field inspector.",
        "enabled": True,
        "rollout_pct": 100,
    },
    {
        "key": "api.bulk_send_v3",
        "environment": "staging",
        "description": "Bulk send endpoint accepting a 10k-row CSV, one envelope per row.",
        "enabled": False,
        "rollout_pct": 10,
    },
    {
        "key": "audit.ledger_anchoring",
        "environment": "prod",
        "description": "Hourly anchoring of document hashes to the append-only verification ledger.",
        "enabled": True,
        "rollout_pct": 100,
    },
    {
        "key": "signing.ai_clause_summary",
        "environment": "canary",
        "description": "Plain-language clause summary shown to signers before execution.",
        "enabled": False,
        "rollout_pct": 5,
    },
]

KEY_ROTATION_INTERVAL_DAYS = 90

#: First-response SLA per priority, in minutes (SUP-2).
SLA_TARGET_MINUTES = {"urgent": 60, "high": 240, "normal": 24 * 60, "low": 72 * 60}


# --- Audit / logs ----------------------------------------------------------


def record_platform_audit(
    db: Session,
    *,
    action: str,
    actor: User | None = None,
    organization_id: str | None = None,
    detail: str | None = None,
    ip_address: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> PlatformAuditEntry:
    entry = PlatformAuditEntry(
        action=action,
        actor_user_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        organization_id=organization_id,
        detail=detail,
        ip_address=ip_address,
        entry_metadata=metadata,
    )
    db.add(entry)
    return entry


def record_system_log(
    db: Session,
    *,
    message: str,
    source: str = "admin",
    level: str = "info",
    organization_id: str | None = None,
    actor_email: str | None = None,
    ip_address: str | None = None,
    status_code: int | None = None,
    latency_ms: int | None = None,
    request_id: str | None = None,
    payload: dict | list | None = None,
) -> SystemLog:
    row = SystemLog(
        organization_id=organization_id,
        level=level,
        source=source,
        message=message,
        status_code=status_code,
        latency_ms=latency_ms,
        request_id=request_id,
        actor_email=actor_email,
        ip_address=ip_address,
        payload=payload,
    )
    db.add(row)
    return row


# --- Platform component health --------------------------------------------
#
# ONE implementation, two consumers: ``GET /api/saas/health`` (REV-6) renders
# it as ``HealthComponent`` and ``GET /api/saas/overview`` (ORG-9) as
# ``PlatformHealthRow``. Both shapes are {component, detail, tone}; two
# separate derivations were the reason the two screens disagreed.
#
# Only components with a real signal in the database are reported. Anything
# needing an external probe (latency percentiles, worker queues) is
# deliberately absent rather than invented.


def component_health(db: Session) -> list[dict[str, str]]:
    """Derived health rows for the platform home tiles."""
    from app.models.charge import Charge
    from app.models.subscription import ProcessedWebhookEvent
    from app.models.webhook import WebhookDelivery
    from app.services.billing_service import billing_service

    now = now_utc()
    day_ago = now - timedelta(days=1)

    errors_24h = int(
        db.scalar(
            select(func.count())
            .select_from(SystemLog)
            .where(SystemLog.level == "error", SystemLog.occurred_at >= day_ago)
        )
        or 0
    )
    envelopes_30d = int(
        db.scalar(
            select(func.count()).select_from(Document).where(Document.created_at >= now - timedelta(days=30))
        )
        or 0
    )
    suspended = int(
        db.scalar(
            select(func.count()).select_from(Organization).where(Organization.suspended_at.is_not(None))
        )
        or 0
    )
    total_deliveries = int(
        db.scalar(select(func.count(WebhookDelivery.id)).where(WebhookDelivery.created_at >= day_ago)) or 0
    )
    delivered = int(
        db.scalar(
            select(func.count(WebhookDelivery.id)).where(
                WebhookDelivery.created_at >= day_ago, WebhookDelivery.status == "delivered"
            )
        )
        or 0
    )
    success = round(delivered * 100 / total_deliveries, 1) if total_deliveries else 100.0
    unprocessed = int(
        db.scalar(
            select(func.count(ProcessedWebhookEvent.id)).where(
                ProcessedWebhookEvent.processed == False  # noqa: E712
            )
        )
        or 0
    )
    dunning = int(db.scalar(select(func.count(Charge.id)).where(Charge.status == "failed")) or 0)

    return [
        {
            "component": "API",
            "detail": f"{errors_24h} errors in the last 24h",
            "tone": "bad" if errors_24h > 50 else "warn" if errors_24h else "good",
        },
        {
            "component": "Signing",
            "detail": f"{envelopes_30d} envelopes in the last 30 days",
            "tone": "good",
        },
        {
            "component": "Tenants",
            "detail": f"{suspended} suspended",
            "tone": "warn" if suspended else "good",
        },
        {
            "component": "Webhook delivery",
            "detail": f"{success}% delivered in 24h ({delivered}/{total_deliveries})",
            "tone": "good" if success >= 99 else ("warn" if success >= 95 else "bad"),
        },
        {
            "component": "Payment provider",
            "detail": f"{billing_service.provider.name} \u00b7 {unprocessed} unprocessed event(s)",
            "tone": "good" if unprocessed == 0 else ("warn" if unprocessed < 5 else "bad"),
        },
        {
            "component": "Collections",
            "detail": f"{dunning} failed charge(s) in dunning",
            "tone": "good" if dunning == 0 else ("warn" if dunning < 5 else "bad"),
        },
    ]


def error_count_since(db: Session, *, days: int) -> int:
    """System-log error rows in the window -- backs the derived uptime figure."""
    return int(
        db.scalar(
            select(func.count())
            .select_from(SystemLog)
            .where(SystemLog.level == "error", SystemLog.occurred_at >= now_utc() - timedelta(days=days))
        )
        or 0
    )


# --- Tenant metrics --------------------------------------------------------


def _monthly_cents(plan: Plan) -> int:
    if plan.billing_interval == "year":
        return round(plan.price_cents / 12)
    return plan.price_cents


def tenant_mrr_cents(org: Organization, subscription: Subscription | None, plan: Plan | None) -> int:
    """MRR is derived, never stored — see ``/api/saas/revenue``.

    A suspended tenant or a trial bills nothing yet, so both contribute zero.
    """
    if org.suspended_at is not None:
        return 0
    status = subscription.status if subscription else org.subscription_status
    if status in {SubscriptionStatus.trialing, SubscriptionStatus.canceled, SubscriptionStatus.expired}:
        return 0
    if plan is None:
        return 0
    if plan.is_seat_based and plan.seat_price_cents:
        return plan.seat_price_cents * max(org.seats_licensed or 0, 0)
    return _monthly_cents(plan)


def tenant_status(org: Organization, subscription: Subscription | None) -> str:
    if org.suspended_at is not None:
        return "suspended"
    return subscription.status if subscription else org.subscription_status


def seats_activated_map(db: Session, org_ids: Iterable[str]) -> dict[str, int]:
    ids = list(org_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(User.organization_id, func.count(User.id))
        .where(User.organization_id.in_(ids), User.status == "active")
        .group_by(User.organization_id)
    ).all()
    return {org_id: count for org_id, count in rows}


def users_count_map(db: Session, org_ids: Iterable[str]) -> dict[str, int]:
    ids = list(org_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(User.organization_id, func.count(User.id))
        .where(User.organization_id.in_(ids))
        .group_by(User.organization_id)
    ).all()
    return {org_id: count for org_id, count in rows}


def documents_count_map(db: Session, org_ids: Iterable[str], *, since: datetime | None = None) -> dict[str, int]:
    ids = list(org_ids)
    if not ids:
        return {}
    query = select(Document.organization_id, func.count(Document.id)).where(
        Document.organization_id.in_(ids)
    )
    if since is not None:
        query = query.where(Document.created_at >= since)
    rows = db.execute(query.group_by(Document.organization_id)).all()
    return {org_id: count for org_id, count in rows}


def subscription_map(db: Session, org_ids: Iterable[str]) -> dict[str, tuple[Subscription, Plan]]:
    ids = list(org_ids)
    if not ids:
        return {}
    rows = db.execute(
        select(Subscription, Plan)
        .join(Plan, Plan.id == Subscription.plan_id)
        .where(Subscription.organization_id.in_(ids))
    ).all()
    return {subscription.organization_id: (subscription, plan) for subscription, plan in rows}


def owner_map(db: Session, orgs: Iterable[Organization]) -> dict[str, User]:
    """The named owner, falling back to the earliest admin of the tenant."""
    orgs = list(orgs)
    owner_ids = {org.owner_user_id for org in orgs if org.owner_user_id}
    by_id: dict[str, User] = {}
    if owner_ids:
        by_id = {
            user.id: user for user in db.scalars(select(User).where(User.id.in_(owner_ids))).all()
        }
    result: dict[str, User] = {}
    missing: list[str] = []
    for org in orgs:
        owner = by_id.get(org.owner_user_id) if org.owner_user_id else None
        if owner is not None:
            result[org.id] = owner
        else:
            missing.append(org.id)
    if missing:
        candidates = db.scalars(
            select(User).where(User.organization_id.in_(missing)).order_by(User.created_at)
        ).all()
        for user in candidates:
            current = result.get(user.organization_id)
            if current is None or (current.role != "admin" and user.role == "admin"):
                result.setdefault(user.organization_id, user)
    return result


def plan_display_name(org: Organization, plan: Plan | None) -> str:
    if plan is not None:
        return plan.name
    return (org.subscription_tier or "free").replace("_", " ").title()


# --- Feature flags ---------------------------------------------------------


def _bucket(organization_id: str, key: str) -> int:
    """Stable 0-99 bucket so a rollout percentage is deterministic per tenant."""
    digest = sha256(f"{key}:{organization_id}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % 100


def resolve_flags(db: Session, organization_id: str) -> dict[str, bool]:
    """The flag map for one tenant: enabled ∧ rollout, then override wins."""
    flags = db.scalars(select(FeatureFlag)).all()
    overrides = {
        row.flag_id: row.enabled
        for row in db.scalars(
            select(FeatureFlagOverride).where(FeatureFlagOverride.organization_id == organization_id)
        ).all()
    }
    resolved: dict[str, bool] = {}
    for flag in flags:
        if flag.id in overrides:
            resolved[flag.key] = overrides[flag.id]
            continue
        value = bool(flag.enabled)
        if value and flag.rollout_pct < 100:
            value = _bucket(organization_id, flag.key) < flag.rollout_pct
        resolved[flag.key] = value
    return resolved


def ensure_security_posture(db: Session) -> list:
    """Seed the posture rows on first read so the UI is never empty."""
    from app.models.platform_setting import SecurityPosture

    existing = {row.key for row in db.scalars(select(SecurityPosture)).all()}
    created = False
    for spec in SECURITY_POSTURE_DEFAULTS:
        if spec["key"] not in existing:
            db.add(SecurityPosture(**spec))
            created = True
    if created:
        db.commit()
    return list(
        db.scalars(select(SecurityPosture)).all()
    )


def ensure_certifications(db: Session) -> list:
    from app.models.platform_setting import Certification

    existing = {row.name for row in db.scalars(select(Certification)).all()}
    created = False
    for spec in CERTIFICATION_DEFAULTS:
        if spec["name"] not in existing:
            db.add(Certification(**spec))
            created = True
    if created:
        db.commit()
    return list(db.scalars(select(Certification).order_by(Certification.sort_order)).all())


# --- Impersonation ---------------------------------------------------------


def _hash_token(raw: str) -> str:
    return sha256(raw.encode("utf-8")).hexdigest()


#: The only scopes an impersonation session may hold. ``read`` permits safe
#: HTTP methods only; ``write`` additionally permits mutations, minus the
#: privilege-granting surface enumerated in ``app.api.deps``.
IMPERSONATION_SCOPES: frozenset[str] = frozenset({"read", "write"})


def start_impersonation(
    db: Session,
    *,
    admin: User,
    org: Organization,
    target: User,
    justification: str,
    ttl_seconds: int,
    scopes: list[str] | None,
    ip_address: str | None = None,
) -> tuple[ImpersonationSession, str]:
    """Mint an impersonation credential and the row that governs it.

    The token is *not* an ordinary access token. It carries
    ``purpose=impersonation`` so ``get_current_user`` routes it through
    ``authorize_impersonation``, which re-reads this row on every request. That
    makes the three properties the session claims actually true:

    * **scope** — ``read`` sessions are refused on any unsafe method;
    * **revocation** — ``ended_at`` is checked per request, so ending a session
      kills the token immediately rather than at its ``exp``;
    * **attribution** — ``imp`` names the admin, and the request context is
      stamped so every audit row written downstream records who really acted.
    """
    settings = get_settings()
    requested = [scope.strip().lower() for scope in (scopes or ["read"]) if scope.strip()]
    unknown = sorted(set(requested) - IMPERSONATION_SCOPES)
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown impersonation scope(s): {', '.join(unknown)}",
        )
    granted = sorted(set(requested) or {"read"})
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=ttl_seconds)
    token = jwt.encode(
        {
            "sub": target.id,
            "exp": expires_at,
            "purpose": IMPERSONATION_TOKEN_PURPOSE,
            "imp": admin.id,
            "org": org.id,
            "scopes": granted,
        },
        settings.jwt_secret,
        algorithm=JWT_ALGORITHM,
    )
    session = ImpersonationSession(
        admin_user_id=admin.id,
        organization_id=org.id,
        justification=justification,
        scopes=granted,
        token_hash=_hash_token(token),
        expires_at=expires_at,
    )
    db.add(session)
    record_platform_audit(
        db,
        action="impersonation.started",
        actor=admin,
        organization_id=org.id,
        detail=f"Impersonating {target.email}: {justification}",
        ip_address=ip_address,
        metadata={"target_user_id": target.id, "ttl_seconds": ttl_seconds, "scopes": granted},
    )
    record_system_log(
        db,
        message=f"Impersonation started for {org.name}",
        source="admin",
        level="warn",
        organization_id=org.id,
        actor_email=admin.email,
        ip_address=ip_address,
        payload={"target_user_id": target.id, "justification": justification, "scopes": granted},
    )
    return session, token


def end_impersonation(db: Session, *, admin: User, ip_address: str | None = None) -> int:
    sessions = db.scalars(
        select(ImpersonationSession).where(
            ImpersonationSession.admin_user_id == admin.id,
            ImpersonationSession.ended_at.is_(None),
        )
    ).all()
    for session in sessions:
        session.ended_at = now_utc()
        db.add(session)
        record_platform_audit(
            db,
            action="impersonation.ended",
            actor=admin,
            organization_id=session.organization_id,
            detail="Impersonation session ended",
            ip_address=ip_address,
            metadata={"session_id": session.id},
        )
    return len(sessions)


# --- Role assignment (one implementation, two routes) ----------------------


def apply_role_assignment(
    db: Session, *, admin: User, user: User, role: str, ip_address: str | None = None
) -> tuple[UserRole, bool]:
    """Assign a platform or tenant role, enforcing every lock-out guard.

    ``PATCH /api/saas/directory/{id}/role`` and ``PATCH /api/saas/users/{id}/role``
    used to be two implementations with different guards; the second had none
    and assigned ``user.role`` directly. They now share this one, which refuses
    to (a) drop the caller's own platform access, (b) leave a tenant without an
    administrator, or (c) remove the *last platform administrator*, which would
    permanently lock everybody out of ``/api/saas/*`` — there is no bootstrap
    route to recover from that.

    Returns ``(role, is_platform_admin)`` and records the platform audit row.
    The caller commits.
    """
    key = str(role).strip().lower()
    if key in {"super", "orgadmin", "admin"}:
        target_role = UserRole.admin
        platform = key == "super"
    elif key in {"sender", "viewer"}:
        target_role = UserRole.sender
        platform = False
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown role")

    if user.is_platform_admin and not platform:
        remaining_platform = db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.is_platform_admin.is_(True), User.id != user.id)
        )
        if not remaining_platform:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The platform must keep at least one platform administrator",
            )

    if user.id == admin.id and not platform:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="You cannot drop your own platform access"
        )

    if user.role == UserRole.admin and target_role != UserRole.admin:
        remaining = db.scalar(
            select(func.count())
            .select_from(User)
            .where(
                User.organization_id == user.organization_id,
                User.role == UserRole.admin,
                User.id != user.id,
            )
        )
        if not remaining:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An organization must keep at least one administrator",
            )

    user.role = target_role
    user.is_platform_admin = platform
    db.add(user)
    record_platform_audit(
        db,
        action="user.role_assigned",
        actor=admin,
        organization_id=user.organization_id,
        detail=f"{user.email} -> {key}",
        ip_address=ip_address,
        metadata={"user_id": user.id, "role": key, "is_platform_admin": platform},
    )
    return target_role, platform


def sla_due_at(priority: str, *, created_at: datetime | None = None) -> datetime:
    minutes = SLA_TARGET_MINUTES.get(priority, SLA_TARGET_MINUTES["normal"])
    return (created_at or now_utc()) + timedelta(minutes=minutes)


def as_aware(value: datetime | None) -> datetime | None:
    """SQLite hands back naive datetimes; every comparison here needs UTC."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def sla_label(due_at: datetime | None, *, resolved: bool = False) -> str | None:
    """Human wording for the ticket list ("2h left", "Breached 30m")."""
    reference = as_aware(due_at)
    if reference is None:
        return None
    if resolved:
        return "Met" if reference >= now_utc() else "Breached"
    delta = reference - now_utc()
    minutes = int(abs(delta).total_seconds() // 60)
    wording = f"{minutes}m" if minutes < 60 else f"{minutes // 60}h {minutes % 60}m"
    return f"{wording} left" if delta.total_seconds() >= 0 else f"Breached {wording}"


# --- Tenant row assembly ---------------------------------------------------


def build_tenant_rows(db: Session, orgs: list[Organization]) -> list[dict[str, Any]]:
    """Assemble the platform tenant table rows in a fixed number of queries."""
    org_ids = [org.id for org in orgs]
    subs = subscription_map(db, org_ids)
    owners = owner_map(db, orgs)
    activated = seats_activated_map(db, org_ids)
    members = users_count_map(db, org_ids)
    docs_total = documents_count_map(db, org_ids)
    docs_30d = documents_count_map(db, org_ids, since=now_utc() - timedelta(days=30))

    rows: list[dict[str, Any]] = []
    for org in orgs:
        subscription, plan = subs.get(org.id, (None, None))
        owner = owners.get(org.id)
        rows.append(
            {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "region": org.region,
                "company_size": org.company_size,
                "owner_email": owner.email if owner else None,
                "owner_name": owner.name if owner else None,
                "plan_code": plan.code if plan else None,
                "plan_name": plan_display_name(org, plan),
                "subscription_tier": org.subscription_tier,
                "subscription_status": subscription.status if subscription else org.subscription_status,
                "status": tenant_status(org, subscription),
                "suspended_at": org.suspended_at,
                "suspension_reason": org.suspension_reason,
                "seats_licensed": org.seats_licensed or 0,
                "seats_activated": activated.get(org.id, 0),
                "envelope_volume_30d": docs_30d.get(org.id, 0),
                "documents_count": docs_total.get(org.id, 0),
                "users_count": members.get(org.id, 0),
                "mrr_cents": tenant_mrr_cents(org, subscription, plan),
                "subscription_expires_at": org.subscription_expires_at,
                "created_at": org.created_at,
            }
        )
    return rows


def ensure_feature_flags(db: Session) -> list[FeatureFlag]:
    """Seed the flag catalogue on first read so the console is never empty."""
    existing = {flag.key for flag in db.scalars(select(FeatureFlag)).all()}
    created = False
    for spec in FEATURE_FLAG_DEFAULTS:
        if spec["key"] not in existing:
            db.add(FeatureFlag(**spec))
            created = True
    if created:
        db.commit()
    return list(db.scalars(select(FeatureFlag).order_by(FeatureFlag.key)).all())


# --- Security-posture enforcement helpers -----------------------------------
#
# These read the posture rows that the platform console writes. They were lost
# once to a concurrent whole-file overwrite; the callers live in
# ``app/api/deps.py`` (ipAllow) and ``app/services/document_service.py`` (dlp).


def ip_allowlist_enforced(db: Session) -> bool:
    """Whether ``require_platform_admin`` should be checking the caller's IP.

    Enforcement requires both the posture toggle *and* a non-empty list of
    ranges — an admin who enables the toggle before configuring any CIDR must
    never lock themselves (or everyone else) out.
    """
    from app.models.platform_setting import IpAllowlistEntry, SecurityPosture

    row = db.scalar(select(SecurityPosture).where(SecurityPosture.key == "ipAllow"))
    if row is None or not row.enabled:
        return False
    has_entries = db.scalar(select(func.count()).select_from(IpAllowlistEntry)) or 0
    return has_entries > 0


def ip_allowed(db: Session, ip: str | None) -> bool:
    """Whether ``ip`` matches at least one configured CIDR range.

    Only meaningful once ``ip_allowlist_enforced`` is True; callers should
    check that first so an empty list is never treated as "deny all". An
    unknown or unparseable address fails closed.
    """
    import ipaddress

    from app.models.platform_setting import IpAllowlistEntry

    if not ip:
        return False
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    ranges = db.scalars(select(IpAllowlistEntry.cidr)).all()
    for cidr in ranges:
        try:
            network = ipaddress.ip_network(cidr, strict=False)
        except ValueError:
            continue
        if address in network:
            return True
    return False


def dlp_enabled(db: Session) -> bool:
    """Whether uploads should be scanned by ``dlp_service``.

    Unlike the IP allowlist there is nothing to configure, so the posture
    toggle alone decides. Disabled means no scan runs at all, rather than a
    scan whose findings are ignored.
    """
    from app.models.platform_setting import SecurityPosture

    row = db.scalar(select(SecurityPosture).where(SecurityPosture.key == "dlp"))
    return bool(row is not None and row.enabled)
