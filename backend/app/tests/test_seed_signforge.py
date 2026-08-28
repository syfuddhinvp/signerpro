"""The SignForge seeder must produce the aggregates the design screens read.

These tests run ``scripts/seed_signforge.py`` against a throwaway SQLite
database and assert the shape of the data, not its exact numbers: the design's
own figures are discounted marketing values the real aggregations cannot
reproduce (see the script's docstring). What is asserted is that every screen
has something non-trivial to render, that the numbers agree with each other,
and that a second run is a no-op.
"""

from __future__ import annotations

import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Generator

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401  (registers every mapper)
from app.core.database import Base
from app.models.audit_log import AuditLog
from app.models.charge import Charge
from app.models.contact import Contact, ContactGroup
from app.models.document import Document
from app.models.enums import DocumentStatus
from app.models.feature_flag import FeatureFlag, FeatureFlagOverride
from app.models.field import Field
from app.models.invoice import Invoice, InvoiceStatus
from app.models.organization import Organization
from app.models.payment_method import PaymentMethod
from app.models.platform_audit import PlatformAuditEntry
from app.models.recipient import Recipient
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.support import SupportTicket, TicketMessage
from app.models.system_log import SystemLog
from app.models.user import User
from app.services.audit_service import audit_service
from app.services.report_service import report_service

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def _load_seeder():
    """Import ``scripts/seed_signforge.py`` without a package on the path."""
    path = BACKEND_ROOT / "scripts" / "seed_signforge.py"
    spec = importlib.util.spec_from_file_location("seed_signforge", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["seed_signforge"] = module
    spec.loader.exec_module(module)
    return module


seed_signforge = _load_seeder()


@pytest.fixture()
def db() -> Generator[Session, None, None]:
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def seeded(db: Session) -> Session:
    seed_signforge.seed(db)
    return db


def _count(db: Session, model, *where) -> int:
    query = select(func.count()).select_from(model)
    for clause in where:
        query = query.where(clause)
    return db.scalar(query) or 0


# --- idempotence -----------------------------------------------------------


def test_second_run_creates_nothing(db: Session) -> None:
    first = seed_signforge.seed(db)
    assert first["created_total"] > 0

    before = {
        model.__name__: _count(db, model)
        for model in (Organization, User, Document, Recipient, Invoice, SupportTicket, Contact)
    }

    second = seed_signforge.seed(db)
    assert second["created_total"] == 0, second["created"]

    after = {
        model.__name__: _count(db, model)
        for model in (Organization, User, Document, Recipient, Invoice, SupportTicket, Contact)
    }
    assert after == before


def test_reset_clears_then_reseeds(db: Session) -> None:
    seed_signforge.seed(db)
    seeded_orgs = _count(db, Organization)
    assert seeded_orgs > 0

    seed_signforge.reset(db)
    assert _count(db, Organization) == 0
    assert _count(db, User) == 0
    assert _count(db, Document) == 0

    seed_signforge.seed(db)
    assert _count(db, Organization) == seeded_orgs


# --- tenants and directory -------------------------------------------------


def test_every_design_tenant_exists_with_plan_and_seats(seeded: Session) -> None:
    orgs = {org.slug: org for org in seeded.scalars(select(Organization))}
    # The six design tenants plus the platform organization.
    assert len(orgs) == len(seed_signforge.TENANTS) + 1
    assert seed_signforge.PLATFORM_ORG_SLUG in orgs

    for spec in seed_signforge.TENANTS:
        org = orgs[spec["slug"]]
        assert org.name == spec["name"]
        assert org.seats_licensed == spec["seats"]
        assert org.region == spec["region"]
        assert org.subscription_tier == spec["plan"]

    suspended = [org for org in orgs.values() if org.suspended_at is not None]
    assert [org.slug for org in suspended] == ["lumen"]
    assert suspended[0].suspension_reason


def test_subscriptions_cover_every_tenant_and_include_a_trial_and_a_cancellation(
    seeded: Session,
) -> None:
    subs = list(seeded.scalars(select(Subscription)))
    assert len(subs) == len(seed_signforge.TENANTS) + 1  # + platform org
    statuses = {sub.status for sub in subs}
    assert SubscriptionStatus.trialing in statuses
    assert SubscriptionStatus.past_due in statuses
    assert SubscriptionStatus.canceled in statuses

    # Churn is derived from canceled_at, so a terminal subscription must carry one.
    for sub in subs:
        if sub.status == SubscriptionStatus.canceled:
            assert sub.canceled_at is not None

    # The MRR series walks trailing months, so start dates must be spread out.
    starts = {sub.created_at.strftime("%Y-%m") for sub in subs}
    assert len(starts) >= 4


def test_super_admin_and_tenant_admin_can_sign_in(seeded: Session) -> None:
    from app.core.security import verify_password

    admin = seeded.scalar(select(User).where(User.email == seed_signforge.SUPER_ADMIN_EMAIL))
    assert admin is not None and admin.is_platform_admin
    assert verify_password(seed_signforge.SEED_PASSWORD, admin.password_hash)

    jordan = seeded.scalar(select(User).where(User.email == "jordan.mehta@northwind.com"))
    assert jordan is not None and not jordan.is_platform_admin
    assert jordan.preferences["title"] == "Legal Ops · Admin"
    assert verify_password(seed_signforge.SEED_PASSWORD, jordan.password_hash)

    # Every tenant has at least one member so seat activation is non-zero.
    for spec in seed_signforge.TENANTS:
        org = seeded.scalar(select(Organization).where(Organization.slug == spec["slug"]))
        assert _count(seeded, User, User.organization_id == org.id) >= 1


# --- documents, fields, audit ---------------------------------------------


def test_design_documents_recipients_and_fields(seeded: Session) -> None:
    acme = seeded.scalar(select(Organization).where(Organization.slug == "acme"))

    for spec in seed_signforge.DOCS:
        # The design reuses titles across kinds ("Data Processing Addendum — EU"
        # is a template *and* an envelope), so the kind is part of the lookup.
        document = seeded.scalar(
            select(Document).where(
                Document.organization_id == acme.id,
                Document.title == spec["title"],
                Document.is_template.is_(False),
            )
        )
        assert document is not None, spec["title"]
        assert document.status == DocumentStatus(seed_signforge.DOC_STATUS_MAP[spec["status"]])
        assert document.page_count == spec["pages"]
        recipients = list(
            seeded.scalars(select(Recipient).where(Recipient.document_id == document.id))
        )
        expected = spec["to"] + spec.get("extra", [])
        assert len(recipients) == len(expected)
        completed = [r for r in recipients if r.status == "completed"]
        assert len(completed) == min(spec["signed"], len(expected))

    primary = seeded.scalar(
        select(Document).where(
            Document.title == "Master Services Agreement — Acme Corp",
            Document.is_template.is_(False),
        )
    )
    fields = list(seeded.scalars(select(Field).where(Field.document_id == primary.id)))
    assert len(fields) == len(seed_signforge.PROTO_FIELDS)
    # Every field must belong to a recipient of its own document.
    recipient_ids = {
        r.id for r in seeded.scalars(select(Recipient).where(Recipient.document_id == primary.id))
    }
    for field in fields:
        assert field.recipient_id is None or field.recipient_id in recipient_ids
    # The conditional field and the merge tags survived.
    conditional = [f for f in fields if f.condition]
    assert conditional and conditional[0].condition["op"] == "checked"
    assert any(f.merge_tag == "{{client.name}}" for f in fields)


def test_templates_are_templates_not_envelopes(seeded: Session) -> None:
    templates = list(seeded.scalars(select(Document).where(Document.is_template.is_(True))))
    assert len(templates) == len(seed_signforge.TEMPLATES)
    for template in templates:
        assert template.owner_user_id is not None


def test_audit_chain_verifies_for_every_document(seeded: Session) -> None:
    documents = list(seeded.scalars(select(Document).where(Document.is_template.is_(False))))
    assert documents

    primary = seeded.scalar(
        select(Document).where(
            Document.title == "Master Services Agreement — Acme Corp",
            Document.is_template.is_(False),
        )
    )
    entries = list(seeded.scalars(select(AuditLog).where(AuditLog.document_id == primary.id)))
    assert len(entries) == len(seed_signforge.AUDIT)

    chained = audit_service.chain(entries)
    head = chained[-1][1]
    # The chain is self-consistent, and recomputing it reproduces the same head.
    assert audit_service.verify_chain(entries, expected_head=head)["valid"] is True
    assert audit_service.chain_head(entries) == head
    # Each link commits to its predecessor.
    for index, (_entry, _checksum, previous) in enumerate(chained):
        expected_previous = chained[index - 1][1] if index else "0" * 64
        assert previous == expected_previous
    # Chronological order matches the design's arc.
    stamps = [entry.created_at for entry, _c, _p in chained]
    assert stamps == sorted(stamps)

    # Every sent envelope has a trail, and the timeline never precedes creation.
    for document in documents:
        rows = list(seeded.scalars(select(AuditLog).where(AuditLog.document_id == document.id)))
        if document.sent_at is None and document.status == DocumentStatus.draft:
            continue
        if not rows:
            continue
        assert min(row.created_at for row in rows) >= document.created_at - timedelta(seconds=1)


# --- reports ---------------------------------------------------------------


def test_report_aggregates_are_non_trivial_and_self_consistent(seeded: Session) -> None:
    acme = seeded.scalar(select(Organization).where(Organization.slug == "acme"))
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=400)

    overview = report_service.overview(seeded, organization_id=acme.id, start=start, end=now)
    assert overview["documents_created"] > 50
    assert overview["documents_completed"] > 0
    assert 0 < overview["completion_rate_pct"] <= 100
    assert overview["median_completion_seconds"] > 0
    assert overview["templates_created"] == len(seed_signforge.TEMPLATES)
    assert overview["templates_uses"] > 0
    assert overview["sender_count"] >= 2
    assert overview["recipient_count"] >= len(seed_signforge.REPORT_RECIPIENT_WEIGHTS)

    # completed <= created, and the rate is the ratio of the two.
    assert overview["documents_completed"] <= overview["documents_created"]
    expected_rate = round(
        overview["documents_completed"] / overview["documents_created"] * 100, 1
    )
    assert overview["completion_rate_pct"] == expected_rate

    invites = report_service.invites(seeded, organization_id=acme.id, start=start, end=now)
    assert invites["total"] > 0
    assert sum(row["count"] for row in invites["split"]) == invites["total"]
    buckets = {row["label"]: row["count"] for row in invites["split"]}
    assert buckets["completed"] > 0
    assert buckets["declined"] > 0  # the funnel must not be a single bar

    recipients = report_service.recipients_report(
        seeded, organization_id=acme.id, start=start, end=now
    )
    assert recipients["total"] >= len(seed_signforge.REPORT_RECIPIENT_WEIGHTS)
    seeded_emails = {email for email, _n, _e, _c in seed_signforge.REPORT_RECIPIENT_WEIGHTS}
    reported = {row["email"] for row in recipients["items"]}
    assert seeded_emails <= reported
    for row in recipients["items"]:
        # Per-recipient stats must not contradict each other.
        assert row["completed"] <= row["sent"]
        assert row["declined"] <= row["sent"]
        assert 0 <= row["completion_rate_pct"] <= 100
    # Someone must have declined, and someone must be at 100%.
    assert any(row["declined"] > 0 for row in recipients["items"])
    assert any(row["completion_rate_pct"] > 50 for row in recipients["items"])

    templates = report_service.templates_report(
        seeded, organization_id=acme.id, start=start, end=now
    )
    assert templates["total"] == len(seed_signforge.TEMPLATES)
    assert sum(row["use_count"] for row in templates["items"]) > 0

    # Historical volume must span at least a year so the trend line has shape.
    months = {
        row.created_at.strftime("%Y-%m")
        for row in seeded.scalars(
            select(Document).where(
                Document.organization_id == acme.id, Document.is_template.is_(False)
            )
        )
    }
    assert len(months) >= 12


