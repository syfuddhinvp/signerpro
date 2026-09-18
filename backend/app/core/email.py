import base64
import re
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dataclasses import dataclass
import httpx
from app.core.config import get_settings
from app.core.logging import get_logger


logger = get_logger("signflow.email")

#: Everything in an outbound message that is a bearer credential rather than
#: prose. Each of these grants whoever holds it the ability to act as the
#: recipient -- sign their envelope, accept their invitation, reset their
#: password -- so the outbox stores them masked. The surrounding markup and
#: wording survive, which is what makes the stored copy worth previewing.
_SECRET_PATTERNS = (
    # /sign/<token>, /invite/<token>, /accept-invite/<token>
    re.compile(r"(/(?:sign|invite|accept-invite)/)[A-Za-z0-9_\-.]{8,}"),
    # ?token=… / &token=… / ?code=…
    re.compile(r"([?&](?:token|code|key)=)[A-Za-z0-9_\-.%]{8,}"),
)

#: What a masked secret is replaced with. Deliberately visible: a reader of the
#: outbox should see that something was removed, not a plausible-looking link.
REDACTED = "[redacted]"


def redact_secrets(text: str | None) -> str | None:
    """Mask bearer links in a message body before it is stored.

    Applied to both the text and HTML parts of every logged message. It is a
    one-way transform on the *stored copy* only -- the message that goes to the
    provider is untouched, so the recipient still receives a working link.
    """
    if not text:
        return text
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub(lambda m: m.group(1) + REDACTED, text)
    return text


@dataclass(frozen=True)
class EmailAttachment:
    """One file travelling with a message.

    ``content`` is the decoded bytes, not base64: the wire format belongs to
    whoever carried it here, and each provider below re-encodes for itself.
    """

    filename: str
    content_type: str
    content: bytes


@dataclass(frozen=True)
class EmailMessage:
    to_email: str
    subject: str
    body: str
    #: Optional HTML alternative. When set, the message goes out as
    #: multipart/alternative with ``body`` as the plain-text part -- the text
    #: part is never dropped, so a client that refuses HTML (or a screen
    #: reader working from the text part) still gets the whole invitation.
    html: str | None = None
    #: What this message is about, for the platform outbox's filter facets.
    #: One of ``app.models.email_log.CATEGORIES``.
    category: str = "system"
    #: The envelope this message is about, when there is one.
    document_id: str | None = None
    #: Set for a message whose whole body is a secret -- a one-time passcode is
    #: the code, so masking links inside it would leave the code itself. Such a
    #: message is logged with its subject and recipient but no body at all.
    body_is_secret: bool = False
    #: Visible carbon copies. Every recipient sees these addresses.
    cc: tuple[str, ...] = ()
    #: Blind copies. Delivered to, but never named in, the headers -- which is
    #: the whole point, so they are kept out of the MIME message and added to
    #: the SMTP envelope only.
    bcc: tuple[str, ...] = ()
    attachments: tuple[EmailAttachment, ...] = ()


