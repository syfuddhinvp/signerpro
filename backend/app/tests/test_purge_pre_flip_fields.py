"""The C1 purge script must never touch a document that is a record."""

from datetime import datetime, timedelta, timezone

from app.models.document import Document
from app.models.enums import DocumentStatus, FieldType
from app.models.field import Field
from app.models.recipient import Recipient
from scripts.purge_pre_flip_fields import purge


def _db():
    from app.core.database import get_db
    from app.main import app as fastapi_app

    return next(fastapi_app.dependency_overrides[get_db]())


def _org_and_sender(client):
    """Register through the API so the org/user rows are exactly real ones."""
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Purge Co",
            "name": "Purge Owner",
            "email": "purge@example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    from app.models.user import User

    db = _db()
    user = db.query(User).filter(User.email == "purge@example.com").one()
    return db, user.organization_id, user.id


def _document(db, org_id: str, sender_id: str, *, status: DocumentStatus, created_at: datetime) -> Document:
    doc = Document(
        organization_id=org_id,
        sender_id=sender_id,
        title=f"Doc {status.value}",
        status=status,
        created_at=created_at,
    )
    db.add(doc)
    db.flush()
    recipient = Recipient(
        document_id=doc.id, name="Signer", email="signer@example.com", signing_order=1
    )
    db.add(recipient)
    db.flush()
    db.add(
        Field(
            document_id=doc.id,
            recipient_id=recipient.id,
            type=FieldType.signature,
            label="Signature",
            page_number=1,
            x=72,
            y=150,
            width=180,
            height=44,
        )
    )
    db.flush()
    return doc


def test_purge_takes_drafts_and_leaves_every_record_alone(client) -> None:
    db_session, org_id, sender_id = _org_and_sender(client)
    old = datetime(2026, 1, 1, tzinfo=timezone.utc)
    cutoff = datetime(2026, 9, 1, tzinfo=timezone.utc)

    draft = _document(db_session, org_id, sender_id, status=DocumentStatus.draft, created_at=old)
    sent = _document(db_session, org_id, sender_id, status=DocumentStatus.sent, created_at=old)
    completed = _document(db_session, org_id, sender_id, status=DocumentStatus.completed, created_at=old)
    # A draft authored *after* the fix is already correct and must survive.
    recent = _document(
        db_session, org_id, sender_id, status=DocumentStatus.draft, created_at=cutoff + timedelta(days=1)
    )
    db_session.commit()

    documents, fields = purge(db_session, cutoff=cutoff, apply=True)
    assert (documents, fields) == (1, 1)

    remaining = {f.document_id for f in db_session.query(Field).all()}
    assert draft.id not in remaining
    # Executed and in-flight records keep their placements, wrong or not:
    # rewriting them after the fact would change a legally retained record.
    assert {sent.id, completed.id, recent.id} <= remaining


def test_purge_reports_without_apply(client) -> None:
    db_session, org_id, sender_id = _org_and_sender(client)
    _document(
        db_session, org_id, sender_id,
        status=DocumentStatus.draft, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    db_session.commit()

    documents, fields = purge(db_session, cutoff=datetime(2026, 9, 1, tzinfo=timezone.utc), apply=False)
    assert (documents, fields) == (1, 1)
    # Nothing was deleted -- reporting is the default for a reason.
    assert db_session.query(Field).count() == 1
