"""The platform template catalog: curation, visibility and import.

The assertions that matter here are the boundaries — an unpublished entry must
be invisible to tenants, curation must be platform-only, and an import must
produce a template the tenant owns outright rather than a live link back to a
platform-controlled row.
"""

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.catalog_template import CatalogTemplate
from app.models.user import User


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _register(client: TestClient, *, org: str, email: str, name: str = "Owner") -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _me(client: TestClient, headers: dict[str, str]) -> dict:
    return client.get("/api/auth/me", headers=headers).json()


def _promote(client: TestClient, headers: dict[str, str]) -> None:
    session, generator = _db()
    user = session.get(User, _me(client, headers)["id"])
    user.is_platform_admin = True
    session.add(user)
    session.commit()
    generator.close()


def _actors(client: TestClient) -> tuple[dict[str, str], dict[str, str]]:
    platform = _register(client, org="SignerPro", email="ops@signforge.com", name="Jordan Mehta")
    _promote(client, platform)
    tenant = _register(client, org="Acme Realty", email="priya@acme.io", name="Priya Rao")
    return platform, tenant


W9 = {
    "slug": "irs-w9",
    "title": "IRS Form W-9",
    "description": "Taxpayer identification and certification.",
    "category": "government",
    "authority": "IRS",
    "jurisdiction": "US",
    "page_count": 1,
    "tags": ["tax"],
    "roles": [{"key": "signer", "name": "Signer", "signing_order": 1}],
    "fields": [
        {"role": "signer", "type": "full_name", "label": "Name", "page_number": 1,
         "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.03},
        {"role": "signer", "type": "signature", "label": "Signature", "page_number": 1,
         "x": 0.1, "y": 0.7, "width": 0.3, "height": 0.05},
    ],
    "published": True,
}


def _create(client: TestClient, platform: dict[str, str], body: dict | None = None) -> dict:
    response = client.post("/api/platform/catalog-templates", json=body or W9, headers=platform)
    assert response.status_code == 201, response.text
    return response.json()


# --- Authorization ---------------------------------------------------------


def test_curation_is_platform_only(client: TestClient) -> None:
    platform, tenant = _actors(client)
    assert client.post("/api/platform/catalog-templates", json=W9, headers=tenant).status_code == 403
    assert client.get("/api/platform/catalog-templates", headers=tenant).status_code == 403
    entry = _create(client, platform)
    assert client.patch(
        f"/api/platform/catalog-templates/{entry['id']}", json={"title": "Hijacked"}, headers=tenant
    ).status_code == 403
    assert client.delete(f"/api/platform/catalog-templates/{entry['id']}", headers=tenant).status_code == 403


def test_unpublished_entries_are_invisible_to_tenants(client: TestClient) -> None:
    platform, tenant = _actors(client)
    entry = _create(client, platform, {**W9, "published": False})

    listing = client.get("/api/templates/catalog", headers=tenant)
    assert listing.status_code == 200, listing.text
    assert listing.json()["total"] == 0
    # Not merely hidden from the list: unreachable and un-importable by id.
    assert client.get(f"/api/templates/catalog/{entry['id']}", headers=tenant).status_code == 404
    assert client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).status_code == 404

    # The platform admin still sees it, which is the point of the draft state.
    assert client.get("/api/platform/catalog-templates", headers=platform).json()["total"] == 1

    published = client.post(f"/api/platform/catalog-templates/{entry['id']}/publish", headers=platform)
    assert published.status_code == 200, published.text
    assert client.get("/api/templates/catalog", headers=tenant).json()["total"] == 1


# --- Browsing --------------------------------------------------------------


