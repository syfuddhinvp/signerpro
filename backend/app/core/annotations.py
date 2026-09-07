"""The sender's own marks on a page: a pen drawing and a text box.

Both are ordinary ``Field`` rows of a new ``FieldType``, which is what lets them
ride the field endpoints, the bulk save, the geometry validation and the final
PDF overlay that already exist. What separates them from every other type is
that they are *authored* content rather than something a recipient does: they
are always ``read_only`` and never ``required``, so they place no obligation on
anybody and the signing surface draws them as inert marks.

The shape each one carries in ``Field.options`` is normalised here, in one
place, because three consumers read it: the API (on the way in), the PDF
overlay (on the way out) and the browser. Anything malformed is dropped rather
than rejected -- a stray key in an options blob is not worth failing a save the
sender cannot correct.

Drawing coordinates are stored *normalised* to the field's own box (0..1, with
a top-left origin, the same origin the field's ``x``/``y`` use). That is what
makes a drawing survive being dragged, resized, or drawn at one zoom level and
rendered at another: the stroke is defined relative to its box, not to the page.
"""

from __future__ import annotations

from typing import Any

from app.models.enums import FieldType

#: Field types that are the sender's mark on the page rather than a recipient's
#: obligation. Kept here (not in ``enums``) so the rules that go with them --
#: always read-only, never required -- live beside the shape they carry.
ANNOTATION_TYPES = frozenset({FieldType.drawing, FieldType.textbox})

#: The base-14 PDF families reportlab can draw without an embedded font file.
#: The key is what the client stores and the value is the reportlab base name;
#: bold/italic pick the matching face in ``pdf_font_name``.
TEXTBOX_FONTS: dict[str, str] = {
    "helvetica": "Helvetica",
    "times": "Times",
    "courier": "Courier",
}
DEFAULT_TEXTBOX_FONT = "helvetica"
DEFAULT_TEXTBOX_SIZE = 12.0
MIN_TEXTBOX_SIZE = 6.0
MAX_TEXTBOX_SIZE = 96.0
DEFAULT_INK = "#0f172a"

MIN_PEN_WIDTH = 0.5
MAX_PEN_WIDTH = 12.0
DEFAULT_PEN_WIDTH = 2.0
#: A single gesture is sampled on every pointermove, which on a trackpad is far
#: more points than the mark needs. Capping keeps one field's blob bounded.
MAX_STROKES = 200
MAX_POINTS_PER_STROKE = 4000


def is_annotation(field_type: Any) -> bool:
    return field_type in ANNOTATION_TYPES


def _color(value: Any, fallback: str = DEFAULT_INK) -> str:
    """A ``#rrggbb`` string, or the fallback. Never raises: colour is cosmetic."""
    if not isinstance(value, str):
        return fallback
    text = value.strip()
    if len(text) != 7 or not text.startswith("#"):
        return fallback
    try:
        int(text[1:], 16)
    except ValueError:
        return fallback
    return text.lower()


def _number(value: Any, *, low: float, high: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number or number in (float("inf"), float("-inf")):  # NaN / inf
        return fallback
    return max(low, min(high, number))


def _unit(value: Any) -> float | None:
    """One drawing coordinate, clamped into the field's box."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return max(0.0, min(1.0, number))


def normalize_textbox_options(options: Any) -> dict[str, Any]:
    raw = options if isinstance(options, dict) else {}
    font = raw.get("font")
    font = font.lower() if isinstance(font, str) else ""
    return {
        "kind": "textbox",
        "font": font if font in TEXTBOX_FONTS else DEFAULT_TEXTBOX_FONT,
        "size": round(
            _number(raw.get("size"), low=MIN_TEXTBOX_SIZE, high=MAX_TEXTBOX_SIZE, fallback=DEFAULT_TEXTBOX_SIZE), 2
        ),
        "bold": bool(raw.get("bold")),
        "italic": bool(raw.get("italic")),
        "color": _color(raw.get("color")),
    }


def normalize_drawing_options(options: Any) -> dict[str, Any]:
    raw = options if isinstance(options, dict) else {}
    strokes: list[list[list[float]]] = []
    for stroke in (raw.get("strokes") or [])[:MAX_STROKES]:
        if not isinstance(stroke, (list, tuple)):
            continue
        points: list[list[float]] = []
        for point in stroke[:MAX_POINTS_PER_STROKE]:
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            x, y = _unit(point[0]), _unit(point[1])
            if x is None or y is None:
                continue
            points.append([round(x, 4), round(y, 4)])
        # A one-point stroke is a dot; the renderer draws it as a round cap, so
        # it is kept. An empty one is not a mark at all.
        if points:
            strokes.append(points)
    return {
        "kind": "drawing",
        "color": _color(raw.get("color")),
        "stroke": round(
            _number(raw.get("stroke"), low=MIN_PEN_WIDTH, high=MAX_PEN_WIDTH, fallback=DEFAULT_PEN_WIDTH), 2
        ),
        "strokes": strokes,
    }


def normalize_options(field_type: Any, options: Any) -> Any:
    """Options as stored for ``field_type``; untouched for a non-annotation."""
    if field_type == FieldType.textbox:
        return normalize_textbox_options(options)
    if field_type == FieldType.drawing:
        return normalize_drawing_options(options)
    return options


def pdf_font_name(font: str, *, bold: bool = False, italic: bool = False) -> str:
    """The reportlab base-14 face for a stored family plus its style flags."""
    base = TEXTBOX_FONTS.get((font or "").lower(), TEXTBOX_FONTS[DEFAULT_TEXTBOX_FONT])
    if base == "Times":
        if bold and italic:
            return "Times-BoldItalic"
        if bold:
            return "Times-Bold"
        if italic:
            return "Times-Italic"
        return "Times-Roman"
    if bold and italic:
        return f"{base}-BoldOblique"
    if bold:
        return f"{base}-Bold"
    if italic:
        return f"{base}-Oblique"
    return base


def rgb(color: str) -> tuple[float, float, float]:
    """``#rrggbb`` as reportlab's 0..1 triple."""
    text = _color(color)
    return (int(text[1:3], 16) / 255, int(text[3:5], 16) / 255, int(text[5:7], 16) / 255)
