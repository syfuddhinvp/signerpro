"""Lifecycle event adapter.

This module used to *simulate* a Salesforce-shaped CRM by writing fictional audit
rows ("loan milestone advanced", "realtor pipeline moved"). That hardcoded one
vertical's vocabulary into the core signing engine.

It is now a thin adapter over :mod:`app.services.webhook_service`: it emits
neutral platform events and lets each customer integration map them onto its own
domain. The public method names and signatures are unchanged so existing call
sites in the signing service keep working.
"""

from typing import Any

from sqlalchemy.orm import Session

from app.models.document import Document
from app.models.recipient import Recipient
from app.services.webhook_service import webhook_service


def document_payload(document: Document) -> dict[str, Any]:
    return {
        "id": document.id,
        "title": document.title,
        "status": str(document.status),
        "workflow_type": str(document.workflow_type) if document.workflow_type else None,
        "organization_id": document.organization_id,
        "sender_id": document.sender_id,
        "original_sha256": getattr(document, "original_sha256", None),
        "final_sha256": getattr(document, "final_sha256", None),
        "recipient_count": len(document.recipients or []),
    }


def recipient_payload(recipient: Recipient) -> dict[str, Any]:
    return {
        "id": recipient.id,
        "name": recipient.name,
        "email": recipient.email,
        "role_name": recipient.role_name,
        "signing_order": recipient.signing_order,
        "status": str(recipient.status),
        "completed_at": recipient.completed_at.isoformat() if recipient.completed_at else None,
    }


class CRMIntegrationService:
    """Emits neutral lifecycle events to the organization's webhook endpoints."""

    def trigger_signer_completed(self, db: Session, *, document: Document, recipient: Recipient) -> None:
        """An individual recipient finished signing -> ``recipient.signed``."""
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="recipient.signed",
            document_id=document.id,
            data={"document": document_payload(document), "recipient": recipient_payload(recipient)},
        )

    def trigger_document_completed(self, db: Session, *, document: Document) -> None:
        """All parties signed and the final PDF is sealed -> ``document.completed``."""
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="document.completed",
            document_id=document.id,
            data={
                "document": document_payload(document),
                "recipients": [recipient_payload(item) for item in (document.recipients or [])],
                "final_pdf_url": f"/api/documents/{document.id}/final-pdf",
            },
        )

    def trigger_document_declined(self, db: Session, *, document: Document, recipient: Recipient) -> None:
        """A recipient declined -> ``recipient.declined`` and ``document.declined``."""
        payload = {"document": document_payload(document), "recipient": recipient_payload(recipient)}
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="recipient.declined",
            document_id=document.id,
            data=payload,
        )
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="document.declined",
            document_id=document.id,
            data=payload,
        )

    def trigger_document_created(self, db: Session, *, document: Document) -> None:
        """A draft envelope now exists -> ``document.created``.

        Emitted from every path that produces a real envelope — a blank draft, a
        duplicate, a document made from a template — but never for a template
        itself, which is a reusable definition rather than something anyone
        signs.
        """
        if document.is_template:
            return
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="document.created",
            document_id=document.id,
            data={"document": document_payload(document)},
        )

    def trigger_document_sent(self, db: Session, *, document: Document) -> None:
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="document.sent",
            document_id=document.id,
            data={
                "document": document_payload(document),
                "recipients": [recipient_payload(item) for item in (document.recipients or [])],
            },
        )

    def trigger_document_voided(self, db: Session, *, document: Document, reason: str | None = None) -> None:
        """The sender terminated the envelope -> ``document.voided``."""
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="document.voided",
            document_id=document.id,
            data={"document": document_payload(document), "reason": reason},
        )

    def trigger_document_viewed(self, db: Session, *, document: Document, recipient: Recipient) -> None:
        """A recipient opened the envelope for the first time -> ``document.viewed``."""
        webhook_service.emit(
            db,
            organization_id=document.organization_id,
            event_type="document.viewed",
            document_id=document.id,
            data={"document": document_payload(document), "recipient": recipient_payload(recipient)},
        )

    def trigger_reminders(self, db: Session, *, document: Document) -> None:
        """One ``recipient.reminded`` event per still-pending recipient."""
        for recipient in document.recipients or []:
            if recipient.status not in ("sent", "viewed"):
                continue
            webhook_service.emit(
                db,
                organization_id=document.organization_id,
                event_type="recipient.reminded",
                document_id=document.id,
                data={"document": document_payload(document), "recipient": recipient_payload(recipient)},
            )


crm_integration_service = CRMIntegrationService()
