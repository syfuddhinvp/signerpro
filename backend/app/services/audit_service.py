from __future__ import annotations

import logging
from datetime import timezone
from typing import Any, Callable

from sqlalchemy import event, select
from sqlalchemy.orm import Session

from app.core.hashing import sha256_json
from app.core.logging import get_impersonation
from app.models.audit_log import AuditLog
from app.models.mixins import now_utc

logger = logging.getLogger(__name__)


#: Classification the audit-trail UI renders as a coloured dot (SIGN-2).
EVENT_KINDS: dict[str, str] = {
    "document_created": "neutral",
    "document_sent": "info",
    "signer_email_sent": "info",
    "signing_link_issued": "info",
    "document_viewed": "info",
    "consent_accepted": "good",
    "signer_otp_sent": "info",
    "signer_otp_verified": "good",
    "signer_otp_locked": "bad",
    "field_completed": "neutral",
    "signature_added": "good",
    "recipient_completed": "good",
    "document_completed": "good",
    "document_declined": "bad",
    "document_voided": "bad",
    "document_expired": "bad",
    "recipient_reassigned": "info",
    "document_purged": "bad",
    "original_hash_mismatch": "bad",
    # PAY-1/PAY-2. Money moving is the most consequential thing that happens
    # to an envelope after a signature, so it belongs in the chained trail
    # rather than only in the mutable `signer_payments` table. Before these
    # existed the certificate of completion printed "Paid" against a figure
    # no chained entry supported -- a financial claim that chain verification
    # did not cover.
    "payment_request_synced": "info",
    "signer_payment_started": "info",
    "signer_payment_succeeded": "good",
    "signer_payment_failed": "bad",
    "signer_payment_refunded": "bad",
    "payment_receipt_issued": "good",
}

#: Genesis link of the per-document hash chain (SIGN-2).
CHAIN_GENESIS = "0" * 64

#: Events a dispute turns on. Omitting IP/user-agent on these is a defect, so
#: :meth:`AuditService.log` refuses to *silently* accept the omission: callers
#: must pass the values (or pass ``None`` explicitly to state that they are
#: genuinely unavailable, e.g. a scheduler with no HTTP request).
IDENTITY_EVENTS: frozenset[str] = frozenset(
    {
        "signer_otp_sent",
        "signer_otp_verified",
        "signer_otp_locked",
        "signer_email_sent",
        "consent_accepted",
        "signature_added",
        "recipient_completed",
        "document_declined",
        # A settlement is identity evidence, not just bookkeeping: a
        # chargeback turns on being able to show who authorised the charge,
        # from where, on what device. Stripe's own webhook cannot supply any
        # of that (the request comes from Stripe's servers), so the signer's
        # own poll of `/payments/{field_id}/refresh` is the only path that
        # can -- and if settlement arrives by webhook first, this frozenset
        # is what stamps ``attribution: not_captured`` into the hash-covered
        # metadata rather than leaving the omission invisible.
        "signer_payment_succeeded",
    }
)


def _stamp(value) -> str | None:
    """Timezone-stable timestamp for hashing.

    Backends differ on whether a ``DateTime(timezone=True)`` column round-trips
    as aware (PostgreSQL) or naive (SQLite). Normalising to naive UTC keeps a
    checksum computed at append time reproducible at verification time.
    """

    if value is None:
        return None
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return value.isoformat()


class _Unset:
    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return "<unset>"


#: Distinguishes "the caller forgot" from "the caller knows there is none".
UNSET = _Unset()


AuditSubscriber = Callable[[Session, AuditLog], None]


