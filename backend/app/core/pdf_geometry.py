"""The one place that answers "how big is this page, and which way is it up?".

Field coordinates are stored in the space the *browser* lays fields out in:
pdf.js `page.getViewport({scale: 1})`. Two things about that viewport are easy
to get wrong on the server, and both were:

* It is measured from the **CropBox** (pdf.js `page.view`), not the MediaBox.
  Print-ready files and trimmed scans routinely differ, and a page whose
  CropBox starts at (0, 100) put every field 100pt out.
* It has **`/Rotate` already applied**. A 612x792 page with `/Rotate 90` is
  792x612 to the browser and to the person signing it. Reading `page.mediabox`
  gave the server the unrotated box, so it bounds-checked against the wrong
  axis (rejecting legal placements and accepting illegal ones) and stamped the
  overlay into unrotated content space, landing signatures rotated and
  displaced. Landscape and scanned contracts are the common case, not the edge
  case.

`PageGeometry.width`/`.height` are therefore the *visual* size — what the
builder drew and what the signer saw — and `overlay_ctm()` maps that visual
space back into the page's own content space for merging.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PageGeometry:
    """A page's visible box, as the browser sees it."""

    #: Visual page size in points, with /Rotate applied.
    width: float
    height: float
    #: The visible (CropBox) origin in the page's own content space.
    left: float
    bottom: float
    #: Normalised /Rotate, one of 0/90/180/270.
    rotation: int
    #: Unrotated visible-box size, in content space.
    content_width: float
    content_height: float

    def overlay_ctm(self) -> tuple[float, float, float, float, float, float]:
        """Transform mapping overlay (visual) coordinates into content space.

        The overlay is drawn at `width` x `height` with a bottom-left origin,
        exactly as the viewer presents the page. This rotates it back onto the
        unrotated content box and shifts it onto a non-zero CropBox origin, so
        `merge_transformed_page` puts the ink where the signer saw it.
        """

        w, h = self.content_width, self.content_height
        if self.rotation == 90:
            return (0.0, 1.0, -1.0, 0.0, w + self.left, self.bottom)
        if self.rotation == 180:
            return (-1.0, 0.0, 0.0, -1.0, w + self.left, h + self.bottom)
        if self.rotation == 270:
            return (0.0, -1.0, 1.0, 0.0, self.left, h + self.bottom)
        return (1.0, 0.0, 0.0, 1.0, self.left, self.bottom)

    @property
    def is_identity(self) -> bool:
        """True when the overlay can be merged without a transform."""

        return self.rotation == 0 and self.left == 0.0 and self.bottom == 0.0


def page_geometry(page) -> PageGeometry:
    """Measure a pypdf page the way pdf.js measures it in the builder."""

    # CropBox is what a viewer renders; it defaults to MediaBox when absent.
    # pypdf synthesises that default, but a malformed box is worth falling
    # back on rather than raising inside a signing request.
    try:
        box = page.cropbox
        content_width = float(box.width)
        content_height = float(box.height)
        if content_width <= 0 or content_height <= 0:
            raise ValueError("empty cropbox")
        left, bottom = float(box.left), float(box.bottom)
    except Exception:
        box = page.mediabox
        content_width, content_height = float(box.width), float(box.height)
        left, bottom = float(box.left), float(box.bottom)

    try:
        rotation = int(page.get("/Rotate", 0) or 0) % 360
    except (TypeError, ValueError):
        rotation = 0
    # /Rotate is defined in 90-degree increments; anything else is malformed.
    if rotation not in (0, 90, 180, 270):
        rotation = 0

    swapped = rotation in (90, 270)
    return PageGeometry(
        width=content_height if swapped else content_width,
        height=content_width if swapped else content_height,
        left=left,
        bottom=bottom,
        rotation=rotation,
        content_width=content_width,
        content_height=content_height,
    )