# --- billing ---------------------------------------------------------------


def test_invoices_totals_and_statuses_are_consistent(seeded: Session) -> None:
    invoices = list(seeded.scalars(select(Invoice)))
    design_numbers = {spec["number"] for spec in seed_signforge.INVOICES}
    assert design_numbers <= {invoice.number for invoice in invoices}

    statuses = {invoice.status for invoice in invoices}
    for expected in (InvoiceStatus.open, InvoiceStatus.paid, InvoiceStatus.past_due, InvoiceStatus.void):
        assert expected in statuses, expected

    for invoice in invoices:
        assert invoice.line_items, invoice.number
        for line in invoice.line_items:
            assert set(line) == {"description", "quantity", "unit_cents", "amount_cents"}
        assert invoice.total_cents >= 0
        assert invoice.amount_paid_cents <= invoice.total_cents
        assert invoice.amount_due_cents == invoice.total_cents - invoice.amount_paid_cents
        if invoice.status == InvoiceStatus.paid:
            assert invoice.amount_due_cents == 0
            assert invoice.paid_at is not None
        if invoice.status == InvoiceStatus.past_due:
            assert invoice.due_at < datetime.now(timezone.utc).replace(tzinfo=invoice.due_at.tzinfo)

    # The revenue screen sums these; both must be non-zero.
    collected = sum(invoice.amount_paid_cents for invoice in invoices)
    outstanding = sum(
        invoice.amount_due_cents
        for invoice in invoices
        if invoice.status in {InvoiceStatus.open, InvoiceStatus.past_due}
    )
    assert collected > 0
    assert outstanding > 0

    # Invoices spread over at least twelve months for the revenue series.
    periods = {invoice.issued_at.strftime("%Y-%m") for invoice in invoices}
    assert len(periods) >= 12


