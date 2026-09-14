from html import escape

from app.core.config import get_settings
from app.core.email import EmailMessage, email_service
from app.models.branding_theme import BrandingTheme
from app.models.document import Document
from app.models.recipient import Recipient


#: What an unbranded invitation says and looks like. The stock button colour
#: matches the app's own accent so an unbranded tenant still looks deliberate.
STOCK_HEADLINE = "You were invited to review and sign a document"
STOCK_BUTTON = "#4f46e5"
STOCK_BUTTON_TEXT = "#ffffff"

#: `logo_position` -> the CSS the email table cell needs. Kept to inline styles
#: and a table because that is the subset of HTML mail clients agree on.
_LOGO_ALIGN = {"left": "left", "center": "center", "right": "right"}


def _paragraph(text: str, *, color: str = "#334155", size: str = "14px") -> str:
    """One escaped paragraph, with newlines kept as line breaks.

    Everything passed here is tenant-authored (a theme's message, a sender's
    invite message) or recipient-authored (a name), so it is escaped before it
    reaches the markup -- an apostrophe in a company name must not be able to
    close an attribute, and a sender must not be able to inject markup into a
    recipient's mail client.
    """
    safe = escape(text.strip()).replace("\n", "<br />")
    return (
        f'<p style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;'
        f'font-size:{size};line-height:1.6;color:{color};">{safe}</p>'
    )


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

        Deliberately a single centred table of inline styles: mail clients strip
        stylesheets, ignore flexbox and disagree about almost everything else.
        The wording is assembled in the same order as the text part, so the two
        renderings of the message say the same thing.
        """
        headline = (theme.headline if theme else None) or STOCK_HEADLINE
        button = (theme.primary_color if theme else None) or STOCK_BUTTON
        button_text = (theme.primary_text_color if theme else None) or STOCK_BUTTON_TEXT
        # Resolved by the caller when a session is to hand: an uploaded logo
        # lives in our storage and its public URL is not on the row.
        logo_url = logo_url if logo_url is not None else (theme.logo_url if theme else None)
        align = _LOGO_ALIGN.get(theme.logo_position if theme else "left", "left")

        parts: list[str] = []
        if logo_url:
            # `alt` is empty on purpose: the logo is decoration beside the
            # headline, which already says what the message is. A screen reader
            # announcing the company name twice is noise.
            parts.append(
                f'<div style="text-align:{align};margin:0 0 18px;">'
                f'<img src="{escape(logo_url, quote=True)}" alt="" '
                f'style="max-height:40px;max-width:180px;border:0;" /></div>'
            )
        parts.append(_paragraph(f"Hello {recipient.name},"))
        parts.append(
            f'<h1 style="margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;'
            f'font-size:18px;line-height:1.45;color:#0f172a;">{escape(headline)}</h1>'
        )
        standing = (theme.message if theme else None)
        if standing:
            parts.append(_paragraph(standing))
        if document.invite_message:
            parts.append(_paragraph(document.invite_message))
        parts.append(_paragraph(f'You have been invited to sign "{document.title}".'))
        parts.append(
            f'<p style="margin:0 0 18px;"><a href="{escape(link, quote=True)}" '
            f'style="display:inline-block;padding:11px 20px;border-radius:8px;'
            f'background:{escape(button, quote=True)};color:{escape(button_text, quote=True)};'
            f'font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;'
            f'text-decoration:none;">Review and sign</a></p>'
        )
        parts.append(
            _paragraph("This link is unique to you and expires automatically.", color="#5b6675", size="12px")
        )
        contact = (theme.contact_sender_email if theme else None)
        if contact:
            parts.append(
                _paragraph(
                    f"Questions about this document? Reply to {contact}.",
                    color="#5b6675",
                    size="12px",
                )
            )
        signature = (theme.footer_signature if theme else None)
        if signature:
            parts.append(
                '<hr style="border:0;border-top:1px solid #e3e7ee;margin:18px 0 14px;" />'
                + _paragraph(signature, color="#5b6675", size="12px")
            )

        inner = "".join(parts)
        return (
            '<!doctype html><html><body style="margin:0;padding:0;background:#f5f6f8;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="background:#f5f6f8;padding:24px 12px;"><tr><td align="center">'
            '<table role="presentation" width="560" cellpadding="0" cellspacing="0" '
            'style="width:560px;max-width:100%;background:#ffffff;border-radius:14px;'
            'border:1px solid #e3e7ee;"><tr><td style="padding:26px 24px;">'
            f"{inner}"
            "</td></tr></table></td></tr></table></body></html>"
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
