import csv
import io
from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.contact import Contact, ContactGroup
from app.models.document import Document
from app.models.enums import RecipientStatus
from app.models.recipient import Recipient
from app.models.user import User
from app.schemas.contact import (
    CONTACT_ROLES,
    CONTACT_SOURCES,
    DEFAULT_GROUPS,
    ContactCreate,
    ContactGroupCreate,
    ContactGroupResponse,
    ContactGroupUpdate,
    ContactHistoryEntry,
    ContactImportError,
    ContactImportResponse,
    ContactResponse,
    ContactUpdate,
)


def contact_response(
    contact: Contact,
    *,
    envelope_count: int = 0,
    last_signed_at: datetime | None = None,
    owner: User | None = None,
) -> ContactResponse:
    return ContactResponse(
        id=contact.id,
        organization_id=contact.organization_id,
        name=contact.name,
        email=contact.email,
        company=contact.company,
        title=contact.title,
        phone=contact.phone,
        address=contact.address,
        description=contact.description,
        default_role=contact.default_role,
        group=contact.group_key,
        source=contact.source,
        tags=list(contact.tags or []),
        color=contact.color,
        envelope_count=envelope_count,
        last_signed_at=last_signed_at or contact.last_signed_at,
        external_id=contact.external_id,
        owner_name=owner.name if owner else None,
        owner_email=owner.email if owner else None,
        created_at=contact.created_at,
        updated_at=contact.updated_at,
    )


