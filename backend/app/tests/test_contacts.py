import io

from fastapi import status
from fastapi.testclient import TestClient


def register(client: TestClient, *, org: str, name: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def make_contact(client: TestClient, headers: dict[str, str], **overrides) -> dict:
    payload = {
        "name": "Dana Signer",
        "email": "dana@customer.com",
        "company": "Customer Co",
        "title": "COO",
        "default_role": "sign",
        "group": "customers",
        "tags": ["vip"],
    }
    payload.update(overrides)
    response = client.post("/api/contacts", headers=headers, json=payload)
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()


def prepared_document(client: TestClient, headers: dict[str, str], pdf_bytes: bytes, title: str = "Purchase agreement") -> dict:
    doc = client.post("/api/documents", headers=headers, json={"title": title}).json()
    upload = client.post(
        f"/api/documents/{doc['id']}/upload-pdf",
        headers=headers,
        files={"upload": ("a.pdf", pdf_bytes, "application/pdf")},
    )
    assert upload.status_code == status.HTTP_200_OK, upload.text
    return upload.json()["document"]


# --------------------------- CRUD ---------------------------


def test_contact_crud_happy_path(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")

    created = make_contact(client, headers)
    assert created["group"] == "customers"
    assert created["source"] == "manual"
    assert created["envelope_count"] == 0
    assert created["last_signed_at"] is None
    assert created["tags"] == ["vip"]

    fetched = client.get(f"/api/contacts/{created['id']}", headers=headers)
    assert fetched.status_code == status.HTTP_200_OK
    assert fetched.json()["email"] == "dana@customer.com"

    patched = client.patch(
        f"/api/contacts/{created['id']}",
        headers=headers,
        json={"company": "Customer Group", "group": "counsel", "tags": ["vip", "legal"]},
    )
    assert patched.status_code == status.HTTP_200_OK, patched.text
    assert patched.json()["company"] == "Customer Group"
    assert patched.json()["group"] == "counsel"
    assert patched.json()["tags"] == ["vip", "legal"]

    deleted = client.delete(f"/api/contacts/{created['id']}", headers=headers)
    assert deleted.status_code == status.HTTP_204_NO_CONTENT
    assert client.get(f"/api/contacts/{created['id']}", headers=headers).status_code == status.HTTP_404_NOT_FOUND


def test_contacts_require_auth(client: TestClient) -> None:
    assert client.get("/api/contacts").status_code == status.HTTP_401_UNAUTHORIZED


def test_contact_validation_errors(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")

    bad_email = client.post("/api/contacts", headers=headers, json={"name": "X", "email": "not-an-email"})
    assert bad_email.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    bad_role = client.post(
        "/api/contacts",
        headers=headers,
        json={"name": "X", "email": "x@example.com", "default_role": "wizard"},
    )
    assert bad_role.status_code == status.HTTP_400_BAD_REQUEST

    make_contact(client, headers)
    duplicate = client.post(
        "/api/contacts",
        headers=headers,
        json={"name": "Other", "email": "DANA@customer.com"},
    )
    assert duplicate.status_code == status.HTTP_409_CONFLICT


# --------------------------- list / search / counts ---------------------------


def test_contact_list_search_group_filter_and_counts(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    make_contact(client, headers, name="Dana Signer", email="dana@customer.com", group="customers", company="Customer Co")
    make_contact(client, headers, name="Ivan Internal", email="ivan@acme.com", group="internal", company="Acme")
    make_contact(client, headers, name="Cora Counsel", email="cora@law.com", group="counsel", company="Law LLP")

    listed = client.get("/api/contacts", headers=headers).json()
    assert listed["total"] == 3
    assert listed["counts"]["all"] == 3
    assert listed["counts"]["customers"] == 1
    assert listed["counts"]["internal"] == 1
    assert listed["counts"]["vendors"] == 0

    by_group = client.get("/api/contacts?group=counsel", headers=headers).json()
    assert by_group["total"] == 1
    assert by_group["items"][0]["name"] == "Cora Counsel"
    # Counts stay global so the sidebar does not collapse when a filter is applied.
    assert by_group["counts"]["all"] == 3

    searched = client.get("/api/contacts?q=internal", headers=headers).json()
    assert [item["email"] for item in searched["items"]] == ["ivan@acme.com"]

    by_company = client.get("/api/contacts?q=customer%20co", headers=headers).json()
    assert by_company["total"] == 1

    tagged = client.get("/api/contacts?tag=vip", headers=headers).json()
    assert tagged["total"] == 3

    paged = client.get("/api/contacts?limit=2&offset=0", headers=headers).json()
    assert len(paged["items"]) == 2
    assert paged["total"] == 3


# --------------------------- derived counts ---------------------------


def test_envelope_count_and_last_signed_at_are_derived(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    contact = make_contact(client, headers)

    document = prepared_document(client, headers, pdf_bytes)
    added = client.post(
        "/api/contacts/add-as-recipients",
        headers=headers,
        json={"document_id": document["id"], "contact_ids": [contact["id"]]},
    )
    assert added.status_code == status.HTTP_201_CREATED, added.text
    recipient = added.json()[0]
    assert recipient["email"] == "dana@customer.com"
    assert recipient["name"] == "Dana Signer"

    refreshed = client.get(f"/api/contacts/{contact['id']}", headers=headers).json()
    assert refreshed["envelope_count"] == 1
    assert refreshed["last_signed_at"] is None

    history = client.get(f"/api/contacts/{contact['id']}/history", headers=headers).json()
    assert len(history) == 1
    assert history[0]["document_id"] == document["id"]
    assert history[0]["title"] == "Purchase agreement"
    assert history[0]["event"] == "sent"

    # A second envelope bumps the derived count.
    second = prepared_document(client, headers, pdf_bytes, title="NDA")
    client.post(
        "/api/contacts/add-as-recipients",
        headers=headers,
        json={"document_id": second["id"], "contact_ids": [contact["id"]]},
    )
    assert client.get(f"/api/contacts/{contact['id']}", headers=headers).json()["envelope_count"] == 2


def test_add_as_recipients_is_idempotent_and_validated(client: TestClient, pdf_bytes: bytes) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    contact = make_contact(client, headers)
    document = prepared_document(client, headers, pdf_bytes)

    body = {"document_id": document["id"], "contact_ids": [contact["id"]]}
    assert len(client.post("/api/contacts/add-as-recipients", headers=headers, json=body).json()) == 1
    # Already on the envelope: no duplicate recipient row.
    assert client.post("/api/contacts/add-as-recipients", headers=headers, json=body).json() == []

    missing = client.post(
        "/api/contacts/add-as-recipients",
        headers=headers,
        json={"document_id": document["id"], "contact_ids": ["nope"]},
    )
    assert missing.status_code == status.HTTP_404_NOT_FOUND


# --------------------------- groups ---------------------------


def test_contact_groups(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    make_contact(client, headers, group="customers")

    groups = client.get("/api/contacts/groups", headers=headers).json()
    keys = {group["key"]: group for group in groups}
    assert set(keys) == {"customers", "internal", "counsel", "vendors"}
    assert keys["customers"]["contact_count"] == 1

    created = client.post("/api/contacts/groups", headers=headers, json={"key": "partners", "label": "Partners"})
    assert created.status_code == status.HTTP_201_CREATED, created.text
    assert client.post(
        "/api/contacts/groups", headers=headers, json={"key": "partners", "label": "Dupe"}
    ).status_code == status.HTTP_409_CONFLICT

    renamed = client.patch(
        f"/api/contacts/groups/{created.json()['id']}", headers=headers, json={"label": "Channel partners"}
    )
    assert renamed.json()["label"] == "Channel partners"

    assert client.delete(f"/api/contacts/groups/{created.json()['id']}", headers=headers).status_code == 204

    # A non-empty group cannot be deleted out from under its members.
    customers_id = keys["customers"]["id"]
    assert client.delete(f"/api/contacts/groups/{customers_id}", headers=headers).status_code == status.HTTP_409_CONFLICT


# --------------------------- import ---------------------------


def test_contact_import_json_and_csv(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")

    dry = client.post(
        "/api/contacts/import",
        headers=headers,
        json={"dry_run": True, "contacts": [{"name": "A", "email": "a@x.com"}, {"name": "B", "email": "b@x.com"}]},
    )
    assert dry.status_code == status.HTTP_200_OK, dry.text
    assert dry.json() == {"created": 2, "updated": 0, "skipped": 0, "errors": []}
    assert client.get("/api/contacts", headers=headers).json()["total"] == 0

    real = client.post(
        "/api/contacts/import",
        headers=headers,
        json={"contacts": [{"name": "A", "email": "a@x.com"}, {"name": "B", "email": "b@x.com"}, {"name": "B2", "email": "b@x.com"}]},
    )
    assert real.json()["created"] == 2
    assert real.json()["skipped"] == 1
    assert client.get("/api/contacts", headers=headers).json()["total"] == 2

    csv_bytes = b"name,email,company,group,tags\nCarl CRM,carl@crm.com,CRM Co,vendors,a;b\nA Renamed,a@x.com,,customers,\n"
    imported = client.post(
        "/api/contacts/import/csv",
        headers=headers,
        files={"upload": ("contacts.csv", io.BytesIO(csv_bytes), "text/csv")},
    )
    assert imported.status_code == status.HTTP_200_OK, imported.text
    assert imported.json()["created"] == 1
    assert imported.json()["updated"] == 1

    carl = [c for c in client.get("/api/contacts", headers=headers).json()["items"] if c["email"] == "carl@crm.com"][0]
    assert carl["source"] == "crm"
    assert carl["group"] == "vendors"
    assert carl["tags"] == ["a", "b"]

    bad = client.post(
        "/api/contacts/import/csv",
        headers=headers,
        files={"upload": ("contacts.csv", io.BytesIO(b"first,last\nA,B\n"), "text/csv")},
    )
    assert bad.status_code == status.HTTP_400_BAD_REQUEST


# --------------------------- tenancy ---------------------------


def test_contacts_are_isolated_per_organization(client: TestClient) -> None:
    acme = register(client, org="Acme", name="Ada", email="ada@acme.com")
    other = register(client, org="Globex", name="Gil", email="gil@globex.com")

    contact = make_contact(client, acme)
    # Same email is free to reuse inside a different tenant.
    other_contact = make_contact(client, other, name="Dana Elsewhere")
    assert other_contact["id"] != contact["id"]

    assert client.get("/api/contacts", headers=other).json()["total"] == 1
    assert client.get("/api/contacts", headers=other).json()["items"][0]["name"] == "Dana Elsewhere"

    assert client.get(f"/api/contacts/{contact['id']}", headers=other).status_code == status.HTTP_404_NOT_FOUND
    assert client.patch(f"/api/contacts/{contact['id']}", headers=other, json={"name": "Hijack"}).status_code == 404
    assert client.delete(f"/api/contacts/{contact['id']}", headers=other).status_code == 404
    assert client.get(f"/api/contacts/{contact['id']}/history", headers=other).status_code == 404

    acme_group_id = client.get("/api/contacts/groups", headers=acme).json()[0]["id"]
    assert client.patch(f"/api/contacts/groups/{acme_group_id}", headers=other, json={"label": "X"}).status_code == 404
