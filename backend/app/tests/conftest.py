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
os.environ["JWT_SECRET"] = "test-secret"
os.environ["APP_BASE_URL"] = "http://localhost:3000"
os.environ["ENVIRONMENT"] = "test"
os.environ["UPLOAD_DIR"] = "/tmp/signflow-test-uploads"

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