def test_browse_filters_by_category_and_search(client: TestClient) -> None:
    platform, tenant = _actors(client)
    _create(client, platform)
    _create(client, platform, {**W9, "slug": "mutual-nda", "title": "Mutual NDA",
                               "category": "legal", "authority": None, "description": "Confidentiality."})

    body = client.get("/api/templates/catalog", headers=tenant).json()
    assert body["total"] == 2
    assert body["categories"] == ["government", "legal"]

    assert client.get("/api/templates/catalog", params={"category": "legal"}, headers=tenant).json()["total"] == 1
    # Search covers the issuing authority, so "IRS" finds the W-9 by its
    # publisher even though the word is not in the title.
    hits = client.get("/api/templates/catalog", params={"q": "irs"}, headers=tenant).json()
    assert [item["slug"] for item in hits["items"]] == ["irs-w9"]


def test_catalog_route_is_not_shadowed_by_template_lookup(client: TestClient) -> None:
    """``/api/templates/catalog`` must not be read as a template whose id is
    the string "catalog" — a registration-order bug that 404s the whole
    catalog."""
    _, tenant = _actors(client)
    assert client.get("/api/templates/catalog", headers=tenant).status_code == 200


# --- Import ----------------------------------------------------------------


def test_import_creates_an_independent_org_template(client: TestClient) -> None:
    platform, tenant = _actors(client)
    entry = _create(client, platform)

    imported = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant)
    assert imported.status_code == 201, imported.text
    template = imported.json()
    assert template["title"] == "IRS Form W-9"
    assert template["field_count"] == 2
    assert template["recipient_count"] == 1

    # It shows up as an ordinary template in the tenant's own library.
    listing = client.get("/api/templates", headers=tenant).json()
    assert [item["id"] for item in listing["items"]] == [template["id"]]

    # And the browse screen now marks the entry as already added.
    browsed = client.get("/api/templates/catalog", headers=tenant).json()["items"][0]
    assert browsed["imported"] is True

    # Independence: deleting the catalog entry leaves the tenant's copy alone.
    assert client.delete(f"/api/platform/catalog-templates/{entry['id']}", headers=platform).status_code == 204
    assert client.get(f"/api/templates/{template['id']}", headers=tenant).status_code == 200


def test_imported_template_carries_roles_without_signer_emails(client: TestClient) -> None:
    """A blueprint names roles, not people. The sender fills in who signs."""
    platform, tenant = _actors(client)
    entry = _create(client, platform, {
        **W9, "slug": "uscis-i9", "title": "Form I-9",
        "roles": [
            {"key": "signer", "name": "Employee", "signing_order": 1},
            {"key": "employer", "name": "Employer representative", "signing_order": 2, "role": "approve"},
        ],
        "fields": [
            {"role": "signer", "type": "signature", "label": "Employee signature", "page_number": 1,
             "x": 0.1, "y": 0.6, "width": 0.3, "height": 0.05},
            {"role": "employer", "type": "signature", "label": "Employer signature", "page_number": 1,
             "x": 0.1, "y": 0.8, "width": 0.3, "height": 0.05},
        ],
    })
    template_id = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).json()["id"]

    recipients = client.get(f"/api/documents/{template_id}/recipients", headers=tenant)
    assert recipients.status_code == 200, recipients.text
    rows = sorted(recipients.json(), key=lambda row: row["signing_order"])
    assert [row["role_name"] for row in rows] == ["Employee", "Employer representative"]
    assert [row["email"] for row in rows] == ["", ""]
    assert rows[1]["role"] == "approve"


def test_imported_template_can_be_used_to_create_a_document(client: TestClient) -> None:
    """The point of the whole feature: the sender picks a catalog form and
    ends up with a normal draft document."""
    platform, tenant = _actors(client)
    entry = _create(client, platform)
    template_id = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).json()["id"]

    used = client.post(f"/api/templates/{template_id}/use", json={"title": "W-9 for Dana"}, headers=tenant)
    assert used.status_code == 201, used.text
    document = used.json()
    assert document["title"] == "W-9 for Dana"
    assert document["status"] == "draft"

    session, generator = _db()
    from app.models.document import Document

    stored = session.get(Document, document["id"])
    # Provenance survives the copy: the document knows which published form it
    # descends from, not just which template.
    assert stored.source_catalog_slug == "irs-w9"
    assert stored.is_template is False
    generator.close()


