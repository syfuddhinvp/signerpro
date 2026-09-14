"""Removing and reordering the pages of a document being prepared.

A PDF arrives with pages nobody wants signed, or in the wrong order, and until
now the only remedy was to re-upload a corrected file -- which the API refuses
once an original is stored. `PUT /api/documents/{id}/pages` takes the pages to
keep, in the order they should end up in.

What is pinned here is the part a pure file rewrite would get wrong: fields
carry the page they were placed on, so they have to be renumbered with their
page, and dropped with it.
"""

from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.tests.conftest import auth_headers


def three_page_pdf() -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(612, 792))
    for label in ("PAGE ONE", "PAGE TWO", "PAGE THREE"):
        pdf.drawString(72, 720, label)
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def prepared_document(client: TestClient, headers: dict[str, str]) -> str:
    created = client.post("/api/documents", headers=headers, json={"title": "Packet", "workflow_type": "parallel"})
    assert created.status_code == 201, created.text
    document_id = created.json()["id"]
    upload = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("packet.pdf", three_page_pdf(), "application/pdf")},
    )
    assert upload.status_code == 200, upload.text
    assert upload.json()["page_count"] == 3
    return document_id


def add_recipient(client: TestClient, headers: dict[str, str], document_id: str) -> str:
    response = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={"name": "Buyer", "email": "buyer@example.com", "role": "sign", "signing_order": 1},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def add_field(client: TestClient, headers: dict[str, str], document_id: str, recipient_id: str, page: int) -> str:
    response = client.post(
        f"/api/documents/{document_id}/fields",
        headers=headers,
        json={
            "recipient_id": recipient_id, "type": "signature", "label": f"Sign p{page}",
            "required": True, "page_number": page, "x": 72, "y": 300, "width": 180, "height": 48,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def pages_of(client: TestClient, headers: dict[str, str], document_id: str) -> int:
    pdf = client.get(f"/api/documents/{document_id}/pdf", headers=headers)
    assert pdf.status_code == 200
    return len(PdfReader(BytesIO(pdf.content)).pages)


def fields_of(client: TestClient, headers: dict[str, str], document_id: str) -> list[dict]:
    response = client.get(f"/api/documents/{document_id}/fields", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_removing_a_page_takes_its_fields_and_renumbers_the_rest(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)
    recipient_id = add_recipient(client, headers, document_id)
    for page in (1, 2, 3):
        add_field(client, headers, document_id, recipient_id, page)

    response = client.put(f"/api/documents/{document_id}/pages", headers=headers, json={"order": [1, 3]})
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 2
    assert pages_of(client, headers, document_id) == 2

    remaining = {f["label"]: f["page_number"] for f in fields_of(client, headers, document_id)}
    # Page 2's field went with page 2; page 3's field followed page 3 to slot 2.
    assert remaining == {"Sign p1": 1, "Sign p3": 2}


def test_reordering_pages_moves_fields_with_them(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)
    recipient_id = add_recipient(client, headers, document_id)
    for page in (1, 2, 3):
        add_field(client, headers, document_id, recipient_id, page)

    response = client.put(f"/api/documents/{document_id}/pages", headers=headers, json={"order": [3, 1, 2]})
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 3

    placed = {f["label"]: f["page_number"] for f in fields_of(client, headers, document_id)}
    assert placed == {"Sign p3": 1, "Sign p1": 2, "Sign p2": 3}


def test_the_rewrite_is_recorded_as_a_new_version_rather_than_overwriting(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)
    before = client.get(f"/api/documents/{document_id}", headers=headers).json()

    response = client.put(f"/api/documents/{document_id}/pages", headers=headers, json={"order": [2, 1, 3]})
    assert response.status_code == 200, response.text
    after = response.json()["document"]
    # A different file, under a different path, with its own hash.
    assert after["original_sha256"] != before["original_sha256"]
    assert after["original_file_path"] != before["original_file_path"]


def test_a_page_that_is_not_a_page_of_this_document_is_refused(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)

    assert client.put(f"/api/documents/{document_id}/pages", headers=headers, json={"order": [1, 4]}).status_code == 400
    assert client.put(f"/api/documents/{document_id}/pages", headers=headers, json={"order": [1, 1]}).status_code == 400
    assert client.put(f"/api/documents/{document_id}/pages", headers=headers, json={"order": []}).status_code == 422
    # Untouched by the refusals.
    assert client.get(f"/api/documents/{document_id}", headers=headers).json()["page_count"] == 3


def test_pages_cannot_be_rearranged_once_the_envelope_is_out(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)
    recipient_id = add_recipient(client, headers, document_id)
    add_field(client, headers, document_id, recipient_id, 1)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers, json={})
    assert sent.status_code == 200, sent.text

    response = client.put(f"/api/documents/{document_id}/pages", headers=headers, json={"order": [1]})
    assert response.status_code == 409


# ── adding pages ────────────────────────────────────────────────────────────
# The other direction: a late exhibit, a missing signature sheet, or an
# addendum that exists only as a photo. `POST /api/documents/{id}/pages` grows
# the document, and the fields at or after the insertion point move down with
# their page.


def png(width: int = 600, height: int = 800) -> bytes:
    from PIL import Image

    buffer = BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def page_size(client: TestClient, headers: dict[str, str], document_id: str, index: int) -> tuple[int, int]:
    pdf = client.get(f"/api/documents/{document_id}/pdf", headers=headers)
    box = PdfReader(BytesIO(pdf.content)).pages[index].mediabox
    return round(float(box.width)), round(float(box.height))


def test_a_blank_page_is_appended_and_leaves_every_field_alone(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)
    recipient_id = add_recipient(client, headers, document_id)
    for page in (1, 3):
        add_field(client, headers, document_id, recipient_id, page)

    response = client.post(f"/api/documents/{document_id}/pages", headers=headers, data={"blank_count": 2})
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 5
    assert pages_of(client, headers, document_id) == 5

    placed = {f["label"]: f["page_number"] for f in fields_of(client, headers, document_id)}
    assert placed == {"Sign p1": 1, "Sign p3": 3}


def test_inserting_a_page_pushes_the_fields_after_it_down(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)
    recipient_id = add_recipient(client, headers, document_id)
    for page in (1, 2, 3):
        add_field(client, headers, document_id, recipient_id, page)

    response = client.post(f"/api/documents/{document_id}/pages", headers=headers, data={"blank_count": 1, "at": 2})
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 4

    placed = {f["label"]: f["page_number"] for f in fields_of(client, headers, document_id)}
    # Page 1 is where it was; the old pages 2 and 3 moved down past the new one.
    assert placed == {"Sign p1": 1, "Sign p2": 3, "Sign p3": 4}
    # The blank sheet is the size of the page it follows, not a guessed default.
    pdf = client.get(f"/api/documents/{document_id}/pdf", headers=headers)
    box = PdfReader(BytesIO(pdf.content)).pages[1].mediabox
    assert (round(float(box.width)), round(float(box.height))) == (612, 792)


def test_an_uploaded_image_becomes_pages_of_the_document(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)

    response = client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("exhibit.png", png(), "image/png")},
        data={"at": 1},
    )
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 4
    assert pages_of(client, headers, document_id) == 4
    # The original pages are still there, behind the image.
    text = PdfReader(BytesIO(client.get(f"/api/documents/{document_id}/pdf", headers=headers).content))
    assert (text.pages[1].extract_text() or "").strip().startswith("PAGE ONE")


