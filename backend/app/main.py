import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import audit, auth, billing, documents, fields, invitations, recipients, signing, organizations, saas, webhooks
from app.api.routes import account, activity, invoices, revenue, support
from app.api.routes import contacts, folders, teams, templates
from app.api.routes import api_keys, embed, public_api, reports, sandbox
from app.api.routes import erasure, flags, logs, notifications, passkeys, payments, scim, sso, tenants, verification
from app.services import notification_service
from app.services.billing_service import StripeApiError
from app.services.scim_service import ScimException
from app.services.audit_service import audit_service
from app.core.config import expected_migration_head, get_settings, parse_cors_origins
from app.core.logging import RequestLoggingMiddleware, configure_logging
from app import models  # noqa: F401


settings = get_settings()
configure_logging()
logger = logging.getLogger("signflow.lifecycle")

#: Parsed once, at import, so a malformed CORS_ORIGINS fails the process
#: instead of silently yielding an allowlist containing the empty string.
CORS_ORIGINS = parse_cors_origins(settings.cors_origins, environment=settings.environment)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and graceful shutdown.

    Replaces the deprecated startup event handler, which had no shutdown
    counterpart at all -- so SIGTERM killed in-flight webhook delivery threads
    mid-POST and at-least-once delivery quietly degraded to at-most-once.
    """
    # Alembic is the single source of truth for schema. No create_all here:
    # it silently drifted from the migrations. (Tests still create_all against
    # their own in-memory engine in app/tests/conftest.py, which is correct.)
    from app.core.crypto import verify_encryption_configured, verify_jwt_secret_configured
    from app.services.billing_service import (
        verify_billing_webhook_secret_configured,
        verify_payment_provider_configured,
    )

    # All hard-fail in production rather than booting on a published default.
    verify_jwt_secret_configured()
    verify_encryption_configured()
    # A default billing webhook secret lets anyone self-grant an enterprise plan.
    verify_billing_webhook_secret_configured()
    # …and a live Stripe key outside production would charge real cards.
    verify_payment_provider_configured()
    # Re-open webhook dispatch. `drain()` below latches it shut, and that latch
    # outlives the app object -- so any process that re-enters the lifespan
    # (a restart in-process, or a test client per test) would otherwise spend
    # the rest of its life delivering inline on the request path.
    from app.services.webhook_service import webhook_service

    webhook_service.resume()

    logger.info(
        "startup.complete",
        extra={"environment": settings.environment, "cors_origins": CORS_ORIGINS},
    )

    yield

    logger.info("shutdown.begin")
    try:
        # Call the singleton's drain directly. This used to be a
        # `getattr(module, "drain", None)` duck-type against the *module*,
        # which has no such attribute -- so the graceful drain this docstring
        # promises silently did nothing on every shutdown.
        from app.services.webhook_service import webhook_service

        abandoned = webhook_service.drain()
        logger.info("shutdown.webhook_drained", extra={"abandoned": abandoned})
    except Exception:  # noqa: BLE001 - shutdown must never raise
        logger.warning("shutdown.webhook_drain_failed", exc_info=True)
    try:
        from app.core.database import engine

        engine.dispose()
    except Exception:  # noqa: BLE001
        logger.warning("shutdown.engine_dispose_failed", exc_info=True)
    logger.info("shutdown.complete")


app = FastAPI(
    title="SignFlow CRM API",
    version="0.1.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 for malformed bodies, including binary ones.

    FastAPI's default handler echoes the offending input back, and blows up with
    a 500 ``UnicodeDecodeError`` when that input is raw bytes (e.g. a multipart
    upload posted to a JSON endpoint). Drop the raw echo and keep the 422.
    """
    errors = []
    for error in exc.errors():
        scrubbed = dict(error)
        if isinstance(scrubbed.get("input"), (bytes, bytearray)):
            scrubbed["input"] = None
        errors.append(scrubbed)
    return JSONResponse(status_code=422, content={"detail": jsonable_encoder(errors)})


@app.exception_handler(StripeApiError)
async def stripe_api_error_handler(request: Request, exc: StripeApiError) -> JSONResponse:
    """A Stripe API failure is an operator-facing error, not a server bug.

    ``StripeApiError`` is not an ``HTTPException``, so left uncaught it
    escaped FastAPI's routing as a raw 500 with a full stack trace -- exactly
    how the real onboarding failure that prompted this handler surfaced.
    Stripe's 4xx (bad params, declined, misconfiguration) map to a 4xx of
    ours; anything Stripe-side 5xx, or a transport failure that reached us as
    something else, becomes a 502. The message is Stripe's own -- useful to
    an operator -- but never the secret key or the request body that carried
    it, which this handler never touches.
    """
    logger.warning(
        "stripe.api_error",
        extra={"status_code": exc.status_code, "code": exc.code, "path": request.url.path},
    )
    response_status = exc.status_code if 400 <= exc.status_code < 500 else status.HTTP_502_BAD_GATEWAY
    return JSONResponse(status_code=response_status, content={"detail": str(exc)})


