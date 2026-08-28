from typing import Any, Callable

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


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


audit_service = AuditService()
