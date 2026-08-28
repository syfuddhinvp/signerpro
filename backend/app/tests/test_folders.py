from fastapi import status
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.models.team import Team, TeamMember
from app.models.user import User


def register(client: TestClient, *, org: str, name: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def make_team(client: TestClient, *, email: str, name: str = "Global Legal") -> str:
    """Teams have no router yet, so seed one directly for the shared-folder path."""
    db = db_session(client)
    user = db.query(User).filter(User.email == email).one()
    team = Team(organization_id=user.organization_id, name=name)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=user.id, role="member"))
    db.commit()
    return team.id


def make_folder(client: TestClient, headers: dict[str, str], **payload) -> dict:
    body = {"name": "Contracts"}
    body.update(payload)
    response = client.post("/api/folders", headers=headers, json=body)
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()


def prepared_document(client: TestClient, headers: dict[str, str], pdf_bytes: bytes, title: str = "Deal") -> dict:
    doc = client.post("/api/documents", headers=headers, json={"title": title}).json()
    upload = client.post(
        f"/api/documents/{doc['id']}/upload-pdf",
        headers=headers,
        files={"upload": ("a.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == status.HTTP_200_OK, upload.text
    return upload.json()["document"]


def test_folder_crud_and_tree(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")

    root = make_folder(client, headers, name="Contracts")
    child = make_folder(client, headers, name="2026", parent_id=root["id"])
    assert child["parent_id"] == root["id"]
    assert root["scope"] == "personal"
    assert root["document_count"] == 0

    tree = client.get("/api/folders/tree", headers=headers).json()
    assert [node["name"] for node in tree["personal"]] == ["Contracts"]
    assert [node["name"] for node in tree["personal"][0]["children"]] == ["2026"]
    assert tree["team"] == []
    assert tree["unfiled_count"] == 0

    flat = client.get("/api/folders", headers=headers).json()
    assert {node["name"] for node in flat} == {"Contracts", "2026"}

    renamed = client.patch(f"/api/folders/{root['id']}", headers=headers, json={"name": "Agreements"})
    assert renamed.status_code == status.HTTP_200_OK, renamed.text
    assert renamed.json()["name"] == "Agreements"

    # Deleting a parent re-parents its children rather than destroying them.
    assert client.delete(f"/api/folders/{root['id']}", headers=headers).status_code == 204
    remaining = client.get("/api/folders", headers=headers).json()
    assert [node["name"] for node in remaining] == ["2026"]
    assert remaining[0]["parent_id"] is None


def test_folders_require_auth(client: TestClient) -> None:
    assert client.get("/api/folders").status_code == status.HTTP_401_UNAUTHORIZED
    assert client.get("/api/folders/tree").status_code == status.HTTP_401_UNAUTHORIZED


def test_folder_validation_errors(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    folder = make_folder(client, headers)
    child = make_folder(client, headers, name="Sub", parent_id=folder["id"])

    assert client.post("/api/folders", headers=headers, json={"name": ""}).status_code == 422
    assert client.post("/api/folders", headers=headers, json={"name": "X", "parent_id": "nope"}).status_code == 404
    assert client.patch(
        f"/api/folders/{folder['id']}", headers=headers, json={"parent_id": folder["id"]}
    ).status_code == status.HTTP_400_BAD_REQUEST
    # A cycle through a descendant is refused too.
    assert client.patch(
        f"/api/folders/{folder['id']}", headers=headers, json={"parent_id": child["id"]}
    ).status_code == status.HTTP_400_BAD_REQUEST
    assert client.get("/api/folders/missing", headers=headers).status_code in (404, 405)


def test_shared_team_folders_are_visible_only_to_members(client: TestClient) -> None:
    owner = register(client, org="Acme", name="Ada", email="ada@acme.com")
    team_id = make_team(client, email="ada@acme.com")

    team_folder = make_folder(client, owner, name="Global Legal", team_id=team_id)
    assert team_folder["scope"] == "team"
    assert team_folder["team_id"] == team_id

    tree = client.get("/api/folders/tree", headers=owner).json()
    assert [node["name"] for node in tree["team"]] == ["Global Legal"]
    assert tree["team"][0]["team_name"] == "Global Legal"

    # A colleague who is not on the team does not see the shared folder.
    invited = client.post(
        "/api/auth/register",
        json={"organization_name": "Acme", "name": "Bob", "email": "bob@acme.com", "password": "strong-password"},
    )
    other = {"Authorization": f"Bearer {invited.json()['access_token']}"}
    assert client.get("/api/folders/tree", headers=other).json()["team"] == []

    # Creating a folder for a team you do not belong to is forbidden.
    assert client.post(
        "/api/folders", headers=other, json={"name": "Sneak", "team_id": team_id}
    ).status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND)


def test_move_documents_between_folders_and_counts(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    folder = make_folder(client, headers, name="Contracts")
    other_folder = make_folder(client, headers, name="Archive")
    first = prepared_document(client, headers, pdf_bytes, title="Deal A")
    second = prepared_document(client, headers, pdf_bytes, title="Deal B")

    assert client.get("/api/folders/tree", headers=headers).json()["unfiled_count"] == 2

    moved = client.post(
        "/api/folders/move",
        headers=headers,
        json={"document_ids": [first["id"], second["id"]], "folder_id": folder["id"]},
    )
    assert moved.status_code == status.HTTP_200_OK, moved.text
    assert set(moved.json()) == {first["id"], second["id"]}

    tree = client.get("/api/folders/tree", headers=headers).json()
    counts = {node["name"]: node["document_count"] for node in tree["personal"]}
    assert counts == {"Contracts": 2, "Archive": 0}
    assert tree["unfiled_count"] == 0

    client.post(
        "/api/folders/move",
        headers=headers,
        json={"document_ids": [second["id"]], "folder_id": other_folder["id"]},
    )
    tree = client.get("/api/folders/tree", headers=headers).json()
    assert {node["name"]: node["document_count"] for node in tree["personal"]} == {"Contracts": 1, "Archive": 1}

    # folder_id: null unfiles.
    client.post("/api/folders/move", headers=headers, json={"document_ids": [first["id"]], "folder_id": None})
    assert client.get("/api/folders/tree", headers=headers).json()["unfiled_count"] == 1

    # Deleting a folder unfiles its remaining documents.
    client.delete(f"/api/folders/{other_folder['id']}", headers=headers)
    assert client.get("/api/folders/tree", headers=headers).json()["unfiled_count"] == 2

    assert client.post(
        "/api/folders/move", headers=headers, json={"document_ids": [], "folder_id": None}
    ).status_code == 422


def test_folders_are_isolated_per_organization(client: TestClient, pdf_bytes: bytes) -> None:
    acme = register(client, org="Acme", name="Ada", email="ada@acme.com")
    globex = register(client, org="Globex", name="Gil", email="gil@globex.com")

    acme_folder = make_folder(client, acme, name="Acme Contracts")
    acme_doc = prepared_document(client, acme, pdf_bytes, title="Acme deal")

    assert client.get("/api/folders", headers=globex).json() == []
    assert client.get("/api/folders/tree", headers=globex).json()["unfiled_count"] == 0

    assert client.patch(f"/api/folders/{acme_folder['id']}", headers=globex, json={"name": "Hijack"}).status_code == 404
    assert client.delete(f"/api/folders/{acme_folder['id']}", headers=globex).status_code == 404

    globex_folder = make_folder(client, globex, name="Globex Contracts")
    # Cross-tenant move must fail on both the folder and the document side.
    assert client.post(
        "/api/folders/move",
        headers=globex,
        json={"document_ids": [acme_doc["id"]], "folder_id": globex_folder["id"]},
    ).status_code == status.HTTP_404_NOT_FOUND
    assert client.post(
        "/api/folders/move",
        headers=acme,
        json={"document_ids": [acme_doc["id"]], "folder_id": globex_folder["id"]},
    ).status_code == status.HTTP_404_NOT_FOUND