def test_an_uploaded_pdf_is_spliced_in_whole(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)

    response = client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("addendum.pdf", three_page_pdf(), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["page_count"] == 6


def test_adding_pages_is_refused_on_bad_input_and_on_a_sent_envelope(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)

    # Neither a file nor a count says nothing about what to add.
    assert client.post(f"/api/documents/{document_id}/pages", headers=headers, data={}).status_code == 400
    # Outside the document.
    assert client.post(
        f"/api/documents/{document_id}/pages", headers=headers, data={"blank_count": 1, "at": 9}
    ).status_code == 400
    assert client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("virus.exe", b"MZ", "application/octet-stream")},
    ).status_code == 400
    assert client.get(f"/api/documents/{document_id}", headers=headers).json()["page_count"] == 3

    recipient_id = add_recipient(client, headers, document_id)
    add_field(client, headers, document_id, recipient_id, 1)
    assert client.post(f"/api/documents/{document_id}/send", headers=headers, json={}).status_code == 200
    assert client.post(f"/api/documents/{document_id}/pages", headers=headers, data={"blank_count": 1}).status_code == 409


def test_pages_cannot_be_added_before_the_document_has_one(client: TestClient) -> None:
    headers = auth_headers(client)
    created = client.post("/api/documents", headers=headers, json={"title": "Empty", "workflow_type": "parallel"})
    document_id = created.json()["id"]

    response = client.post(f"/api/documents/{document_id}/pages", headers=headers, data={"blank_count": 1})
    assert response.status_code == 409