def test_importing_twice_is_allowed_and_copies_are_separate(client: TestClient) -> None:
    platform, tenant = _actors(client)
    entry = _create(client, platform)
    first = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).json()
    second = client.post(
        f"/api/templates/catalog/{entry['id']}/import", json={"title": "W-9 (contractors)"}, headers=tenant
    ).json()
    assert first["id"] != second["id"]
    assert second["title"] == "W-9 (contractors)"


def test_import_is_scoped_to_the_importing_organization(client: TestClient) -> None:
    platform, tenant = _actors(client)
    other = _register(client, org="Beta Co", email="sam@beta.io", name="Sam Lee")
    entry = _create(client, platform)
    client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant)

    assert client.get("/api/templates", headers=other).json()["total"] == 0
    # ...and the "already added" marker is per-organization, not global.
    assert client.get("/api/templates/catalog", headers=other).json()["items"][0]["imported"] is False


# --- Validation ------------------------------------------------------------


def test_a_field_may_not_reference_an_unknown_role(client: TestClient) -> None:
    """``fields.recipient_id`` is NOT NULL, so an orphan field would fail at
    flush time on the tenant's import request. Reject it at authoring time."""
    platform, _ = _actors(client)
    response = client.post(
        "/api/platform/catalog-templates",
        json={**W9, "fields": [{"role": "witness", "type": "signature", "label": "Witness",
                                "page_number": 1, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.05}]},
        headers=platform,
    )
    assert response.status_code == 400
    assert "witness" in response.json()["detail"]


def test_a_field_may_not_sit_beyond_the_last_page(client: TestClient) -> None:
    platform, _ = _actors(client)
    response = client.post(
        "/api/platform/catalog-templates",
        json={**W9, "page_count": 1,
              "fields": [{"role": "signer", "type": "signature", "label": "Page three signature",
                          "page_number": 3, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.05}]},
        headers=platform,
    )
    assert response.status_code == 400
    assert "Page three signature" in response.json()["detail"]


def test_slugs_are_unique(client: TestClient) -> None:
    platform, _ = _actors(client)
    _create(client, platform)
    assert client.post("/api/platform/catalog-templates", json=W9, headers=platform).status_code == 409


def test_category_must_be_known(client: TestClient) -> None:
    platform, _ = _actors(client)
    response = client.post("/api/platform/catalog-templates", json={**W9, "category": "misc"}, headers=platform)
    assert response.status_code == 422


def test_update_rejects_roles_that_orphan_existing_fields(client: TestClient) -> None:
    """Dropping a role out from under the fields that use it is the same bug
    as authoring an orphan, and must be caught on the update path too."""
    platform, _ = _actors(client)
    entry = _create(client, platform)
    response = client.patch(
        f"/api/platform/catalog-templates/{entry['id']}",
        json={"roles": [{"key": "other", "name": "Someone else", "signing_order": 1}]},
        headers=platform,
    )
    assert response.status_code == 400
    assert "signer" in response.json()["detail"]


# --- Seeding ---------------------------------------------------------------


def test_seeding_is_idempotent_and_ships_entries_unpublished(client: TestClient) -> None:
    platform, tenant = _actors(client)
    first = client.post("/api/platform/catalog-templates/seed", headers=platform)
    assert first.status_code == 200, first.text
    count = first.json()["total"]
    assert count > 0

    second = client.post("/api/platform/catalog-templates/seed", headers=platform)
    assert second.json()["total"] == count

    # Nothing is visible to tenants until a curator attaches the real PDF and
    # publishes: an importable entry with no file yields an empty template.
    assert client.get("/api/templates/catalog", headers=tenant).json()["total"] == 0
    assert all(item["published"] is False for item in second.json()["items"])


