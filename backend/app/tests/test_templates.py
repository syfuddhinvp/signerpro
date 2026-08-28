from fastapi import status
from fastapi.testclient import TestClient


def register(client: TestClient, *, org: str, name: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def prepared_document(client: TestClient, headers: dict[str, str], pdf_bytes: bytes, title: str = "Purchase agreement") -> dict:
    doc = client.post("/api/documents", headers=headers, json={"title": title}).json()
    upload = client.post(
        f"/api/documents/{doc['id']}/upload-pdf",
        headers=headers,
        files={"upload": ("a.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == status.HTTP_200_OK, upload.text
    return upload.json()["document"]


def add_recipient_and_field(client: TestClient, headers: dict[str, str], document_id: str) -> None:
    recipient = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={"name": "Dana", "email": "dana@customer.com", "signing_order": 1},
    )
    assert recipient.status_code in (200, 201), recipient.text
    field = client.post(
        f"/api/documents/{document_id}/fields",
        headers=headers,
        json={
            "recipient_id": recipient.json()["id"],
            "type": "signature",
            "page_number": 1,
            "x": 100,
            "y": 100,
            "width": 150,
            "height": 40,
            "required": True,
            "label": "Sign here",
        },
    )
    assert field.status_code in (200, 201), field.text


def make_template(client: TestClient, headers: dict[str, str], pdf_bytes: bytes, title: str = "NDA") -> dict:
    document = prepared_document(client, headers, pdf_bytes, title=title)
    add_recipient_and_field(client, headers, document["id"])
    response = client.post(f"/api/templates/from-document/{document['id']}", headers=headers, json={})
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()


def test_create_template_from_document_copies_fields(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    template = make_template(client, headers, pdf_bytes, title="Mutual NDA")

    assert template["title"] == "Mutual NDA template"
    assert template["field_count"] == 1
    assert template["recipient_count"] == 1
    assert template["use_count"] == 0
    assert template["owner_name"] == "Ada"
    assert template["page_count"] == 1
    assert template["archived_at"] is None

    # It really is a template on the documents side too.
    assert client.get(f"/api/documents/{template['id']}", headers=headers).json()["is_template"] is True
    # A template is not a document in the library list.
    assert [doc["id"] for doc in client.get("/api/documents", headers=headers).json()] != [template["id"]]


def test_template_list_use_counts_and_field_counts(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    template = make_template(client, headers, pdf_bytes, title="NDA")
    other = make_template(client, headers, pdf_bytes, title="Order form")

    listed = client.get("/api/templates", headers=headers).json()
    assert listed["total"] == 2
    assert {item["title"] for item in listed["items"]} == {"NDA template", "Order form template"}
    assert all(item["field_count"] == 1 for item in listed["items"])
    assert all(item["use_count"] == 0 for item in listed["items"])

    # Using a template creates a document and bumps the derived use_count.
    used = client.post(f"/api/templates/{template['id']}/use", headers=headers, json={"title": "NDA - Globex"})
    assert used.status_code == status.HTTP_201_CREATED, used.text
    document = used.json()
    assert document["is_template"] is False
    assert document["title"] == "NDA - Globex"
    assert document["recipients_total"] == 1

    refreshed = client.get(f"/api/templates/{template['id']}", headers=headers).json()
    assert refreshed["use_count"] == 1
    assert refreshed["field_count"] == 1

    client.post(f"/api/templates/{template['id']}/use", headers=headers, json={})
    assert client.get(f"/api/templates/{template['id']}", headers=headers).json()["use_count"] == 2

    by_uses = client.get("/api/templates?sort=uses", headers=headers).json()["items"]
    assert by_uses[0]["id"] == template["id"]

    by_name = client.get("/api/templates?sort=name", headers=headers).json()["items"]
    assert [item["title"] for item in by_name] == ["NDA template", "Order form template"]

    searched = client.get("/api/templates?q=order", headers=headers).json()
    assert searched["total"] == 1
    assert searched["items"][0]["id"] == other["id"]

    paged = client.get("/api/templates?limit=1", headers=headers).json()
    assert len(paged["items"]) == 1 and paged["total"] == 2


def test_template_rename_duplicate_archive(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    template = make_template(client, headers, pdf_bytes)

    renamed = client.patch(
        f"/api/templates/{template['id']}", headers=headers, json={"title": "Renamed NDA", "doc_type": "nda"}
    )
    assert renamed.status_code == status.HTTP_200_OK, renamed.text
    assert renamed.json()["title"] == "Renamed NDA"
    assert renamed.json()["doc_type"] == "nda"

    duplicated = client.post(f"/api/templates/{template['id']}/duplicate", headers=headers, json={})
    assert duplicated.status_code == status.HTTP_201_CREATED, duplicated.text
    assert duplicated.json()["title"] == "Renamed NDA (Copy)"
    assert duplicated.json()["field_count"] == 1
    assert duplicated.json()["id"] != template["id"]
    assert client.get("/api/templates", headers=headers).json()["total"] == 2

    archived = client.post(f"/api/templates/{template['id']}/archive", headers=headers)
    assert archived.status_code == status.HTTP_200_OK
    assert archived.json()["archived_at"] is not None
    assert client.get("/api/templates", headers=headers).json()["total"] == 1
    assert client.get("/api/templates?include_archived=true", headers=headers).json()["total"] == 2
    # Archived templates cannot be used.
    assert client.post(f"/api/templates/{template['id']}/use", headers=headers, json={}).status_code == 409

    restored = client.post(f"/api/templates/{template['id']}/restore", headers=headers)
    assert restored.json()["archived_at"] is None
    assert client.get("/api/templates", headers=headers).json()["total"] == 2


def test_template_usage_report(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    template = make_template(client, headers, pdf_bytes)
    client.post(f"/api/templates/{template['id']}/use", headers=headers, json={})
    client.post(f"/api/templates/{template['id']}/use", headers=headers, json={})

    usage = client.get(f"/api/templates/{template['id']}/usage", headers=headers)
    assert usage.status_code == status.HTTP_200_OK, usage.text
    body = usage.json()
    assert body["template_id"] == template["id"]
    assert body["use_count"] == 2
    assert body["completed_copies"] == 0
    assert body["by_sender"] == [{"name": "Ada", "count": 2}]
    assert len(body["series"]) == 30
    assert sum(body["series"]) == 2


def test_template_validation_errors(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    document = prepared_document(client, headers, pdf_bytes)
    template = make_template(client, headers, pdf_bytes, title="NDA")

    assert client.get("/api/templates?sort=sideways", headers=headers).status_code == status.HTTP_400_BAD_REQUEST
    assert client.patch(f"/api/templates/{template['id']}", headers=headers, json={"title": ""}).status_code == 422
    # A plain document is not reachable through the templates router.
    assert client.get(f"/api/templates/{document['id']}", headers=headers).status_code == 404
    # ...and a template cannot be re-templated.
    assert client.post(
        f"/api/templates/from-document/{template['id']}", headers=headers, json={}
    ).status_code == status.HTTP_400_BAD_REQUEST
    assert client.patch(
        f"/api/templates/{template['id']}", headers=headers, json={"folder_id": "nope"}
    ).status_code == 404


def test_templates_require_auth(client: TestClient) -> None:
    assert client.get("/api/templates").status_code == status.HTTP_401_UNAUTHORIZED


def test_templates_are_isolated_per_organization(client: TestClient, pdf_bytes: bytes) -> None:
    acme = register(client, org="Acme", name="Ada", email="ada@acme.com")
    globex = register(client, org="Globex", name="Gil", email="gil@globex.com")
    template = make_template(client, acme, pdf_bytes)

    assert client.get("/api/templates", headers=globex).json() == {"items": [], "total": 0}
    assert client.get(f"/api/templates/{template['id']}", headers=globex).status_code == 404
    assert client.patch(f"/api/templates/{template['id']}", headers=globex, json={"title": "Hijack"}).status_code == 404
    assert client.post(f"/api/templates/{template['id']}/duplicate", headers=globex, json={}).status_code == 404
    assert client.post(f"/api/templates/{template['id']}/use", headers=globex, json={}).status_code == 404
    assert client.get(f"/api/templates/{template['id']}/usage", headers=globex).status_code == 404
    assert client.post(f"/api/templates/{template['id']}/archive", headers=globex).status_code == 404
