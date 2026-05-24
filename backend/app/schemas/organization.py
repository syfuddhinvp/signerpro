from pydantic import BaseModel, Field


class OrganizationSettingsUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    
    # SMTP
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = Field(default=None)
    smtp_username: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(default=None, max_length=255)
    smtp_from_email: str | None = Field(default=None, max_length=255)
    
    # SMS
    sms_provider: str | None = Field(default=None, max_length=50)  # "twilio" or "telnyx"
    twilio_account_sid: str | None = Field(default=None, max_length=255)
    twilio_auth_token: str | None = Field(default=None, max_length=255)
    twilio_from_number: str | None = Field(default=None, max_length=50)
    
    telnyx_api_key: str | None = Field(default=None, max_length=255)
    telnyx_from_number: str | None = Field(default=None, max_length=50)


class OrganizationResponse(BaseModel):
    id: str
    name: str
    
    # Non-sensitive SMTP details
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_from_email: str | None = None
    
    # Non-sensitive SMS details
    sms_provider: str | None = None
    twilio_account_sid: str | None = None
    twilio_from_number: str | None = None
    telnyx_from_number: str | None = None

    class Config:
        from_attributes = True