def test_an_added_image_is_cut_to_the_page_it_joins(client: TestClient) -> None:
    """A phone photo is thousands of pixels wide. Left at its own size it
    became a page several feet tall next to letter-sized ones -- the whole
    reason the fit is chosen here rather than by the camera."""
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)

    response = client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("photo.png", png(3024, 4032), "image/png")},
        data={"at": 1},
    )
    assert response.status_code == 200, response.text
    assert page_size(client, headers, document_id, 0) == (612, 792)


def test_the_image_fit_is_the_senders_choice(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)

    # Cover-and-crop still lands on the document's own page size...
    filled = client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("wide.png", png(2000, 500), "image/png")},
        data={"at": 1, "fit": "fill"},
    )
    assert filled.status_code == 200, filled.text
    assert page_size(client, headers, document_id, 0) == (612, 792)

    # ...while `actual` is the old behaviour, kept for a sender who wants the
    # image at its own size: 2000px at 96 dpi is a 1500pt page.
    actual = client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("wide.png", png(2000, 500), "image/png")},
        data={"at": 1, "fit": "actual"},
    )
    assert actual.status_code == 200, actual.text
    assert page_size(client, headers, document_id, 0) == (1500, 375)

    unknown = client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("wide.png", png(), "image/png")},
        data={"fit": "sideways"},
    )
    assert unknown.status_code == 400


def test_an_image_uploaded_as_the_original_gets_a_page_too(client: TestClient) -> None:
    headers = auth_headers(client)
    created = client.post("/api/documents", headers=headers, json={"title": "Photo", "workflow_type": "parallel"})
    document_id = created.json()["id"]

    upload = client.post(
        f"/api/documents/{document_id}/upload-pdf",
        headers=headers,
        files={"upload": ("scan.jpg", png(3024, 4032), "image/png")},
    )
    assert upload.status_code == 200, upload.text
    assert page_size(client, headers, document_id, 0) == (612, 792)


def test_a_crop_takes_only_the_part_that_was_selected(client: TestClient) -> None:
    """The sender drags a box over the picture, and that box is what becomes
    the page -- a photographed page surrounded by a desk should not bring the
    desk with it."""
    from PIL import Image

    headers = auth_headers(client)
    document_id = prepared_document(client, headers)
    # Left half red, right half blue: what survives the crop is checkable.
    source = Image.new("RGB", (400, 400), "red")
    source.paste(Image.new("RGB", (200, 400), "blue"), (200, 0))
    buffer = BytesIO()
    source.save(buffer, format="PNG")

    response = client.post(
        f"/api/documents/{document_id}/pages",
        headers=headers,
        files={"upload": ("desk.png", buffer.getvalue(), "image/png")},
        # The right half only, filled to the page so no white margin is left.
        data={"at": 1, "fit": "fill", "crop": "0.5,0,0.5,1"},
    )
    assert response.status_code == 200, response.text
    assert page_size(client, headers, document_id, 0) == (612, 792)

    page = PdfReader(BytesIO(client.get(f"/api/documents/{document_id}/pdf", headers=headers).content)).pages[0]
    image = list(page.images)[0]
    with Image.open(BytesIO(image.data)) as rendered:
        # Nothing from the red half made it onto the page. (Exact values are
        # not pinned: the PDF stores the image compressed.)
        red, green, blue = rendered.convert("RGB").getpixel((rendered.width // 2, rendered.height // 2))
        assert blue > 200 and red < 50 and green < 50


def test_a_crop_outside_the_image_is_refused(client: TestClient) -> None:
    headers = auth_headers(client)
    document_id = prepared_document(client, headers)

    for crop in ("0.5,0,0.8,1", "0,0,0,1", "-0.1,0,0.5,0.5", "1,2,3", "left"):
        response = client.post(
            f"/api/documents/{document_id}/pages",
            headers=headers,
            files={"upload": ("photo.png", png(), "image/png")},
            data={"crop": crop},
        )
        assert response.status_code == 400, f"{crop} -> {response.status_code}"
    assert client.get(f"/api/documents/{document_id}", headers=headers).json()["page_count"] == 3
