from __future__ import annotations

from base64 import b64decode
from datetime import datetime, timezone
from io import BytesIO
from textwrap import wrap

from fastapi import HTTPException, status
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.hashing import sha256_bytes
from app.core.storage import storage
from app.models.document import Document
from app.models.document_version import DocumentVersion
from app.models.enums import DocumentStatus, DocumentVersionType, FieldType, SignatureType
from app.models.field import Field
from app.models.recipient import Recipient
from app.models.signature import Signature
from app.services.audit_service import audit_service


class PdfService:
    def generate_final_pdf(self, db: Session, *, document: Document) -> Document:
        if not document.original_file_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Document has no original PDF")
        if document.status == DocumentStatus.completed and document.final_file_path:
            return document
        if not document.recipients or any(recipient.completed_at is None for recipient in document.recipients):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="All recipients must complete before final PDF generation")

        original_bytes = storage.read_bytes(document.original_file_path)
        reader = PdfReader(BytesIO(original_bytes))
        writer = PdfWriter()
        signatures = self._latest_signatures(db, document.id)

        for page_index, page in enumerate(reader.pages, start=1):
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)
            overlay = self._build_page_overlay(
                page_width=page_width,
                page_height=page_height,
                fields=[field for field in document.fields if field.page_number == page_index],
                signatures=signatures,
            )
            if overlay:
                overlay_reader = PdfReader(BytesIO(overlay))
                page.merge_page(overlay_reader.pages[0])
            writer.add_page(page)

        audit_pdf = PdfReader(BytesIO(self._build_audit_certificate(db, document)))
        for audit_page in audit_pdf.pages:
            writer.add_page(audit_page)
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

    def _build_page_overlay(
        self,
        *,
        page_width: float,
        page_height: float,
        fields: list[Field],
        signatures: dict[str, Signature],
    ) -> bytes | None:
        packet = BytesIO()
        pdf = canvas.Canvas(packet, pagesize=(page_width, page_height))
        drew_anything = False
        for field in fields:
            value = field.value or field.default_value
            x = float(field.x)
            y = float(field.y)
            width = float(field.width)
            height = float(field.height)
            if field.type == FieldType.signature:
                signature = signatures.get(field.id)
                if not signature:
                    continue
                drew_anything = True
                self._draw_signature(pdf, signature, x, y, width, height)
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
