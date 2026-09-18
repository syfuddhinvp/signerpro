from __future__ import annotations

from base64 import b64decode
from secrets import token_urlsafe
from datetime import datetime, timezone
from io import BytesIO
from textwrap import wrap

from fastapi import HTTPException, status
from pypdf import PdfReader, PdfWriter
from pypdf.constants import UserAccessPermissions
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.annotations import (
    normalize_drawing_options,
    normalize_textbox_options,
    pdf_font_name,
    rgb,
)
from app.core.hashing import sha256_bytes
from app.core.pdf_geometry import page_geometry
from app.core.storage import storage
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.enums import DocumentStatus, DocumentVersionType, FieldType, SignatureType, SignerPaymentStatus, is_signing_role
from app.models.field import Field
from app.models.field_attachment import FieldAttachment
from app.models.recipient import Recipient
from app.models.signature import Signature
from app.models.payment_receipt import PaymentReceipt
from app.models.signer_payment import SignerPayment
from app.services import pades_service, pdf_layout
from app.services.audit_service import audit_service


class PdfService:
    def generate_final_pdf(self, db: Session, *, document: Document) -> Document:
        if not document.original_file_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document has no original PDF")
        if document.status == DocumentStatus.completed and document.final_file_path:
            return document
        # Only recipients carrying a signing obligation gate execution: a CC
        # ("copy") recipient is delivered a copy and never completes.
        signers = [recipient for recipient in document.recipients if is_signing_role(recipient.role)]
        if not signers or any(recipient.completed_at is None for recipient in signers):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="All recipients must complete before final PDF generation")

        original_bytes = storage.read_bytes(document.original_file_path)
        # SEAL INTEGRITY (audit 5.3): the certificate prints original_sha256 as
        # evidence that what was signed is what was uploaded. That claim is only
        # true if the bytes are re-hashed here, immediately before flattening.
        self.assert_original_intact(db, document, original_bytes)
        reader = PdfReader(BytesIO(original_bytes))
        writer = PdfWriter()
        signatures = self._latest_signatures(db, document.id)
        attachments = self._latest_attachments(db, document.id)
        payments = self._latest_payments(db, document.id)

        for page_index, page in enumerate(reader.pages, start=1):
            # Visual size, matching the pdf.js viewport the fields were placed
            # against: CropBox-derived and with /Rotate applied. See
            # app/core/pdf_geometry.
            geometry = page_geometry(page)
            overlay = self._build_page_overlay(
                page_width=geometry.width,
                page_height=geometry.height,
                fields=[field for field in document.fields if field.page_number == page_index],
                signatures=signatures,
                attachments=attachments,
                payments=payments,
                # Every page of an executed contract carries the mark, not just
                # the ones that happened to hold a field.
                verified_note=self._verified_note(document),
            )
            # Attach first, then merge into the *attached* page. pypdf
            # deprecated merging into a page that belongs to no writer --
            # it warned on every executed document, and the docs say the old
            # order is unreliable rather than merely noisy.
            attached = writer.add_page(page)
            if overlay:
                overlay_reader = PdfReader(BytesIO(overlay))
                # The overlay is drawn in the page's *visual* space. On a
                # rotated page, or one whose visible box does not start at
                # (0, 0), that is not the content space the page is stamped
                # in, so it is mapped back before merging.
                if geometry.is_identity:
                    attached.merge_page(overlay_reader.pages[0])
                else:
                    attached.merge_transformed_page(
                        overlay_reader.pages[0], geometry.overlay_ctm()
                    )

        audit_pdf = PdfReader(BytesIO(self._build_audit_certificate(db, document)))
        for audit_page in audit_pdf.pages:
            writer.add_page(audit_page)
        # Document properties: a reader's "Document properties" panel showed
        # every field empty, so a downloaded contract identified itself only by
        # its filename. The envelope id and the original hash go in the keywords
        # so the file can be tied back to its audit trail from the file alone.
        self._apply_metadata(db, writer, document)
        # LOCK THE SEAL: the executed contract is evidence, so it is stored —
        # and therefore downloaded — with its editing permissions cleared.
        self._apply_lock(writer)
        output = BytesIO()
        writer.write(output)
        final_bytes = output.getvalue()
        # Optional PAdES signature. Off unless a certificate is configured, so
        # the default product remains SES and is described as such. The hash is
        # taken *after* signing, because the signature changes the bytes and
        # the seal must describe the file that is actually stored.
        seal_result = pades_service.seal(final_bytes)
        final_bytes = seal_result.pdf
        final_hash = sha256_bytes(final_bytes)
        final_path = f"documents/{document.id}/final.pdf"
        storage.write_bytes(final_path, final_bytes)

        document.final_file_path = final_path
        document.final_sha256 = final_hash
        document.status = DocumentStatus.completed
        document.completed_at = document.completed_at or datetime.now(timezone.utc)
        for field in document.fields:
            field.is_locked = True
        db.add(
            DocumentVersion(
                document_id=document.id,
                version_type=DocumentVersionType.final,
                file_path=final_path,
                sha256=final_hash,
            )
        )
        audit_service.log(
            db,
            document_id=document.id,
            event_type="final_pdf_generated",
            event_message="Final signed PDF was generated.",
            metadata={"sha256": final_hash, "file_path": final_path},
        )
        audit_service.log(
            db,
            document_id=document.id,
            event_type="document_completed",
            event_message="Document completed after all recipients signed.",
        )
        # Cloud archive. Hooked here rather than in ``signing_service.complete``
        # because sealing is the one thing every completion route shares --
        # the signer flow and the sender's manual "generate final PDF" both
        # land exactly here, and neither can complete a document without it.
        # Imported locally: the export service reads documents and storage,
        # so a module-level import would close an import cycle.
        from app.services.cloud_export_service import cloud_export_service

        cloud_export_service.enqueue_for_document(db, document=document)
        return document

    # ---- seal integrity --------------------------------------------------

    def assert_original_intact(self, db: Session, document: Document, original_bytes: bytes) -> str:
        """Fail loudly when the stored original no longer matches its hash."""

        actual = sha256_bytes(original_bytes)
        if document.original_sha256 and actual != document.original_sha256:
            audit_service.log(
                db,
                document_id=document.id,
                event_type="original_hash_mismatch",
                event_message="Stored original PDF does not match its recorded SHA-256; sealing refused.",
                ip_address=None,
                user_agent=None,
                metadata={"recorded": document.original_sha256, "actual": actual},
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Original PDF integrity check failed: stored file does not match its recorded SHA-256.",
            )
        return actual

    def _actual_hash(self, path: str | None) -> str | None:
        if not path:
            return None
        try:
            return sha256_bytes(storage.read_bytes(path))
        except Exception:
            return None

    def verify_stored_files(self, document: Document) -> dict[str, str | bool | None]:
        """Re-hash the stored PDFs. Never trusts the recorded hash columns."""

        original_actual = self._actual_hash(document.original_file_path)
        final_actual = self._actual_hash(document.final_file_path)
        return {
            "original_sha256_actual": original_actual,
            "original_pdf_intact": (
                None
                if original_actual is None or not document.original_sha256
                else original_actual == document.original_sha256
            ),
            "final_sha256_actual": final_actual,
            "final_pdf_intact": (
                None
                if final_actual is None or not document.final_sha256
                else final_actual == document.final_sha256
            ),
        }

    def _latest_signatures(self, db: Session, document_id: str) -> dict[str, Signature]:
        signatures = db.scalars(
            select(Signature)
            .where(Signature.document_id == document_id)
            .order_by(Signature.field_id, Signature.created_at.desc())
        ).all()
        latest: dict[str, Signature] = {}
        for signature in signatures:
            latest.setdefault(signature.field_id, signature)
        return latest

    # ---- coordinate convention -------------------------------------------
    #
    # CANONICAL FIELD COORDINATE SPACE (the one seam where it changes):
    #
    #   Stored on `Field` (and carried by the API, the builder and the signing
    #   surface) as **PDF points with a TOP-LEFT origin**: `x` is the distance
    #   from the page's left edge to the field's left edge, and `y` is the
    #   distance from the page's *top* edge down to the field's *top* edge.
    #   Both are in points (1/72"), the same unit as the page mediabox, so the
    #   browser needs no unit conversion at all — it only scales by however
    #   large it chose to draw the page.
    #
    #   ReportLab's canvas is bottom-left origin, so `y` is flipped here and
    #   nowhere else. Anything drawn onto the overlay must go through
    #   `_pdf_y()`; a raw `field.y` reaching `drawString` is the C1 bug
    #   (a field 150pt from the top used to be stamped 150pt from the bottom).
    #
    # `field_service._validate_coordinates` bounds-checks `x + width <=
    # page_width` and `y + height <= page_height`, which holds identically under
    # either origin, so it needs no companion change.

    @staticmethod
    def _pdf_y(y_top: float, height: float, page_height: float) -> float:
        """Top-left-origin `y` (of the field's top edge) → ReportLab baseline y
        (of the field's *bottom* edge)."""

        return page_height - y_top - height

    def _latest_attachments(self, db: Session, document_id: str) -> dict[str, FieldAttachment]:
        """The newest uploaded file per field — a stamp image, or an attachment."""

        rows = db.scalars(
            select(FieldAttachment)
            .where(FieldAttachment.document_id == document_id)
            .order_by(FieldAttachment.created_at.asc())
        ).all()
        return {row.field_id: row for row in rows}

    def _latest_payments(self, db: Session, document_id: str) -> dict[str, SignerPayment]:
        """The newest attempt per payment field.

        A field is charged (and, on failure, retried) at most a handful of
        times; the most recent attempt is the one whose status the overlay
        and the certificate must show, exactly the way `_latest_signatures`
        picks the most recent signature for a re-signed field.
        """

        rows = db.scalars(
            select(SignerPayment)
            .where(SignerPayment.document_id == document_id)
            .order_by(SignerPayment.field_id, SignerPayment.created_at.desc())
        ).all()
        latest: dict[str, SignerPayment] = {}
        for row in rows:
            latest.setdefault(row.field_id, row)
        return latest

    def _build_page_overlay(
        self,
        *,
        page_width: float,
        page_height: float,
        fields: list[Field],
        signatures: dict[str, Signature],
        attachments: dict[str, FieldAttachment] | None = None,
        payments: dict[str, SignerPayment] | None = None,
        verified_note: str | None = None,
    ) -> bytes | None:
        packet = BytesIO()
        pdf = canvas.Canvas(packet, pagesize=(page_width, page_height))
        drew_anything = False
        if verified_note:
            self._draw_verified_badge(pdf, page_width, verified_note)
            drew_anything = True
        for field in fields:
            value = field.value or field.default_value
            x = float(field.x)
            width = float(field.width)
            height = float(field.height)
            # The single origin flip. `y` from here down is bottom-left origin.
            y = self._pdf_y(float(field.y), height, page_height)
            if field.type == FieldType.signature:
                signature = signatures.get(field.id)
                if not signature:
                    continue
                drew_anything = True
                self._draw_signature(pdf, signature, x, y, width, height)
                continue
            if field.type == FieldType.stamp:
                # A stamp is a mark on the page, so it is drawn as the image the
                # signer uploaded. Without this the executed contract carried
                # the *filename* as a line of text where the seal should be.
                attachment = (attachments or {}).get(field.id)
                if not attachment:
                    continue
                try:
                    image = ImageReader(BytesIO(storage.read_bytes(attachment.file_path)))
                except Exception:
                    continue
                drew_anything = True
                pdf.drawImage(image, x, y, width=width, height=height, mask="auto", preserveAspectRatio=True, anchor="c")
                continue
            if field.type == FieldType.drawing:
                if self._draw_ink(pdf, field, x, y, width, height):
                    drew_anything = True
                continue
            if field.type == FieldType.textbox:
                if self._draw_textbox(pdf, field, x, y, width, height):
                    drew_anything = True
                continue
            if field.type == FieldType.payment:
                # A payment field has no meaningful text value of its own --
                # `Field.value` (when present) is the internal `paid:<intent>`
                # marker the completion gate writes, never something fit to
                # print -- so it always takes this branch, drawing a
                # confirmation in place of the on-screen Pay button, or
                # nothing at all when there is nothing settled to attest to.
                payment = (payments or {}).get(field.id)
                if self._draw_payment_confirmation(pdf, payment, x, y, width, height):
                    drew_anything = True
                continue
            if field.type == FieldType.checkbox:
                if str(value).lower() == "true":
                    drew_anything = True
                    pdf.setFont("Helvetica-Bold", min(height * 0.8, 18))
                    pdf.drawCentredString(x + width / 2, y + height * 0.2, "X")
                continue
            if field.type == FieldType.radio:
                # One button of a radio group is a *button*, not a line of text.
                # Each member of the group carries the group's answer, so this
                # button is filled when that answer is its own choice; the ring
                # is drawn either way, because an unpicked button is part of the
                # question the executed document has to keep showing.
                choice = self._radio_choice(field)
                if choice is not None:
                    drew_anything = True
                    self._draw_radio(pdf, x, y, width, height, filled=str(value).strip() == choice)
                    continue
                # Authored before groups existed: one box listing its choices,
                # whose answer is a value -- drawn as text by the path below.
            if not value:
                continue
            drew_anything = True
            pdf.setFont("Helvetica", min(max(height * 0.45, 8), 12))
            pdf.drawString(x + 3, y + max(height * 0.35, 4), str(value)[:160])
        pdf.save()
        return packet.getvalue() if drew_anything else None

    @staticmethod
    def _radio_choice(field: Field) -> str | None:
        """The choice one radio button stands for, or None when the row is not
        a member of a group (see ``frontend/lib/sf/radioGroups.ts``)."""
        options = field.options
        if not isinstance(options, dict):
            return None
        choice = options.get("choice")
        group = options.get("group")
        if not choice or not group:
            return None
        text = str(choice).strip()
        return text or None

    @staticmethod
    def _draw_radio(
        pdf: canvas.Canvas, x: float, y: float, width: float, height: float, *, filled: bool
    ) -> None:
        """One radio button: its ring, and its dot when it is the answer."""
        radius = max(1.5, min(width, height) / 2 - 1)
        cx, cy = x + width / 2, y + height / 2
        pdf.saveState()
        pdf.setLineWidth(max(0.5, radius * 0.14))
        pdf.circle(cx, cy, radius, stroke=1, fill=0)
        if filled:
            pdf.circle(cx, cy, radius * 0.55, stroke=0, fill=1)
        pdf.restoreState()

    def _draw_payment_confirmation(
        self, pdf: canvas.Canvas, payment: SignerPayment | None, x: float, y: float, width: float, height: float
    ) -> bool:
        """A settled payment field's confirmation, in place of the on-screen
        Pay button: amount, the date paid, and a short reference.

        Anything short of an actually-settled payment must never look like
        one. `None` (no attempt at all, still `requires_payment`, mid-flight
        `processing`, or `failed`) draws nothing, leaving the box blank
        rather than mimicking money that never cleared. A refunded payment
        DID clear once, so it still gets its own line -- but says "refunded",
        never "paid".
        """
        if payment is None or payment.status not in (SignerPaymentStatus.succeeded, SignerPaymentStatus.refunded):
            return False
        amount = f"{payment.amount_cents / 100:,.2f} {payment.currency.upper()}"
        if payment.status == SignerPaymentStatus.refunded:
            lines = [f"Refunded {amount}", "This payment was refunded"]
        else:
            paid_at = payment.paid_at.strftime("%d %b %Y %H:%M UTC") if payment.paid_at else "date unknown"
            lines = [f"Paid {amount}", f"Paid {paid_at}", f"Ref: {payment.provider_payment_intent_id or 'n/a'}"]
        pdf.saveState()
        if payment.status == SignerPaymentStatus.refunded:
            pdf.setFillColorRGB(0.7, 0.35, 0.05)
        else:
            pdf.setFillColorRGB(0.02, 0.6, 0.41)
        line_height = min(max(height / max(len(lines), 1), 8), 12)
        pdf.setFont("Helvetica-Bold", min(max(line_height * 0.75, 7), 10))
        text_y = y + height - line_height
        for line in lines:
            if text_y < y - 2:
                break
            pdf.drawString(x + 3, text_y, line[:80])
            text_y -= line_height
        pdf.restoreState()
        return True

    def _draw_ink(
        self, pdf: canvas.Canvas, field: Field, x: float, y: float, width: float, height: float
    ) -> bool:
        """A pen annotation: the sender's strokes, drawn inside the field box.

        Points are stored normalised to the box with a top-left origin (see
        `app/core/annotations.py`), so they are scaled by the box here and
        flipped once onto the PDF's bottom-left origin -- which is what lets the
        same drawing survive a resize or a different page size.
        """
        options = normalize_drawing_options(field.options)
        strokes = options["strokes"]
        if not strokes:
            return False
        pdf.saveState()
        pdf.setStrokeColorRGB(*rgb(options["color"]))
        pdf.setFillColorRGB(*rgb(options["color"]))
        pdf.setLineWidth(options["stroke"])
        pdf.setLineCap(1)   # round: a hand-drawn line has no square ends
        pdf.setLineJoin(1)
        for stroke in strokes:
            points = [(x + px * width, y + (1 - py) * height) for px, py in stroke]
            if len(points) == 1:
                # A tap is a dot, not a zero-length line (which draws nothing).
                cx, cy = points[0]
                pdf.circle(cx, cy, options["stroke"] / 2, stroke=0, fill=1)
                continue
            path = pdf.beginPath()
            path.moveTo(*points[0])
            for point in points[1:]:
                path.lineTo(*point)
            pdf.drawPath(path, stroke=1, fill=0)
        pdf.restoreState()
        return True

    def _draw_textbox(
        self, pdf: canvas.Canvas, field: Field, x: float, y: float, width: float, height: float
    ) -> bool:
        """A text annotation, in the face and size the sender chose.

        The text is wrapped to the box's width by measuring the chosen font --
        `textwrap` counts characters, which in a proportional face is not width
        -- and lines that overflow the box are dropped rather than drawn over
        whatever the page already says there.
        """
        text = (field.default_value or field.value or "").strip()
        if not text:
            return False
        options = normalize_textbox_options(field.options)
        font = pdf_font_name(options["font"], bold=options["bold"], italic=options["italic"])
        size = float(options["size"])
        leading = size * 1.2
        inner = max(1.0, width - 6)
        lines: list[str] = []
        for paragraph in text.splitlines():
            if not paragraph.strip():
                lines.append("")
                continue
            line = ""
            for word in paragraph.split():
                candidate = f"{line} {word}".strip()
                if line and pdf.stringWidth(candidate, font, size) > inner:
                    lines.append(line)
                    line = word
                else:
                    line = candidate
            lines.append(line)
        pdf.saveState()
        pdf.setFont(font, size)
        pdf.setFillColorRGB(*rgb(options["color"]))
        # First baseline sits one line height below the top of the box.
        baseline = y + height - leading + (leading - size) / 2
        for line in lines:
            if baseline < y - size * 0.25:
                break
            if line:
                pdf.drawString(x + 3, baseline, line)
            baseline -= leading
        pdf.restoreState()
        return True

    def _draw_signature(self, pdf: canvas.Canvas, signature: Signature, x: float, y: float, width: float, height: float) -> None:
        if signature.signature_type == SignatureType.drawn and signature.signature_image_path:
            try:
                image = ImageReader(BytesIO(storage.read_bytes(signature.signature_image_path)))
                pdf.drawImage(image, x, y, width=width, height=height, mask="auto", preserveAspectRatio=True, anchor="c")
                return
            except Exception:
                pass
        pdf.setFont("Times-Italic", min(max(height * 0.55, 12), 24))
        pdf.drawString(x + 3, y + max(height * 0.3, 6), signature.signature_text or "Signed")

    def build_audit_certificate(self, db: Session, document: Document) -> bytes:
        """The certificate of completion as a standalone PDF.

        The same pages that are appended to the sealed document, rendered on
        their own so the trail can be downloaded as evidence at any point in the
        envelope's life — not only after it completes.
        """

        return self._lock(self._build_audit_certificate(db, document), db=db, document=document)

    #: Shown as the PDF's producing application in every reader.
    PRODUCER = "SignerPro"

    def _apply_metadata(self, db: Session, writer: PdfWriter, document: Document, *, certificate: bool = False) -> None:
        """Fill in the properties panel: who, what, when, and which envelope."""

        from app.models.organization import Organization
        from app.models.user import User

        sender = db.get(User, document.sender_id)
        organization = db.get(Organization, document.organization_id)
        author = organization.name if organization else (sender.email if sender else "SignerPro")
        sealed = document.completed_at or datetime.now(timezone.utc)
        title = f"{document.title} — certificate of completion" if certificate else document.title
        keywords = [f"envelope:{document.id}"]
        if document.original_sha256:
            keywords.append(f"original-sha256:{document.original_sha256}")
        writer.add_metadata(
            {
                "/Title": title,
                "/Author": author,
                "/Subject": (
                    "Certificate of completion and audit trail"
                    if certificate
                    else f"Electronically signed via SignerPro · envelope {document.id}"
                ),
                "/Keywords": " ".join(keywords),
                "/Creator": self.PRODUCER,
                "/Producer": self.PRODUCER,
                "/CreationDate": self._pdf_date(document.created_at or sealed),
                "/ModDate": self._pdf_date(sealed),
            }
        )

    @staticmethod
    def _pdf_date(moment: datetime) -> str:
        """A `D:YYYYMMDDHHmmSS+00'00'` string — the only date form PDF readers parse."""

        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment.astimezone(timezone.utc).strftime("D:%Y%m%d%H%M%S+00'00'")

    def _verified_note(self, document: Document) -> str | None:
        """The footer line stamped on every page of an executed contract."""

        if not document.original_sha256:
            return None
        sealed = (document.completed_at or datetime.now(timezone.utc)).strftime("%d %b %Y %H:%M UTC")
        return f"Signed and verified via SignerPro  ·  Envelope {document.id}  ·  Sealed {sealed}"

    def _draw_verified_badge(self, pdf: canvas.Canvas, page_width: float, note: str) -> None:
        """A small green check and one line of provenance, in the bottom margin.

        Deliberately tiny and hard against the page edge: it is a mark of
        provenance, not a watermark, and it must not sit on top of the
        document's own footer.
        """

        pdf.saveState()
        radius = 3.4
        cx, cy = 40.0, 12.0
        pdf.setFillColorRGB(0.02, 0.6, 0.41)
        pdf.circle(cx, cy, radius, fill=1, stroke=0)
        pdf.setStrokeColorRGB(1, 1, 1)
        pdf.setLineWidth(0.8)
        pdf.line(cx - 1.6, cy, cx - 0.4, cy - 1.4)
        pdf.line(cx - 0.4, cy - 1.4, cx + 1.7, cy + 1.5)
        pdf.setFillColorRGB(0.35, 0.4, 0.47)
        pdf.setFont("Helvetica", 6)
        pdf.drawString(cx + radius + 4, cy - 2, note[: int((page_width - 90) / 3)])
        pdf.restoreState()

    def _lock(self, pdf_bytes: bytes, *, db: Session | None = None, document: Document | None = None) -> bytes:
        """Re-write a PDF with its properties filled in and editing cleared."""

        reader = PdfReader(BytesIO(pdf_bytes))
        writer = PdfWriter()
        for page in reader.pages:
            writer.add_page(page)
        if db is not None and document is not None:
            self._apply_metadata(db, writer, document, certificate=True)
        self._apply_lock(writer)
        output = BytesIO()
        writer.write(output)
        return output.getvalue()

    def _apply_lock(self, writer: PdfWriter) -> None:
        """Printing, reading and copying stay open; filling and editing do not.

        The owner password is random and deliberately never stored, so nothing
        — this service included — can lift the restriction afterwards. Worth
        being precise: PDF permissions are honoured by conforming readers, not
        enforced by cryptography, so the tamper *evidence* remains the recorded
        SHA-256 and the audit chain. This stops the accidental edit.
        """

        writer.encrypt(
            user_password="",
            owner_password=token_urlsafe(32),
            permissions_flag=(
                UserAccessPermissions.PRINT
                | UserAccessPermissions.PRINT_TO_REPRESENTATION
                | UserAccessPermissions.EXTRACT
                | UserAccessPermissions.EXTRACT_TEXT_AND_GRAPHICS
            ),
            algorithm="AES-256",
        )

    def build_document_with_certificate(self, db: Session, document: Document) -> bytes:
        """The document and its certificate of completion, as one file.

        A sealed envelope already carries the certificate pages inside
        ``final.pdf``, so that file is served as it stands — re-stitching it
        would change its bytes and break the ``final_sha256`` the certificate
        itself attests to. An envelope still in flight is stitched on demand:
        the original PDF followed by the certificate, so "download" is one
        document plus its evidence rather than two files to keep together.
        """

        if document.final_file_path:
            return storage.read_bytes(document.final_file_path)
        if not document.original_file_path:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document has no PDF to download")

        writer = PdfWriter()
        for page in PdfReader(BytesIO(storage.read_bytes(document.original_file_path))).pages:
            writer.add_page(page)
        for page in PdfReader(BytesIO(self._build_audit_certificate(db, document))).pages:
            writer.add_page(page)
        self._apply_metadata(db, writer, document)
        self._apply_lock(writer)
        output = BytesIO()
        writer.write(output)
        return output.getvalue()

    def _build_audit_certificate(self, db: Session, document: Document) -> bytes:
        """The certificate of completion, in the product's house style.

        Laid out with ``pdf_layout.Sheet`` -- the same margins, palette, type
        scale and page furniture as the receipts and invoices -- rather than
        the navy banner and second palette it carried before. Nothing it
        *states* changed; a certificate is evidence, and wording that shifts
        with a redesign is wording nobody can rely on.

        The rows are drawn with the canvas directly rather than ``Sheet.row``
        because a signer card and a timeline row are records, not label/value
        pairs: each needs its own columns, its own wrapping and a status of its
        own.
        """
        from app.models.user import User

        sender = db.get(User, document.sender_id)
        sender_email = sender.email if sender else f"ID: {document.sender_id}"

        sheet = pdf_layout.Sheet(
            footer=f"Audit certificate · {document.title}"
        )
        pdf = sheet.canvas
        width = sheet.width

        sheet.header(
            eyebrow="SignerPro compliance record",
            title="Document History & Audit Certificate",
            reference=f"STATUS: {document.status.value.upper()}",
            issuer="SignFlow CRM E-Signature Compliance Audit Log",
            issued="All timestamps expressed in UTC",
        )

        # A verified badge that reports the chain, not a decoration: it says
        # "verified" only when `audit_service` re-derives the same head from the
        # stored entries, and says the opposite when it does not.
        verification = audit_service.verify_for_document(db, document)
        chain_ok = bool(verification["valid"])
        sheet.badge(
            "AUDIT CHAIN VERIFIED" if chain_ok else "AUDIT CHAIN BROKEN",
            pdf_layout.POSITIVE if chain_ok else pdf_layout.NEGATIVE,
        )

        def card(height: float) -> float:
            """A bordered row card at the cursor. Returns its top edge."""

            top = sheet.y
            pdf.setStrokeColorRGB(*pdf_layout.RULE)
            pdf.setLineWidth(0.75)
            pdf.setFillColorRGB(*pdf_layout.PANEL)
            pdf.roundRect(sheet.left, top - height, sheet.content_width, height, 5, fill=1, stroke=1)
            return top

        sheet.section("Document details")
        sheet.rows(
            [
                ("Document name", document.title),
                ("Document ID", document.id),
                (
                    "Date created",
                    document.created_at.strftime("%Y-%m-%d %H:%M:%S UTC")
                    if document.created_at
                    else "N/A",
                ),
                ("Original SHA-256 hash", document.original_sha256 or "N/A"),
                ("Document sender", sender_email),
            ],
            label_width=170,
        )

        sheet.section("Signers & Recipients")
        for recipient in sorted(document.recipients, key=lambda item: (item.signing_order, item.email)):
            sheet.space(0, keep=36)
            top = card(30)
            sheet.y = top - 12
            sheet.text(
                f"{recipient.name} ({recipient.email})",
                x=sheet.left + 10,
                size=8.5,
                bold=True,
                color=pdf_layout.INK,
                max_width=sheet.content_width - 140,
            )
            status_text = recipient.status.value.upper()
            sheet.text(
                status_text,
                x=sheet.right - 10,
                size=8,
                bold=True,
                color=pdf_layout.POSITIVE if status_text == "COMPLETED" else pdf_layout.WARNING,
                align="right",
            )
            sheet.y = top - 23
            sheet.text(
                f"Role: {recipient.role_name or 'Signer'}  |  Order: {recipient.signing_order}",
                x=sheet.left + 10,
                size=7.5,
                color=pdf_layout.MUTED,
                max_width=sheet.content_width - 300,
            )
            viewed = recipient.viewed_at.strftime("%Y-%m-%d %H:%M:%S UTC") if recipient.viewed_at else "Not Viewed"
            signed = (
                recipient.completed_at.strftime("%Y-%m-%d %H:%M:%S UTC")
                if recipient.completed_at
                else "Not Completed"
            )
            sheet.text(
                f"Viewed: {viewed}  |  Signed: {signed}",
                x=sheet.right - 10,
                size=7,
                color=pdf_layout.MUTED,
                align="right",
            )
            sheet.y = top - 30
            sheet.space(8, keep=40)

        # Payments section -- ONLY when the envelope actually carries at
        # least one payment attempt. An envelope with no payment fields has
        # no `SignerPayment` rows at all, so this block is skipped entirely
        # and the certificate says nothing about money.
        payments = self._latest_payments(db, document.id)
        if payments:
            recipients_by_id = {recipient.id: recipient for recipient in document.recipients}
            # The certificate used to cite only Stripe's PaymentIntent id, so
            # the executed document's sole payment evidence was an identifier
            # meaningful to a third party's dashboard. Citing this tenant's
            # own receipt number makes the claim traceable inside this
            # application -- to a numbered, checksummed record and, through
            # it, to a chained audit entry.
            receipts_by_payment = {
                receipt.signer_payment_id: receipt
                for receipt in db.scalars(
                    select(PaymentReceipt).where(
                        PaymentReceipt.signer_payment_id.in_([p.id for p in payments.values()])
                    )
                ).all()
            }
            sheet.section("Payments")

            collected_cents = 0
            currency = "USD"
            for payment in sorted(payments.values(), key=lambda item: item.created_at):
                sheet.space(0, keep=34)
                payer = recipients_by_id.get(payment.recipient_id)
                payer_label = f"{payer.name} ({payer.email})" if payer else payment.recipient_id
                amount_label = f"{payment.amount_cents / 100:,.2f} {payment.currency.upper()}"
                currency = payment.currency.upper()

                top = card(28)
                sheet.y = top - 11
                sheet.text(
                    payer_label,
                    x=sheet.left + 10,
                    size=8.5,
                    bold=True,
                    color=pdf_layout.INK,
                    max_width=sheet.content_width - 140,
                )
                status_text = payment.status.value.upper()
                sheet.text(
                    status_text,
                    x=sheet.right - 10,
                    size=8,
                    bold=True,
                    color=(
                        pdf_layout.POSITIVE
                        if payment.status == SignerPaymentStatus.succeeded
                        else pdf_layout.WARNING
                        if payment.status == SignerPaymentStatus.refunded
                        else pdf_layout.NEGATIVE
                    ),
                    align="right",
                )
                sheet.y = top - 21
                reference = payment.provider_payment_intent_id or "n/a"
                receipt = receipts_by_payment.get(payment.id)
                receipt_label = f"  |  Receipt: {receipt.number}" if receipt else ""
                sheet.text(
                    f"Amount: {amount_label}  |  Ref: {reference}{receipt_label}",
                    x=sheet.left + 10,
                    size=7.5,
                    color=pdf_layout.MUTED,
                    max_width=sheet.content_width - 20,
                )
                if payment.status in (SignerPaymentStatus.succeeded, SignerPaymentStatus.refunded):
                    collected_cents += payment.amount_cents - payment.refunded_amount_cents

                sheet.y = top - 28
                sheet.space(8, keep=40)

            sheet.space(6, keep=34)
            sheet.text(
                f"Total collected: {collected_cents / 100:,.2f} {currency}",
                size=9,
                bold=True,
                color=pdf_layout.INK,
            )
            sheet.space(13)
            # Says plainly who holds the money. A signer reading this months
            # later needs to know who to approach about a refund, and the
            # answer is the sender, not this platform.
            sheet.text(
                "Payments were received directly by the sender's own payment account; "
                "the sender is the merchant of record.",
                size=7.5,
                color=pdf_layout.MUTED,
            )
            sheet.space(16)

        sheet.section("Audit Log Timeline")

        #: Where each timeline column starts, as an offset from the left margin.
        #: One definition for the header and the rows, so a column heading can
        #: never drift away from the values under it.
        columns = (0.0, 180.0, 330.0, 450.0)

        def draw_table_header() -> None:
            sheet.space(0, keep=30)
            pdf.setFillColorRGB(0.929, 0.937, 0.953)
            pdf.rect(sheet.left, sheet.y - 13, sheet.content_width, 18, fill=1, stroke=0)
            for offset, label in zip(
                columns, ("Event Detail Log", "Triggered By", "Timestamp (UTC)", "IP Address")
            ):
                sheet.text(label, x=sheet.left + offset + 5, size=8, bold=True, color=pdf_layout.INK)
            sheet.space(22)

        draw_table_header()

        for index, event in enumerate(sorted(document.audit_logs, key=lambda item: item.created_at)):
            recipient = next((r for r in document.recipients if r.id == event.recipient_id), None)
            actor = recipient.email if recipient else (sender_email if event.user_id else "System/CRM")

            clean_message = event.event_message.replace("\n", " ").strip()
            event_lines = wrap(clean_message, width=42) or [""]
            row_height = max(len(event_lines) * 11 + 6, 20)

            # The break is taken before anything is drawn, so a wrapped event
            # never straddles two pages -- and the header is redrawn, because a
            # page of timestamps with no column headings is unreadable.
            if sheet.y - row_height < sheet.margin + pdf_layout.FOOTER_HEIGHT:
                sheet.page_break()
                draw_table_header()

            top = sheet.y
            if index % 2 == 1:
                pdf.setFillColorRGB(*pdf_layout.PANEL)
                pdf.rect(sheet.left, top - row_height + 4, sheet.content_width, row_height, fill=1, stroke=0)

            sheet.y = top - 6
            for line in event_lines:
                sheet.text(line, x=sheet.left + 5, size=8, color=pdf_layout.BODY, max_width=columns[1] - 10)
                sheet.y -= 11

            sheet.y = top - 6
            sheet.text(actor, x=sheet.left + columns[1] + 5, size=8, color=pdf_layout.BODY, max_width=columns[2] - columns[1] - 10)
            sheet.text(
                event.created_at.strftime("%Y-%m-%d %H:%M:%S UTC"),
                x=sheet.left + columns[2] + 5,
                size=8,
                color=pdf_layout.BODY,
                max_width=columns[3] - columns[2] - 10,
            )
            sheet.text(
                event.ip_address or "-",
                x=sheet.left + columns[3] + 5,
                size=8,
                color=pdf_layout.BODY,
            )

            sheet.y = top - row_height + 4
            sheet.rule(width=0.5)
            sheet.y = top - row_height

        return sheet.save()

    def save_drawn_signature(self, *, document_id: str, recipient_id: str, field_id: str, data_url_or_base64: str) -> str:
        payload = data_url_or_base64.split(",", 1)[1] if "," in data_url_or_base64 else data_url_or_base64
        try:
            image_bytes = b64decode(payload, validate=True)
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Signature image is not valid base64") from exc
        if len(image_bytes) > 1024 * 1024:
            raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Signature image is too large")
        if not image_bytes.startswith((b"\x89PNG", b"\xff\xd8")):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Signature image must be PNG or JPEG")
        relative_path = f"documents/{document_id}/signatures/{recipient_id}-{field_id}.png"
        return storage.write_bytes(relative_path, image_bytes)


pdf_service = PdfService()
