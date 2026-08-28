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

    # Billing / payment provider seam (see app/services/billing_service.py)
    billing_provider: str = Field(default="null", alias="BILLING_PROVIDER")
    billing_webhook_secret: str = Field(default="dev-billing-webhook-secret", alias="BILLING_WEBHOOK_SECRET")

    # Observability
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # Object storage
    storage_backend: str = Field(default="local", alias="STORAGE_BACKEND")  # "local" | "s3"
    s3_bucket: str | None = Field(default=None, alias="S3_BUCKET")
    s3_prefix: str = Field(default="", alias="S3_PREFIX")
    s3_region: str | None = Field(default=None, alias="S3_REGION")
    s3_endpoint_url: str | None = Field(default=None, alias="S3_ENDPOINT_URL")
    s3_server_side_encryption: str | None = Field(default="AES256", alias="S3_SERVER_SIDE_ENCRYPTION")
    s3_sse_kms_key_id: str | None = Field(default=None, alias="S3_SSE_KMS_KEY_ID")
    s3_presign_expires_seconds: int = Field(default=900, alias="S3_PRESIGN_EXPIRES_SECONDS")

    # Secret encryption at rest
    secret_encryption_key: str | None = Field(default=None, alias="SECRET_ENCRYPTION_KEY")
    secret_encryption_keys_old: str | None = Field(default=None, alias="SECRET_ENCRYPTION_KEYS_OLD")

    # Expiry scheduler
    expiry_batch_size: int = Field(default=500, alias="EXPIRY_BATCH_SIZE")


@lru_cache
def get_settings() -> Settings:
    return Settings()

