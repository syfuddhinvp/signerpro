from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = Field(
        default="postgresql+psycopg://signflow:signflow@localhost:5432/signflow",
        alias="DATABASE_URL",
    )
    jwt_secret: str = Field(default="change-me-in-production", alias="JWT_SECRET")
    # Short-lived by design: refresh-token rotation (POST /api/auth/refresh)
    # is what keeps a session alive, and a 15-minute window bounds the damage
    # from a leaked access token to roughly the revocation check interval.
    jwt_expires_minutes: int = Field(default=15, alias="JWT_EXPIRES_MINUTES")
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
    stripe_secret_key: str | None = Field(default=None, alias="STRIPE_SECRET_KEY")
    stripe_webhook_secret: str | None = Field(default=None, alias="STRIPE_WEBHOOK_SECRET")
    stripe_connect_webhook_secret: str | None = Field(default=None, alias="STRIPE_CONNECT_WEBHOOK_SECRET")
    #: Read through the ``stripe_publishable_key`` property below, never
    #: directly -- the property layers a live ``os.environ`` lookup over this
    #: declared value. Declared here all the same so ``.env`` and pydantic
    #: resolve it exactly like every other setting.
    stripe_publishable_key_configured: str | None = Field(default=None, alias="STRIPE_PUBLISHABLE_KEY")

    # Observability
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # Object storage
    storage_backend: str = Field(default="local", alias="STORAGE_BACKEND")  # "local" | "s3"
    s3_bucket: str | None = Field(default=None, alias="S3_BUCKET")
    s3_prefix: str = Field(default="", alias="S3_PREFIX")
    s3_region: str | None = Field(default=None, alias="S3_REGION")
    s3_endpoint_url: str | None = Field(default=None, alias="S3_ENDPOINT_URL")
    # The endpoint a *browser* can reach. With MinIO in compose the API talks to
    # http://minio:9000, a name that does not resolve outside the network, so a
    # URL presigned against it is unopenable. Presigning uses this when set.
    s3_public_endpoint_url: str | None = Field(default=None, alias="S3_PUBLIC_ENDPOINT_URL")
    # Explicit keys for MinIO and other static-credential endpoints. Left unset
    # on AWS, where boto3 should pick up the instance/IRSA role instead.
    s3_access_key_id: str | None = Field(default=None, alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str | None = Field(default=None, alias="S3_SECRET_ACCESS_KEY")
    # AES256 is right on AWS. MinIO rejects it unless it is configured with a
    # KMS, so the compose stack sets this to empty.
    s3_server_side_encryption: str | None = Field(default="AES256", alias="S3_SERVER_SIDE_ENCRYPTION")
    s3_sse_kms_key_id: str | None = Field(default=None, alias="S3_SSE_KMS_KEY_ID")
    s3_presign_expires_seconds: int = Field(default=900, alias="S3_PRESIGN_EXPIRES_SECONDS")

    # Secret encryption at rest
    secret_encryption_key: str | None = Field(default=None, alias="SECRET_ENCRYPTION_KEY")
    secret_encryption_keys_old: str | None = Field(default=None, alias="SECRET_ENCRYPTION_KEYS_OLD")

    # Cloud storage integrations (Google Drive / Dropbox OAuth)
    google_drive_client_id: str | None = Field(default=None, alias="GOOGLE_DRIVE_CLIENT_ID")
    google_drive_client_secret: str | None = Field(default=None, alias="GOOGLE_DRIVE_CLIENT_SECRET")
    dropbox_app_key: str | None = Field(default=None, alias="DROPBOX_APP_KEY")
    dropbox_app_secret: str | None = Field(default=None, alias="DROPBOX_APP_SECRET")
    #: Where the provider sends the browser back after consent. Must match the
    #: redirect URI registered with the provider *exactly*. Read through the
    #: ``cloud_oauth_redirect_url`` property, which defaults it off APP_BASE_URL.
    cloud_oauth_redirect_url_configured: str | None = Field(
        default=None, alias="CLOUD_OAUTH_REDIRECT_URL"
    )

    # Expiry scheduler
    expiry_batch_size: int = Field(default=500, alias="EXPIRY_BATCH_SIZE")

    # --- Database connection pool ------------------------------------------
    # Budget arithmetic, which is what these defaults exist to make survivable:
    #
    #     peak connections = replicas x workers x (pool_size + max_overflow)
    #
    # Unconfigured, SQLAlchemy defaults to pool_size=5 / max_overflow=10, i.e.
    # 15 per worker process. Three replicas of four gunicorn workers is then
    # 3 x 4 x 15 = 180 against PostgreSQL's default max_connections=100, and
    # the deployment fails to start. The defaults below are 3 + 2 = 5 per
    # worker: 3 x 4 x 5 = 60, which leaves headroom under 100 for psql,
    # migrations and the cron entrypoints.
    #
    # Scale db_pool_size with per-worker concurrency, not with traffic, and
    # re-check the product against max_connections before adding replicas.
    db_pool_size: int = Field(default=3, alias="DB_POOL_SIZE")
    db_max_overflow: int = Field(default=2, alias="DB_MAX_OVERFLOW")
    #: Recycle below any proxy/server idle timeout (PgBouncer, RDS) so the pool
    #: never hands out a connection the server has already closed.
    db_pool_recycle_seconds: int = Field(default=1800, alias="DB_POOL_RECYCLE_SECONDS")
    #: Fail fast when the pool is exhausted rather than piling up requests.
    db_pool_timeout_seconds: int = Field(default=10, alias="DB_POOL_TIMEOUT_SECONDS")

    # --- Rate limiting ------------------------------------------------------
    #: "memory" (default; single-node) or "redis" (shared across replicas).
    #: In-process counters multiply every limit by the replica count, which is
    #: an authentication-strength regression for login/OTP/password-reset.
    rate_limit_backend: str = Field(default="memory", alias="RATE_LIMIT_BACKEND")
    redis_url: str | None = Field(default=None, alias="REDIS_URL")

    # --- Retention ----------------------------------------------------------
    #: Days of ``system_logs`` to keep. Both a disk and a GDPR concern.
    system_log_retention_days: int = Field(default=90, alias="SYSTEM_LOG_RETENTION_DAYS")

    # --- Proxy trust ---------------------------------------------------------
    #: Comma-separated IPs/CIDRs of the reverse proxies in front of this app.
    #: ``X-Forwarded-For`` is honoured **only** when the immediate peer is one
    #: of these. Empty -- the default -- means the header is ignored entirely,
    #: because any client can send it and every per-IP rate limit would
    #: otherwise be bypassable by rotating one header.
    #:
    #: Behind an ingress this MUST be set, or every request appears to come
    #: from the proxy and shares a single rate-limit bucket.
    trusted_proxy_ips: str = Field(default="", alias="TRUSTED_PROXY_IPS")

    # --- PAdES sealing (optional) --------------------------------------------
    #: Path to a PKCS#12 (.p12/.pfx) bundle holding the signing key and chain.
    #: Unset -- the default -- means the product applies no cryptographic
    #: signature and remains a Simple Electronic Signature platform, which is
    #: the only thing it may then be marketed as (DECISIONS.md D1).
    pades_certificate_path: str | None = Field(default=None, alias="PADES_CERTIFICATE_PATH")
    pades_certificate_passphrase: str | None = Field(
        default=None, alias="PADES_CERTIFICATE_PASSPHRASE"
    )

    @property
    def cloud_oauth_redirect_url(self) -> str:
        """The page the OAuth consent screen returns to.

        Defaults off ``APP_BASE_URL`` so a normal deployment configures
        nothing, and is overridable for the rare case where the browser-facing
        origin is not the one registered with the provider.
        """
        if self.cloud_oauth_redirect_url_configured:
            return self.cloud_oauth_redirect_url_configured.strip()
        return f"{self.app_base_url.rstrip('/')}/account/integrations/callback"

    @property
    def stripe_publishable_key(self) -> str | None:
        """``STRIPE_PUBLISHABLE_KEY``: the signer-payment publishable key.

        Publishable by design -- it can only tokenize a card / mount Stripe
        Elements, never read or charge anything, so it is safe to hand
        straight to the browser. Handed to the signing client (in
        ``PaymentIntentResponse``) so it can mount Elements against the
        tenant's own connected account. Distinct from
        ``NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`` (frontend/.env.example), which
        is for the platform's own billing checkout and is baked into the
        frontend bundle at build time; this one is read server-side.

        Deliberately a live property rather than a plain ``Field`` like its
        neighbours: ``get_settings()`` caches one ``Settings`` instance for
        the process's lifetime, so a plain field would freeze this value to
        whatever the environment held at the *first* call, and a later
        ``os.environ`` change (a test's ``monkeypatch.setenv``/``delenv``, or
        a secrets-manager sidecar rewriting the environment) would go
        unnoticed without also calling ``get_settings.cache_clear()``. Every
        other Stripe field here has never needed to change after startup, so
        this is the only one where that mattered.
        """
        import os

        # `os.environ` first, so a rotated secret or a test's
        # `monkeypatch.setenv`/`delenv` is seen without clearing the
        # `get_settings` cache; then the declared field, which pydantic has
        # already resolved from the environment or `.env` at construction.
        # An earlier version read `.env` from disk here on every access,
        # which cost a filesystem hit per payment intent and -- worse --
        # silently resolved to nothing whenever the process's working
        # directory was not the one holding `.env`.
        return os.environ.get("STRIPE_PUBLISHABLE_KEY") or self.stripe_publishable_key_configured


#: The only environments that may run with insecure development defaults.
NON_PRODUCTION_ENVIRONMENTS = {"development", "dev", "local", "test", "testing"}

#: Values that must never be the live signing key.
INSECURE_JWT_SECRETS = {"change-me-in-production", "changeme", "secret", "test-secret"}
MIN_JWT_SECRET_LENGTH = 32


class CorsConfigurationError(RuntimeError):
    """Raised when CORS_ORIGINS cannot be used safely with credentials."""


def parse_cors_origins(raw: str | None, *, environment: str | None = None) -> list[str]:
    """Parse ``CORS_ORIGINS`` into a validated allowlist.

    ``[o.strip() for o in raw.split(",")]`` -- what this replaced -- turns an
    empty value into ``[""]`` and a trailing comma into a stray empty origin,
    and happily accepts ``"*"``. Since the app sends ``allow_credentials=True``,
    a wildcard would be both a real vulnerability and silently ineffective:
    browsers refuse a credentialed response whose ACAO is ``*``.
    """
    origins = [origin.strip() for origin in (raw or "").split(",")]
    origins = [origin for origin in origins if origin]
    if "*" in origins:
        raise CorsConfigurationError(
            "CORS_ORIGINS may not contain '*': the API sends credentialed "
            "responses, and a wildcard origin with credentials is both unsafe "
            "and rejected by every browser. List the exact origins instead."
        )
    if not origins and is_production(environment):
        raise CorsConfigurationError(
            "CORS_ORIGINS is empty. Set it to the exact browser origins that "
            "may call this API."
        )
    # Deduplicate, preserving order.
    return list(dict.fromkeys(origins))


def is_production(environment: str | None) -> bool:
    """Anything not explicitly a development/test environment is production.

    Deliberately inverted from an ``== "production"`` test: a typo in
    ``ENVIRONMENT`` ("prod", "staging", "") must fail closed, not silently
    hand the deployment its development fallbacks.
    """
    return (environment or "").strip().lower() not in NON_PRODUCTION_ENVIRONMENTS


@lru_cache
def expected_migration_head() -> str | None:
    """The single alembic head this build ships, or ``None`` if unresolvable.

    Read from the revision files on disk rather than hardcoded, so it cannot
    drift from the migrations it is supposed to describe. ``None`` (missing
    alembic, unreadable directory, or -- a real bug worth seeing -- a branched
    chain with more than one head) makes readiness report the applied version
    without asserting on it, rather than failing the replica for a defect in
    the check itself.
    """
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        root = Path(__file__).resolve().parents[2]
        script = ScriptDirectory.from_config(Config(str(root / "alembic.ini")))
        heads = script.get_heads()
    except Exception:  # noqa: BLE001 - never let this break a readiness probe
        return None
    return heads[0] if len(heads) == 1 else None


@lru_cache
def get_settings() -> Settings:
    return Settings()

