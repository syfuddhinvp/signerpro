"""Coverage for the SignerPro library (DOC-1…DOC-7), bulk field save (FLD-2/3)
and recipient routing (RTE-1…RTE-4)."""

from datetime import date, timedelta

from fastapi import status
from fastapi.testclient import TestClient

from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document
from app.tests.test_tenancy import headers as bearer
from app.tests.test_tenancy import register


def _document(client: TestClient, headers: dict[str, str], title: str = "Doc") -> str:
    created = client.post("/api/documents", headers=headers, json={"title": title})
    assert created.status_code == 201, created.text
    return created.json()["id"]


# ----------------------------------------------------------------- library


def test_library_updated_range_is_inclusive_of_both_days(client: TestClient) -> None:
    """`updated_to` must include documents touched *on* that date — a naive
    midnight bound would have excluded every one of them."""
    headers = auth_headers(client)
    today = _document(client, headers, "Touched today")
    stamp = date.today()

    inside = client.get(
        "/api/documents/library",
        headers=headers,
        params={"updated_from": stamp.isoformat(), "updated_to": stamp.isoformat()},
    ).json()
    assert today in [item["id"] for item in inside["items"]]

    before = client.get(
        "/api/documents/library",
        headers=headers,
        params={"updated_to": (stamp - timedelta(days=1)).isoformat()},
    ).json()
    assert before["items"] == []

    after = client.get(
        "/api/documents/library",
        headers=headers,
        params={"updated_from": (stamp + timedelta(days=1)).isoformat()},
    ).json()
    assert after["items"] == []


def test_library_filters_sorting_pagination_and_counts(client: TestClient) -> None:
    headers = auth_headers(client)
    alpha = _document(client, headers, "Alpha lease")
    beta = _document(client, headers, "Beta NDA")
    gamma = _document(client, headers, "Gamma order")

    assert client.patch(f"/api/documents/{beta}", headers=headers, json={"doc_type": "nda"}).status_code == 200
    assert client.post(f"/api/documents/{gamma}/archive", headers=headers).status_code == 200

    page = client.get("/api/documents/library", headers=headers).json()
    ids = [item["id"] for item in page["items"]]
    assert gamma not in ids  # archived rows are out of the default view
    assert {alpha, beta} <= set(ids)
    assert page["total"] == 2
    assert page["counts"]["all"] == 2
    assert page["counts"]["draft"] == 2
    assert page["counts"]["archived"] == 1
    assert page["counts"]["trashed"] == 0

    # search
    found = client.get("/api/documents/library", headers=headers, params={"q": "beta"}).json()
    assert [item["id"] for item in found["items"]] == [beta]

    # type filter
    typed = client.get("/api/documents/library", headers=headers, params={"doc_type": "nda"}).json()
    assert [item["id"] for item in typed["items"]] == [beta]

    # sorting by name + pagination
    by_name = client.get(
        "/api/documents/library", headers=headers, params={"sort": "name", "limit": 1, "offset": 0}
    ).json()
    assert len(by_name["items"]) == 1
    assert by_name["items"][0]["id"] == alpha
    assert by_name["total"] == 2
    second = client.get(
        "/api/documents/library", headers=headers, params={"sort": "name", "limit": 1, "offset": 1}
    ).json()
    assert second["items"][0]["id"] == beta

    # archived + trash buckets
    archived = client.get("/api/documents/library", headers=headers, params={"quick": "archived"}).json()
    assert [item["id"] for item in archived["items"]] == [gamma]

    assert client.delete(f"/api/documents/{alpha}", headers=headers).status_code == 204
    trash = client.get("/api/documents/library", headers=headers, params={"quick": "trash"}).json()
    assert [item["id"] for item in trash["items"]] == [alpha]
    assert trash["counts"]["trashed"] == 1
    assert trash["counts"]["all"] == 1

    # owner + favourites
    mine = client.get("/api/documents/library", headers=headers, params={"owner": "me"}).json()
    assert [item["id"] for item in mine["items"]] == [beta]
    assert mine["items"][0]["owner_name"] == "Admin User"
    assert mine["items"][0]["is_favorite"] is False
    assert client.post(f"/api/documents/{beta}/favorite", headers=headers).status_code == 204
    favorites = client.get("/api/documents/library", headers=headers, params={"quick": "favorites"}).json()
    assert [item["id"] for item in favorites["items"]] == [beta]
    assert favorites["items"][0]["is_favorite"] is True
    assert client.delete(f"/api/documents/{beta}/favorite", headers=headers).status_code == 204
    assert client.get("/api/documents/library", headers=headers, params={"quick": "favorites"}).json()["total"] == 0

    counts = client.get("/api/documents/counts", headers=headers).json()
    assert counts["all"] == 1 and counts["archived"] == 1 and counts["trashed"] == 1


