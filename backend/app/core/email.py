import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dataclasses import dataclass
import httpx
from app.core.config import get_settings
from app.core.logging import get_logger


logger = get_logger("signflow.email")


@dataclass(frozen=True)
class EmailMessage:
    to_email: str
    subject: str
    body: str


class EmailService:
    def send(self, message: EmailMessage, *, organization=None) -> bool:
        """Send an email. Returns whether it was actually delivered.

        This used to return ``None`` whatever happened: every provider error
        was caught, logged at warning level, and followed by the console
        fallback, so a dead mail provider was indistinguishable from a
        successful send and no caller had anything to check. A signer who
        never received their link or OTP looked exactly like one who did.

        ``True`` means a provider accepted the message, or that no provider is
        configured at all and the console fallback is the intended behaviour in
        development. ``False`` means a provider *was* configured and every
        attempt to reach it failed -- the case a caller must not ignore.
        """
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
                    },
                    timeout=10.0,
                )
                if response.status_code in (200, 201):
                    logger.info(f"[Email Gateway] Resend email sent successfully! Message ID: {response.json().get('id')}")
                    return True
                else:
                    logger.error(f"[Email Gateway Error] Resend responded with status {response.status_code}: {response.text}")
            except Exception as e:
                logger.error(f"[Email Gateway Error] Resend API call failed: {e}")

        # 2. Try SMTP Client (Dynamic tenant or global)
        elif smtp_host:
            configured = True
            try:
                source_label = f"Organization settings ({organization.name})" if organization and organization.smtp_host else "Global settings"
                logger.info(f"[Email Gateway] Sending via SMTP [{source_label}] ({smtp_host}:{smtp_port or 587}) to {message.to_email}...")
                
                mime_msg = MIMEMultipart()
                mime_msg["From"] = smtp_from_email
                mime_msg["To"] = message.to_email
                mime_msg["Subject"] = message.subject
                mime_msg.attach(MIMEText(message.body, "plain"))

                port = smtp_port or 587
                with smtplib.SMTP(smtp_host, port, timeout=10.0) as server:
                    if smtp_username and smtp_password:
                        server.starttls()
                        server.login(smtp_username, smtp_password)
                    server.send_message(mime_msg)
                logger.info(f"[Email Gateway] SMTP email sent successfully to {message.to_email}!")
                return True
            except Exception as e:
                logger.error(f"[Email Gateway Error] SMTP delivery failed: {e}")

        # 3. Development Fallback Print Console
        print("\n--- SignFlow CRM development email ---")
        print(f"To: {message.to_email}")
        print(f"Subject: {message.subject}")
        print(message.body)
        print("--- end email ---\n")
        # Only a truthful "delivered" when there was nothing to deliver through.
        return not configured


email_service = EmailService()