class EmailService:
    def send(
        self,
        message: EmailMessage,
        *,
        organization=None,
        sent_by_user_id: str | None = None,
    ) -> bool:
        """Send an email, record it in the outbox, and say whether it left.

        ``send`` used to return ``None`` whatever happened: every provider error
        was caught, logged at warning level, and followed by the console
        fallback, so a dead mail provider was indistinguishable from a
        successful send and no caller had anything to check. A signer who
        never received their link or OTP looked exactly like one who did.

        ``True`` means a provider accepted the message, or that no provider is
        configured at all and the console fallback is the intended behaviour in
        development. ``False`` means a provider *was* configured and every
        attempt to reach it failed -- the case a caller must not ignore.

        The outbox row is written here rather than by the callers: a send path
        that forgets to log is a message missing from the outbox, and a missing
        message is exactly what nobody can notice by reading the outbox.
        """
        outcome = self._deliver(message, organization)
        self._record(message, organization, outcome, sent_by_user_id)
        return outcome.delivered

    # -- delivery ---------------------------------------------------------

    def _deliver(self, message: EmailMessage, organization) -> "SendOutcome":
        # Sandbox organizations never emit outbound mail (API-11). The check
        # lives here rather than in each caller so that a new send path cannot
        # forget it -- a sandbox that delivers real email to a real signer is
        # the one failure this feature must not have.
        if organization is not None and getattr(organization, "is_sandbox", False):
            logger.info(
                "sandbox.email.suppressed",
                extra={"to_email": message.to_email, "subject": message.subject},
            )
            return SendOutcome(True, "suppressed", "none", None, None)

        configured = False
        settings = get_settings()

        # Read configurations, prioritizing organization-scoped SMTP settings
        smtp_host = organization.smtp_host if (organization and organization.smtp_host) else settings.smtp_host
        smtp_port = organization.smtp_port if (organization and organization.smtp_port) else settings.smtp_port
        smtp_username = organization.smtp_username if (organization and organization.smtp_username) else settings.smtp_username
        smtp_password = organization.smtp_password if (organization and organization.smtp_password) else settings.smtp_password
        smtp_from_email = organization.smtp_from_email if (organization and organization.smtp_from_email) else settings.smtp_from_email

        # Global-only Resend config
        resend_api_key = settings.resend_api_key
        error: str | None = None

        # 1. Try Resend HTTP API (if enabled globally)
        if resend_api_key and not (organization and organization.smtp_host):
            configured = True
            try:
                logger.info(f"[Email Gateway] Sending via Resend API to {message.to_email}...")
                response = httpx.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {resend_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from": smtp_from_email,
                        "to": message.to_email,
                        "subject": message.subject,
                        "text": message.body,
                        **({"html": message.html} if message.html else {}),
                        **({"cc": list(message.cc)} if message.cc else {}),
                        **({"bcc": list(message.bcc)} if message.bcc else {}),
                        **(
                            {
                                "attachments": [
                                    {
                                        "filename": a.filename,
                                        "content": base64.b64encode(a.content).decode("ascii"),
                                        "content_type": a.content_type,
                                    }
                                    for a in message.attachments
                                ]
                            }
                            if message.attachments
                            else {}
                        ),
                    },
                    timeout=10.0,
                )
                if response.status_code in (200, 201):
                    logger.info(f"[Email Gateway] Resend email sent successfully! Message ID: {response.json().get('id')}")
                    return SendOutcome(True, "sent", "resend", None, smtp_from_email)
                error = f"Resend responded with status {response.status_code}: {response.text}"
                logger.error(f"[Email Gateway Error] {error}")
            except Exception as e:
                error = f"Resend API call failed: {e}"
                logger.error(f"[Email Gateway Error] {error}")

        # 2. Try SMTP Client (Dynamic tenant or global)
        elif smtp_host:
            configured = True
            try:
                source_label = f"Organization settings ({organization.name})" if organization and organization.smtp_host else "Global settings"
                logger.info(f"[Email Gateway] Sending via SMTP [{source_label}] ({smtp_host}:{smtp_port or 587}) to {message.to_email}...")

                # "alternative" rather than the default "mixed": the two parts
                # are the same message in two renderings, and the client picks
                # one. As "mixed" a client shows them as two attachments, which
                # is how a branded invitation arrives twice.
                # With files to carry, the root is "mixed" and the two
                # renderings of the body become one "alternative" part inside
                # it: an attachment hung off an "alternative" root would be
                # offered to the client as a *third* rendering of the message.
                body_part: MIMEMultipart | MIMEText
                if message.html:
                    body_part = MIMEMultipart("alternative")
                    # Least-preferred part first: RFC 2046 says the last part
                    # is the one a client should prefer, so the HTML follows.
                    body_part.attach(MIMEText(message.body, "plain"))
                    body_part.attach(MIMEText(message.html, "html"))
                else:
                    body_part = MIMEText(message.body, "plain")

                if message.attachments:
                    mime_msg = MIMEMultipart("mixed")
                    mime_msg.attach(body_part)
                    for attachment in message.attachments:
                        subtype = (attachment.content_type.split("/", 1) + ["octet-stream"])[1]
                        part = MIMEApplication(attachment.content, _subtype=subtype)
                        part.add_header(
                            "Content-Disposition", "attachment", filename=attachment.filename
                        )
                        mime_msg.attach(part)
                elif isinstance(body_part, MIMEMultipart):
                    mime_msg = body_part
                else:
                    mime_msg = MIMEMultipart("mixed")
                    mime_msg.attach(body_part)

                mime_msg["From"] = smtp_from_email
                mime_msg["To"] = message.to_email
                if message.cc:
                    mime_msg["Cc"] = ", ".join(message.cc)
                mime_msg["Subject"] = message.subject

                port = smtp_port or 587
                with smtplib.SMTP(smtp_host, port, timeout=10.0) as server:
                    if smtp_username and smtp_password:
                        server.starttls()
                        server.login(smtp_username, smtp_password)
                    # Bcc addresses ride the envelope only: `send_message`
                    # would otherwise take the recipients from the headers,
                    # where a blind copy by definition does not appear.
                    server.send_message(
                        mime_msg,
                        to_addrs=[message.to_email, *message.cc, *message.bcc],
                    )
                logger.info(f"[Email Gateway] SMTP email sent successfully to {message.to_email}!")
                return SendOutcome(True, "sent", "smtp", None, smtp_from_email)
            except Exception as e:
                error = f"SMTP delivery failed: {e}"
                logger.error(f"[Email Gateway Error] {error}")

        # 3. Development Fallback Print Console
        print("\n--- SignFlow CRM development email ---")
        print(f"To: {message.to_email}")
        if message.cc:
            print(f"Cc: {', '.join(message.cc)}")
        if message.bcc:
            print(f"Bcc: {', '.join(message.bcc)}")
        print(f"Subject: {message.subject}")
        for attachment in message.attachments:
            print(f"Attachment: {attachment.filename} ({len(attachment.content)} bytes)")
        print(message.body)
        print("--- end email ---\n")
        # Only a truthful "delivered" when there was nothing to deliver through.
        if configured:
            return SendOutcome(False, "failed", "none", error, smtp_from_email)
        return SendOutcome(True, "sent", "console", None, smtp_from_email)

    # -- the outbox -------------------------------------------------------

    def _record(
        self,
        message: EmailMessage,
        organization,
        outcome: "SendOutcome",
        sent_by_user_id: str | None,
    ) -> None:
        """Write one row of the platform outbox.

        Written through ``background_session`` rather than a caller-supplied
        session: most send paths are services that hold no session of their
        own, and that helper honours a ``get_db`` override so the suite's
        in-memory engine sees these rows too.

        Nothing here may propagate. A message that was accepted by a provider
        but could not be written to the outbox is still a delivered message,
        and turning that into a 500 would make the logging worse than no
        logging at all.
        """
        try:
            # Imported here, not at module scope: `app.core.email` is imported
            # by services that the model layer itself imports, and a top-level
            # model import closes that cycle.
            from app.core.database import background_session
            from app.models.email_log import EmailLog

            body_text = None if message.body_is_secret else redact_secrets(message.body)
            body_html = None if message.body_is_secret else redact_secrets(message.html)

            with background_session() as session:
                session.add(
                    EmailLog(
                        organization_id=getattr(organization, "id", None),
                        to_email=message.to_email[:320],
                        from_email=(outcome.from_email or None),
                        subject=message.subject[:512],
                        body_text=body_text,
                        body_html=body_html,
                        category=message.category,
                        status=outcome.status,
                        provider=outcome.provider,
                        error=outcome.error[:1024] if outcome.error else None,
                        document_id=message.document_id,
                        sent_by_user_id=sent_by_user_id,
                    )
                )
                session.commit()
        except Exception as exc:  # noqa: BLE001 - see the docstring
            logger.warning("email.outbox.record_failed", extra={"error": str(exc)})


@dataclass(frozen=True)
class SendOutcome:
    """What one delivery attempt did, in the terms the outbox records."""

    delivered: bool
    #: One of ``app.models.email_log.STATUSES``.
    status: str
    #: resend | smtp | console | none
    provider: str
    error: str | None
    from_email: str | None


email_service = EmailService()
