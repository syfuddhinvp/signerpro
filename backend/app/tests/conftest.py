import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
# 32+ bytes: PyJWT warns below the RFC 7518 minimum for HS256, which fired on
# essentially every authenticated request in the suite.
os.environ["JWT_SECRET"] = "test-secret-not-real-but-long-enough-for-hs256"
os.environ["APP_BASE_URL"] = "http://localhost:3000"
os.environ["ENVIRONMENT"] = "test"
os.environ["UPLOAD_DIR"] = "/tmp/signflow-test-uploads"
# The suite must never reach the network. `backend/.env` sets
# BILLING_PROVIDER=stripe with a real (test-mode) secret key, and pydantic
# settings read that file, so without these three pins the billing tests
# instantiated the live `StripePaymentProvider` and made real HTTPS calls to
# api.stripe.com -- which is what made ~82 tests fail here and would fail
# outright in CI or offline. The null provider keeps every billing path local;
# the placeholder key exists only so a test that constructs the Stripe adapter
# explicitly (with its `transport` faked) still passes the sk_test_ prefix
# check in `verify_stripe_key_is_safe_here`.
os.environ["BILLING_PROVIDER"] = "null"
# Blanked rather than given a placeholder: `Settings` reads `.env` via
# `SettingsConfigDict(env_file=".env")`, so a developer's real key would
# otherwise still reach `_stripe_setting` and defeat the point. An empty value
# is falsy there, which is also what lets
# `test_stripe_requires_a_secret_key` observe a genuinely unconfigured
# provider. Tests that need the Stripe adapter construct it with an explicit
# key and a faked `transport`.
os.environ["STRIPE_SECRET_KEY"] = ""
os.environ["STRIPE_WEBHOOK_SECRET"] = ""
os.environ["STRIPE_CONNECT_WEBHOOK_SECRET"] = ""
# Unlike the three above, this one is given a value: it is a *publishable*
# key (designed to be shipped to browsers, able only to tokenize), and
# `signer_payment_service` now refuses to hand a signer a payment modal it
# could never mount, so leaving it blank would 409 every payment test for a
# reason unrelated to what those tests are checking. A test that wants the
# unconfigured path deletes it with `monkeypatch.delenv`.
os.environ["STRIPE_PUBLISHABLE_KEY"] = "pk_test_placeholder"

from app import models  # noqa: E402,F401
from app.core.database import Base, get_db
from app.core.storage import storage
from app.main import app


@pytest.fixture()
def upload_dir() -> Generator[Path, None, None]:
    with TemporaryDirectory() as directory:
        os.environ["UPLOAD_DIR"] = directory
        yield Path(directory)


@pytest.fixture()
def client(upload_dir: Path) -> Generator[TestClient, None, None]:
    storage.root = upload_dir.resolve()
    storage.root.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def pdf_bytes() -> bytes:
    from io import BytesIO

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(612, 792))
    pdf.drawString(72, 720, "Purchase agreement")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def auth_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Acme Realty",
            "name": "Admin User",
            "email": "admin@example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def add_payment_method(client: TestClient, headers: dict[str, str], *, decline: bool = False) -> str:
    """Put a (development-provider) instrument on file and return its id.

    Upgrades and seat purchases are gated on payment, so any test that needs a
    paid plan has to go through this first -- which is the point.
    ``decline=True`` marks the instrument so ``NullPaymentProvider`` always
    declines it, for exercising the refusal and dunning paths.
    """
    response = client.post(
        "/api/billing/payment-methods",
        json={"type": "card", "provider_token": "tok_test_visa", "make_default": True},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    payment_method_id = response.json()["id"]
    if decline:
        from app.core.database import get_db
        from app.main import app
        from app.models.payment_method import PaymentMethod
        from app.services.billing_service import DEV_DECLINE_MARKER

        generator = app.dependency_overrides[get_db]()
        session = next(generator)
        stored = session.get(PaymentMethod, payment_method_id)
        stored.meta = DEV_DECLINE_MARKER
        session.add(stored)
        session.commit()
        generator.close()
    return payment_method_id


def upgrade_plan(client: TestClient, headers: dict[str, str], plan_code: str) -> dict:
    """Pay for and move onto ``plan_code``. Asserts the upgrade succeeded."""
    client.get("/api/billing/plans")
    add_payment_method(client, headers)
    response = client.post(
        "/api/billing/change-plan", json={"plan_code": plan_code}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()
