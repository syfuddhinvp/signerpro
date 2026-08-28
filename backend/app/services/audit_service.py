from typing import Any, Callable

from sqlalchemy.orm import Session

from app.core.hashing import sha256_json
from app.models.audit_log import AuditLog


#: Classification the audit-trail UI renders as a coloured dot (SIGN-2).
EVENT_KINDS: dict[str, str] = {
    "document_created": "neutral",
    "document_sent": "info",
    "signer_email_sent": "info",
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
}

#: Genesis link of the per-document hash chain (SIGN-2).
CHAIN_GENESIS = "0" * 64


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
        document_id: str,
        event_type: str,
        event_message: str,
        recipient_id: str | None = None,
        user_id: str | None = None,
        ip_address: str | None = None,
        user_agent: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AuditLog:
        audit_log = AuditLog(
            document_id=document_id,
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


    # ---- tamper-evident hash chain (SIGN-2) -------------------------------

    def entry_kind(self, event_type: str) -> str:
        return EVENT_KINDS.get(event_type, "neutral")

    def _canonical(self, entry: AuditLog, previous_checksum: str) -> dict[str, Any]:
        return {
            "previous": previous_checksum,
            "id": entry.id,
            "document_id": entry.document_id,
            "recipient_id": entry.recipient_id,
            "user_id": entry.user_id,
            "event_type": entry.event_type,
            "event_message": entry.event_message,
            "ip_address": entry.ip_address,
            "user_agent": entry.user_agent,
            "metadata": entry.log_metadata,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
        }

    def chain(self, entries: list[AuditLog]) -> list[tuple[AuditLog, str, str]]:
        """Return (entry, checksum, previous_checksum) in chronological order.

        Each checksum covers the entry *and* its predecessor's checksum, so
        editing or removing any row invalidates every checksum after it.
        """
        ordered = sorted(entries, key=lambda item: (item.created_at, item.id))
        previous = CHAIN_GENESIS
        result: list[tuple[AuditLog, str, str]] = []
        for entry in ordered:
            checksum = sha256_json(self._canonical(entry, previous))
            result.append((entry, checksum, previous))
            previous = checksum
        return result

    def chain_head(self, entries: list[AuditLog]) -> str:
        chained = self.chain(entries)
        return chained[-1][1] if chained else CHAIN_GENESIS

    def verify_chain(self, entries: list[AuditLog], *, expected_head: str | None = None) -> dict[str, Any]:
        chained = self.chain(entries)
        head = chained[-1][1] if chained else CHAIN_GENESIS
        return {
            "entry_count": len(chained),
            "chain_head": head,
            "hash_algorithm": "SHA-256",
            "valid": expected_head is None or expected_head == head,
        }


audit_service = AuditService()
