"""Page annotations (ANN-1): the sender's pen drawing and text box.

An annotation is an ordinary ``fields`` row of a new type, which is what lets it
ride the endpoints and the final-PDF overlay that already exist. What these
tests pin is the part that is *not* ordinary: it places no obligation on a
recipient, every recipient is shown it whoever it is assigned to, and it is
burned into the completed contract.
"""

from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.core.annotations import normalize_drawing_options, normalize_textbox_options, pdf_font_name
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document, token_from_link


STROKE = [[0.0, 0.0], [0.5, 0.4], [1.0, 1.0]]


def _annotation(
    client: TestClient,
    document_id: str,
    headers: dict[str, str],
    recipient_id: str,
    **overrides,
) -> dict:
    body = {
        "recipient_id": recipient_id,
        "type": "textbox",
        "label": "Note",
        "page_number": 1,
        "x": 60,
        "y": 120,
        "width": 240,
        "height": 60,
    }
    body.update(overrides)
    response = client.post(f"/api/documents/{document_id}/fields", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# The normalisation contract, which the browser mirrors in lib/sf/annotations.ts
# ---------------------------------------------------------------------------


def test_textbox_options_fall_back_rather_than_fail() -> None:
    options = normalize_textbox_options({"font": "comic-sans", "size": 400, "color": "red", "bold": 1})
    assert options == {
        "kind": "textbox", "font": "helvetica", "size": 96.0, "bold": True, "italic": False, "color": "#0f172a",
    }
    assert normalize_textbox_options({"font": "TIMES", "size": 18})["font"] == "times"


def test_drawing_points_are_clamped_and_rubbish_dropped() -> None:
    options = normalize_drawing_options(
        {"color": "#DC2626", "stroke": 99, "strokes": [[[-1, 2], ["x", 0]], [], "nope", [[0.25, 0.75]]]}
    )
    assert options["color"] == "#dc2626"
    assert options["stroke"] == 12.0  # clamped to MAX_PEN_WIDTH
    # The bad point is dropped, the out-of-range one is pulled into the box, the
    # empty and non-list strokes disappear, and the one-point tap survives.
    assert options["strokes"] == [[[0.0, 1.0]], [[0.25, 0.75]]]


def test_font_names_are_reportlab_base_14() -> None:
    assert pdf_font_name("times", bold=True, italic=True) == "Times-BoldItalic"
    assert pdf_font_name("times") == "Times-Roman"
    assert pdf_font_name("helvetica", italic=True) == "Helvetica-Oblique"
    assert pdf_font_name("nonsense") == "Helvetica"


# ---------------------------------------------------------------------------
# The API refuses to let an annotation pose as an obligation
# ---------------------------------------------------------------------------


def test_an_annotation_is_never_required_or_writable(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")

    # The client asks for the opposite of every rule, and gets the rule.
    created = _annotation(
        client, document_id, headers, recipient_id,
        required=True, read_only=False, validation="email",
        default_value="Approved by Legal",
        options={"font": "times", "size": 14, "bold": True, "color": "#1d4ed8"},
    )
    assert created["required"] is False
    assert created["read_only"] is True
    assert created["validation"] == "none"
    assert created["options"]["font"] == "times"
    assert created["options"]["size"] == 14.0

    patched = client.patch(
        f"/api/documents/{document_id}/fields/{created['id']}",
        json={"required": True, "read_only": False},
        headers=headers,
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["required"] is False
    assert patched.json()["read_only"] is True


def test_a_bulk_save_normalises_annotations_too(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")

    saved = client.put(
        f"/api/documents/{document_id}/fields",
        headers=headers,
        json={
            "fields": [
                {
                    "recipient_id": recipient_id, "type": "drawing", "label": "Pen Drawing",
                    "page_number": 1, "x": 40, "y": 40, "width": 200, "height": 100,
                    "required": True, "read_only": False,
                    "options": {"color": "#047857", "stroke": 3, "strokes": [STROKE]},
                }
            ]
        },
    )
    assert saved.status_code == 200, saved.text
    row = saved.json()[0]
    assert row["type"] == "drawing"
    assert row["required"] is False and row["read_only"] is True
    assert row["options"]["strokes"] == [STROKE]


# ---------------------------------------------------------------------------
# What the recipient is shown
# ---------------------------------------------------------------------------


def test_every_recipient_sees_an_annotation_but_is_never_asked_to_fill_it(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    buyer = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    name_field = add_field(client, document_id, headers, buyer, "full_name", "Buyer full name", 680)
    # Assigned to the buyer, but content rather than an obligation.
    note = _annotation(
        client, document_id, headers, buyer,
        default_value="Please initial the schedule.",
        options={"font": "times", "size": 13},
    )

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    session = client.post(f"/api/sign/{token}/consent").json()

    assert [item["id"] for item in session["fields"]] == [name_field]
    assert note["id"] not in [item["id"] for item in session["other_field_placements"]]
    assert [item["id"] for item in session["annotations"]] == [note["id"]]
    assert session["annotations"][0]["default_value"] == "Please initial the schedule."
    # It is not one of this recipient's fields, and it does not move the gate.
    assert note["id"] not in session["assigned_field_ids"]
    assert session["required_total"] == 1

    # And it cannot be written to as though it were an input.
    refused = client.post(f"/api/sign/{token}/fields/{note['id']}/value", json={"value": "hi"})
    assert refused.status_code == 400


# ---------------------------------------------------------------------------
# The completed contract carries the mark
# ---------------------------------------------------------------------------


def test_annotations_are_burned_into_the_final_pdf(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    buyer = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    name_field = add_field(client, document_id, headers, buyer, "full_name", "Buyer full name", 680)
    _annotation(
        client, document_id, headers, buyer,
        default_value="Countersigned in escrow",
        options={"font": "courier", "size": 12},
    )
    _annotation(
        client, document_id, headers, buyer, type="drawing", label="Pen Drawing",
        y=300, options={"color": "#dc2626", "stroke": 2.5, "strokes": [STROKE]},
    )

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    final = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert final.status_code == 200, final.text
    reader = PdfReader(BytesIO(final.content))
    reader.decrypt("")
    page = reader.pages[0]
    assert "Countersigned in escrow" in (page.extract_text() or "")
    # The pen stroke is a path, not text: the page's content stream carries the
    # ink it was drawn in, the line width, and the operators that drew and
    # stroked the path.
    content = page.get_contents().get_data().decode("latin-1")
    assert "0.862745 0.14902 0.14902 RG" in content  # #dc2626
    assert "2.5 w" in content
    assert " m\n" in content and " l\n" in content and "\nS\n" in content


def test_a_text_box_wraps_to_its_box_rather_than_running_off_the_page() -> None:
    """Long text is wrapped by measuring the chosen face, not by counting
    characters -- and whatever will not fit in the box is dropped rather than
    printed over the document's own words."""
    from app.services.pdf_service import pdf_service

    class _Row:
        type = "textbox"
        options = {"kind": "textbox", "font": "helvetica", "size": 10, "bold": False, "italic": False, "color": "#0f172a"}
        default_value = "word " * 400
        value = None

    from reportlab.pdfgen import canvas

    packet = BytesIO()
    pdf = canvas.Canvas(packet, pagesize=(612, 792))
    assert pdf_service._draw_textbox(pdf, _Row(), 50, 600, 120, 40) is True
    pdf.save()
    reader = PdfReader(BytesIO(packet.getvalue()))
    text = reader.pages[0].extract_text() or ""
    # 40pt of box at 12pt leading holds three lines, not four hundred words.
    assert 0 < text.count("word") <= 12
