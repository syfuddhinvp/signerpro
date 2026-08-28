from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import audit, auth, billing, documents, fields, invitations, recipients, signing, organizations, saas, webhooks
from app.api.routes import account, activity, invoices, revenue, support
from app.api.routes import contacts, folders, teams, templates
from app.api.routes import api_keys, embed, public_api, reports
from app.api.routes import flags, logs, tenants
from app.core.config import get_settings
from app.core.logging import RequestLoggingMiddleware, configure_logging
from app import models  # noqa: F401


settings = get_settings()
configure_logging()

app = FastAPI(title="SignFlow CRM API", version="0.1.0")

app.add_middleware(RequestLoggingMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
app.include_router(account.router)
app.include_router(contacts.router)
app.include_router(templates.router)
app.include_router(folders.router)
app.include_router(teams.router)


@app.on_event("startup")
def startup() -> None:
    # Alembic is the single source of truth for schema. No create_all here:
    # it silently drifted from the migrations. (Tests still create_all against
    # their own in-memory engine in app/tests/conftest.py, which is correct.)
    from app.core.crypto import verify_encryption_configured

    verify_encryption_configured()


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

