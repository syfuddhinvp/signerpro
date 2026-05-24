from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, request_ip, request_user_agent
from app.core.database import get_db
from app.core.storage import storage
from app.models.enums import DocumentStatus, RecipientStatus
from app.models.user import User
from app.schemas.document import DocumentCreate, DocumentResponse, DocumentUpdate, SendDocumentResponse, UploadPdfResponse
from app.services.audit_service import audit_service
from app.services.document_service import document_response, document_service
from app.services.email_service import signflow_email_service
from app.services.pdf_service import pdf_service
from app.services.token_service import token_service


router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("", response_model=DocumentResponse, status_code=201)
def create_document(payload: DocumentCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    document = document_service.create(db, user=user, payload=payload)
    return document_response(document)


@router.get("", response_model=list[DocumentResponse])
def list_documents(
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DocumentResponse]:
    return [document_response(document) for document in document_service.list_for_user(db, user=user, status_filter=status_filter)]


@router.get("/templates/all", response_model=list[DocumentResponse])
def list_templates(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[DocumentResponse]:
    return [document_response(doc) for doc in document_service.list_templates(db, user=user)]


@router.post("/templates/{template_id}/use", response_model=DocumentResponse)
def use_template(template_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    new_doc = document_service.use_template(db, template_id=template_id, user=user)
    return document_response(new_doc)


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    return document_response(document_service.get_for_user(db, document_id=document_id, user=user))


@router.patch("/{document_id}", response_model=DocumentResponse)
def update_document(
    document_id: str,
    payload: DocumentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.update(db, document=document, user=user, payload=payload))


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    document_service.delete(db, document=document)


@router.post("/{document_id}/upload-pdf", response_model=UploadPdfResponse)
async def upload_pdf(
    document_id: str,
    upload: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UploadPdfResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    uploaded = await document_service.upload_pdf(db, document=document, user=user, upload=upload)
    return UploadPdfResponse(document=document_response(uploaded), sha256=uploaded.original_sha256 or "", page_count=uploaded.page_count)


@router.get("/{document_id}/pdf")
def original_pdf(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> FileResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    if not document.original_file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Original PDF not found")
    return FileResponse(storage.path(document.original_file_path), media_type="application/pdf", filename=f"{document.title}.pdf")


@router.get("/{document_id}/final-pdf")
def final_pdf(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> FileResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    if document.status != DocumentStatus.completed or not document.final_file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Final PDF is not available")
    return FileResponse(storage.path(document.final_file_path), media_type="application/pdf", filename=f"{document.title}-signed.pdf")


@router.post("/{document_id}/send", response_model=SendDocumentResponse)
def send_document(
    document_id: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SendDocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_service.send(
        db,
        document=document,
        user=user,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )


@router.post("/{document_id}/void", response_model=DocumentResponse)
def void_document(
    document_id: str,
    reason: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.void(db, document=document, user=user, reason=reason))


@router.post("/{document_id}/remind")
def remind_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> dict[str, list[dict[str, str]]]:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    if document.status not in {DocumentStatus.sent, DocumentStatus.viewed, DocumentStatus.partially_completed}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only active documents can receive reminders")
    links: list[dict[str, str]] = []
    for recipient in document.recipients:
        if recipient.status in {RecipientStatus.sent, RecipientStatus.viewed}:
            raw_token, _ = token_service.create_for_recipient(db, document_id=document.id, recipient_id=recipient.id)
            link = signflow_email_service.send_signing_link(document=document, recipient=recipient, token=raw_token)
            links.append({"recipient_id": recipient.id, "email": recipient.email, "signing_link": link})
            audit_service.log(
                db,
                document_id=document.id,
                recipient_id=recipient.id,
                user_id=user.id,
                event_type="signer_email_sent",
                event_message=f"Reminder signing link sent to {recipient.email}.",
            )
    db.commit()
    return {"signing_links": links}


@router.post("/{document_id}/generate-final-pdf", response_model=DocumentResponse)
def generate_final_pdf(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    pdf_service.generate_final_pdf(db, document=document)
    db.commit()
    db.refresh(document)
    return document_response(document)

