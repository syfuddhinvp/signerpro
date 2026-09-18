from app.core.config import get_settings
from app.core import email_layout as layout
from app.core.email import EmailMessage, email_service
from app.models.branding_theme import BrandingTheme
from app.models.document import Document
from app.models.recipient import Recipient


#: What an unbranded invitation says. The stock accent lives in the shared
#: layout, so an unbranded tenant inherits the house colour rather than a
#: second copy of it kept in step by hand.
STOCK_HEADLINE = "You were invited to review and sign a document"


class SignFlowEmailService:
    def signing_link_for(self, *, token: str) -> str:
        """The URL a signing token resolves to. One definition, two callers."""

        return f"{get_settings().app_base_url.rstrip('/')}/sign/{token}"

    def invitation_body(
        self,
        *,
        document: Document,
        recipient: Recipient,
        link: str,
        theme: BrandingTheme | None = None,
    ) -> tuple[str, str]:
        """Subject and plain-text body for a signing invitation.

        The theme supplies the tenant's voice -- headline, standing message,
        reply-to address and signature. The document's own ``invite_subject``
        and ``invite_message`` are about *this* envelope, so they win over the
        theme's where both are set, and the theme's message is carried above
        the envelope's rather than being replaced by it.
        """
        headline = (theme.headline if theme else None) or STOCK_HEADLINE
        subject = document.invite_subject or f"Signature requested: {document.title}"

        lines = [f"Hello {recipient.name},", "", headline, ""]
        standing = (theme.message if theme else None)
        if standing:
            lines += [standing.strip(), ""]
        if document.invite_message:
            lines += [document.invite_message.strip(), ""]
        lines += [
            f'You have been invited to sign "{document.title}".',
            f"Open your secure signing link: {link}",
            "",
            "This link is unique to you and expires automatically.",
        ]
        contact = (theme.contact_sender_email if theme else None)
        if contact:
            lines += ["", f"Questions about this document? Reply to {contact}."]
        signature = (theme.footer_signature if theme else None)
        if signature:
            lines += ["", signature.strip()]
        return subject, "\n".join(lines)

    def invitation_html(
        self,
        *,
        document: Document,
        recipient: Recipient,
        link: str,
        theme: BrandingTheme | None = None,
        logo_url: str | None = None,
    ) -> str:
        """The same invitation as HTML, carrying the theme's logo and colours.

        Built from the shared blocks in ``app.core.email_layout`` so that an
        invitation, a password reset and an admin-composed notice arrive
        looking like mail from one company. The wording is assembled in the
        same order as the text part, so the two renderings say the same thing.
        """
        headline = (theme.headline if theme else None) or STOCK_HEADLINE
        # Resolved by the caller when a session is to hand: an uploaded logo
        # lives in our storage and its public URL is not on the row.
        resolved_logo = logo_url if logo_url is not None else (theme.logo_url if theme else None)
        brand = layout.Brand.from_theme(theme, logo_url=resolved_logo)

        parts = [
            layout.eyebrow("Signature requested"),
            layout.heading(headline),
            layout.paragraph(f"Hello {recipient.name},"),
        ]
        standing = (theme.message if theme else None)
        if standing:
            parts.append(layout.paragraphs(standing))
        if document.invite_message:
            parts.append(layout.paragraphs(document.invite_message))
        parts.append(
            layout.details(
                [
                    ("Document", document.title),
                    ("Your role", "Signer"),
                ]
            )
        )
        parts.append(layout.button("Review and sign", link, brand))
        parts.append(layout.fallback_link(link))
        parts.append(
            layout.note("This link is unique to you and expires automatically. Please do not forward it.")
        )

        return layout.shell(
            "".join(parts),
            brand=brand,
            preheader=f'Your signature is requested on "{document.title}".',
        )

    def send_signing_link(self, *, document: Document, recipient: Recipient, token: str, db=None) -> str:
        link = self.signing_link_for(token=token)

        org = None
        theme = None
        if db:
            from app.models.organization import Organization
            from app.services.branding_service import branding_service

            org = db.get(Organization, document.organization_id)
            theme = branding_service.resolve_for_document(db, document=document)

        subject, body = self.invitation_body(
            document=document, recipient=recipient, link=link, theme=theme
        )
        html = self.invitation_html(
            document=document, recipient=recipient, link=link, theme=theme,
            logo_url=branding_service.logo_url_for(theme) if (db and theme) else None,
        )
        email_service.send(
            EmailMessage(
                to_email=recipient.email,
                subject=subject,
                body=body,
                html=html,
                category="invitation",
                document_id=document.id,
            ),
            organization=org,
        )
        return link


signflow_email_service = SignFlowEmailService()