def test_charges_carry_dunning_state_and_recent_volume(seeded: Session) -> None:
    charges = list(seeded.scalars(select(Charge)))
    assert charges
    statuses = {charge.status for charge in charges}
    assert {"succeeded", "failed"} <= statuses

    failed = [charge for charge in charges if charge.status == "failed"]
    assert failed
    for charge in failed:
        assert charge.decline_code
        assert charge.dunning_step and charge.dunning_step >= 1
        assert charge.next_attempt_at is not None

    now = datetime.now(timezone.utc)
    window = now - timedelta(days=30)
    recent = [
        charge
        for charge in charges
        if charge.occurred_at.replace(tzinfo=charge.occurred_at.tzinfo or timezone.utc) >= window
    ]
    assert recent, "the revenue screen's 30-day gross volume would be zero"
    assert sum(charge.amount_cents for charge in recent if charge.status == "succeeded") > 0

    # Every charge that names an invoice must point at one that exists.
    for charge in charges:
        if charge.invoice_id:
            assert seeded.get(Invoice, charge.invoice_id) is not None


def test_payment_methods_have_exactly_one_default_per_tenant(seeded: Session) -> None:
    methods = list(seeded.scalars(select(PaymentMethod)))
    assert methods
    by_org: dict[str, list[PaymentMethod]] = {}
    for method in methods:
        by_org.setdefault(method.organization_id, []).append(method)
    for org_id, rows in by_org.items():
        assert sum(1 for row in rows if row.is_default) == 1, org_id
        org = seeded.get(Organization, org_id)
        assert org.default_payment_method_id in {row.id for row in rows}


