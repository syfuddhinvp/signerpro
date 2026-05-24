import pytest
from fastapi import status
from fastapi.testclient import TestClient
from app.core.database import get_db
from app.models.organization import Organization
from app.models.user import User


def test_org_settings_access_and_update(client: TestClient) -> None:
    # Resolve the active database session from the client dependencies override
    db = next(client.app.dependency_overrides[get_db]())

    # 1. Register organization and admin user (returns 201 Created)
    resp = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Acme Brokers",
            "name": "Alice Smith",
            "email": "alice@acme.com",
            "password": "securepassword123",
        },
    )
    assert resp.status_code == status.HTTP_201_CREATED
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. Get organization settings
    resp = client.get("/api/organizations/me", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    data = resp.json()
    assert data["name"] == "Acme Brokers"
    assert data["smtp_host"] is None
    assert "smtp_password" not in data  # Sensitive passwords must never be exposed!

    # 3. Patch organization settings
    resp = client.patch(
        "/api/organizations/me",
        headers=headers,
        json={
            "smtp_host": "smtp.acme.com",
            "smtp_port": 587,
            "smtp_username": "mail-agent@acme.com",
            "smtp_password": "supersecretpassword",
            "sms_provider": "telnyx",
            "telnyx_api_key": "TS_KEY_SECRET",
            "telnyx_from_number": "+15551239999",
        },
    )
    assert resp.status_code == status.HTTP_200_OK
    updated = resp.json()
    assert updated["smtp_host"] == "smtp.acme.com"
    assert updated["smtp_port"] == 587
    assert updated["sms_provider"] == "telnyx"
    assert updated["telnyx_from_number"] == "+15551239999"
    assert "smtp_password" not in updated  # Still not exposed!
    assert "telnyx_api_key" not in updated  # Still not exposed!

    # 4. Confirm it is persisted in the database
    org = db.query(Organization).filter_by(name="Acme Brokers").first()
    assert org is not None
    assert org.smtp_host == "smtp.acme.com"
    assert org.smtp_password == "supersecretpassword"
    assert org.telnyx_api_key == "TS_KEY_SECRET"


def test_org_settings_role_protection(client: TestClient) -> None:
    # Resolve the active database session from the client dependencies override
    db = next(client.app.dependency_overrides[get_db]())

    # 1. Register organization and admin user (returns 201 Created)
    resp = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Role Test Org",
            "name": "Bob Admin",
            "email": "bob@admin.com",
            "password": "securepassword123",
        },
    )
    assert resp.status_code == status.HTTP_201_CREATED
    
    # Get the organization ID to create a non-admin sender manually
    org = db.query(Organization).filter_by(name="Role Test Org").first()
    
    # 2. Create a sender (non-admin) user manually
    from app.core.security import hash_password
    sender = User(
        organization_id=org.id,
        name="Charlie Sender",
        email="charlie@sender.com",
        password_hash=hash_password("senderpass123"),
        role="sender",
    )
    db.add(sender)
    db.commit()

    # 3. Log in as sender
    login_resp = client.post(
        "/api/auth/login",
        json={"email": "charlie@sender.com", "password": "senderpass123"},
    )
    assert login_resp.status_code == status.HTTP_200_OK
    token = login_resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 4. Retrieve settings (should be allowed for read-only view)
    resp = client.get("/api/organizations/me", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["name"] == "Role Test Org"

    # 5. Patch settings (should return 403 Forbidden for non-admins)
    patch_resp = client.patch(
        "/api/organizations/me",
        headers=headers,
        json={"smtp_host": "smtp.unauthorized.com"},
    )
    assert patch_resp.status_code == status.HTTP_403_FORBIDDEN
    assert "Only administrators can manage" in patch_resp.json()["detail"]