@app.exception_handler(ScimException)
async def scim_exception_handler(request: Request, exc: ScimException) -> JSONResponse:
    """SCIM errors are a flat body per RFC 7644 §3.12, not FastAPI's usual
    ``{"detail": ...}`` envelope."""
    return JSONResponse(status_code=exc.status_code, content=exc.scim_body)


# The bell feed is produced from audit events, wired once at import time so
# every code path that logs an event raises the notification too (see
# `services/notification_service.py`).
notification_service.register(audit_service)

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(recipients.router)
app.include_router(fields.router)
app.include_router(signing.router)
app.include_router(audit.router)
app.include_router(organizations.router)
app.include_router(saas.router)
app.include_router(invoices.router)
app.include_router(support.router)
app.include_router(activity.router)
app.include_router(revenue.router)
app.include_router(webhooks.router)
app.include_router(invitations.router)
app.include_router(billing.router)
app.include_router(sandbox.router)
app.include_router(tenants.router)
app.include_router(flags.platform_router)
app.include_router(flags.tenant_router)
app.include_router(logs.tenant_router)
app.include_router(logs.platform_router)
app.include_router(api_keys.router)
app.include_router(api_keys.settings_router)
app.include_router(embed.router)
app.include_router(public_api.router)
app.include_router(reports.router)
app.include_router(audit.certificate_router)
app.include_router(verification.router)
app.include_router(erasure.router)
app.include_router(passkeys.router)
app.include_router(sso.router)
app.include_router(account.router)
app.include_router(contacts.router)
app.include_router(templates.router)
app.include_router(folders.router)
app.include_router(teams.router)
app.include_router(notifications.router)
app.include_router(scim.router)
app.include_router(scim.token_router)
app.include_router(payments.router)
app.include_router(payments.document_payments_router)
app.include_router(payments.connect_webhook_router)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Liveness. Deliberately cheap and dependency-free.

    An orchestrator *restarts* a container that fails this, so it must answer
    "is this process wedged" and never "is the database up" -- one shared
    database blip failing liveness would restart every replica at once.
    """
    return {"status": "ok"}


@app.get("/api/health/ready")
def readiness(response: Response) -> dict[str, object]:
    """Readiness: may this replica receive traffic?

    Checks the three things whose absence lets a replica accept a request but
    not serve it:

    * **database** -- ``SELECT 1`` through the real pool, so pool exhaustion
      surfaces here rather than as user-visible timeouts;
    * **storage** -- the uploads volume or bucket is present and writable;
    * **migrations** -- ``alembic_version`` matches the head this build ships.
      A replica running new code against an unmigrated database (or old code
      against a migrated one) is the C10 failure mode, and is otherwise
      completely silent.

    Returns 503 with a per-check breakdown, so the orchestrator stops routing
    and on-call can see *which* dependency broke.
    """
    checks: dict[str, dict[str, object]] = {}

    def record(name: str, probe) -> None:
        try:
            detail = probe()
            checks[name] = {"status": "ok", **({"detail": detail} if detail else {})}
        except Exception as exc:  # noqa: BLE001 - a probe reports, it never raises
            checks[name] = {"status": "fail", "error": f"{type(exc).__name__}: {exc}"}

    def check_database():
        from sqlalchemy import text

        from app.core.database import engine, pool_status

        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"pool": pool_status()}

    def check_storage():
        from app.core.storage import storage

        storage.health_check()
        return {"backend": getattr(storage, "backend", "unknown")}

    def check_migrations():
        from sqlalchemy import text

        from app.core.database import engine

        expected = expected_migration_head()
        with engine.connect() as connection:
            applied = sorted(connection.execute(text("SELECT version_num FROM alembic_version")).scalars())
        if expected is None:
            return {"applied": applied, "expected": None, "note": "head not resolvable in this build"}
        if applied != [expected]:
            raise RuntimeError(
                f"database is at {applied or ['<none>']} but this build expects {expected}; "
                "run `alembic upgrade head` before serving traffic"
            )
        return {"applied": applied}

    record("database", check_database)
    record("storage", check_storage)
    record("migrations", check_migrations)

    ready = all(check["status"] == "ok" for check in checks.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if ready else "not_ready", "checks": checks}

