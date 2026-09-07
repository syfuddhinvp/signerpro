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


def convert_to_pdf(*, filename: str, content: bytes) -> bytes:
    """Return `content` as PDF bytes, converting by file type where needed.

    A `.pdf` upload is passed straight through so an already-signed or
    form-bearing PDF is never re-rendered.
    """
    extension = extension_of(filename)
    if extension == ".pdf":
        return content
    if extension in IMAGE_EXTENSIONS:
        return _image_to_pdf(content)
    if extension in OFFICE_EXTENSIONS:
        return _office_to_pdf(filename=filename, content=content, extension=extension)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Unsupported file type. Upload a PDF, an image, or a document such as .docx.",
    )


def _image_to_pdf(content: bytes) -> bytes:
    try:
        with Image.open(BytesIO(content)) as image:
            frames = _flatten_frames(image)
            buffer = BytesIO()
            first, rest = frames[0], frames[1:]
            first.save(buffer, format="PDF", resolution=IMAGE_DPI, save_all=bool(rest), append_images=rest)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Image could not be read",
        ) from exc
    return buffer.getvalue()


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