class AuditService:
    def __init__(self) -> None:
        # Additive, opt-in hook. Anything registered here is invoked after the
        # AuditLog row is added to the session. Subscribers must never raise —
        # any exception is swallowed so audit logging (and the transaction it
        # belongs to) can never be broken by a listener.
        self._subscribers: list[AuditSubscriber] = []

    def subscribe(self, subscriber: AuditSubscriber) -> AuditSubscriber:
        """Register a listener invoked for every audit event that is logged."""
        self._subscribers.append(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: AuditSubscriber) -> None:
        if subscriber in self._subscribers:
            self._subscribers.remove(subscriber)

    def log(
        self,
        db: Session,
        *,
        document_id: str | None,
        event_type: str,
        event_message: str,
        recipient_id: str | None = None,
        user_id: str | None = None,
        ip_address: str | None | _Unset = UNSET,
        user_agent: str | None | _Unset = UNSET,
        metadata: dict[str, Any] | None = None,
        document_ref: str | None = None,
    ) -> AuditLog:
        metadata = self._stamp_impersonation(db, metadata)
        metadata, ip_address, user_agent = self._resolve_attribution(
            event_type=event_type,
            metadata=metadata,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        audit_log = AuditLog(
            document_id=document_id,
            document_ref=document_ref or document_id,
            recipient_id=recipient_id,
            user_id=user_id,
            event_type=event_type,
            event_message=event_message,
            ip_address=ip_address,
            user_agent=user_agent,
            log_metadata=metadata,
        )
        db.add(audit_log)
        for subscriber in list(self._subscribers):
            try:
                subscriber(db, audit_log)
            except Exception:
                pass
        return audit_log

    @staticmethod
    def _stamp_impersonation(db: Session, metadata: dict[str, Any] | None) -> dict[str, Any] | None:
        """Attribute an impersonated action to the platform admin who took it.

        The row's ``user_id`` is necessarily the tenant user the token acts as,
        so without this a tenant auditing a breach would conclude their own
        administrator did it. The attribution goes into the hash-covered
        metadata rather than a new column, so it is tamper-evident too.
        """
        context = get_impersonation()
        if not context:
            return metadata

        resolved = context.get("resolved")
        if resolved is None:
            from app.models.impersonation import ImpersonationSession
            from app.models.user import User

            admin = db.get(User, context["admin_user_id"]) if context.get("admin_user_id") else None
            session = db.scalar(
                select(ImpersonationSession).where(
                    ImpersonationSession.token_hash == context.get("token_hash")
                )
            )
            resolved = {
                "admin_user_id": context.get("admin_user_id"),
                "admin_email": admin.email if admin else None,
                "session_id": session.id if session else None,
                "justification": session.justification if session else None,
            }
            # Cached on the request-scoped dict: one lookup per request, not
            # one per audit row.
            context["resolved"] = resolved

        metadata = dict(metadata or {})
        metadata["impersonation"] = resolved
        return metadata

    def _resolve_attribution(
        self,
        *,
        event_type: str,
        metadata: dict[str, Any] | None,
        ip_address: str | None | _Unset,
        user_agent: str | None | _Unset,
    ) -> tuple[dict[str, Any] | None, str | None, str | None]:
        """Flag identity-verification events logged without IP/user-agent.

        Raising here would break unrelated call sites mid-transaction, which is
        the one thing audit logging must never do. Instead the omission is made
        *visible*: it is warned about and stamped into the (hash-covered)
        metadata, so a trail with unattributed OTP events cannot be presented
        as if attribution had been captured.
        """

        omitted = isinstance(ip_address, _Unset) and isinstance(user_agent, _Unset)
        ip = None if isinstance(ip_address, _Unset) else ip_address
        ua = None if isinstance(user_agent, _Unset) else user_agent
        if omitted and event_type in IDENTITY_EVENTS:
            logger.warning(
                "audit.attribution_omitted",
                extra={"event_type": event_type},
            )
            metadata = dict(metadata or {})
            metadata["attribution"] = "not_captured"
        return metadata, ip, ua

    # ---- tamper-evident hash chain (SIGN-2) -------------------------------

    def entry_kind(self, event_type: str) -> str:
        return EVENT_KINDS.get(event_type, "neutral")

    def _canonical(self, entry: AuditLog, previous_checksum: str) -> dict[str, Any]:
        # The ``*_ref`` columns (immutable) rather than the FK columns (nulled
        # when the referenced row is purged) so the chain survives deletion.
        return {
            "previous": previous_checksum,
            "sequence": entry.sequence,
            "id": entry.id,
            "document_id": entry.document_ref,
            "recipient_id": entry.recipient_ref,
            "user_id": entry.user_ref,
            "event_type": entry.event_type,
            "event_message": entry.event_message,
            "ip_address": entry.ip_address,
            "user_agent": entry.user_agent,
            "metadata": entry.log_metadata,
            "created_at": _stamp(entry.created_at),
        }

    def compute_checksum(self, entry: AuditLog, previous_checksum: str) -> str:
        return sha256_json(self._canonical(entry, previous_checksum))

    def _ordered(self, entries: list[AuditLog]) -> list[AuditLog]:
        return sorted(
            entries,
            key=lambda item: (
                item.sequence if item.sequence is not None else 0,
                item.created_at,
                item.id,
            ),
        )

    def chain(self, entries: list[AuditLog]) -> list[tuple[AuditLog, str, str]]:
        """Return (entry, checksum, previous_checksum) in chronological order.

        The checksums returned are the ones **persisted at append time**, not
        values re-derived from the (mutable) row contents — that is what makes
        the trail tamper-*evident*. Use :meth:`verify_chain` to compare the
        stored values against a recomputation.
        """

        result: list[tuple[AuditLog, str, str]] = []
        for entry in self._ordered(entries):
            result.append(
                (
                    entry,
                    entry.checksum or CHAIN_GENESIS,
                    entry.previous_checksum or CHAIN_GENESIS,
                )
            )
        return result

    def chain_head(self, entries: list[AuditLog]) -> str:
        chained = self.chain(entries)
        return chained[-1][1] if chained else CHAIN_GENESIS

    def verify_chain(
        self,
        entries: list[AuditLog],
        *,
        expected_head: str | None = None,
        expected_count: int | None = None,
    ) -> dict[str, Any]:
        """Recompute the chain and compare it against the stored checksums.

        Detects, and reports the position of:

        * a **modified** row — recomputed checksum != stored checksum;
        * a **deleted or reordered** row — stored ``previous_checksum`` does
          not equal the predecessor's stored ``checksum``, or ``sequence`` is
          not contiguous from zero;
        * a **truncated** trail — the stored head/count no longer match the
          anchor held on the document row (``expected_head``/``expected_count``);
        * an **inserted** row — it cannot carry a valid predecessor link.
        """

        ordered = self._ordered(entries)
        head = ordered[-1].checksum if ordered else CHAIN_GENESIS
        broken_at_index: int | None = None
        broken_at_entry_id: str | None = None
        reason: str | None = None

        previous = CHAIN_GENESIS
        for index, entry in enumerate(ordered):
            if entry.checksum is None or entry.previous_checksum is None:
                broken_at_index, broken_at_entry_id = index, entry.id
                reason = "entry has no stored checksum"
                break
            if entry.sequence != index:
                broken_at_index, broken_at_entry_id = index, entry.id
                reason = f"sequence gap: expected {index}, stored {entry.sequence}"
                break
            if entry.previous_checksum != previous:
                broken_at_index, broken_at_entry_id = index, entry.id
                reason = "previous_checksum does not match the preceding entry"
                break
            recomputed = self.compute_checksum(entry, entry.previous_checksum)
            if recomputed != entry.checksum:
                broken_at_index, broken_at_entry_id = index, entry.id
                reason = "entry contents do not match its stored checksum"
                break
            previous = entry.checksum

        if reason is None and expected_count is not None and expected_count != len(ordered):
            reason = f"entry count {len(ordered)} does not match the sealed count {expected_count}"
        if reason is None and expected_head is not None and expected_head != (head or CHAIN_GENESIS):
            reason = "chain head does not match the expected head"

        return {
            "entry_count": len(ordered),
            "chain_head": head or CHAIN_GENESIS,
            "hash_algorithm": "SHA-256",
            "valid": reason is None,
            "broken_at_index": broken_at_index,
            "broken_at_entry_id": broken_at_entry_id,
            "reason": reason,
        }

    def verify_for_document(self, db: Session, document) -> dict[str, Any]:
        """Verify a document's trail against the anchor stored on the document."""

        entries = list(
            db.scalars(select(AuditLog).where(AuditLog.document_ref == document.id))
        )
        return self.verify_chain(
            entries,
            expected_head=document.audit_chain_head,
            expected_count=document.audit_entry_count,
        )

    # ---- retention -------------------------------------------------------

    def detach_document(self, db: Session, document) -> None:
        """Sever a document from its audit trail so the trail survives purge.

        ESIGN/UETA and eIDAS require the evidentiary record to be retained
        independently of the document itself. The FK is nulled (the referenced
        row is about to disappear) while ``document_ref``, ``document_title``
        and ``organization_id`` — denormalized onto every row at append time —
        keep the orphaned trail identifiable and queryable.
        """

        self.log(
            db,
            document_id=None,
            document_ref=document.id,
            event_type="document_purged",
            event_message=f"Document '{document.title}' was permanently purged. Audit trail retained.",
            ip_address=None,
            user_agent=None,
            metadata={"document_id": document.id, "title": document.title},
        )
        db.flush()
        for entry in db.scalars(select(AuditLog).where(AuditLog.document_ref == document.id)):
            entry.document_id = None
        db.flush()


audit_service = AuditService()


# ---- append-time chaining -------------------------------------------------
#
# Registered on Session rather than on AuditService.log because audit rows are
# also constructed directly (e.g. expiry_service, the seed script). Every path
# that inserts an AuditLog gets a persisted, linked checksum.


def _chain_pending(session: Session) -> None:
    from app.models.document import Document

    pending = [obj for obj in session.new if isinstance(obj, AuditLog)]
    if not pending:
        return

    by_document: dict[str | None, list[AuditLog]] = {}
    for entry in pending:
        if entry.id is None:
            from app.models.mixins import uuid_str

            entry.id = uuid_str()
        if entry.created_at is None:
            entry.created_at = now_utc()
        if entry.document_ref is None:
            entry.document_ref = entry.document_id
        if entry.recipient_ref is None:
            entry.recipient_ref = entry.recipient_id
        if entry.user_ref is None:
            entry.user_ref = entry.user_id
        by_document.setdefault(entry.document_ref, []).append(entry)

    for document_ref, rows in by_document.items():
        document = session.get(Document, document_ref) if document_ref else None
        if document is not None:
            for row in rows:
                if row.document_title is None:
                    row.document_title = document.title
                if row.organization_id is None:
                    row.organization_id = document.organization_id

        last = None
        if document_ref is not None:
            last = session.scalars(
                select(AuditLog)
                .where(AuditLog.document_ref == document_ref)
                .order_by(AuditLog.sequence.desc())
                .limit(1)
            ).first()
        previous = last.checksum if last is not None and last.checksum else CHAIN_GENESIS
        sequence = (last.sequence + 1) if last is not None and last.sequence is not None else 0

        for entry in sorted(rows, key=lambda item: (item.created_at, item.id)):
            entry.sequence = sequence
            entry.previous_checksum = previous
            entry.checksum = audit_service.compute_checksum(entry, previous)
            previous = entry.checksum
            sequence += 1

        if document is not None:
            # Anchor: without it, truncating the tail of the trail would leave
            # a self-consistent (but incomplete) chain.
            document.audit_chain_head = previous
            document.audit_entry_count = sequence


@event.listens_for(Session, "before_flush")
def _audit_before_flush(session: Session, flush_context, instances) -> None:  # noqa: ARG001
    _chain_pending(session)