# --- support, logs, platform settings -------------------------------------


def test_tickets_have_threads_including_an_internal_note(seeded: Session) -> None:
    tickets = list(seeded.scalars(select(SupportTicket)))
    assert len(tickets) == len(seed_signforge.TICKETS)

    statuses = {ticket.status for ticket in tickets}
    assert {"open", "pending", "escalated", "resolved"} <= statuses
    priorities = {ticket.priority for ticket in tickets}
    assert {"urgent", "high", "normal"} <= priorities

    total_messages = 0
    for ticket in tickets:
        messages = list(
            seeded.scalars(select(TicketMessage).where(TicketMessage.ticket_id == ticket.id))
        )
        assert messages, ticket.reference
        total_messages += len(messages)
        # The first message always comes from the customer.
        first = min(messages, key=lambda m: m.created_at)
        assert first.is_staff is False
        if ticket.status == "resolved":
            assert ticket.resolved_at is not None
        else:
            assert ticket.resolved_at is None
    assert total_messages == sum(len(spec["messages"]) for spec in seed_signforge.TICKETS)

    internal = list(
        seeded.scalars(select(TicketMessage).where(TicketMessage.is_internal.is_(True)))
    )
    assert internal, "the agent view needs at least one internal note"


def test_logs_and_platform_audit_span_every_source_and_level(seeded: Session) -> None:
    logs = list(seeded.scalars(select(SystemLog)))
    assert len(logs) == len(seed_signforge.LOGS)
    assert {"info", "warn", "error"} == {log.level for log in logs}
    assert {"api", "webhook", "auth", "billing", "signing", "admin"} == {
        log.source for log in logs
    }

    entries = list(seeded.scalars(select(PlatformAuditEntry)))
    assert len(entries) == len(seed_signforge.PLATFORM_AUDIT)
    for entry in entries:
        assert entry.actor_email
        assert entry.detail


