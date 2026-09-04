"""Rotated pages and offset visible boxes (audit C-1 / C-2).

Field coordinates are authored against the pdf.js viewport, which applies
`/Rotate` and measures the CropBox. The server used to measure `page.mediabox`,
which does neither — so on a rotated or cropped page it bounds-checked the
wrong axis and stamped the overlay into the wrong space.

The suite had only upright, origin-at-zero fixtures, which is why this was
invisible. These build the awkward pages directly.
"""

from decimal import Decimal
from io import BytesIO

import pytest
from fastapi import HTTPException
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from app.core.pdf_geometry import page_geometry

LETTER_W, LETTER_H = 612.0, 792.0


def _pdf_bytes(width: float = LETTER_W, height: float = LETTER_H) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=(width, height))
    pdf.drawString(72, height - 72, "Purchase agreement")
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def _page(*, rotate: int = 0, crop: tuple[float, float, float, float] | None = None):
    reader = PdfReader(BytesIO(_pdf_bytes()))
    page = reader.pages[0]
    if rotate:
        page.rotate(rotate)
    if crop:
        page.cropbox.lower_left = (crop[0], crop[1])
        page.cropbox.upper_right = (crop[2], crop[3])
    return page


# ---- geometry ----------------------------------------------------------


def test_upright_page_measures_as_the_browser_does():
    geometry = page_geometry(_page())
    assert (geometry.width, geometry.height) == (LETTER_W, LETTER_H)
    assert geometry.rotation == 0
    assert geometry.is_identity


@pytest.mark.parametrize("rotation", [90, 270])
def test_quarter_turns_swap_the_visual_axes(rotation):
    """The bug: pdf.js reports 792x612 here, the MediaBox reports 612x792."""

    geometry = page_geometry(_page(rotate=rotation))
    assert (geometry.width, geometry.height) == (LETTER_H, LETTER_W)
    assert geometry.rotation == rotation
    assert not geometry.is_identity


def test_half_turn_keeps_the_axes_but_still_needs_a_transform():
    geometry = page_geometry(_page(rotate=180))
    assert (geometry.width, geometry.height) == (LETTER_W, LETTER_H)
    assert not geometry.is_identity


def test_cropbox_sets_the_origin_and_the_size():
    geometry = page_geometry(_page(crop=(0, 100, LETTER_W, 892)))
    assert geometry.height == 792.0
    assert geometry.bottom == 100.0
    assert not geometry.is_identity


def test_malformed_rotation_is_ignored_rather_than_raising():
    page = _page()
    page[__import__("pypdf").generic.NameObject("/Rotate")] = __import__(
        "pypdf"
    ).generic.NumberObject(45)
    assert page_geometry(page).rotation == 0


# ---- the transform -----------------------------------------------------


def _apply(ctm, point):
    a, b, c, d, e, f = ctm
    x, y = point
    return (a * x + c * y + e, b * x + d * y + f)


def _corners(width, height):
    return [(0.0, 0.0), (width, 0.0), (width, height), (0.0, height)]


@pytest.mark.parametrize("rotation", [0, 90, 180, 270])
def test_overlay_corners_land_on_the_content_box(rotation):
    """Whatever the rotation, the overlay must cover the page exactly."""

    geometry = page_geometry(_page(rotate=rotation))
    ctm = geometry.overlay_ctm()
    mapped = [_apply(ctm, corner) for corner in _corners(geometry.width, geometry.height)]

    xs = sorted(round(x, 6) for x, _ in mapped)
    ys = sorted(round(y, 6) for _, y in mapped)
    assert xs == [0.0, 0.0, LETTER_W, LETTER_W]
    assert ys == [0.0, 0.0, LETTER_H, LETTER_H]


def test_overlay_transform_is_shifted_onto_an_offset_cropbox():
    geometry = page_geometry(_page(crop=(0, 100, LETTER_W, 892)))
    # The overlay's bottom-left is the visible box's bottom-left, not (0, 0).
    assert _apply(geometry.overlay_ctm(), (0.0, 0.0)) == (0.0, 100.0)


def test_top_left_of_a_rotated_page_maps_to_the_visual_top_left():
    """A signature 1in from the top-left of what the signer saw.

    On a 90-degree page the visual top-left is the content bottom-left, which
    is precisely the mapping the old code got wrong.
    """

    geometry = page_geometry(_page(rotate=90))
    visual_top_left = (72.0, geometry.height - 72.0)
    x, y = _apply(geometry.overlay_ctm(), visual_top_left)
    assert (round(x, 6), round(y, 6)) == (72.0, 72.0)


# ---- bounds checking ---------------------------------------------------


class _Doc:
    """Enough of a Document for _validate_coordinates."""

    def __init__(self, path):
        self.original_file_path = path
        self.page_count = 1


@pytest.fixture()
def rotated_document(tmp_path, monkeypatch):
    from app.core import storage as storage_module
    from app.services.field_service import field_service

    writer = PdfWriter()
    reader = PdfReader(BytesIO(_pdf_bytes()))
    page = reader.pages[0]
    page.rotate(90)
    writer.add_page(page)
    buffer = BytesIO()
    writer.write(buffer)
    data = buffer.getvalue()

    monkeypatch.setattr(storage_module.storage, "read_bytes", lambda _path: data)
    monkeypatch.setattr(
        "app.services.field_service.storage", storage_module.storage, raising=False
    )
    return field_service, _Doc("documents/rotated.pdf")


def test_landscape_placement_is_accepted_on_a_rotated_page(rotated_document):
    """700pt across only fits once /Rotate is honoured. This used to 400."""

    field_service, document = rotated_document
    field_service._validate_coordinates(
        document, 1, Decimal("700"), Decimal("100"), Decimal("80"), Decimal("24")
    )


def test_placement_off_the_rotated_page_is_still_rejected(rotated_document):
    """The check must not simply get looser: 700pt down does not fit in 612."""

    field_service, document = rotated_document
    with pytest.raises(HTTPException) as excinfo:
        field_service._validate_coordinates(
            document, 1, Decimal("100"), Decimal("700"), Decimal("80"), Decimal("24")
        )
    assert excinfo.value.status_code == 400
