from typing import Any

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog


class AuditService:
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
        return audit_log


audit_service = AuditService()