def test_seeding_preserves_curator_edits(client: TestClient) -> None:
    platform, _ = _actors(client)
    client.post("/api/platform/catalog-templates/seed", headers=platform)

    session, generator = _db()
    from sqlalchemy import select

    entry = session.scalar(select(CatalogTemplate).where(CatalogTemplate.slug == "irs-w9"))
    entry_id = entry.id
    entry.title = "IRS Form W-9 (2026 revision)"
    entry.published = True
    session.commit()
    generator.close()

    client.post("/api/platform/catalog-templates/seed", headers=platform)
    after = client.get(f"/api/platform/catalog-templates/{entry_id}", headers=platform).json()
    assert after["title"] == "IRS Form W-9 (2026 revision)"
    assert after["published"] is True


# --- The form's PDF --------------------------------------------------------


def test_curator_uploads_the_form_and_tenants_can_preview_it(client: TestClient, pdf_bytes: bytes) -> None:
    platform, tenant = _actors(client)
    entry = _create(client, platform, {**W9, "published": False})

    uploaded = client.post(
        f"/api/platform/catalog-templates/{entry['id']}/file",
        files={"upload": ("w9.pdf", pdf_bytes, "application/pdf")},
        headers=platform,
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["has_file"] is True

    client.post(f"/api/platform/catalog-templates/{entry['id']}/publish", headers=platform)
    preview = client.get(f"/api/templates/catalog/{entry['id']}/pdf", headers=tenant)
    assert preview.status_code == 200
    assert preview.headers["content-type"] == "application/pdf"


def test_an_unpublished_form_is_not_previewable_by_a_tenant(client: TestClient, pdf_bytes: bytes) -> None:
    platform, tenant = _actors(client)
    entry = _create(client, platform, {**W9, "published": False})
    client.post(
        f"/api/platform/catalog-templates/{entry['id']}/file",
        files={"upload": ("w9.pdf", pdf_bytes, "application/pdf")},
        headers=platform,
    )
    assert client.get(f"/api/templates/catalog/{entry['id']}/pdf", headers=tenant).status_code == 404


def test_uploading_the_form_is_platform_only(client: TestClient, pdf_bytes: bytes) -> None:
    platform, tenant = _actors(client)
    entry = _create(client, platform)
    response = client.post(
        f"/api/platform/catalog-templates/{entry['id']}/file",
        files={"upload": ("w9.pdf", pdf_bytes, "application/pdf")},
        headers=tenant,
    )
    assert response.status_code == 403


def test_the_first_pdf_pulls_stranded_fields_onto_its_last_page(client: TestClient, pdf_bytes: bytes) -> None:
    """A blueprint's page count is a guess until a file backs it.

    The seeded entries declare one (`offer-letter` says two pages and places
    four fields on page 2) with no PDF behind them, so refusing the curator's
    one-page form would be refusing the only authority in the exchange — and
    there would be nowhere to fix it, since the builder has no pages to drag
    those fields onto either. The file wins; the labels come back so the
    curator knows what still needs placing.
    """
    platform, _ = _actors(client)
    entry = _create(client, platform, {
        **W9, "page_count": 2,
        "fields": [
            {"role": "signer", "type": "full_name", "label": "Name",
             "page_number": 1, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.05},
            {"role": "signer", "type": "signature", "label": "Page two signature",
             "page_number": 2, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.05},
        ],
    })
    response = client.post(
        f"/api/platform/catalog-templates/{entry['id']}/file",
        files={"upload": ("w9.pdf", pdf_bytes, "application/pdf")},
        headers=platform,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["page_count"] == 1
    assert body["fields_moved"] == ["Page two signature"]
    assert [f["page_number"] for f in body["fields"]] == [1, 1]
    # Only the page moved — the box keeps the coordinates the curator gave it.
    assert body["fields"][1]["x"] == 0.1

    # The move is persisted, not just reported back on the one response.
    after = client.get(f"/api/platform/catalog-templates/{entry['id']}", headers=platform).json()
    assert [f["page_number"] for f in after["fields"]] == [1, 1]
    assert after["fields_moved"] == []


def test_replacing_a_pdf_with_a_shorter_one_is_refused(client: TestClient, pdf_bytes: bytes) -> None:
    """Once a file backs the entry its placement was built against real pages.

    Silently dragging those fields onto the last page would destroy work the
    curator did on a page they could see, so a shorter revision is refused and
    they re-place first."""
    platform, _ = _actors(client)
    entry = _create(client, platform, {
        **W9, "page_count": 1,
        "fields": [{"role": "signer", "type": "signature", "label": "Signature",
                    "page_number": 1, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.05}],
    })
    url = f"/api/platform/catalog-templates/{entry['id']}/file"
    assert client.post(url, files={"upload": ("w9.pdf", pdf_bytes, "application/pdf")}, headers=platform).status_code == 200

    # Now push the placement onto a second page and try the one-page file again.
    patched = client.patch(
        f"/api/platform/catalog-templates/{entry['id']}",
        json={"page_count": 2,
              "fields": [{"role": "signer", "type": "signature", "label": "Page two signature",
                          "page_number": 2, "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.05}]},
        headers=platform,
    )
    assert patched.status_code == 200, patched.text

    response = client.post(url, files={"upload": ("w9.pdf", pdf_bytes, "application/pdf")}, headers=platform)
    assert response.status_code == 400
    assert "Page two signature" in response.json()["detail"]


def test_an_unconvertible_file_type_is_refused(client: TestClient) -> None:
    """Office and image formats are converted, as on a document upload. A
    format with no path to a PDF is rejected outright rather than stored as a
    form nobody can render."""
    platform, _ = _actors(client)
    entry = _create(client, platform)
    response = client.post(
        f"/api/platform/catalog-templates/{entry['id']}/file",
        files={"upload": ("form.zip", b"PK\x03\x04not-a-document", "application/zip")},
        headers=platform,
    )
    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["detail"]


def test_importing_a_form_with_a_pdf_yields_a_prepared_template(client: TestClient, pdf_bytes: bytes) -> None:
    """With a file attached the imported template is `prepared`, not `draft`:
    there is a document to place fields on and send."""
    platform, tenant = _actors(client)
    entry = _create(client, platform, {**W9, "published": False})
    client.post(
        f"/api/platform/catalog-templates/{entry['id']}/file",
        files={"upload": ("w9.pdf", pdf_bytes, "application/pdf")},
        headers=platform,
    )
    client.post(f"/api/platform/catalog-templates/{entry['id']}/publish", headers=platform)

    template_id = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).json()["id"]
    document = client.get(f"/api/documents/{template_id}", headers=tenant).json()
    assert document["status"] == "prepared"

    # The tenant can read the PDF through their own template, not just the
    # catalog preview.
    assert client.get(f"/api/documents/{template_id}/pdf", headers=tenant).status_code == 200


# --- Authoring a custom form ----------------------------------------------


def _draft(client: TestClient, platform: dict[str, str], catalog_id: str) -> str:
    response = client.post(f"/api/platform/catalog-templates/{catalog_id}/draft-template", headers=platform)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_a_curator_authors_placement_in_the_builder_and_saves_it_back(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """The whole round-trip: create an entry, place fields on it as an
    ordinary template, adopt that placement, publish, and have a tenant import
    a form that carries the fields the curator drew."""
    platform, tenant = _actors(client)
    entry = _create(client, platform, {
        **W9, "slug": "state-tax-form", "title": "State tax form",
        "published": False, "roles": [], "fields": [],
    })

    template_id = _draft(client, platform, entry["id"])
    client.post(
        f"/api/documents/{template_id}/upload-pdf",
        files={"upload": ("form.pdf", pdf_bytes, "application/pdf")},
        headers=platform,
    )
    recipient = client.post(
        f"/api/documents/{template_id}/recipients",
        json={"name": "Taxpayer", "email": "taxpayer@example.com", "role_name": "Taxpayer", "signing_order": 1},
        headers=platform,
    )
    assert recipient.status_code == 201, recipient.text
    field = client.post(
        f"/api/documents/{template_id}/fields",
        json={"recipient_id": recipient.json()["id"], "type": "signature", "label": "Sign here",
              "page_number": 1, "x": 0.2, "y": 0.6, "width": 0.3, "height": 0.05},
        headers=platform,
    )
    assert field.status_code == 201, field.text

    adopted = client.post(
        f"/api/platform/catalog-templates/{entry['id']}/adopt/{template_id}", headers=platform
    )
    assert adopted.status_code == 200, adopted.text
    body = adopted.json()
    assert body["has_file"] is True
    assert [role["name"] for role in body["roles"]] == ["Taxpayer"]
    assert [f["label"] for f in body["fields"]] == ["Sign here"]
    # The role key is derived from the role name, and the field points at it.
    assert body["fields"][0]["role"] == body["roles"][0]["key"] == "taxpayer"

    client.post(f"/api/platform/catalog-templates/{entry['id']}/publish", headers=platform)
    imported_id = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).json()["id"]
    fields = client.get(f"/api/documents/{imported_id}/fields", headers=tenant).json()
    assert [f["label"] for f in fields] == ["Sign here"]


def test_opening_the_draft_twice_returns_the_same_template(client: TestClient) -> None:
    """Otherwise a curator who re-opens the builder silently starts over and
    loses the placement they already did."""
    platform, _ = _actors(client)
    entry = _create(client, platform)
    assert _draft(client, platform, entry["id"]) == _draft(client, platform, entry["id"])


def test_a_draft_can_be_opened_for_an_unpublished_entry(client: TestClient) -> None:
    """Authoring happens before publishing, so the published gate that hides
    an entry from tenants must not block its own curator."""
    platform, tenant = _actors(client)
    entry = _create(client, platform, {**W9, "published": False})
    assert client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).status_code == 404
    assert client.post(
        f"/api/platform/catalog-templates/{entry['id']}/draft-template", headers=platform
    ).status_code == 201


def test_adopting_replaces_the_blueprint_rather_than_appending(client: TestClient) -> None:
    platform, _ = _actors(client)
    entry = _create(client, platform)
    assert len(entry["fields"]) == 2

    template_id = _draft(client, platform, entry["id"])
    # Strip the draft back to nothing, then adopt it.
    for field in client.get(f"/api/documents/{template_id}/fields", headers=platform).json():
        client.delete(f"/api/documents/{template_id}/fields/{field['id']}", headers=platform)

    adopted = client.post(
        f"/api/platform/catalog-templates/{entry['id']}/adopt/{template_id}", headers=platform
    ).json()
    assert adopted["fields"] == []


def test_adopting_is_platform_only_and_scoped_to_the_curators_own_templates(client: TestClient) -> None:
    platform, tenant = _actors(client)
    entry = _create(client, platform)
    template_id = _draft(client, platform, entry["id"])

    assert client.post(
        f"/api/platform/catalog-templates/{entry['id']}/adopt/{template_id}", headers=tenant
    ).status_code == 403
    # A template id from another organization is a 404, not someone else's work.
    other = _register(client, org="Beta Co", email="sam@beta.io", name="Sam Lee")
    doc = client.post("/api/documents", json={"title": "Theirs", "is_template": True}, headers=other).json()
    assert client.post(
        f"/api/platform/catalog-templates/{entry['id']}/adopt/{doc['id']}", headers=platform
    ).status_code == 404


def test_a_tenants_existing_import_is_unaffected_by_later_curation(client: TestClient) -> None:
    """An import is a copy, not a link: re-curating the entry must not reach
    into templates tenants already hold."""
    platform, tenant = _actors(client)
    entry = _create(client, platform)
    imported_id = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).json()["id"]

    template_id = _draft(client, platform, entry["id"])
    for field in client.get(f"/api/documents/{template_id}/fields", headers=platform).json():
        client.delete(f"/api/documents/{template_id}/fields/{field['id']}", headers=platform)
    client.post(f"/api/platform/catalog-templates/{entry['id']}/adopt/{template_id}", headers=platform)

    still_there = client.get(f"/api/documents/{imported_id}/fields", headers=tenant).json()
    assert len(still_there) == 2


def test_the_document_response_names_the_catalog_form_it_belongs_to(client: TestClient) -> None:
    """The builder needs this to know it is editing a catalog form, and to
    offer saving back rather than leaving the curator stranded."""
    platform, _ = _actors(client)
    entry = _create(client, platform)
    template_id = _draft(client, platform, entry["id"])
    document = client.get(f"/api/documents/{template_id}", headers=platform).json()
    assert document["source_catalog_slug"] == "irs-w9"


def test_an_entry_resolves_by_slug_as_well_as_by_id(client: TestClient) -> None:
    """The builder knows a document's `source_catalog_slug`, not the entry id,
    so saving placement back has to work from the slug."""
    platform, _ = _actors(client)
    entry = _create(client, platform)
    by_slug = client.get("/api/platform/catalog-templates/irs-w9", headers=platform)
    assert by_slug.status_code == 200, by_slug.text
    assert by_slug.json()["id"] == entry["id"]

    template_id = _draft(client, platform, entry["id"])
    adopted = client.post(f"/api/platform/catalog-templates/irs-w9/adopt/{template_id}", headers=platform)
    assert adopted.status_code == 200, adopted.text


def test_a_document_from_a_catalog_form_can_take_its_first_recipient(client: TestClient) -> None:
    """The path a sender actually walks: import the form, use it, then put a
    person on the resulting draft.

    The roles arrive blank, and the builder saves the recipient list as a whole,
    so the very first add sends an empty address back with it. That used to come
    back 422 and no recipient could be added to a catalog document at all.
    """
    platform, tenant = _actors(client)
    entry = _create(client, platform, {
        **W9, "slug": "uscis-i9", "title": "Form I-9",
        "roles": [
            {"key": "signer", "name": "Employee", "signing_order": 1},
            {"key": "employer", "name": "Employer representative", "signing_order": 2, "role": "approve"},
        ],
        "fields": [
            {"role": "signer", "type": "signature", "label": "Employee signature", "page_number": 1,
             "x": 0.1, "y": 0.6, "width": 0.3, "height": 0.05},
            {"role": "employer", "type": "signature", "label": "Employer signature", "page_number": 1,
             "x": 0.1, "y": 0.8, "width": 0.3, "height": 0.05},
        ],
    })
    template_id = client.post(f"/api/templates/catalog/{entry['id']}/import", headers=tenant).json()["id"]
    document_id = client.post(f"/api/templates/{template_id}/use", headers=tenant).json()["id"]

    rows = sorted(
        client.get(f"/api/documents/{document_id}/recipients", headers=tenant).json(),
        key=lambda row: row["signing_order"],
    )
    # The role survives being used, so the approver does not quietly become a signer.
    assert [row["role"] for row in rows] == ["sign", "approve"]

    # Exactly what the builder sends: the row it just filled in, and the other
    # role handed straight back as it came.
    saved = client.put(
        f"/api/documents/{document_id}/recipients",
        headers=tenant,
        json={"workflow_type": "sequential", "recipients": [
            {"id": rows[0]["id"], "name": "Dev Soab", "email": "dev.soab@example.com",
             "role_name": rows[0]["role_name"], "role": "sign", "signing_order": 1},
            {"id": rows[1]["id"], "name": "", "email": "",
             "role_name": rows[1]["role_name"], "role": "approve", "signing_order": 2},
        ]},
    )
    assert saved.status_code == 200, saved.text
    assert [row["email"] for row in saved.json()] == ["dev.soab@example.com", ""]
    # Filling a role keeps its id, so the fields already placed on it stay placed.
    fields = client.get(f"/api/documents/{document_id}/fields", headers=tenant).json()
    assert {field["recipient_id"] for field in fields} == {rows[0]["id"], rows[1]["id"]}
