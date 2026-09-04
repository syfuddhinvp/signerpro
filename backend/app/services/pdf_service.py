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

from app.core.hashing import sha256_bytes
from app.core.storage import storage
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.enums import DocumentStatus, DocumentVersionType, FieldType, SignatureType, is_signing_role
from app.models.field import Field
from app.models.field_attachment import FieldAttachment
from app.models.recipient import Recipient
from app.models.signature import Signature
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

        for page_index, page in enumerate(reader.pages, start=1):
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)
            overlay = self._build_page_overlay(
                page_width=page_width,
                page_height=page_height,
                fields=[field for field in document.fields if field.page_number == page_index],
                signatures=signatures,
                attachments=attachments,
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
                attached.merge_page(overlay_reader.pages[0])

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

    def _build_page_overlay(
        self,
        *,
        page_width: float,
        page_height: float,
        fields: list[Field],
        signatures: dict[str, Signature],
        attachments: dict[str, FieldAttachment] | None = None,
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
            if field.type == FieldType.checkbox:
                if str(value).lower() == "true":
                    drew_anything = True
                    pdf.setFont("Helvetica-Bold", min(height * 0.8, 18))
                    pdf.drawCentredString(x + width / 2, y + height * 0.2, "X")
                continue
            if not value:
                continue
            drew_anything = True
            pdf.setFont("Helvetica", min(max(height * 0.45, 8), 12))
            pdf.drawString(x + 3, y + max(height * 0.35, 4), str(value)[:160])
        pdf.save()
        return packet.getvalue() if drew_anything else None

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
    PRODUCER = "SignForge"

    def _apply_metadata(self, db: Session, writer: PdfWriter, document: Document, *, certificate: bool = False) -> None:
        """Fill in the properties panel: who, what, when, and which envelope."""

        from app.models.organization import Organization
        from app.models.user import User

        sender = db.get(User, document.sender_id)
        organization = db.get(Organization, document.organization_id)
        author = organization.name if organization else (sender.email if sender else "SignForge")
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
                    else f"Electronically signed via SignForge · envelope {document.id}"
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
        return f"Signed and verified via SignForge  ·  Envelope {document.id}  ·  Sealed {sealed}"

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
        from app.models.user import User
        from textwrap import wrap

        sender = db.get(User, document.sender_id)
        sender_email = sender.email if sender else f"ID: {document.sender_id}"

        packet = BytesIO()
        pdf = canvas.Canvas(packet, pagesize=LETTER)
        width, height = LETTER
        cursor = height - 40

        # Draw beautiful Header Banner
        pdf.setFillColorRGB(0.08, 0.12, 0.28) # Professional Dark Navy
        pdf.rect(0, height - 60, width, 60, fill=1, stroke=0)
        
        pdf.setFillColorRGB(1, 1, 1)
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(40, height - 38, "Document History & Audit Certificate")
        
        pdf.setFont("Helvetica-Oblique", 9)
        pdf.setFillColorRGB(0.85, 0.88, 1.0)
        pdf.drawString(40, height - 48, "SignFlow CRM E-Signature Compliance Audit Log")
        
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawRightString(width - 40, height - 38, f"STATUS: {document.status.value.upper()}")
        pdf.setFont("Helvetica", 8)
        pdf.drawRightString(width - 40, height - 48, "All timestamps expressed in UTC")

        # A verified badge that reports the chain, not a decoration: it says
        # "verified" only when `audit_service` re-derives the same head from the
        # stored entries, and says the opposite when it does not.
        verification = audit_service.verify_for_document(db, document)
        chain_ok = bool(verification["valid"])
        badge_label = "AUDIT CHAIN VERIFIED" if chain_ok else "AUDIT CHAIN BROKEN"
        badge_width = pdf.stringWidth(badge_label, "Helvetica-Bold", 7) + 24
        badge_x = width - 40 - badge_width
        badge_y = height - 78
        if chain_ok:
            pdf.setFillColorRGB(0.02, 0.6, 0.41)
        else:
            pdf.setFillColorRGB(0.86, 0.15, 0.15)
        pdf.roundRect(badge_x, badge_y, badge_width, 15, 7.5, fill=1, stroke=0)
        pdf.setFillColorRGB(1, 1, 1)
        pdf.setFont("Helvetica-Bold", 7)
        pdf.drawString(badge_x + 17, badge_y + 4.6, badge_label)
        # The tick, drawn rather than typed so no font has to carry the glyph.
        pdf.setStrokeColorRGB(1, 1, 1)
        pdf.setLineWidth(1.1)
        tick_x, tick_y = badge_x + 9, badge_y + 7.5
        if chain_ok:
            pdf.line(tick_x - 2.6, tick_y, tick_x - 0.9, tick_y - 2.2)
            pdf.line(tick_x - 0.9, tick_y - 2.2, tick_x + 2.8, tick_y + 2.6)
        else:
            pdf.line(tick_x - 2.4, tick_y - 2.4, tick_x + 2.4, tick_y + 2.4)
            pdf.line(tick_x - 2.4, tick_y + 2.4, tick_x + 2.4, tick_y - 2.4)

        cursor = height - 85

        def check_page_break(needed_height: float):
            nonlocal cursor
            if cursor - needed_height < 45:
                pdf.showPage()
                # Thin professional header for subsequent pages
                pdf.setFillColorRGB(0.08, 0.12, 0.28)
                pdf.rect(0, height - 35, width, 35, fill=1, stroke=0)
                pdf.setFillColorRGB(1, 1, 1)
                pdf.setFont("Helvetica-Bold", 10)
                pdf.drawString(40, height - 22, f"Audit Log (continued) - {document.title}")
                pdf.setFont("Helvetica", 8)
                pdf.drawRightString(width - 40, height - 22, "SignFlow CRM Compliance Audit Log")
                cursor = height - 55

        # Document Details section
        pdf.setFillColorRGB(0.08, 0.12, 0.28)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(40, cursor, "Document Details")
        
        # Outline Box for details
        box_top = cursor - 8
        box_bottom = box_top - 82
        pdf.setStrokeColorRGB(0.85, 0.85, 0.88)
        pdf.setLineWidth(1)
        pdf.setFillColorRGB(0.97, 0.98, 0.99)
        pdf.rect(40, box_bottom, width - 80, box_top - box_bottom, fill=1, stroke=1)
        
        details = [
            ("Document Name:", document.title),
            ("Document ID:", document.id),
            ("Date Created:", document.created_at.strftime('%Y-%m-%d %H:%M:%S UTC') if document.created_at else "N/A"),
            ("Original SHA-256 Hash:", document.original_sha256 or "N/A"),
            ("Document Sender:", sender_email)
        ]
        
        pdf.setFillColorRGB(0.15, 0.15, 0.15)
        text_y = box_top - 14
        for key, val in details:
            pdf.setFont("Helvetica-Bold", 8)
            pdf.drawString(52, text_y, key)
            pdf.setFont("Helvetica", 8)
            pdf.drawString(170, text_y, str(val))
            text_y -= 13
            
        cursor = box_bottom - 20

        # Recipients section
        pdf.setFillColorRGB(0.08, 0.12, 0.28)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(40, cursor, "Signers & Recipients")
        cursor -= 10
        
        for recipient in sorted(document.recipients, key=lambda item: (item.signing_order, item.email)):
            check_page_break(38)
            
            # Recipient box border & fill
            pdf.setStrokeColorRGB(0.88, 0.88, 0.9)
            pdf.setLineWidth(0.75)
            pdf.setFillColorRGB(0.99, 0.99, 1.0)
            pdf.rect(40, cursor - 28, width - 80, 28, fill=1, stroke=1)
            
            # Recipient info text
            pdf.setFillColorRGB(0.1, 0.1, 0.1)
            pdf.setFont("Helvetica-Bold", 8)
            pdf.drawString(48, cursor - 10, f"{recipient.name} ({recipient.email})")
            
            pdf.setFont("Helvetica", 7.5)
            pdf.setFillColorRGB(0.4, 0.4, 0.4)
            pdf.drawString(48, cursor - 21, f"Role: {recipient.role_name or 'Signer'}  |  Order: {recipient.signing_order}")
            
            # Status Badge on the right side of the card
            status_text = recipient.status.value.upper()
            status_color = (0.1, 0.55, 0.1) if status_text == "COMPLETED" else (0.85, 0.45, 0.0)
            pdf.setFillColorRGB(*status_color)
            pdf.setFont("Helvetica-Bold", 8)
            pdf.drawRightString(width - 48, cursor - 10, status_text)
            
            # Timestamps right-aligned
            pdf.setFont("Helvetica", 7)
            pdf.setFillColorRGB(0.45, 0.45, 0.45)
            viewed_str = recipient.viewed_at.strftime('%Y-%m-%d %H:%M:%S UTC') if recipient.viewed_at else "Not Viewed"
            completed_str = recipient.completed_at.strftime('%Y-%m-%d %H:%M:%S UTC') if recipient.completed_at else "Not Completed"
            pdf.drawRightString(width - 48, cursor - 21, f"Viewed: {viewed_str}  |  Signed: {completed_str}")
            
            cursor -= 33

        cursor -= 10

        # Timeline Header
        check_page_break(40)
        pdf.setFillColorRGB(0.08, 0.12, 0.28)
        pdf.setFont("Helvetica-Bold", 11)
        pdf.drawString(40, cursor, "Audit Log Timeline")
        cursor -= 10

        def draw_table_header():
            nonlocal cursor
            check_page_break(25)
            pdf.setFillColorRGB(0.93, 0.94, 0.96)
            pdf.rect(40, cursor - 15, width - 80, 18, fill=1, stroke=0)
            
            pdf.setFillColorRGB(0.1, 0.15, 0.3)
            pdf.setFont("Helvetica-Bold", 8)
            pdf.drawString(45, cursor - 8, "Event Detail Log")
            pdf.drawString(200, cursor - 8, "Triggered By")
            pdf.drawString(350, cursor - 8, "Timestamp (UTC)")
            pdf.drawString(470, cursor - 8, "IP Address")
            cursor -= 20

        draw_table_header()
        
        row_index = 0
        for event in sorted(document.audit_logs, key=lambda item: item.created_at):
            recipient = next((r for r in document.recipients if r.id == event.recipient_id), None)
            actor = recipient.email if recipient else (sender_email if event.user_id else "System/CRM")
            
            # Format and wrap long messages cleanly
            clean_message = event.event_message.replace("\n", " ").strip()
            event_lines = wrap(clean_message, width=38) or [""]
            row_height = max(len(event_lines) * 11 + 6, 20)
            
            check_page_break(row_height)
            
            if row_index % 2 == 1:
                pdf.setFillColorRGB(0.97, 0.98, 0.99)
                pdf.rect(40, cursor - row_height + 4, width - 80, row_height, fill=1, stroke=0)
                
            pdf.setFillColorRGB(0.15, 0.15, 0.15)
            pdf.setFont("Helvetica", 8)
            
            line_y = cursor - 6
            for eline in event_lines:
                pdf.drawString(45, line_y, eline)
                line_y -= 11
                
            pdf.drawString(200, cursor - 6, actor[:32])
            pdf.drawString(350, cursor - 6, event.created_at.strftime('%Y-%m-%d %H:%M:%S UTC'))
            pdf.drawString(470, cursor - 6, event.ip_address or "-")
            
            pdf.setStrokeColorRGB(0.9, 0.9, 0.9)
            pdf.setLineWidth(0.5)
            pdf.line(40, cursor - row_height + 4, width - 40, cursor - row_height + 4)
            
            cursor -= row_height
            row_index += 1

        pdf.save()
        return packet.getvalue()

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
