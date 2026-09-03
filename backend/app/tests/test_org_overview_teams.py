"""Tenant self-service organization surface: settings (ORG-1), the Overview
aggregate (ORG-2) and teams (ORG-8)."""

from fastapi import status
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.tests.conftest import upgrade_plan


def register(client: TestClient, *, org: str, name: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def make_sender(client: TestClient, *, org_id: str, email: str, name: str) -> str:
    """A second member of the same tenant, without the admin role."""
    from app.core.security import hash_password

    db = db_session(client)
    user = User(
        organization_id=org_id,
        name=name,
        email=email,
        password_hash=hash_password("strong-password"),
        role=UserRole.sender,
    )
    db.add(user)
    db.commit()
    return user.id


def org_id_of(client: TestClient, email: str) -> str:
    return db_session(client).query(User).filter(User.email == email).one().organization_id


# --- ORG-1: self-service tenant profile ------------------------------------


def test_org_admin_owns_the_tenant_profile_fields(client: TestClient) -> None:
    headers = register(client, org="Acme Realty", name="Ada", email="ada@acme.com")

    before = client.get("/api/organizations/me", headers=headers).json()
    assert before["slug"] is None and before["seats_licensed"] == 0

    response = client.patch(
        "/api/organizations/me",
        headers=headers,
        json={
            "slug": "acme-realty",
            "region": "eu-west-1",
            "company_size": "11-50",
            "seats_licensed": 25,
        },
    )
    assert response.status_code == status.HTTP_200_OK, response.text
    body = response.json()
    assert body["slug"] == "acme-realty"
    assert body["region"] == "eu-west-1"
    assert body["company_size"] == "11-50"
    assert body["seats_licensed"] == 25

    # Branding is a paid feature: the entry plan may not set it, so it moved
    # out of this test and into test_custom_branding_is_entitlement_gated.
    upgrade_plan(client, headers, "business")
    branded = client.patch(
        "/api/organizations/me",
        headers=headers,
        json={"accent_color": "#1d4ed8", "logo_url": "https://cdn.example.com/acme.png"},
    )
    assert branded.status_code == status.HTTP_200_OK, branded.text
    assert branded.json()["accent_color"] == "#1d4ed8"
    assert branded.json()["logo_url"] == "https://cdn.example.com/acme.png"
    # And they are readable back by any member, not only the admin.
    assert client.get("/api/organizations/me", headers=headers).json()["slug"] == "acme-realty"


def test_slug_is_validated_and_unique_across_tenants(client: TestClient) -> None:
    acme = register(client, org="Acme", name="Ada", email="ada@acme.com")
    globex = register(client, org="Globex", name="Gil", email="gil@globex.com")

    assert client.patch("/api/organizations/me", headers=acme, json={"slug": "shared"}).status_code == 200
    # A slug already taken by another tenant is a 409, not an IntegrityError.
    clash = client.patch("/api/organizations/me", headers=globex, json={"slug": "shared"})
    assert clash.status_code == status.HTTP_409_CONFLICT
    # Re-sending your own slug is a no-op, not a conflict.
    assert client.patch("/api/organizations/me", headers=acme, json={"slug": "shared"}).status_code == 200

    for bad in ("Not Lowercase", "-leading", "trailing-", "has spaces", "a" * 81):
        assert (
            client.patch("/api/organizations/me", headers=acme, json={"slug": bad}).status_code
            == status.HTTP_422_UNPROCESSABLE_ENTITY
        ), bad
    assert (
        client.patch("/api/organizations/me", headers=acme, json={"accent_color": "blue"}).status_code
        == status.HTTP_422_UNPROCESSABLE_ENTITY
    )
    # Credentials are write-only: they never come back in the response.
    updated = client.patch(
        "/api/organizations/me", headers=acme, json={"smtp_password": "s3cret", "smtp_host": "smtp.acme.com"}
    ).json()
    assert "smtp_password" not in updated and updated["smtp_host"] == "smtp.acme.com"


def test_profile_update_is_admin_only(client: TestClient) -> None:
    admin = register(client, org="Acme", name="Ada", email="ada@acme.com")
    org_id = org_id_of(client, "ada@acme.com")
    make_sender(client, org_id=org_id, email="sam@acme.com", name="Sam")
    sender = client.post(
        "/api/auth/login", json={"email": "sam@acme.com", "password": "strong-password"}
    ).json()
    sender_headers = {"Authorization": f"Bearer {sender['access_token']}"}

    assert client.patch("/api/organizations/me", headers=sender_headers, json={"slug": "nope"}).status_code == 403
    assert client.get("/api/organizations/me", headers=sender_headers).status_code == 200
    assert client.patch("/api/organizations/me", headers=admin, json={"slug": "ok"}).status_code == 200


# --- ORG-2: the Overview aggregate -----------------------------------------


def test_overview_aggregates_are_derived_and_scoped(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    client.patch("/api/organizations/me", headers=headers, json={"seats_licensed": 5})

    empty = client.get("/api/organizations/me/overview", headers=headers)
    assert empty.status_code == status.HTTP_200_OK, empty.text
    body = empty.json()
    assert body["range"] == "30d"
    assert len(body["series"]) == 12
    assert body["stats"]["seats_licensed"] == 5
    assert body["stats"]["seats_activated"] == 1
    assert body["stats"]["completion_rate"] == 0.0
    assert [row["name"] for row in body["team"]] == ["Ada"]
    assert body["team"][0]["role_label"] == "Organization admin"

    # A draft is work waiting on us; sending it moves it out for signature.
    doc = client.post("/api/documents", json={"title": "Deal"}, headers=headers).json()
    client.post(
        f"/api/documents/{doc['id']}/upload-pdf",
        headers=headers,
        files={"upload": ("a.pdf", pdf_bytes, "application/pdf")},
    )
    after_draft = client.get("/api/organizations/me/overview", headers=headers).json()
    assert after_draft["stats"]["action_required"] >= 1
    assert after_draft["stats"]["out_for_signature"] == 0
    assert sum(after_draft["series"]) == 1

    recipient_id = client.post(
        f"/api/documents/{doc['id']}/recipients",
        headers=headers,
        json={"name": "Signer", "email": "signer@example.com", "role_name": "Signer", "signing_order": 1},
    ).json()["id"]
    field = client.post(
        f"/api/documents/{doc['id']}/fields",
        headers=headers,
        json={
            "recipient_id": recipient_id,
            "type": "signature",
            "label": "Sign",
            "required": True,
            "page_number": 1,
            "x": 72,
            "y": 100,
            "width": 180,
            "height": 48,
        },
    )
    assert field.status_code == 201, field.text
    assert client.post(f"/api/documents/{doc['id']}/send", headers=headers).status_code == 200

    sent = client.get("/api/organizations/me/overview", headers=headers).json()
    assert sent["stats"]["out_for_signature"] == 1
    assert sent["team"][0]["sent_count"] == 1

    # Ranges are validated; every one yields twelve buckets.
    for range_key in ("7d", "30d", "90d", "12m"):
        page = client.get(f"/api/organizations/me/overview?range={range_key}", headers=headers).json()
        assert page["range"] == range_key and len(page["series"]) == 12
    assert client.get("/api/organizations/me/overview?range=all", headers=headers).status_code == 422

    # Another tenant sees none of it.
    other = register(client, org="Globex", name="Gil", email="gil@globex.com")
    theirs = client.get("/api/organizations/me/overview", headers=other).json()
    assert theirs["stats"]["out_for_signature"] == 0
    assert sum(theirs["series"]) == 0
    assert client.get("/api/organizations/me/overview").status_code == 401


# --- ORG-8: teams ----------------------------------------------------------


def test_team_crud_and_membership(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    org_id = org_id_of(client, "ada@acme.com")
    sam_id = make_sender(client, org_id=org_id, email="sam@acme.com", name="Sam")

    assert client.get("/api/teams", headers=headers).json() == []

    created = client.post("/api/teams", headers=headers, json={"name": "Legal", "description": "Contracts"})
    assert created.status_code == status.HTTP_201_CREATED, created.text
    team = created.json()
    assert team["name"] == "Legal"
    assert team["organization_id"] == org_id
    # The creating admin joins as lead so the team is never orphaned.
    assert team["member_count"] == 1 and team["my_role"] == "lead"

    assert client.post("/api/teams", headers=headers, json={"name": "legal"}).status_code == 409
    assert client.post("/api/teams", headers=headers, json={"name": ""}).status_code == 422

    added = client.post(f"/api/teams/{team['id']}/members", headers=headers, json={"user_id": sam_id})
    assert added.status_code == 201, added.text
    assert added.json()["member_count"] == 2
    assert {row["email"] for row in added.json()["members"]} == {"ada@acme.com", "sam@acme.com"}
    # my_role stays the caller's, not the added member's.
    assert added.json()["my_role"] == "lead"
    # Idempotent: re-adding updates the role instead of duplicating.
    promoted = client.post(
        f"/api/teams/{team['id']}/members", headers=headers, json={"user_id": sam_id, "role": "lead"}
    ).json()
    assert promoted["member_count"] == 2
    assert {row["role"] for row in promoted["members"]} == {"lead"}
    assert client.post(
        f"/api/teams/{team['id']}/members", headers=headers, json={"user_id": sam_id, "role": "boss"}
    ).status_code == 422

    renamed = client.patch(f"/api/teams/{team['id']}", headers=headers, json={"name": "Legal EMEA"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "Legal EMEA"
    assert client.get(f"/api/teams/{team['id']}", headers=headers).json()["name"] == "Legal EMEA"

    assert client.delete(f"/api/teams/{team['id']}/members/{sam_id}", headers=headers).status_code == 204
    assert client.get(f"/api/teams/{team['id']}", headers=headers).json()["member_count"] == 1
    assert client.delete(f"/api/teams/{team['id']}/members/{sam_id}", headers=headers).status_code == 404

    assert client.delete(f"/api/teams/{team['id']}", headers=headers).status_code == 204
    assert client.get("/api/teams", headers=headers).json() == []


def test_team_deletion_unshares_folders_but_keeps_documents(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    team = client.post("/api/teams", headers=headers, json={"name": "Legal"}).json()

    folder = client.post(
        "/api/folders", headers=headers, json={"name": "Global Legal", "team_id": team["id"]}
    )
    assert folder.status_code == 201, folder.text
    folder_id = folder.json()["id"]

    doc = client.post("/api/documents", json={"title": "Deal"}, headers=headers).json()
    client.post(
        f"/api/documents/{doc['id']}/upload-pdf",
        headers=headers,
        files={"upload": ("a.pdf", pdf_bytes, "application/pdf")},
    )
    client.post("/api/folders/move", headers=headers, json={"document_ids": [doc["id"]], "folder_id": folder_id})
    assert client.get("/api/teams", headers=headers).json()[0]["document_count"] == 1

    assert client.delete(f"/api/teams/{team['id']}", headers=headers).status_code == 204

    # The folder survives as a personal folder and still holds the document.
    tree = client.get("/api/folders/tree", headers=headers).json()
    assert tree["team"] == []
    assert [(node["name"], node["document_count"]) for node in tree["personal"]] == [("Global Legal", 1)]
    assert client.get(f"/api/documents/{doc['id']}", headers=headers).status_code == 200


def test_teams_are_admin_gated_and_tenant_isolated(client: TestClient) -> None:
    admin = register(client, org="Acme", name="Ada", email="ada@acme.com")
    org_id = org_id_of(client, "ada@acme.com")
    make_sender(client, org_id=org_id, email="sam@acme.com", name="Sam")
    sender = client.post(
        "/api/auth/login", json={"email": "sam@acme.com", "password": "strong-password"}
    ).json()
    sender_headers = {"Authorization": f"Bearer {sender['access_token']}"}

    team = client.post("/api/teams", headers=admin, json={"name": "Legal"}).json()

    # Any member may read the team list; only admins may change it.
    assert client.get("/api/teams", headers=sender_headers).status_code == 200
    assert client.get("/api/teams", headers=sender_headers).json()[0]["my_role"] is None
    assert client.post("/api/teams", headers=sender_headers, json={"name": "Shadow"}).status_code == 403
    assert client.patch(f"/api/teams/{team['id']}", headers=sender_headers, json={"name": "X"}).status_code == 403
    assert client.delete(f"/api/teams/{team['id']}", headers=sender_headers).status_code == 403

    # Cross-tenant ids read as absent, never as forbidden.
    globex = register(client, org="Globex", name="Gil", email="gil@globex.com")
    assert client.get("/api/teams", headers=globex).json() == []
    assert client.get(f"/api/teams/{team['id']}", headers=globex).status_code == 404
    assert client.patch(f"/api/teams/{team['id']}", headers=globex, json={"name": "Hijack"}).status_code == 404
    assert client.delete(f"/api/teams/{team['id']}", headers=globex).status_code == 404
    gil_id = db_session(client).query(User).filter(User.email == "gil@globex.com").one().id
    # A member of another tenant can never be added to this team.
    assert client.post(f"/api/teams/{team['id']}/members", headers=admin, json={"user_id": gil_id}).status_code == 404
    assert client.get("/api/teams").status_code == 401
