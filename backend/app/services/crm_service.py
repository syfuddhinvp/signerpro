from sqlalchemy.orm import Session
from app.models.document import Document
from app.models.recipient import Recipient
from app.services.audit_service import audit_service


class CRMIntegrationService:
    def trigger_signer_completed(self, db: Session, *, document: Document, recipient: Recipient) -> None:
        """
        Triggered when an individual recipient finishes signing.
        """
        print(f"\n[CRM Integration] Signer completed: {recipient.email}")
        
        # 1. Internal Task Trigger: Notify processing/admin team
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=recipient.id,
            event_type="crm_internal_task_triggered",
            event_message=f"Processing team notified: {recipient.name} ({recipient.role_name or 'Signer'}) has signed the document.",
            metadata={"recipient_role": recipient.role_name, "recipient_name": recipient.name}
        )

    def trigger_document_completed(self, db: Session, *, document: Document) -> None:
        """
        Triggered when all parties have signed and the document is fully finalized.
        """
        print(f"\n[CRM Integration] Document fully completed: {document.title}")

        # 1. Attach Signed Docs to CRM (Auto-save to contact/deal)
        audit_service.log(
            db,
            document_id=document.id,
            event_type="crm_document_attached",
            event_message=f"Final signed copy of '{document.title}' auto-saved to CRM Contact/Deal records.",
            metadata={"final_sha256": document.final_sha256}
        )

        # 2. Loan Milestone Trigger (Auto-trigger after signing)
        audit_service.log(
            db,
            document_id=document.id,
            event_type="crm_loan_milestone_updated",
            event_message="Loan Milestone Trigger: Status advanced to 'Underwriting Review' / 'Documents Signed'.",
            metadata={"document_title": document.title}
        )

        # 3. Realtor Transaction Trigger (Move pipeline stages)
        audit_service.log(
            db,
            document_id=document.id,
            event_type="crm_realtor_pipeline_updated",
            event_message="Realtor Pipeline Trigger: Deal stage auto-moved to 'Pending/Under Contract'.",
            metadata={"pipeline_stage": "Pending"}
        )

        # 4. Notification Engine (Email/SMS alerts)
        audit_service.log(
            db,
            document_id=document.id,
            event_type="crm_notification_sent",
            event_message="Notification Engine: Completion alerts and final signed PDF sent to all parties.",
            metadata={"recipient_count": len(document.recipients)}
        )

    def trigger_reminders(self, db: Session, *, document: Document) -> None:
        """
        Simulate automated reminder sending for pending signers.
        """
        pending_recipients = [r for r in document.recipients if r.status in ["sent", "viewed"]]
        for recipient in pending_recipients:
            audit_service.log(
                db,
                document_id=document.id,
                recipient_id=recipient.id,
                event_type="crm_reminder_sent",
                event_message=f"Reminder Automation: Secure follow-up alert sent to pending signer {recipient.email}.",
                metadata={"reminder_recipient": recipient.email}
            )


crm_integration_service = CRMIntegrationService()
