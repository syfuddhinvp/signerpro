"""C1 — the field-coordinate round trip.

Field geometry is stored in **PDF points with a top-left origin** (see the
``coordinate convention`` block in ``app/services/pdf_service.py``). The final
PDF is drawn by ReportLab, whose origin is bottom-left, so exactly one flip
happens — at that seam. These tests pin the flip end to end: a field authored a
known distance from the top of the page must be stamped that same distance from
the top of the executed PDF, on a non-Letter page size as well as Letter.
"""

from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.services.pdf_service import pdf_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document, token_from_link
from app.tests.test_signing_correctness import add_field, add_recipient, send

A4 = (595.276, 841.89)
LETTER = (612.0, 792.0)


def make_pdf(size: tuple[float, float], pages: int = 1) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=size)
    for index in range(pages):
        pdf.drawString(72, size[1] - 72, f"Page {index + 1}")
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def stamped_positions(pdf_bytes: bytes, page_index: int = 0) -> list[tuple[str, float, float]]:
    """Every text run on a page, with the device-space (x, y) it was drawn at."""

    found: list[tuple[str, float, float]] = []

    def visitor(text, cm, tm, font_dict, font_size):  # noqa: ANN001
        stripped = text.strip()
        if stripped:
            found.append((stripped, tm[4], tm[5]))

    PdfReader(BytesIO(pdf_bytes)).pages[page_index].extract_text(visitor_text=visitor)
    return found


# ---------------------------------------------------------------- unit


def test_the_origin_flip_is_the_page_height_minus_the_top_edge_and_height() -> None:
    # A 48pt-tall field whose top edge is 150pt from the top of a 792pt page has
    # its bottom edge 792 - 150 - 48 = 594pt from the bottom.
    assert pdf_service._pdf_y(150.0, 48.0, 792.0) == 594.0
    # A4 is 841.89pt tall, so the same field lands elsewhere — the flip is
    # driven by the real mediabox, never by an assumed page size.
    assert round(pdf_service._pdf_y(150.0, 48.0, 841.89), 2) == 643.89


def test_the_flip_is_its_own_inverse() -> None:
    for page_height in (792.0, 841.89, 1008.0):
        for y in (0.0, 150.0, 400.5):
            flipped = pdf_service._pdf_y(y, 48.0, page_height)
            assert round(pdf_service._pdf_y(flipped, 48.0, page_height), 6) == y


def test_a_field_at_the_very_top_is_drawn_at_the_very_top() -> None:
    # y=0 (flush with the top edge) must put the field's *bottom* one height
    # below the top of the page — not at the bottom of the page.
    assert pdf_service._pdf_y(0.0, 40.0, 792.0) == 752.0


# ---------------------------------------------------------------- round trip


def _execute(client: TestClient, page: tuple[float, float], *, y_top: float, height: float) -> bytes:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, make_pdf(page), headers)
    recipient = add_recipient(client, document_id, headers, "Alice", "alice@example.com")
    add_field(
        client, document_id, headers, recipient, "text", "Marker",
        y=y_top, height=height, width=180,
    )
    tokens = send(client, document_id, headers)
    token = tokens["alice@example.com"]

    assert client.post(f"/api/sign/{token}/consent").status_code == 200
    session = client.get(f"/api/sign/{token}").json()
    field_id = session["fields"][0]["id"]
    # The session must hand the browser back exactly what was authored: same
    # unit, same origin. No conversion happens anywhere but the PDF seam.
    assert float(session["fields"][0]["y"]) == y_top
    assert float(session["fields"][0]["x"]) == 72

    saved = client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "ROUNDTRIP"})
    assert saved.status_code == 200, saved.text
    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.status_code == 200, completed.text

    final = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert final.status_code == 200, final.text
    return final.content


def test_a_field_authored_150pt_from_the_top_of_a_letter_page_is_stamped_there(
    client: TestClient,
) -> None:
    final = _execute(client, LETTER, y_top=150.0, height=48.0)
    runs = dict((text, (x, y)) for text, x, y in stamped_positions(final))
    assert "ROUNDTRIP" in runs, runs
    x, y = runs["ROUNDTRIP"]

    # Bottom edge of the field: 792 - 150 - 48 = 594. The glyph baseline sits
    # `max(height*0.35, 4)` above it, and x is inset 3pt.
    assert abs(x - 75.0) < 0.5
    assert abs(y - (594.0 + 16.8)) < 0.5
    # The pre-fix behaviour — the auditor measured y=612 for a field ~150 from
    # the top — put the text near the *top* of the page. It must not be there.
    assert y < 700


def test_the_same_field_on_an_a4_page_follows_the_a4_mediabox(client: TestClient) -> None:
    final = _execute(client, A4, y_top=150.0, height=48.0)
    runs = dict((text, (x, y)) for text, x, y in stamped_positions(final))
    assert "ROUNDTRIP" in runs, runs
    _, y = runs["ROUNDTRIP"]

    # 841.89 - 150 - 48 = 643.89, i.e. ~50pt higher up the sheet than on Letter
    # purely because the page is taller. A hardcoded 792 would land at 594.
    assert abs(y - (643.89 + 16.8)) < 0.5
    # Distance from the *top* of the page is what the author chose, on both
    # page sizes: 841.89 - (643.89 + 48) = 150.
    assert abs((A4[1] - (y - 16.8) - 48.0) - 150.0) < 0.5


def test_a_field_flush_with_the_top_of_the_page_is_stamped_at_the_top(client: TestClient) -> None:
    final = _execute(client, LETTER, y_top=0.0, height=40.0)
    runs = dict((text, (x, y)) for text, x, y in stamped_positions(final))
    assert "ROUNDTRIP" in runs, runs
    _, y = runs["ROUNDTRIP"]
    # Bottom edge at 752; anything below half the page means the flip is missing.
    assert y > 700, f"a field at y=0 (page top) was stamped at y={y}"
