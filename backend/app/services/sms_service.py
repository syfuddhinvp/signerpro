import httpx
from app.core.config import get_settings
from app.core.logging import get_logger


logger = get_logger("signflow.sms")


class SmsService:
    def send_sms(self, *, to_phone: str, body: str, organization=None) -> bool:
        """Send an SMS. Returns whether it was actually delivered.

        Same contract as ``EmailService.send``, and it had the same defect: a
        provider that was down was swallowed into a warning and the console
        fallback, so an undelivered OTP was silent. ``True`` means a provider
        took it, or none is configured and the console fallback is intended.
        ``False`` means a configured provider failed.
        """
        configured = False
        settings = get_settings()

        # 1. Resolve Provider and Credentials
        provider = organization.sms_provider if (organization and organization.sms_provider) else "twilio"
        
        # Twilio credentials
        twilio_sid = organization.twilio_account_sid if (organization and organization.twilio_account_sid) else settings.twilio_account_sid
        twilio_token = organization.twilio_auth_token if (organization and organization.twilio_auth_token) else settings.twilio_auth_token
        twilio_from = organization.twilio_from_number if (organization and organization.twilio_from_number) else settings.twilio_from_number

        # Telnyx credentials
        telnyx_key = organization.telnyx_api_key if (organization and organization.telnyx_api_key) else None
        telnyx_from = organization.telnyx_from_number if (organization and organization.telnyx_from_number) else None

        # 2. Dispatch via Telnyx Provider
        if provider == "telnyx" and telnyx_key and telnyx_from:
            configured = True
            try:
                source_label = f"Organization settings ({organization.name})" if organization else "Global settings"
                logger.info(f"[SMS Gateway] Dispatched via Telnyx [{source_label}] to {to_phone}...")
                
                url = "https://api.telnyx.com/v2/messages"
                headers = {
                    "Authorization": f"Bearer {telnyx_key}",
                    "Content-Type": "application/json",
                }
                payload = {
                    "from": telnyx_from,
                    "to": to_phone,
                    "text": body,
                }
                
                response = httpx.post(url, headers=headers, json=payload, timeout=10.0)
                
                if response.status_code in (200, 201, 202):
                    logger.info(f"[SMS Gateway] Telnyx SMS successfully queued! Message ID: {response.json().get('data', {}).get('id')}")
                    return True
                else:
                    logger.error(f"[SMS Gateway Error] Telnyx responded with status {response.status_code}: {response.text}")
            except Exception as e:
                logger.error(f"[SMS Gateway Error] Telnyx REST connection failed: {e}")

        # 3. Dispatch via Twilio Provider
        elif twilio_sid and twilio_token and twilio_from:
            configured = True
            try:
                source_label = f"Organization settings ({organization.name})" if organization else "Global settings"
                logger.info(f"[SMS Gateway] Dispatched via Twilio [{source_label}] to {to_phone}...")
                
                url = f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json"
                auth = (twilio_sid, twilio_token)
                data = {
                    "To": to_phone,
                    "From": twilio_from,
                    "Body": body,
                }
                
                response = httpx.post(url, auth=auth, data=data, timeout=10.0)
                
                if response.status_code in (200, 201):
                    logger.info(f"[SMS Gateway] Twilio SMS successfully delivered! SID: {response.json().get('sid')}")
                    return True
                else:
                    logger.error(f"[SMS Gateway Error] Twilio responded with status {response.status_code}: {response.text}")
            except Exception as e:
                logger.error(f"[SMS Gateway Error] Twilio REST connection failed: {e}")

        # 4. Development Fallback Logger
        print("\n--- SignFlow CRM development SMS ---")
        print(f"To: {to_phone}")
        print(f"Body: {body}")
        print("--- end SMS ---\n")
        return not configured


sms_service = SmsService()
