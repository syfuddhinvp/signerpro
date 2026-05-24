from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import audit, auth, documents, fields, recipients, signing, organizations, saas
from app.core.config import get_settings
from app.core.database import Base, engine
from app import models  # noqa: F401


settings = get_settings()

app = FastAPI(title="SignFlow CRM API", version="0.1.0")

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


@app.on_event("startup")
def startup() -> None:
    if settings.environment == "development":
        Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

