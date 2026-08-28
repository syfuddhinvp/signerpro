import io
import zipfile

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, request_ip, request_user_agent
from app.core.database import get_db
from app.core.storage import storage
from app.models.enums import DocumentStatus, RecipientStatus
from app.models.user import User
from app.schemas.document import (
    BulkActionRequest,
    BulkActionResult,
    BulkDownloadRequest,
    DocumentCounts,
    DocumentCreate,
    DocumentDuplicateRequest,
    DocumentLibraryPage,
    DocumentListItem,
    DocumentMoveRequest,
    DocumentRenameRequest,
    DocumentResponse,
    DocumentUpdate,
    RoutingResponse,
    RoutingUpdate,
    SendDocumentResponse,
    UploadPdfResponse,
)
from app.models.plan import (
    ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH,
    ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT,
    ENTITLEMENT_MAX_STORAGE_BYTES,
)
from app.models.usage_event import UsageEventType
from app.services.audit_service import audit_service
from app.services.entitlement_service import entitlement_service
from app.services.document_service import document_response, document_service
from app.services.email_service import signflow_email_service
from app.services.pdf_service import pdf_service
from app.services.token_service import token_service


router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.post("", response_model=DocumentResponse, status_code=201)
def create_document(payload: DocumentCreate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    # Templates are scaffolding, not billable output; only real documents count.
    if not payload.is_template:
        entitlement_service.check_entitlement(
            db, user.organization_id, ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH, amount=1
        )
    document = document_service.create(db, user=user, payload=payload)
    if not document.is_template:
        entitlement_service.record_usage(
            db,
            organization_id=user.organization_id,
            event_type=UsageEventType.document_created,
            document_id=document.id,
        )
        db.commit()
    return document_response(document)


@router.get("", response_model=list[DocumentResponse])
def list_documents(
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[DocumentResponse]:
    return [document_response(document) for document in document_service.list_for_user(db, user=user, status_filter=status_filter)]


def _list_item(document, *, owner_names: dict[str, str], favorites: set[str]) -> DocumentListItem:
    base = document_response(document)
    item = DocumentListItem(**base.model_dump())
    item.owner_name = owner_names.get(document.owner_user_id or document.sender_id)
    item.is_favorite = document.id in favorites
    return item


@router.get("/library", response_model=DocumentLibraryPage)
def document_library(
    quick: str = Query(default="all"),
    status_filter: DocumentStatus | None = Query(default=None, alias="status"),
    doc_type: str | None = Query(default=None),
    folder_id: str | None = Query(default=None),
    owner: str | None = Query(default=None),
    since_days: int | None = Query(default=None, ge=1, le=3650),
    q: str | None = Query(default=None, max_length=200),
    sort: str = Query(default="recent", pattern="^(recent|name|status|owner)$"),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentLibraryPage:
    items, total, favorites = document_service.library(
        db,
        user=user,
        quick=quick,
        status_filter=status_filter,
        doc_type=doc_type,
        folder_id=folder_id,
        owner=owner,
        since_days=since_days,
        q=q,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    owner_names = document_service.owner_names(db, items)
    return DocumentLibraryPage(
        items=[_list_item(document, owner_names=owner_names, favorites=favorites) for document in items],
        total=total,
        limit=limit,
        offset=offset,
        counts=document_service.library_counts(db, user=user),
    )


@router.get("/counts", response_model=DocumentCounts)
def document_counts(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentCounts:
    return document_service.library_counts(db, user=user)


@router.post("/bulk", response_model=BulkActionResult)
def bulk_document_action(
    payload: BulkActionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BulkActionResult:
    updated, ids, skipped = document_service.bulk_action(
        db,
        user=user,
        document_ids=payload.document_ids,
        action=payload.action,
        folder_id=payload.folder_id,
    )
    return BulkActionResult(action=payload.action, updated=updated, document_ids=ids, skipped=skipped)


@router.post("/bulk-download")
def bulk_download(
    payload: BulkDownloadRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Zip of the best available PDF per document (final if signed, else original)."""
    buffer = io.BytesIO()
    included = 0
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for document_id in dict.fromkeys(payload.document_ids):
            document = document_service.get_for_user(db, document_id=document_id, user=user)
            path = document.final_file_path or document.original_file_path
            if not path:
                continue
            try:
                content = storage.path(path).read_bytes()
            except OSError:
                continue
            suffix = "-signed" if document.final_file_path else ""
            safe_title = "".join(ch for ch in document.title if ch.isalnum() or ch in " -_").strip() or "document"
            archive.writestr(f"{safe_title}-{document.id[:8]}{suffix}.pdf", content)
            included += 1
    if included == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No downloadable PDFs in the selection")
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="documents.zip"', "X-Document-Count": str(included)},
    )


@router.delete("/trash", response_model=BulkActionResult)
def empty_trash(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> BulkActionResult:
    purged = document_service.empty_trash(db, user=user)
    return BulkActionResult(action="purge", updated=purged, document_ids=[], skipped=[])


@router.get("/templates/all", response_model=list[DocumentResponse])
def list_templates(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[DocumentResponse]:
    return [document_response(doc) for doc in document_service.list_templates(db, user=user)]


@router.post("/templates/{template_id}/use", response_model=DocumentResponse)
def use_template(template_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    entitlement_service.check_entitlement(
        db, user.organization_id, ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH, amount=1
    )
    new_doc = document_service.use_template(db, template_id=template_id, user=user)
    entitlement_service.record_usage(
        db,
        organization_id=user.organization_id,
        event_type=UsageEventType.document_created,
        document_id=new_doc.id,
    )
    db.commit()
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
def delete_document(
    document_id: str,
    permanent: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    """Soft delete (trash) by default; `?permanent=true` purges a trashed row."""
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    if permanent:
        document_service.purge(db, document=document)
        return
    document_service.soft_delete(db, document=document, user=user)
@router.post("/{document_id}/duplicate", response_model=DocumentResponse, status_code=201)
def duplicate_document(
    document_id: str,
    payload: DocumentDuplicateRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    if not document.is_template:
        entitlement_service.check_entitlement(db, user.organization_id, ENTITLEMENT_MAX_DOCUMENTS_PER_MONTH, amount=1)
    copy = document_service.duplicate(
        db, document=document, user=user, title=payload.title if payload else None, as_template=document.is_template
    )
    if not copy.is_template:
        entitlement_service.record_usage(
            db,
            organization_id=user.organization_id,
            event_type=UsageEventType.document_created,
            document_id=copy.id,
        )
        db.commit()
    return document_response(copy)


@router.post("/{document_id}/make-template", response_model=DocumentResponse, status_code=201)
def make_template(
    document_id: str,
    payload: DocumentDuplicateRequest | None = Body(default=None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    template = document_service.duplicate(
        db,
        document=document,
        user=user,
        title=(payload.title if payload else None) or f"{document.title} (Template)",
        as_template=True,
    )
    return document_response(template)


@router.post("/{document_id}/rename", response_model=DocumentResponse)
def rename_document(
    document_id: str,
    payload: DocumentRenameRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.rename(db, document=document, user=user, title=payload.title))


@router.post("/{document_id}/archive", response_model=DocumentResponse)
def archive_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.set_archived(db, document=document, user=user, archived=True))


@router.post("/{document_id}/unarchive", response_model=DocumentResponse)
def unarchive_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.set_archived(db, document=document, user=user, archived=False))


@router.post("/{document_id}/trash", response_model=DocumentResponse)
def trash_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.soft_delete(db, document=document, user=user))


@router.post("/{document_id}/restore", response_model=DocumentResponse)
def restore_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.restore(db, document=document, user=user))


@router.post("/{document_id}/move", response_model=DocumentResponse)
def move_document(
    document_id: str,
    payload: DocumentMoveRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> DocumentResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_response(document_service.move(db, document=document, user=user, folder_id=payload.folder_id))


@router.post("/{document_id}/favorite", status_code=204)
def favorite_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    document_service.set_favorite(db, document=document, user=user, favorite=True)


@router.delete("/{document_id}/favorite", status_code=204)
def unfavorite_document(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    document_service.set_favorite(db, document=document, user=user, favorite=False)


@router.get("/{document_id}/routing", response_model=RoutingResponse)
def get_routing(document_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> RoutingResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_service.routing(document)


@router.put("/{document_id}/routing", response_model=RoutingResponse)
def update_routing(
    document_id: str,
    payload: RoutingUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> RoutingResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    return document_service.update_routing(db, document=document, user=user, payload=payload)



@router.post("/{document_id}/upload-pdf", response_model=UploadPdfResponse)
async def upload_pdf(
    document_id: str,
    request: Request,
    upload: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UploadPdfResponse:
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    # Pre-flight against the declared body size so we reject before writing to
    # disk; the exact byte count is metered after the write.
    declared_size = int(request.headers.get("content-length") or 0)
    entitlement_service.check_entitlement(
        db, user.organization_id, ENTITLEMENT_MAX_STORAGE_BYTES, amount=max(declared_size, 1)
    )
    uploaded = await document_service.upload_pdf(db, document=document, user=user, upload=upload)
    if uploaded.original_file_path:
        try:
            stored_bytes = storage.path(uploaded.original_file_path).stat().st_size
        except Exception:  # storage backend may not expose a local path
            stored_bytes = declared_size
        entitlement_service.record_usage(
            db,
            organization_id=user.organization_id,
            event_type=UsageEventType.storage_bytes_added,
            quantity=stored_bytes,
            document_id=uploaded.id,
            metadata={"path": uploaded.original_file_path},
        )
        db.commit()
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
    entitlement_service.check_entitlement(
        db,
        user.organization_id,
        ENTITLEMENT_MAX_RECIPIENTS_PER_DOCUMENT,
        amount=len(document.recipients or []) or 1,
    )
    result = document_service.send(
        db,
        document=document,
        user=user,
        ip_address=request_ip(request),
        user_agent=request_user_agent(request),
    )
    entitlement_service.record_usage(
        db,
        organization_id=user.organization_id,
        event_type=UsageEventType.document_sent,
        document_id=document.id,
        metadata={"recipients": len(document.recipients or [])},
    )
    db.commit()
    return result


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
    entitlement_service.ensure_active(db, user.organization_id)
    document = document_service.get_for_user(db, document_id=document_id, user=user)
    if document.status not in {DocumentStatus.sent, DocumentStatus.viewed, DocumentStatus.partially_completed}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only active documents can receive reminders")
    links: list[dict[str, str]] = []
    for recipient in document.recipients:
        if recipient.status in {RecipientStatus.sent, RecipientStatus.viewed}:
            raw_token, _ = token_service.create_for_recipient(
                db,
                document_id=document.id,
                recipient_id=recipient.id,
                expires_at=document.expires_at,
            )
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

