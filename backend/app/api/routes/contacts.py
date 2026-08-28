from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.contact import Contact
from app.models.enums import RecipientStatus
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.contact import (
    ContactAddRecipientsRequest,
    ContactCreate,
    ContactGroupCreate,
    ContactGroupResponse,
    ContactGroupUpdate,
    ContactHistoryEntry,
    ContactImportRequest,
    ContactImportResponse,
    ContactListResponse,
    ContactResponse,
    ContactUpdate,
)
from app.schemas.recipient import RecipientResponse
from app.services.contact_service import contact_service
from app.services.document_service import document_service


router = APIRouter(prefix="/api/contacts", tags=["contacts"])


@router.get("", response_model=ContactListResponse)
def list_contacts(
    q: str | None = Query(default=None),
    group: str | None = Query(default=None),
    source: str | None = Query(default=None),
    tag: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ContactListResponse:
    items, total, counts = contact_service.list_for_user(
        db, user=user, q=q, group=group, source=source, tag=tag, limit=limit, offset=offset
    )
    return ContactListResponse(
        items=contact_service.list_response(db, items, organization_id=user.organization_id),
        total=total,
        counts=counts,
    )


@router.post("", response_model=ContactResponse, status_code=201)
def create_contact(
    payload: ContactCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ContactResponse:
    contact = contact_service.create(db, user=user, payload=payload)
    return contact_service.single_response(db, contact)


# Group routes are declared before /{contact_id} so "groups" is not read as an id.
@router.get("/groups", response_model=list[ContactGroupResponse])
def list_contact_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[ContactGroupResponse]:
    return contact_service.list_groups(db, user=user)


@router.post("/groups", response_model=ContactGroupResponse, status_code=201)
def create_contact_group(
    payload: ContactGroupCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ContactGroupResponse:
    group = contact_service.create_group(db, user=user, payload=payload)
    return ContactGroupResponse(id=group.id, key=group.key, label=group.label, sort_order=group.sort_order, contact_count=0)


@router.patch("/groups/{group_id}", response_model=ContactGroupResponse)
def update_contact_group(
    group_id: str,
    payload: ContactGroupUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ContactGroupResponse:
    group = contact_service.get_group_for_user(db, group_id=group_id, user=user)
    group = contact_service.update_group(db, group=group, payload=payload)
    counts = contact_service.group_counts(db, user=user)
    return ContactGroupResponse(
        id=group.id,
        key=group.key,
        label=group.label,
        sort_order=group.sort_order,
        contact_count=counts.get(group.key, 0),
    )


@router.delete("/groups/{group_id}", status_code=204)
def delete_contact_group(group_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    group = contact_service.get_group_for_user(db, group_id=group_id, user=user)
    contact_service.delete_group(db, group=group)


@router.post("/import", response_model=ContactImportResponse)
def import_contacts(
    payload: ContactImportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ContactImportResponse:
    """Bulk import from a JSON body of ContactCreate rows (CNT-8)."""
    if not payload.contacts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide at least one contact")
    return contact_service.import_contacts(db, user=user, payload=payload.contacts, dry_run=payload.dry_run)


@router.post("/import/csv", response_model=ContactImportResponse)
async def import_contacts_csv(
    upload: UploadFile = File(...),
    dry_run: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ContactImportResponse:
    """Bulk import from a CRM-style CSV export (CNT-8).

    Recognised columns: name, email, company, title, phone, default_role, group,
    source, tags (semicolon separated), color, external_id. Only ``email`` is required.
    """
    filename = upload.filename or "contacts.csv"
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only CSV files are supported")
    rows, errors = contact_service.parse_csv(await upload.read())
    result = contact_service.import_contacts(db, user=user, payload=rows, dry_run=dry_run)
    result.skipped += len(errors)
    result.errors = errors + result.errors
    return result


@router.post("/add-as-recipients", response_model=list[RecipientResponse], status_code=201)
def add_contacts_as_recipients(
    payload: ContactAddRecipientsRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[RecipientResponse]:
    """Use contacts as recipients on a draft document (CNT-8 / RTE-4 companion)."""
    document = document_service.get_for_user(db, document_id=payload.document_id, user=user)
    document_service.ensure_editable(document)
    contacts = list(
        db.scalars(
            select(Contact).where(
                Contact.organization_id == user.organization_id,
                Contact.id.in_(payload.contact_ids),
            )
        ).unique()
    )
    found = {contact.id for contact in contacts}
    missing = [contact_id for contact_id in payload.contact_ids if contact_id not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Contact not found: {missing[0]}")

    existing_emails = {recipient.email.lower() for recipient in document.recipients or []}
    next_order = max((recipient.signing_order for recipient in document.recipients or []), default=0) + 1
    created: list[Recipient] = []
    ordered = sorted(contacts, key=lambda contact: payload.contact_ids.index(contact.id))
    for contact in ordered:
        if contact.email.lower() in existing_emails:
            continue
        recipient = Recipient(
            document_id=document.id,
            name=contact.name,
            email=contact.email,
            role_name=contact.title,
            role=contact.default_role,
            color=contact.color,
            contact_id=contact.id,
            signing_order=next_order,
            status=RecipientStatus.waiting,
        )
        next_order += 1
        existing_emails.add(contact.email.lower())
        db.add(recipient)
        created.append(recipient)
    db.commit()
    for recipient in created:
        db.refresh(recipient)
    return [RecipientResponse.model_validate(recipient) for recipient in created]


@router.get("/{contact_id}", response_model=ContactResponse)
def get_contact(contact_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ContactResponse:
    contact = contact_service.get_for_user(db, contact_id=contact_id, user=user)
    return contact_service.single_response(db, contact)


@router.patch("/{contact_id}", response_model=ContactResponse)
def update_contact(
    contact_id: str,
    payload: ContactUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ContactResponse:
    contact = contact_service.get_for_user(db, contact_id=contact_id, user=user)
    contact = contact_service.update(db, contact=contact, payload=payload)
    return contact_service.single_response(db, contact)


@router.delete("/{contact_id}", status_code=204)
def delete_contact(contact_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    contact = contact_service.get_for_user(db, contact_id=contact_id, user=user)
    contact_service.delete(db, contact=contact)


@router.get("/{contact_id}/history", response_model=list[ContactHistoryEntry])
def contact_history(
    contact_id: str,
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ContactHistoryEntry]:
    contact = contact_service.get_for_user(db, contact_id=contact_id, user=user)
    return contact_service.history(db, contact=contact, limit=limit, offset=offset)