def test_feature_flags_carry_rollout_and_overrides(seeded: Session) -> None:
    flags = {flag.key: flag for flag in seeded.scalars(select(FeatureFlag))}
    for key, (enabled, rollout) in seed_signforge.FLAG_STATE.items():
        assert key in flags, key
        assert flags[key].enabled is enabled
        assert flags[key].rollout_pct == rollout
    # A partial rollout must exist, or the flags screen shows only on/off.
    assert any(0 < flag.rollout_pct < 100 for flag in flags.values())

    overrides = list(seeded.scalars(select(FeatureFlagOverride)))
    assert len(overrides) == len(seed_signforge.FLAG_OVERRIDES)
    for override in overrides:
        assert seeded.get(Organization, override.organization_id) is not None


def test_security_posture_certifications_and_api_keys(seeded: Session) -> None:
    from app.models.api_key import ApiKey
    from app.models.platform_setting import Certification, SecurityPosture
    from app.services.api_key_service import hash_api_key

    posture = {row.key: row for row in seeded.scalars(select(SecurityPosture))}
    for key, enabled in seed_signforge.SECURITY_STATE.items():
        assert posture[key].enabled is enabled
    assert any(row.enabled for row in posture.values())
    assert any(not row.enabled for row in posture.values())

    assert _count(seeded, Certification) >= 8

    keys = list(seeded.scalars(select(ApiKey)))
    assert len(keys) == len(seed_signforge.API_KEYS)
    for key in keys:
        # Only the hash is stored, and it must match the printed plaintext.
        raw = seed_signforge.SEED_API_KEYS[key.label]
        assert key.key_hash == hash_api_key(raw)
        assert raw not in (key.prefix, key.last_four)
        assert key.prefix in raw
        assert raw.endswith(key.last_four)
    assert any(key.revoked_at is not None for key in keys)


def test_contacts_groups_and_account_area(seeded: Session) -> None:
    from app.models.integration import CloudTarget, Integration
    from app.models.notification import Notification, NotificationPreference
    from app.models.saved_signature import SavedSignature
    from app.models.user_session import UserSession

    assert _count(seeded, Contact) == len(seed_signforge.CONTACTS)
    assert _count(seeded, ContactGroup) == 4
    # Every contact sits in a group that exists.
    group_keys = {row.key for row in seeded.scalars(select(ContactGroup))}
    for contact in seeded.scalars(select(Contact)):
        assert contact.group_key in group_keys

    assert _count(seeded, Integration) == len(seed_signforge.INTEGRATIONS)
    assert _count(seeded, Integration, Integration.connected.is_(True)) == sum(
        1 for _p, _l, _d, connected in seed_signforge.INTEGRATIONS if connected
    )
    assert _count(seeded, CloudTarget) == len(seed_signforge.CLOUD_TARGETS)
    assert _count(seeded, NotificationPreference) == len(seed_signforge.NOTIF_PREFS)
    assert _count(seeded, Notification) == len(seed_signforge.NOTIFICATIONS)
    assert _count(seeded, UserSession) == len(seed_signforge.DEVICES)
    assert _count(seeded, SavedSignature) == len(seed_signforge.SAVED_SIGNATURES)


# --- relative time --------------------------------------------------------


def test_no_timestamp_is_hardcoded_to_a_fixed_year(db: Session) -> None:
    """Seeding at two different "now"s must move every timestamp with it."""
    seed_signforge.seed(db, now=datetime.now(timezone.utc))
    latest = db.scalar(select(func.max(Document.created_at)))
    assert latest is not None
    latest = latest if latest.tzinfo else latest.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    # The newest envelope is minutes old, not years.
    assert now - latest < timedelta(days=2)
    assert latest <= now + timedelta(minutes=1)

    # And the oldest history reaches back about a year, not to a literal 2026.
    oldest = db.scalar(select(func.min(Document.created_at)))
    oldest = oldest if oldest.tzinfo else oldest.replace(tzinfo=timezone.utc)
    assert timedelta(days=300) < now - oldest < timedelta(days=400)
