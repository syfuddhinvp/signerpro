from fastapi import status
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.models.user import User
from app.tests.conftest import upgrade_plan


def register(client: TestClient, *, org: str, name: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()


def headers(payload: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['access_token']}"}


def test_org_creator_becomes_admin(client: TestClient) -> None:
    payload = register(client, org="Acme", name="Ada Admin", email="ada@acme.com")
    assert payload["user"]["role"] == "admin"

    me = client.get("/api/auth/me", headers=headers(payload))
    assert me.status_code == status.HTTP_200_OK
    assert me.json()["role"] == "admin"

    # The org admin can now configure its own gateway settings.
    resp = client.patch(
        "/api/organizations/me",
        headers=headers(payload),
        json={"smtp_host": "smtp.acme.com"},
    )
    assert resp.status_code == status.HTTP_200_OK, resp.text


def test_tenant_admin_is_not_platform_admin(client: TestClient) -> None:
    """The single most important guard: a tenant admin must never reach /api/saas/*."""
    tenant = register(client, org="Tenant Co", name="Tina Admin", email="tina@tenant.com")
    assert tenant["user"]["role"] == "admin"
    h = headers(tenant)

    for method, path in [
        ("get", "/api/saas/metrics"),
        ("get", "/api/saas/organizations"),
        ("get", "/api/saas/users"),
        ("patch", "/api/saas/organizations/any-id"),
        ("patch", "/api/saas/users/any-id/role"),
    ]:
        request = getattr(client, method)
        response = request(path, headers=h, json={"role": "admin"}) if method == "patch" else request(path, headers=h)
        assert response.status_code == status.HTTP_403_FORBIDDEN, f"{method} {path} -> {response.status_code}"

    # Flipping the platform flag is what actually grants access.
    db = next(client.app.dependency_overrides[get_db]())
    user = db.get(User, tenant["user"]["id"])
    user.is_platform_admin = True
    db.commit()

    assert client.get("/api/saas/metrics", headers=h).status_code == status.HTTP_200_OK


def test_invitation_flow(client: TestClient) -> None:
    admin = register(client, org="Invite Co", name="Ivy Admin", email="ivy@invite.com")
    h = headers(admin)

    created = client.post("/api/invitations/", headers=h, json={"email": "New@Invite.com", "role": "sender"})
    assert created.status_code == status.HTTP_201_CREATED, created.text
    link = created.json()["invite_link"]
    token = link.rsplit("/", 1)[-1]
    assert created.json()["invitation"]["email"] == "new@invite.com"

    listed = client.get("/api/invitations/", headers=h)
    assert listed.status_code == status.HTTP_200_OK
    assert len(listed.json()) == 1

    accepted = client.post(
        "/api/invitations/accept",
        json={"token": token, "name": "Newcomer", "password": "another-strong-pass"},
    )
    assert accepted.status_code == status.HTTP_201_CREATED, accepted.text
    body = accepted.json()
    assert body["user"]["role"] == "sender"
    assert body["user"]["organization_id"] == admin["user"]["organization_id"]
    assert body["access_token"]

    # Single-use.
    replay = client.post(
        "/api/invitations/accept",
        json={"token": token, "name": "Newcomer", "password": "another-strong-pass"},
    )
    assert replay.status_code == status.HTTP_410_GONE

    # Accepted invites no longer show as pending.
    assert client.get("/api/invitations/", headers=h).json() == []


def test_invitation_requires_org_admin_and_unique_email(client: TestClient) -> None:
    admin = register(client, org="Guard Co", name="Gus Admin", email="gus@guard.com")
    h = headers(admin)

    # This test is about permission scoping, not seat limits: lift the org off the
    # 2-seat entry plan so the entitlement check never masks the assertions below.
    client.get("/api/billing/plans")
    assert upgrade_plan(client, h, "business")["plan_code"] == "business"

    dup = client.post("/api/invitations/", headers=h, json={"email": "gus@guard.com"})
    assert dup.status_code == status.HTTP_409_CONFLICT

    created = client.post("/api/invitations/", headers=h, json={"email": "sender@guard.com"})
    token = created.json()["invite_link"].rsplit("/", 1)[-1]
    sender = client.post(
        "/api/invitations/accept",
        json={"token": token, "name": "Sam Sender", "password": "another-strong-pass"},
    )
    sender_headers = headers(sender.json())

    assert client.post("/api/invitations/", headers=sender_headers, json={"email": "x@guard.com"}).status_code == (
        status.HTTP_403_FORBIDDEN
    )
    assert client.get("/api/invitations/", headers=sender_headers).status_code == status.HTTP_403_FORBIDDEN

    # Invitations are scoped to the inviting org only.
    other = register(client, org="Other Co", name="Otto Admin", email="otto@other.com")
    pending = client.post("/api/invitations/", headers=h, json={"email": "pending@guard.com"})
    invite_id = pending.json()["invitation"]["id"]
    assert client.delete(f"/api/invitations/{invite_id}", headers=headers(other)).status_code == (
        status.HTTP_404_NOT_FOUND
    )
    assert client.delete(f"/api/invitations/{invite_id}", headers=h).status_code == status.HTTP_204_NO_CONTENT


def test_invitation_rejects_bad_token(client: TestClient) -> None:
    response = client.post(
        "/api/invitations/accept",
        json={"token": "not-a-real-token", "name": "Nobody", "password": "another-strong-pass"},
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_org_member_role_management(client: TestClient) -> None:
    admin = register(client, org="Members Co", name="Mia Admin", email="mia@members.com")
    h = headers(admin)

    created = client.post("/api/invitations/", headers=h, json={"email": "member@members.com"})
    token = created.json()["invite_link"].rsplit("/", 1)[-1]
    member = client.post(
        "/api/invitations/accept",
        json={"token": token, "name": "Mel Member", "password": "another-strong-pass"},
    ).json()

    members = client.get("/api/organizations/me/members", headers=h)
    assert members.status_code == status.HTTP_200_OK
    assert {m["email"] for m in members.json()} == {"mia@members.com", "member@members.com"}
    assert "is_platform_admin" not in members.json()[0]

    promote = client.patch(
        f"/api/organizations/me/members/{member['user']['id']}/role",
        headers=h,
        json={"role": "admin"},
    )
    assert promote.status_code == status.HTTP_200_OK
    assert promote.json()["role"] == "admin"

    # Setting is_platform_admin is not accepted by the schema and never applied.
    db = next(client.app.dependency_overrides[get_db]())
    assert db.get(User, member["user"]["id"]).is_platform_admin is False

    # Cross-tenant member management is impossible.
    other = register(client, org="Outsider Co", name="Ozzy", email="ozzy@outsider.com")
    assert client.patch(
        f"/api/organizations/me/members/{member['user']['id']}/role",
        headers=headers(other),
        json={"role": "sender"},
    ).status_code == status.HTTP_404_NOT_FOUND


def test_last_admin_cannot_be_demoted(client: TestClient) -> None:
    admin = register(client, org="Solo Co", name="Sol Admin", email="sol@solo.com")
    h = headers(admin)

    demote = client.patch(
        f"/api/organizations/me/members/{admin['user']['id']}/role",
        headers=h,
        json={"role": "sender"},
    )
    assert demote.status_code == status.HTTP_409_CONFLICT

    # With a second admin present, demotion is allowed.
    created = client.post("/api/invitations/", headers=h, json={"email": "co@solo.com", "role": "admin"})
    token = created.json()["invite_link"].rsplit("/", 1)[-1]
    client.post("/api/invitations/accept", json={"token": token, "name": "Co Admin", "password": "another-strong-pass"})

    demote = client.patch(
        f"/api/organizations/me/members/{admin['user']['id']}/role",
        headers=h,
        json={"role": "sender"},
    )
    assert demote.status_code == status.HTTP_200_OK
    assert demote.json()["role"] == "sender"


def test_invitation_is_capped_by_the_plan_seat_limit(client: TestClient) -> None:
    """The entry plan allows 2 users, so the seat that tips an org over is refused."""
    admin = register(client, org="Seat Co", name="Sia Admin", email="sia@seat.com")
    h = headers(admin)
    client.get("/api/billing/plans")

    # Org has 1 user; the 2nd seat is within the entry plan.
    first = client.post("/api/invitations/", headers=h, json={"email": "two@seat.com"})
    assert first.status_code == 201, first.text
    token = first.json()["invite_link"].rsplit("/", 1)[-1]
    accepted = client.post(
        "/api/invitations/accept",
        json={"token": token, "name": "Two", "password": "another-strong-pass"},
    )
    assert accepted.status_code == 201, accepted.text

    # The org is now full, so the next invite is refused up front.
    assert client.post("/api/invitations/", headers=h, json={"email": "three@seat.com"}).status_code == 402

    # ...and raising the plan lifts the cap.
    assert upgrade_plan(client, h, "business")["plan_code"] == "business"
    assert client.post("/api/invitations/", headers=h, json={"email": "three@seat.com"}).status_code == 201