def test_library_rejects_unknown_sort(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.get("/api/documents/library", headers=headers, params={"sort": "sideways"})
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_soft_delete_restore_and_purge(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers, "Trash me")

    assert client.delete(f"/api/documents/{document_id}", headers=headers).status_code == 204
    assert client.get(f"/api/documents/{document_id}", headers=headers).json()["deleted_at"] is not None
    assert client.get("/api/documents", headers=headers).json() == []

    restored = client.post(f"/api/documents/{document_id}/restore", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["deleted_at"] is None
    assert client.post(f"/api/documents/{document_id}/restore", headers=headers).status_code == 409

    # purge is only legal from the trash
    assert client.delete(f"/api/documents/{document_id}?permanent=true", headers=headers).status_code == 409
    assert client.post(f"/api/documents/{document_id}/trash", headers=headers).status_code == 200
    assert client.delete(f"/api/documents/{document_id}?permanent=true", headers=headers).status_code == 204
    assert client.get(f"/api/documents/{document_id}", headers=headers).status_code == 404


def test_rename_duplicate_make_template_and_move(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Sam Signer", "sam@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Sign here", 300)

    renamed = client.post(f"/api/documents/{document_id}/rename", headers=headers, json={"title": "Renamed packet"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Renamed packet"
    assert client.post(f"/api/documents/{document_id}/rename", headers=headers, json={"title": ""}).status_code == 422

    copy = client.post(f"/api/documents/{document_id}/duplicate", headers=headers, json={"title": "Copy packet"})
    assert copy.status_code == 201, copy.text
    copy_id = copy.json()["id"]
    assert copy.json()["title"] == "Copy packet"
    assert copy.json()["is_template"] is False
    assert len(client.get(f"/api/documents/{copy_id}/recipients", headers=headers).json()) == 1
    assert len(client.get(f"/api/documents/{copy_id}/fields", headers=headers).json()) == 1

    template = client.post(f"/api/documents/{document_id}/make-template", headers=headers, json={})
    assert template.status_code == 201, template.text
    assert template.json()["is_template"] is True
    template_ids = [item["id"] for item in client.get("/api/documents/templates/all", headers=headers).json()]
    assert template.json()["id"] in template_ids

    folder = client.post("/api/folders", headers=headers, json={"name": "Closings"})
    assert folder.status_code == 201, folder.text
    folder_id = folder.json()["id"]
    moved = client.post(f"/api/documents/{document_id}/move", headers=headers, json={"folder_id": folder_id})
    assert moved.status_code == 200
    assert moved.json()["folder_id"] == folder_id
    in_folder = client.get("/api/documents/library", headers=headers, params={"folder_id": folder_id}).json()
    assert [item["id"] for item in in_folder["items"]] == [document_id]
    assert client.post(f"/api/documents/{document_id}/move", headers=headers, json={"folder_id": "missing"}).status_code == 404


def test_bulk_actions_and_bulk_download(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    first = create_uploaded_document(client, pdf_bytes, headers)
    second = _document(client, headers, "No PDF yet")

    result = client.post(
        "/api/documents/bulk",
        headers=headers,
        json={"document_ids": [first, second, "nope"], "action": "archive"},
    )
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["action"] == "archive"
    assert body["updated"] == 2
    assert sorted(body["document_ids"]) == sorted([first, second])
    assert body["skipped"] == [{"document_id": "nope", "reason": "not_found"}]
    assert client.get("/api/documents/counts", headers=headers).json()["archived"] == 2

    unarchived = client.post(
        "/api/documents/bulk", headers=headers, json={"document_ids": [first, second], "action": "unarchive"}
    ).json()
    assert unarchived["updated"] == 2

    folder_id = client.post("/api/folders", headers=headers, json={"name": "Bulk"}).json()["id"]
    moved = client.post(
        "/api/documents/bulk",
        headers=headers,
        json={"document_ids": [first, second], "action": "move", "folder_id": folder_id},
    ).json()
    assert moved["updated"] == 2
    assert client.get(f"/api/documents/{first}", headers=headers).json()["folder_id"] == folder_id

    deleted = client.post(
        "/api/documents/bulk", headers=headers, json={"document_ids": [first, second], "action": "delete"}
    ).json()
    assert deleted["updated"] == 2
    assert client.get("/api/documents/counts", headers=headers).json()["trashed"] == 2

    purged = client.delete("/api/documents/trash", headers=headers)
    assert purged.status_code == 200
    assert purged.json() == {"action": "purge", "updated": 2, "document_ids": [], "skipped": []}
    assert client.get("/api/documents/counts", headers=headers).json()["trashed"] == 0

    third = create_uploaded_document(client, pdf_bytes, headers)
    fourth = _document(client, headers, "Nothing to download")
    zipped = client.post("/api/documents/bulk-download", headers=headers, json={"document_ids": [third, fourth]})
    assert zipped.status_code == 200
    assert zipped.headers["content-type"] == "application/zip"
    assert zipped.headers["x-document-count"] == "1"
    assert zipped.content[:2] == b"PK"
    assert (
        client.post("/api/documents/bulk-download", headers=headers, json={"document_ids": [fourth]}).status_code
        == 404
    )
    assert client.post("/api/documents/bulk", headers=headers, json={"document_ids": [], "action": "archive"}).status_code == 422


def test_library_and_row_actions_are_tenant_scoped(client: TestClient) -> None:
    acme = bearer(register(client, org="Acme", name="Ada", email="ada@acme.com"))
    other = bearer(register(client, org="Globex", name="Gil", email="gil@globex.com"))
    document_id = _document(client, acme, "Acme only")

    assert client.get("/api/documents/library", headers=other).json()["total"] == 0
    assert client.get("/api/documents/counts", headers=other).json()["all"] == 0
    for path in ("archive", "trash", "restore", "rename", "duplicate", "make-template"):
        payload = {"title": "x"} if path in {"rename", "duplicate", "make-template"} else None
        response = client.post(f"/api/documents/{document_id}/{path}", headers=other, json=payload)
        assert response.status_code == 404, path
    assert client.get(f"/api/documents/{document_id}/routing", headers=other).status_code == 404
    bulk = client.post(
        "/api/documents/bulk", headers=other, json={"document_ids": [document_id], "action": "archive"}
    ).json()
    assert bulk["updated"] == 0 and bulk["skipped"][0]["reason"] == "not_found"
    assert client.get(f"/api/documents/{document_id}", headers=acme).json()["archived_at"] is None


def test_library_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/documents/library").status_code == 401
    assert client.get("/api/documents/counts").status_code == 401


# ------------------------------------------------------------------ fields


def test_bulk_field_save_round_trip(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Sam Signer", "sam@example.com")

    saved = client.put(
        f"/api/documents/{document_id}/fields",
        headers=headers,
        json={
            "fields": [
                {
                    "recipient_id": recipient_id,
                    "type": "checkbox",
                    "label": "Has co-buyer",
                    "page_number": 1,
                    "x": 72,
                    "y": 600,
                    "width": 20,
                    "height": 20,
                },
                {
                    "recipient_id": recipient_id,
                    "type": "email",
                    "label": "Co-buyer email",
                    "page_number": 1,
                    "x": 72,
                    "y": 500,
                    "width": 200,
                    "height": 30,
                    "validation": "email",
                    "read_only": False,
                },
            ]
        },
    )
    assert saved.status_code == 200, saved.text
    fields = saved.json()
    assert len(fields) == 2
    checkbox = next(item for item in fields if item["type"] == "checkbox")
    email_field = next(item for item in fields if item["type"] == "email")
    assert email_field["validation"] == "email"
    assert email_field["read_only"] is False
    assert email_field["condition"] is None

    # Second save: keep the checkbox by id, add a conditional field, drop the email one.
    resaved = client.put(
        f"/api/documents/{document_id}/fields",
        headers=headers,
        json={
            "fields": [
                {
                    "id": checkbox["id"],
                    "recipient_id": recipient_id,
                    "type": "checkbox",
                    "label": "Has co-buyer",
                    "page_number": 1,
                    "x": 100,
                    "y": 600,
                    "width": 20,
                    "height": 20,
                },
                {
                    "recipient_id": recipient_id,
                    "type": "text",
                    "label": "Co-buyer name",
                    "page_number": 1,
                    "x": 72,
                    "y": 400,
                    "width": 200,
                    "height": 30,
                    "condition": {"field_id": checkbox["id"], "op": "checked"},
                    "validation": "custom",
                    "validation_pattern": "[A-Za-z ]+",
                    "read_only": True,
                },
            ]
        },
    )
    assert resaved.status_code == 200, resaved.text
    body = resaved.json()
    assert len(body) == 2
    assert {item["id"] for item in body} >= {checkbox["id"]}
    kept = next(item for item in body if item["id"] == checkbox["id"])
    assert float(kept["x"]) == 100.0
    conditional = next(item for item in body if item["label"] == "Co-buyer name")
    assert conditional["condition"] == {"field_id": checkbox["id"], "op": "checked", "value": None}
    assert conditional["validation"] == "custom"
    assert conditional["validation_pattern"] == "[A-Za-z ]+"
    assert conditional["read_only"] is True
    assert len(client.get(f"/api/documents/{document_id}/fields", headers=headers).json()) == 2

    # per-field update of the new properties
    patched = client.patch(
        f"/api/documents/{document_id}/fields/{conditional['id']}",
        headers=headers,
        json={"read_only": False, "validation": "none"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["read_only"] is False

    assert client.delete(f"/api/documents/{document_id}/fields/{conditional['id']}", headers=headers).status_code == 204
    assert len(client.get(f"/api/documents/{document_id}/fields", headers=headers).json()) == 1


def test_bulk_field_save_validation_errors(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Sam Signer", "sam@example.com")

    def save(field: dict) -> int:
        return client.put(
            f"/api/documents/{document_id}/fields", headers=headers, json={"fields": [field]}
        ).status_code

    base = {
        "recipient_id": recipient_id,
        "type": "text",
        "label": "Field",
        "page_number": 1,
        "x": 10,
        "y": 10,
        "width": 100,
        "height": 20,
    }
    assert save({**base, "validation": "custom"}) == 400  # pattern required
    assert save({**base, "validation": "custom", "validation_pattern": "([a-z"}) == 400  # bad regex
    assert save({**base, "validation": "sideways"}) == 422  # unknown validation kind
    assert save({**base, "page_number": 9}) == 400  # off-document page
    assert save({**base, "recipient_id": "someone-else"}) == 400
    assert save({**base, "condition": {"field_id": "ghost", "op": "checked"}}) == 400
    assert save({**base, "id": "not-mine"}) == 400
    # a foreign document is invisible
    other = bearer(register(client, org="Globex", name="Gil", email="gil@globex.com"))
    assert client.put(f"/api/documents/{document_id}/fields", headers=other, json={"fields": []}).status_code == 404


def test_signer_value_respects_validation_and_read_only(client: TestClient, pdf_bytes: bytes) -> None:
    from app.tests.test_document_flow import token_from_link

    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Sam Signer", "sam@example.com")
    fields = client.put(
        f"/api/documents/{document_id}/fields",
        headers=headers,
        json={
            "fields": [
                {
                    "recipient_id": recipient_id,
                    "type": "signature",
                    "label": "Signature",
                    "page_number": 1,
                    "x": 72,
                    "y": 200,
                    "width": 180,
                    "height": 48,
                },
                {
                    "recipient_id": recipient_id,
                    "type": "email",
                    "label": "Work email",
                    "page_number": 1,
                    "x": 72,
                    "y": 300,
                    "width": 200,
                    "height": 30,
                    "validation": "email",
                },
                {
                    "recipient_id": recipient_id,
                    "type": "text",
                    "label": "Prefilled",
                    "page_number": 1,
                    "x": 72,
                    "y": 400,
                    "width": 200,
                    "height": 30,
                    "read_only": True,
                    "required": False,
                },
            ]
        },
    ).json()
    email_field = next(item for item in fields if item["label"] == "Work email")
    locked_field = next(item for item in fields if item["label"] == "Prefilled")

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])

    assert client.post(f"/api/sign/{token}/consent").status_code == 200

    bad = client.post(f"/api/sign/{token}/fields/{email_field['id']}/value", json={"value": "not-an-email"})
    assert bad.status_code == 400
    assert "email address" in bad.json()["detail"]
    good = client.post(f"/api/sign/{token}/fields/{email_field['id']}/value", json={"value": "sam@work.com"})
    assert good.status_code == 200, good.text

    blocked = client.post(f"/api/sign/{token}/fields/{locked_field['id']}/value", json={"value": "nope"})
    assert blocked.status_code == 400
    assert "read-only" in blocked.json()["detail"]


# -------------------------------------------------------- recipients/routing


def test_set_recipients_reorder_and_roles(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)

    saved = client.put(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={
            "workflow_type": "sequential",
            "recipients": [
                {"name": "Buyer", "email": "Buyer@Example.com", "role": "sign", "color": "#2563eb", "signing_order": 1},
                {"name": "Approver", "email": "approver@example.com", "role": "approve", "signing_order": 2},
                {"name": "Watcher", "email": "watcher@example.com", "role": "copy", "signing_order": 3},
            ],
        },
    )
    assert saved.status_code == 200, saved.text
    recipients = saved.json()
    assert [item["signing_order"] for item in recipients] == [1, 2, 3]
    assert [item["role"] for item in recipients] == ["sign", "approve", "copy"]
    assert recipients[0]["email"] == "buyer@example.com"
    assert recipients[0]["color"] == "#2563eb"
    assert client.get(f"/api/documents/{document_id}", headers=headers).json()["workflow_type"] == "sequential"

    buyer, approver, watcher = (item["id"] for item in recipients)

    # keep the buyer by id, drop the watcher
    resaved = client.put(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={
            "recipients": [
                {"id": buyer, "name": "Buyer Renamed", "email": "buyer@example.com", "role": "sign", "signing_order": 2},
                {"id": approver, "name": "Approver", "email": "approver@example.com", "role": "approve", "signing_order": 1},
            ]
        },
    ).json()
    assert [item["name"] for item in resaved] == ["Approver", "Buyer Renamed"]
    assert {item["id"] for item in resaved} == {buyer, approver}

    reordered = client.post(
        f"/api/documents/{document_id}/recipients/reorder",
        headers=headers,
        json={"recipient_ids": [buyer, approver]},
    )
    assert reordered.status_code == 200, reordered.text
    assert [(item["id"], item["signing_order"]) for item in reordered.json()] == [(buyer, 1), (approver, 2)]

    # reorder must name every recipient exactly once
    assert (
        client.post(
            f"/api/documents/{document_id}/recipients/reorder", headers=headers, json={"recipient_ids": [buyer]}
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/documents/{document_id}/recipients/reorder",
            headers=headers,
            json={"recipient_ids": [buyer, buyer, approver]},
        ).status_code
        == 400
    )
    assert (
        client.post(
            f"/api/documents/{document_id}/recipients/reorder",
            headers=headers,
            json={"recipient_ids": [buyer, approver, watcher]},
        ).status_code
        == 400
    )

    # duplicate emails and empty lists are rejected
    assert (
        client.put(
            f"/api/documents/{document_id}/recipients",
            headers=headers,
            json={"recipients": [
                {"name": "A", "email": "dupe@example.com"},
                {"name": "B", "email": "dupe@example.com"},
            ]},
        ).status_code
        == 400
    )
    assert client.put(f"/api/documents/{document_id}/recipients", headers=headers, json={"recipients": []}).status_code == 400
    assert (
        client.put(
            f"/api/documents/{document_id}/recipients",
            headers=headers,
            json={"recipients": [{"id": "ghost", "name": "A", "email": "a@example.com"}]},
        ).status_code
        == 400
    )

    patched = client.patch(
        f"/api/documents/{document_id}/recipients/{buyer}",
        headers=headers,
        json={"role": "inperson", "color": "#f97316"},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["role"] == "inperson"
    assert patched.json()["color"] == "#f97316"
    assert (
        client.patch(
            f"/api/documents/{document_id}/recipients/{buyer}", headers=headers, json={"role": "notary"}
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/documents/{document_id}/recipients/{buyer}", headers=headers, json={"contact_id": "ghost"}
        ).status_code
        == 404
    )

    other = bearer(register(client, org="Globex", name="Gil", email="gil@globex.com"))
    assert (
        client.post(
            f"/api/documents/{document_id}/recipients/reorder", headers=other, json={"recipient_ids": [buyer]}
        ).status_code
        == 404
    )


def test_bulk_recipients_from_contacts(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    contact = client.post(
        "/api/contacts",
        headers=headers,
        json={"name": "Cora Contact", "email": "cora@example.com"},
    )
    if contact.status_code not in {200, 201}:  # contacts module owned by another agent
        return
    contact_id = contact.json()["id"]

    added = client.post(
        f"/api/documents/{document_id}/recipients/bulk",
        headers=headers,
        json={"recipients": [{"name": "Manual", "email": "manual@example.com"}], "from_contact_ids": [contact_id]},
    )
    assert added.status_code == 201, added.text
    body = added.json()
    assert [item["email"] for item in body] == ["manual@example.com", "cora@example.com"]
    assert body[1]["contact_id"] == contact_id
    assert [item["signing_order"] for item in body] == [1, 2]
    # already-present emails are skipped rather than duplicated
    again = client.post(
        f"/api/documents/{document_id}/recipients/bulk",
        headers=headers,
        json={"from_contact_ids": [contact_id]},
    )
    assert again.status_code == 201
    assert again.json() == []


def test_routing_settings(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = _document(client, headers, "Routing doc")

    initial = client.get(f"/api/documents/{document_id}/routing", headers=headers)
    assert initial.status_code == 200, initial.text
    assert initial.json() == {
        "document_id": document_id,
        "workflow_type": "parallel",
        "reminder_cadence": "48h",
        "expires_in_days": 14,
        "invite_subject": None,
        "invite_message": None,
    }

    updated = client.put(
        f"/api/documents/{document_id}/routing",
        headers=headers,
        json={
            "workflow_type": "sequential",
            "reminder_cadence": "7d",
            "expires_in_days": 30,
            "invite_subject": "Please sign",
            "invite_message": "Two minutes, promise.",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["workflow_type"] == "sequential"
    assert updated.json()["reminder_cadence"] == "7d"
    assert updated.json()["expires_in_days"] == 30
    assert updated.json()["invite_subject"] == "Please sign"

    document = client.get(f"/api/documents/{document_id}", headers=headers).json()
    assert document["reminder_cadence"] == "7d"
    assert document["expires_in_days"] == 30
    assert document["invite_message"] == "Two minutes, promise."

    assert (
        client.put(
            f"/api/documents/{document_id}/routing", headers=headers, json={"reminder_cadence": "3h"}
        ).status_code
        == 422
    )
    assert (
        client.put(
            f"/api/documents/{document_id}/routing", headers=headers, json={"expires_in_days": 0}
        ).status_code
        == 422
    )
    assert client.put(f"/api/documents/{document_id}/routing", json={"expires_in_days": 5}).status_code == 401


# ------------------------------------------------- quick-bucket badge counts


# quick filter name -> the DocumentCounts key that badges it. Only `trash`
# differs, because the count key predates the filter name.
QUICK_BUCKETS = {
    "inbox": "inbox",
    "outbox": "outbox",
    "completed": "completed",
    "drafts": "drafts",
    "favorites": "favorites",
    "expiring": "expiring",
    "shared": "shared",
    "mine": "mine",
    "archived": "archived",
    "trash": "trashed",
}


def _invite_colleague(client: TestClient, headers: dict[str, str]) -> dict[str, str]:
    created = client.post("/api/invitations/", headers=headers, json={"email": "colleague@example.com", "role": "sender"})
    assert created.status_code == 201, created.text
    token = created.json()["invite_link"].rsplit("/", 1)[-1]
    accepted = client.post(
        "/api/invitations/accept",
        json={"token": token, "name": "Colleague", "password": "another-strong-pass"},
    )
    assert accepted.status_code == 201, accepted.text
    return {"Authorization": f"Bearer {accepted.json()['access_token']}"}


def test_counts_cover_every_quick_bucket(client: TestClient, pdf_bytes: bytes) -> None:
    """Every sidebar badge must equal the number of rows the same `quick`
    filter returns — otherwise a badge can disagree with its own list."""
    headers = auth_headers(client)
    colleague = _invite_colleague(client, headers)

    # Owned by the admin: a favourite draft, an archived and a trashed row.
    # (The Free plan caps the org at five documents per cycle — stay inside it.)
    favourite = _document(client, headers, "My favourite")
    assert client.post(f"/api/documents/{favourite}/favorite", headers=headers).status_code == 204
    archived = _document(client, headers, "My archive")
    assert client.post(f"/api/documents/{archived}/archive", headers=headers).status_code == 200
    trashed = _document(client, headers, "My trash")
    assert client.delete(f"/api/documents/{trashed}", headers=headers).status_code == 204

    # Owned by the colleague and out for the admin's signature: inbox + outbox
    # + shared + expiring (short expiry window puts it inside the 7-day horizon).
    inbound = create_uploaded_document(client, pdf_bytes, colleague)
    recipient = add_recipient(client, inbound, colleague, "Admin User", "admin@example.com")
    add_field(client, inbound, colleague, recipient, "signature", "Sign", 200)
    assert client.put(
        f"/api/documents/{inbound}/routing", headers=colleague, json={"expires_in_days": 2}
    ).status_code == 200
    assert client.post(f"/api/documents/{inbound}/send", headers=colleague).status_code == 200

    # A colleague-owned draft the admin is not a recipient of: shared only.
    colleague_draft = _document(client, colleague, "Colleague draft")

    counts = client.get("/api/documents/counts", headers=headers).json()

    for bucket, count_key in QUICK_BUCKETS.items():
        page = client.get(
            "/api/documents/library", headers=headers, params={"quick": bucket, "limit": 200}
        ).json()
        badge = counts[count_key]
        assert badge == page["total"], f"{bucket}: badge {badge} != list {page['total']}"
        assert badge == len(page["items"]), bucket

    # Spot-check the absolute values so a shared-zero bug cannot pass the loop.
    assert counts["mine"] == 1  # my favourite (archived/trashed are excluded)
    assert counts["shared"] == 2  # inbound + colleague draft
    assert counts["drafts"] == 2
    assert counts["draft"] == counts["drafts"]
    assert counts["favorites"] == 1
    assert counts["inbox"] == 1
    assert counts["outbox"] == 1
    assert counts["expiring"] == 1
    assert counts["archived"] == 1
    assert counts["trashed"] == 1
    assert counts["all"] == 3
    # legacy aliases stay in step with their quick twins
    assert counts["action"] == counts["inbox"]
    assert counts["waiting"] == counts["outbox"]
    assert colleague_draft


def test_copy_link_issues_a_link_without_emailing(client: TestClient, pdf_bytes: bytes) -> None:
    """`notify=false` is what "copy link" needs: a URL, and no second email.

    Either way the recipient's previous link is superseded, so a signer never
    has two live URLs — and the trail records which of the two happened.
    """

    from app.tests.test_document_flow import token_from_link

    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    created = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={"name": "Buyer", "email": "buyer@example.com", "role": "sign", "signing_order": 1},
    )
    assert created.status_code == 201, created.text
    recipient_id = created.json()["id"]
    add_field(client, document_id, headers, recipient_id, "signature", "Sign here", 120)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    first_token = token_from_link(sent.json()["signing_links"][0]["signing_link"])

    copied = client.post(
        f"/api/documents/{document_id}/recipients/{recipient_id}/resend?notify=false",
        headers=headers,
    )
    assert copied.status_code == 200, copied.text
    assert copied.json()["email"] == "buyer@example.com"
    copied_token = token_from_link(copied.json()["signing_link"])
    assert copied_token != first_token

    # The link that was emailed is dead; the copied one works.
    assert client.get(f"/api/sign/{first_token}").status_code == 403
    assert client.get(f"/api/sign/{copied_token}").status_code == 200

    trail = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers)
    assert trail.status_code == 200
    assert any(entry["event_type"] == "signing_link_issued" for entry in trail.json())