class ContactService:
    # ---------- helpers ----------

    def get_for_user(self, db: Session, *, contact_id: str, user: User) -> Contact:
        contact = db.get(Contact, contact_id)
        if not contact or contact.organization_id != user.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
        return contact

    def _validate_enums(self, *, default_role: str | None, source: str | None) -> None:
        if default_role is not None and default_role not in CONTACT_ROLES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"default_role must be one of {sorted(CONTACT_ROLES)}",
            )
        if source is not None and source not in CONTACT_SOURCES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"source must be one of {sorted(CONTACT_SOURCES)}",
            )

    def _envelope_stats(self, db: Session, *, organization_id: str, emails: list[str]) -> dict[str, tuple[int, datetime | None]]:
        """Derived envelope_count / last_signed_at keyed by lower-cased email."""
        if not emails:
            return {}
        lowered = [email.lower() for email in emails]
        rows = db.execute(
            select(
                func.lower(Recipient.email),
                func.count(Recipient.id),
                func.max(Recipient.completed_at),
            )
            .join(Document, Document.id == Recipient.document_id)
            .where(
                Document.organization_id == organization_id,
                Document.is_template == False,  # noqa: E712
                func.lower(Recipient.email).in_(lowered),
            )
            .group_by(func.lower(Recipient.email))
        ).all()
        return {row[0]: (row[1], row[2]) for row in rows}

    def _owners(self, db: Session, contacts: list[Contact]) -> dict[str, User]:
        """Creator rows keyed by id — one query for the whole page, not one per row."""
        ids = {c.created_by_user_id for c in contacts if c.created_by_user_id}
        if not ids:
            return {}
        return {user.id: user for user in db.scalars(select(User).where(User.id.in_(ids))).unique()}

    def list_response(self, db: Session, contacts: list[Contact], *, organization_id: str) -> list[ContactResponse]:
        stats = self._envelope_stats(db, organization_id=organization_id, emails=[c.email for c in contacts])
        owners = self._owners(db, contacts)
        result: list[ContactResponse] = []
        for contact in contacts:
            count, last_signed = stats.get(contact.email.lower(), (0, None))
            result.append(
                contact_response(
                    contact,
                    envelope_count=count,
                    last_signed_at=last_signed,
                    owner=owners.get(contact.created_by_user_id or ""),
                )
            )
        return result

    def single_response(self, db: Session, contact: Contact) -> ContactResponse:
        return self.list_response(db, [contact], organization_id=contact.organization_id)[0]

    # ---------- CRUD ----------

    def create(self, db: Session, *, user: User, payload: ContactCreate) -> Contact:
        self._validate_enums(default_role=payload.default_role, source=payload.source)
        email = payload.email.lower()
        existing = db.scalars(
            select(Contact).where(
                Contact.organization_id == user.organization_id,
                func.lower(Contact.email) == email,
            )
        ).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A contact with this email already exists")
        contact = Contact(
            organization_id=user.organization_id,
            name=payload.name,
            email=email,
            company=payload.company,
            title=payload.title,
            phone=payload.phone,
            address=payload.address,
            description=payload.description,
            default_role=payload.default_role,
            group_key=payload.group,
            source=payload.source,
            tags=list(payload.tags),
            color=payload.color,
            external_id=payload.external_id,
            created_by_user_id=user.id,
        )
        db.add(contact)
        db.commit()
        db.refresh(contact)
        return contact

    def list_for_user(
        self,
        db: Session,
        *,
        user: User,
        q: str | None = None,
        group: str | None = None,
        source: str | None = None,
        tag: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[Contact], int, dict[str, int]]:
        base = select(Contact).where(Contact.organization_id == user.organization_id)
        if q:
            pattern = f"%{q.lower()}%"
            base = base.where(
                or_(
                    func.lower(Contact.name).like(pattern),
                    func.lower(Contact.email).like(pattern),
                    func.lower(func.coalesce(Contact.company, "")).like(pattern),
                )
            )
        if group and group != "all":
            base = base.where(Contact.group_key == group)
        if source:
            base = base.where(Contact.source == source)

        rows = list(db.scalars(base.order_by(Contact.name.asc())).unique())
        if tag:
            rows = [row for row in rows if tag in (row.tags or [])]
        total = len(rows)
        items = rows[offset : offset + limit]
        return items, total, self.group_counts(db, user=user)

    def group_counts(self, db: Session, *, user: User) -> dict[str, int]:
        rows = db.execute(
            select(Contact.group_key, func.count(Contact.id))
            .where(Contact.organization_id == user.organization_id)
            .group_by(Contact.group_key)
        ).all()
        counts = {key: 0 for key, _ in DEFAULT_GROUPS}
        # Custom groups defined by the tenant must still appear with a zero count.
        for group_key, _label in self._group_keys(db, user=user):
            counts.setdefault(group_key, 0)
        for group_key, count in rows:
            counts[group_key] = count
        counts["all"] = sum(count for group_key, count in rows)
        return counts

    def _group_keys(self, db: Session, *, user: User) -> list[tuple[str, str]]:
        rows = list(
            db.scalars(
                select(ContactGroup)
                .where(ContactGroup.organization_id == user.organization_id)
                .order_by(ContactGroup.sort_order.asc(), ContactGroup.label.asc())
            ).unique()
        )
        return [(row.key, row.label) for row in rows]

    def update(self, db: Session, *, contact: Contact, payload: ContactUpdate) -> Contact:
        self._validate_enums(default_role=payload.default_role, source=None)
        data = payload.model_dump(exclude_unset=True)
        if "email" in data and data["email"]:
            email = data.pop("email").lower()
            clash = db.scalars(
                select(Contact).where(
                    Contact.organization_id == contact.organization_id,
                    func.lower(Contact.email) == email,
                    Contact.id != contact.id,
                )
            ).first()
            if clash:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A contact with this email already exists")
            contact.email = email
        if "group" in data:
            contact.group_key = data.pop("group")
        if "tags" in data and data["tags"] is not None:
            contact.tags = list(data.pop("tags"))
        for key, value in data.items():
            setattr(contact, key, value)
        db.commit()
        db.refresh(contact)
        return contact

    def delete(self, db: Session, *, contact: Contact) -> None:
        db.delete(contact)
        db.commit()

    # ---------- history ----------

    def history(
        self, db: Session, *, contact: Contact, limit: int = 20, offset: int = 0
    ) -> list[ContactHistoryEntry]:
        rows = db.execute(
            select(Recipient, Document)
            .join(Document, Document.id == Recipient.document_id)
            .where(
                Document.organization_id == contact.organization_id,
                Document.is_template == False,  # noqa: E712
                func.lower(Recipient.email) == contact.email.lower(),
            )
            .order_by(Document.created_at.desc())
        ).all()
        entries: list[ContactHistoryEntry] = []
        for recipient, document in rows:
            if recipient.status == RecipientStatus.completed:
                event, occurred_at = "signed", recipient.completed_at
            elif recipient.viewed_at:
                event, occurred_at = "viewed", recipient.viewed_at
            else:
                event, occurred_at = "sent", document.sent_at or document.created_at
            entries.append(
                ContactHistoryEntry(
                    document_id=document.id,
                    title=document.title,
                    status=document.status.value,
                    event=event,
                    occurred_at=occurred_at,
                )
            )
        return entries[offset : offset + limit]

    # ---------- groups ----------

    def list_groups(self, db: Session, *, user: User) -> list[ContactGroupResponse]:
        self.ensure_default_groups(db, user=user)
        counts = self.group_counts(db, user=user)
        groups = list(
            db.scalars(
                select(ContactGroup)
                .where(ContactGroup.organization_id == user.organization_id)
                .order_by(ContactGroup.sort_order.asc(), ContactGroup.label.asc())
            ).unique()
        )
        return [
            ContactGroupResponse(
                id=group.id,
                key=group.key,
                label=group.label,
                sort_order=group.sort_order,
                contact_count=counts.get(group.key, 0),
            )
            for group in groups
        ]

    def ensure_default_groups(self, db: Session, *, user: User) -> None:
        existing = {group.key for group in db.scalars(
            select(ContactGroup).where(ContactGroup.organization_id == user.organization_id)
        ).unique()}
        created = False
        for index, (key, label) in enumerate(DEFAULT_GROUPS):
            if key not in existing:
                db.add(
                    ContactGroup(
                        organization_id=user.organization_id,
                        key=key,
                        label=label,
                        sort_order=index,
                    )
                )
                created = True
        if created:
            db.commit()

    def create_group(self, db: Session, *, user: User, payload: ContactGroupCreate) -> ContactGroup:
        clash = db.scalars(
            select(ContactGroup).where(
                ContactGroup.organization_id == user.organization_id,
                ContactGroup.key == payload.key,
            )
        ).first()
        if clash:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A group with this key already exists")
        group = ContactGroup(
            organization_id=user.organization_id,
            key=payload.key,
            label=payload.label,
            sort_order=payload.sort_order,
        )
        db.add(group)
        db.commit()
        db.refresh(group)
        return group

    def get_group_for_user(self, db: Session, *, group_id: str, user: User) -> ContactGroup:
        group = db.get(ContactGroup, group_id)
        if not group or group.organization_id != user.organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact group not found")
        return group

    def update_group(self, db: Session, *, group: ContactGroup, payload: ContactGroupUpdate) -> ContactGroup:
        data = payload.model_dump(exclude_unset=True)
        new_key = data.get("key")
        if new_key and new_key != group.key:
            clash = db.scalars(
                select(ContactGroup).where(
                    ContactGroup.organization_id == group.organization_id,
                    ContactGroup.key == new_key,
                    ContactGroup.id != group.id,
                )
            ).first()
            if clash:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A group with this key already exists")
            # Keep members pointing at their group.
            for contact in db.scalars(
                select(Contact).where(
                    Contact.organization_id == group.organization_id,
                    Contact.group_key == group.key,
                )
            ).unique():
                contact.group_key = new_key
        for key, value in data.items():
            if value is not None:
                setattr(group, key, value)
        db.commit()
        db.refresh(group)
        return group

    def delete_group(self, db: Session, *, group: ContactGroup) -> None:
        remaining = db.scalar(
            select(func.count(Contact.id)).where(
                Contact.organization_id == group.organization_id,
                Contact.group_key == group.key,
            )
        )
        if remaining:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Move or delete the contacts in this group before deleting it",
            )
        db.delete(group)
        db.commit()

    # ---------- import ----------

    def import_contacts(
        self, db: Session, *, user: User, payload: list[ContactCreate], dry_run: bool
    ) -> ContactImportResponse:
        created = updated = skipped = 0
        errors: list[ContactImportError] = []
        seen: set[str] = set()
        for index, row in enumerate(payload, start=1):
            email = row.email.lower()
            if email in seen:
                skipped += 1
                errors.append(ContactImportError(row=index, message="Duplicate email inside the payload"))
                continue
            seen.add(email)
            if row.default_role not in CONTACT_ROLES or row.source not in CONTACT_SOURCES:
                skipped += 1
                errors.append(ContactImportError(row=index, message="Invalid default_role or source"))
                continue
            existing = db.scalars(
                select(Contact).where(
                    Contact.organization_id == user.organization_id,
                    func.lower(Contact.email) == email,
                )
            ).first()
            if existing:
                updated += 1
                if not dry_run:
                    existing.name = row.name
                    existing.company = row.company or existing.company
                    existing.title = row.title or existing.title
                    existing.phone = row.phone or existing.phone
                    existing.address = row.address or existing.address
                    existing.description = row.description or existing.description
                    existing.default_role = row.default_role
                    existing.group_key = row.group
                    existing.source = row.source
                    if row.tags:
                        existing.tags = list(row.tags)
                    existing.color = row.color or existing.color
                    existing.external_id = row.external_id or existing.external_id
                continue
            created += 1
            if not dry_run:
                db.add(
                    Contact(
                        organization_id=user.organization_id,
                        name=row.name,
                        email=email,
                        company=row.company,
                        title=row.title,
                        phone=row.phone,
                        address=row.address,
                        description=row.description,
                        default_role=row.default_role,
                        group_key=row.group,
                        source=row.source,
                        tags=list(row.tags),
                        color=row.color,
                        external_id=row.external_id,
                        created_by_user_id=user.id,
                    )
                )
        if dry_run:
            db.rollback()
        else:
            db.commit()
        return ContactImportResponse(created=created, updated=updated, skipped=skipped, errors=errors)

    def parse_csv(self, content: bytes) -> tuple[list[ContactCreate], list[ContactImportError]]:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV must be UTF-8 encoded") from exc
        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames or "email" not in {name.strip().lower() for name in reader.fieldnames}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV requires an 'email' column")
        rows: list[ContactCreate] = []
        errors: list[ContactImportError] = []
        for index, raw in enumerate(reader, start=1):
            record = {(key or "").strip().lower(): (value or "").strip() for key, value in raw.items()}
            tags = [tag.strip() for tag in record.get("tags", "").split(";") if tag.strip()]
            try:
                rows.append(
                    ContactCreate(
                        name=record.get("name") or record.get("email", ""),
                        email=record.get("email", ""),
                        company=record.get("company") or None,
                        title=record.get("title") or None,
                        phone=record.get("phone") or None,
                        address=record.get("address") or None,
                        description=record.get("description") or None,
                        default_role=record.get("default_role") or "sign",
                        group=record.get("group") or "customers",
                        source=record.get("source") or "crm",
                        tags=tags,
                        color=record.get("color") or None,
                        external_id=record.get("external_id") or None,
                    )
                )
            except Exception as exc:  # pydantic validation of the row
                errors.append(ContactImportError(row=index, message=str(exc).split("\n", 1)[0]))
        return rows, errors


contact_service = ContactService()
