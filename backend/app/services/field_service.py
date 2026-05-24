from decimal import Decimal
from io import BytesIO

from fastapi import HTTPException, status
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.storage import storage
from app.models.document import Document
from app.models.field import Field
from app.models.user import User
from app.schemas.field import FieldCreate, FieldUpdate
from app.services.audit_service import audit_service
from app.services.document_service import document_service


class FieldService:
    def create(self, db: Session, *, document: Document, user: User, payload: FieldCreate) -> Field:
        document_service.ensure_editable(document)
        self._validate_recipient(document, payload.recipient_id)
        self._validate_coordinates(document, payload.page_number, payload.x, payload.y, payload.width, payload.height)
        field = Field(document_id=document.id, **payload.model_dump())
        db.add(field)
        db.flush()
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=field.recipient_id,
            user_id=user.id,
            event_type="field_added",
            event_message=f"Field '{field.label}' was added.",
            metadata={"field_id": field.id, "type": field.type},
        )
        db.commit()
        db.refresh(field)
        return field

    def get(self, document: Document, field_id: str) -> Field:
        field = next((item for item in document.fields if item.id == field_id), None)
        if not field:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
        return field

    def update(self, db: Session, *, document: Document, user: User, field_id: str, payload: FieldUpdate) -> Field:
        document_service.ensure_editable(document)
        field = self.get(document, field_id)
        updates = payload.model_dump(exclude_unset=True)
        recipient_id = updates.get("recipient_id", field.recipient_id)
        self._validate_recipient(document, recipient_id)
        page_number = updates.get("page_number", field.page_number)
        x = updates.get("x", field.x)
        y = updates.get("y", field.y)
        width = updates.get("width", field.width)
        height = updates.get("height", field.height)
        self._validate_coordinates(document, page_number, Decimal(x), Decimal(y), Decimal(width), Decimal(height))
        for key, value in updates.items():
            setattr(field, key, value)
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=field.recipient_id,
            user_id=user.id,
            event_type="field_updated",
            event_message=f"Field '{field.label}' was updated.",
            metadata={"field_id": field.id},
        )
        db.commit()
        db.refresh(field)
        return field

    def delete(self, db: Session, *, document: Document, user: User, field_id: str) -> None:
        document_service.ensure_editable(document)
        field = self.get(document, field_id)
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=field.recipient_id,
            user_id=user.id,
            event_type="field_deleted",
            event_message=f"Field '{field.label}' was deleted.",
            metadata={"field_id": field.id},
        )
        db.delete(field)
        db.commit()

    def _validate_recipient(self, document: Document, recipient_id: str) -> None:
        if not any(recipient.id == recipient_id for recipient in document.recipients):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field recipient must belong to this document")

    def _validate_coordinates(
        self,
        document: Document,
        page_number: int,
        x: Decimal,
        y: Decimal,
        width: Decimal,
        height: Decimal,
    ) -> None:
        if not document.original_file_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a PDF before placing fields")
        if page_number < 1 or page_number > document.page_count:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid field page number")
        if x < 0 or y < 0 or width <= 0 or height <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid field coordinates")
        reader = PdfReader(BytesIO(storage.read_bytes(document.original_file_path)))
        page = reader.pages[page_number - 1]
        page_width = Decimal(str(float(page.mediabox.width)))
        page_height = Decimal(str(float(page.mediabox.height)))
        if x + width > page_width or y + height > page_height:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field must fit inside the PDF page")


field_service = FieldService()

