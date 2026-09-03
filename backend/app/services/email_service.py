from app.core.config import get_settings
from app.core.email import EmailMessage, email_service
from app.models.document import Document
from app.models.recipient import Recipient


class SignFlowEmailService:
    def signing_link_for(self, *, token: str) -> str:
        """The URL a signing token resolves to. One definition, two callers."""

        return f"{get_settings().app_base_url.rstrip('/')}/sign/{token}"

    def send_signing_link(self, *, document: Document, recipient: Recipient, token: str, db=None) -> str:
        link = self.signing_link_for(token=token)
        
        org = None
        if db:
            from app.models.organization import Organization
            org = db.get(Organization, document.organization_id)

        email_service.send(
            EmailMessage(
                to_email=recipient.email,
                subject=f"Signature requested: {document.title}",
                body=(
                    f"Hello {recipient.name},\n\n"
                    f"You have been invited to sign \"{document.title}\" in SignFlow CRM.\n"
                    f"Open your secure signing link: {link}\n\n"
                    "This link is unique to you and expires automatically."
                ),
            ),
            organization=org
        )
        return link


signflow_email_service = SignFlowEmailService()

