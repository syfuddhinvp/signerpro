from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://signflow:signflow@localhost:5432/signflow",
        alias="DATABASE_URL",
    )
    jwt_secret: str = Field(default="change-me-in-production", alias="JWT_SECRET")
    jwt_expires_minutes: int = Field(default=60 * 8, alias="JWT_EXPIRES_MINUTES")
    app_base_url: str = Field(default="http://localhost:3000", alias="APP_BASE_URL")
    upload_dir: str = Field(default="./uploads", alias="UPLOAD_DIR")
    signing_token_expire_days: int = Field(default=14, alias="SIGNING_TOKEN_EXPIRE_DAYS")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    max_upload_bytes: int = 25 * 1024 * 1024
    cors_origins: str = Field(default="http://localhost:3000,http://frontend:3000", alias="CORS_ORIGINS")

    # Twilio SMS Configuration
    twilio_account_sid: str | None = Field(default=None, alias="TWILIO_ACCOUNT_SID")
    twilio_auth_token: str | None = Field(default=None, alias="TWILIO_AUTH_TOKEN")
    twilio_from_number: str | None = Field(default=None, alias="TWILIO_FROM_NUMBER")

    # Email Gateway Configurations (SMTP / Resend)
    smtp_host: str | None = Field(default=None, alias="SMTP_HOST")
    smtp_port: int | None = Field(default=None, alias="SMTP_PORT")
    smtp_username: str | None = Field(default=None, alias="SMTP_USERNAME")
    smtp_password: str | None = Field(default=None, alias="SMTP_PASSWORD")
    smtp_from_email: str = Field(default="noreply@signflow.com", alias="SMTP_FROM_EMAIL")
    resend_api_key: str | None = Field(default=None, alias="RESEND_API_KEY")


@lru_cache
def get_settings() -> Settings:
    return Settings()

