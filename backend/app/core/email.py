import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dataclasses import dataclass
import httpx
from app.core.config import get_settings


@dataclass(frozen=True)
class EmailMessage:
    to_email: str
    subject: str
    body: str


class EmailService:
    def send(self, message: EmailMessage, *, organization=None) -> None:
        """
        Sends an email. Uses organization-scoped SMTP credentials if configured,
        otherwise falls back to system settings, and finally to console print logs.
        """
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
            try:
                print(f"[Email Gateway] Sending via Resend API to {message.to_email}...")
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
                    print(f"[Email Gateway] Resend email sent successfully! Message ID: {response.json().get('id')}")
                    return
                else:
                    print(f"[Email Gateway Error] Resend responded with status {response.status_code}: {response.text}")
            except Exception as e:
                print(f"[Email Gateway Error] Resend API call failed: {e}")

        # 2. Try SMTP Client (Dynamic tenant or global)
        elif smtp_host:
            try:
                source_label = f"Organization settings ({organization.name})" if organization and organization.smtp_host else "Global settings"
                print(f"[Email Gateway] Sending via SMTP [{source_label}] ({smtp_host}:{smtp_port or 587}) to {message.to_email}...")
                
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
                print(f"[Email Gateway] SMTP email sent successfully to {message.to_email}!")
                return
            except Exception as e:
                print(f"[Email Gateway Error] SMTP delivery failed: {e}")

        # 3. Development Fallback Print Console
        print("\n--- SignFlow CRM development email ---")
        print(f"To: {message.to_email}")
        print(f"Subject: {message.subject}")
        print(message.body)
        print("--- end email ---\n")


email_service = EmailService()
