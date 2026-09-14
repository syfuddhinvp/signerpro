"""Turn whatever a sender uploads into the one thing the rest of the app knows
how to sign: a PDF.

Signing, field placement, PAdES sealing and the audit certificate all assume a
PDF page tree, so conversion happens once at the upload boundary and nothing
downstream has to care that the sender started from a .docx or a photo of a
contract.

Images go through Pillow (already a dependency). Office and text formats go
through a headless LibreOffice, which is optional at runtime: where it is not
installed those uploads are refused with a clear message rather than failing
somewhere deeper.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError

# 72 pt == 1 inch, and Pillow writes image PDFs at `resolution` dots per inch.
# 96 dpi keeps a screenshot roughly life-size on the page instead of blowing it
# up to several sheets.
IMAGE_DPI = 96.0

#: US Letter in points -- the page an image is laid onto when there is no
#: existing page to match (an image uploaded as the original).
DEFAULT_PAGE_SIZE = (612.0, 792.0)

#: How an image is laid onto the page it is being turned into.
#:
#: ``fit``    contain: the whole image, scaled down to sit inside the page.
#: ``fill``   cover: the page is filled edge to edge and the overhang cropped.
#: ``actual`` no page at all -- the page becomes the image's own size at
#:            ``IMAGE_DPI``, which is what a 3000px screenshot did before there
#:            was a choice: a page several feet tall, dwarfing the document it
#:            was added to.
IMAGE_FIT_MODES = frozenset({"fit", "fill", "actual"})

#: A crop rectangle as fractions of the image: ``(x, y, width, height)`` with
#: the origin at the top left. Fractions rather than pixels because the
#: chooser is a box dragged over a preview scaled to fit a dialog -- it knows
#: where the box is in the picture, not how many pixels that is in the
#: original, and the two must not be allowed to disagree.
CropRect = tuple[float, float, float, float]

IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp"})
OFFICE_EXTENSIONS = frozenset(
    {
        ".doc", ".docx", ".odt", ".rtf", ".txt", ".md",
        ".xls", ".xlsx", ".ods", ".csv",
        ".ppt", ".pptx", ".odp",
    }
)
SUPPORTED_EXTENSIONS = frozenset({".pdf"}) | IMAGE_EXTENSIONS | OFFICE_EXTENSIONS

# Long enough for LibreOffice's first-run profile creation on a cold container,
# short enough that a wedged conversion cannot pin a worker indefinitely.
SOFFICE_TIMEOUT_SECONDS = 120


def extension_of(filename: str) -> str:
    return Path(filename).suffix.lower()


def is_supported(filename: str) -> bool:
    return extension_of(filename) in SUPPORTED_EXTENSIONS


def soffice_binary() -> str | None:
    return shutil.which("soffice") or shutil.which("libreoffice")


def convert_to_pdf(
    *,
    filename: str,
    content: bytes,
    page_size: tuple[float, float] | None = None,
    fit: str = "fit",
    crop: CropRect | None = None,
) -> bytes:
    """Return `content` as PDF bytes, converting by file type where needed.

    A `.pdf` upload is passed straight through so an already-signed or
    form-bearing PDF is never re-rendered.

    ``crop`` cuts the image down to the part the sender chose before any of
    that happens. ``page_size`` (in points) and ``fit`` apply to images only: an image has no
    page size of its own, so one has to be chosen for it, and the sensible
    choice is the size of the document it is joining. See ``IMAGE_FIT_MODES``.
    """
    extension = extension_of(filename)
    if extension == ".pdf":
        return content
    if extension in IMAGE_EXTENSIONS:
        return _image_to_pdf(content, page_size=page_size, fit=fit, crop=crop)
    if extension in OFFICE_EXTENSIONS:
        return _office_to_pdf(filename=filename, content=content, extension=extension)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Unsupported file type. Upload a PDF, an image, or a document such as .docx.",
    )


def _image_to_pdf(
    content: bytes,
    *,
    page_size: tuple[float, float] | None = None,
    fit: str = "fit",
    crop: CropRect | None = None,
) -> bytes:
    if fit not in IMAGE_FIT_MODES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown image fit")
    if crop is not None:
        _validate_crop(crop)
    try:
        with Image.open(BytesIO(content)) as image:
            frames = _flatten_frames(image)
            if crop is not None:
                frames = [_crop(frame, crop) for frame in frames]
            if fit != "actual":
                target = page_size or DEFAULT_PAGE_SIZE
                frames = [_lay_on_page(frame, page_size=target, fit=fit) for frame in frames]
            buffer = BytesIO()
            first, rest = frames[0], frames[1:]
            first.save(buffer, format="PDF", resolution=IMAGE_DPI, save_all=bool(rest), append_images=rest)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image could not be read",
        ) from exc
    return buffer.getvalue()


def _validate_crop(crop: CropRect) -> None:
    x, y, width, height = crop
    if width <= 0 or height <= 0 or x < 0 or y < 0 or x + width > 1.0001 or y + height > 1.0001:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected area is not inside the image",
        )


def _crop(frame: Image.Image, crop: CropRect) -> Image.Image:
    """The part of ``frame`` the sender selected.

    Rounding is clamped to at least one pixel in each direction: a hairline
    selection is a slip, not a reason to fail the whole upload.
    """
    source_w, source_h = frame.size
    left = min(round(crop[0] * source_w), source_w - 1)
    top = min(round(crop[1] * source_h), source_h - 1)
    right = max(min(round((crop[0] + crop[2]) * source_w), source_w), left + 1)
    bottom = max(min(round((crop[1] + crop[3]) * source_h), source_h), top + 1)
    return frame.crop((left, top, right, bottom))


def _lay_on_page(frame: Image.Image, *, page_size: tuple[float, float], fit: str) -> Image.Image:
    """Draw ``frame`` onto a white page of exactly ``page_size`` points.

    The image keeps its aspect ratio and is centred either way; ``fit`` scales
    it down to sit inside the page, ``fill`` scales it up to cover the page and
    crops the overhang. Working in pixels at ``IMAGE_DPI`` and saving at the
    same resolution is what makes the finished PDF page come out at exactly the
    requested point size.
    """
    width = max(1, round(page_size[0] / 72.0 * IMAGE_DPI))
    height = max(1, round(page_size[1] / 72.0 * IMAGE_DPI))
    source_w, source_h = frame.size
    if source_w < 1 or source_h < 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image could not be read")
    ratios = (width / source_w, height / source_h)
    scale = min(ratios) if fit == "fit" else max(ratios)
    scaled = frame.resize((max(1, round(source_w * scale)), max(1, round(source_h * scale))), Image.LANCZOS)
    page = Image.new("RGB", (width, height), (255, 255, 255))
    page.paste(scaled, ((width - scaled.width) // 2, (height - scaled.height) // 2))
    return page


def _flatten_frames(image: Image.Image) -> list[Image.Image]:
    """Every frame of the image as opaque RGB.

    Multi-frame sources (animated GIF, multi-page TIFF) become one PDF page per
    frame. Transparency is composited onto white: a PDF page has no alpha, and
    without this an RGBA logo would raise instead of printing.
    """
    frames: list[Image.Image] = []
    index = 0
    while True:
        try:
            image.seek(index)
        except EOFError:
            break
        frame = image.convert("RGBA") if image.mode in {"RGBA", "LA", "P"} else image.convert("RGB")
        if frame.mode == "RGBA":
            canvas = Image.new("RGB", frame.size, (255, 255, 255))
            canvas.paste(frame, mask=frame.split()[3])
            frame = canvas
        frames.append(frame)
        index += 1
        if not getattr(image, "is_animated", False) and index >= getattr(image, "n_frames", 1):
            break
    if not frames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Image could not be read")
    return frames


def _office_to_pdf(*, filename: str, content: bytes, extension: str) -> bytes:
    binary = soffice_binary()
    if binary is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Converting this file type is unavailable right now. Upload a PDF instead.",
        )
    with tempfile.TemporaryDirectory() as workdir:
        work = Path(workdir)
        # The sender's filename never reaches the filesystem: only its extension
        # matters to LibreOffice, and a fixed stem keeps path traversal and
        # exotic characters out of the command entirely.
        source = work / f"source{extension}"
        source.write_bytes(content)
        outdir = work / "out"
        outdir.mkdir()
        try:
            result = subprocess.run(
                [
                    binary,
                    "--headless",
                    "--norestore",
                    f"-env:UserInstallation=file://{work / 'profile'}",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(outdir),
                    str(source),
                ],
                capture_output=True,
                timeout=SOFFICE_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Document took too long to convert",
            ) from exc
        produced = outdir / "source.pdf"
        if result.returncode != 0 or not produced.exists():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{Path(filename).name} could not be converted to PDF",
            )
        return produced.read_bytes()
