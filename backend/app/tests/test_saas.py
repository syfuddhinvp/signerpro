from datetime import datetime, timezone
import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.models.organization import Organization
from app.models.user import User


def test_saas_metrics_and_permissions(client: TestClient) -> None:
    # 1. Register organization and admin user
    resp = client.post(
        "/api/auth/register",
        json={
            "organization_name": "SaaS Admin Test Org",
            "name": "Super Admin User",
            "email": "saasadmin@signflow.com",
            "password": "securepassword123",
        },
    )
    assert resp.status_code == status.HTTP_201_CREATED
    admin_token = resp.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # /api/saas/* is platform-scoped: a tenant admin is not enough.
    db = next(client.app.dependency_overrides[get_db]())
    platform_admin = db.get(User, resp.json()["user"]["id"])
    platform_admin.is_platform_admin = True
    db.commit()

    # 2. Get the database session to create a sender (non-admin) manually
    db = next(client.app.dependency_overrides[get_db]())
    org = db.query(Organization).filter_by(name="SaaS Admin Test Org").first()
    
    from app.core.security import hash_password
    sender = User(
        organization_id=org.id,
        name="John Sender",
        email="john@sender.com",
        password_hash=hash_password("senderpass123"),
        role="sender",
    )
    db.add(sender)
    db.commit()

    # 3. Log in as sender
    login_resp = client.post(
        "/api/auth/login",
        json={"email": "john@sender.com", "password": "senderpass123"},
    )
    assert login_resp.status_code == status.HTTP_200_OK
    sender_token = login_resp.json()["access_token"]
    sender_headers = {"Authorization": f"Bearer {sender_token}"}

    # 4. Attempt to access SaaS metrics as a non-admin (sender) -> should be 403 Forbidden
    resp = client.get("/api/saas/metrics", headers=sender_headers)
    assert resp.status_code == status.HTTP_403_FORBIDDEN
    assert "Requires SaaS Super Admin permissions" in resp.json()["detail"]

    # 5. Retrieve SaaS metrics as an admin -> should be 200 OK
    resp = client.get("/api/saas/metrics", headers=admin_headers)
    assert resp.status_code == status.HTTP_200_OK
    metrics = resp.json()
    assert metrics["total_organizations"] >= 1
    assert metrics["total_users"] >= 2
    assert "free" in metrics["tier_counts"]


def test_saas_subscription_and_user_management(client: TestClient) -> None:
    # 1. Register organization and admin user
    resp = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Tenant Inc",
            "name": "Admin Tenant",
            "email": "tenant-admin@tenant.com",
            "password": "securepassword123",
        },
    )
    assert resp.status_code == status.HTTP_201_CREATED
    admin_token = resp.json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # /api/saas/* is platform-scoped: a tenant admin is not enough.
    db = next(client.app.dependency_overrides[get_db]())
    platform_admin = db.get(User, resp.json()["user"]["id"])
    platform_admin.is_platform_admin = True
    db.commit()

    # 2. Get list of organizations
    resp = client.get("/api/saas/organizations", headers=admin_headers)
    assert resp.status_code == status.HTTP_200_OK
    orgs = resp.json()
    assert len(orgs) >= 1
    target_org = next(o for o in orgs if o["name"] == "Tenant Inc")
    assert target_org["subscription_tier"] == "free"
    assert target_org["subscription_status"] == "active"

    # 3. Update subscription tier to growth and status to trialing
    future_date = "2026-12-31T23:59:59"
    resp = client.patch(
        f"/api/saas/organizations/{target_org['id']}",
        headers=admin_headers,
        json={
            "subscription_tier": "growth",
            "subscription_status": "trialing",
            "subscription_expires_at": future_date,
        },
    )
    assert resp.status_code == status.HTTP_200_OK
    updated_org = resp.json()
    assert updated_org["subscription_tier"] == "growth"
    assert updated_org["subscription_status"] == "trialing"
    assert updated_org["subscription_expires_at"].startswith("2026-12-31T23:59:59")

    # 4. List users in system
    resp = client.get("/api/saas/users", headers=admin_headers)
    assert resp.status_code == status.HTTP_200_OK
    users = resp.json()["items"]
    assert len(users) >= 1
    
    # 5. Create a non-admin sender manually
    db = next(client.app.dependency_overrides[get_db]())
    org = db.query(Organization).filter_by(name="Tenant Inc").first()
    from app.core.security import hash_password
    sender = User(
        organization_id=org.id,
        name="Upgrade Target User",
        email="upgrade-me@sender.com",
        password_hash=hash_password("senderpass123"),
        role="sender",
    )
    db.add(sender)
    db.commit()

    # 6. Change sender's role to admin
    resp = client.patch(
        f"/api/saas/users/{sender.id}/role",
        headers=admin_headers,
        json={"role": "admin"},
    )
    assert resp.status_code == status.HTTP_200_OK
    updated_user = resp.json()
    assert updated_user["role"] == "admin"
    assert updated_user["email"] == "upgrade-me@sender.com"
