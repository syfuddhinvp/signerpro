"""GDPR Article 17 erasure (W11).

The hard part of erasure in this product is not deleting rows. It is that two
legal obligations point in opposite directions:

* **Article 17** says a data subject can require their personal data to be
  erased.
* **ESIGN/UETA** — and the entire value of this product — says an executed
  contract and the audit trail proving who signed it must remain intact and
  tamper-evident. ``audit_logs`` is a hash chain precisely so that nobody, the
  operator included, can quietly alter it after the fact.

Rewriting audit rows to satisfy the first would break the second, and the
chain would correctly report itself as tampered with. So this service does not
do that, and does not pretend to.

What it does instead
--------------------
* **Erases** personal data everywhere it is operational rather than evidential:
  the user record, saved signatures (a handwriting sample is biometric-adjacent
  and has no evidential role once the document is sealed), contacts, sessions,
  password-reset tokens, and recipient rows on documents that were never sent.
* **Retains**, and says so in the returned report: audit entries, and recipient
  rows on documents that were sent or executed. These are retained under GDPR
  Art. 17(3)(b)/(e) — a legal obligation and the establishment or defence of
  legal claims — which is a recognised limit on the right to erasure, not a
  loophole this codebase invented.

The report is the point. An erasure that silently leaves data behind is worse
than one that refuses, because the subject is told they were forgotten and
were not. Callers should show the report to whoever requested the erasure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from secrets import token_urlsafe

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.contact import Contact
from app.models.document import Document
from app.models.enums import DocumentStatus
from app.models.password_reset import PasswordResetToken
from app.models.recipient import Recipient
from app.models.saved_signature import SavedSignature
from app.models.user import User
from app.models.user_session import UserSession
from app.services.account_service import account_service

#: Documents whose recipient rows are still editable. Anything else is a record
#: of something that actually happened and is retained.
ERASABLE_DOCUMENT_STATUSES = (DocumentStatus.draft,)

REDACTED_NAME = "Erased at the subject's request"


def _tombstone_email(subject_id: str) -> str:
    """A unique, undeliverable address.

    Not simply blanked: ``email`` is ``NOT NULL`` and uniquely indexed, and
    collapsing every erased user onto one value would make the second erasure
    fail on the unique index.
    """
    return f"erased+{subject_id}@invalid.erased"


@dataclass
class ErasureReport:
    """What was erased, and what was kept and why."""

    subject_email: str
    erased: dict[str, int] = field(default_factory=dict)
    retained: dict[str, int] = field(default_factory=dict)
    retention_basis: str = (
        "Audit entries and the recipient records of sent or executed documents are retained "
        "under GDPR Art. 17(3)(b) and (e): a legal obligation, and the establishment or "
        "defence of legal claims. Executed agreements and the trail proving who signed them "
        "cannot be altered without destroying their evidential value."
    )

    def _bump(self, bucket: dict[str, int], key: str, amount: int = 1) -> None:
        if amount:
            bucket[key] = bucket.get(key, 0) + amount


class ErasureService:
    def erase_subject(self, db: Session, *, email: str) -> ErasureReport:
        """Erase the personal data of whoever holds ``email``.

        Keyed on the email rather than a user id because a data subject is very
        often a *signer* who never had an account.
        """
        normalized = email.strip().lower()
        report = ErasureReport(subject_email=normalized)

        user = db.scalar(select(User).where(User.email == normalized))
        if user is not None:
            self._erase_user(db, user, report)

        self._erase_saved_signatures(db, normalized, user, report)
        self._erase_contacts(db, normalized, report)
        self._erase_recipients(db, normalized, report)
        self._count_retained_audit(db, normalized, user, report)

        db.commit()
        return report

    # -- individual surfaces ------------------------------------------------

    def _erase_user(self, db: Session, user: User, report: ErasureReport) -> None:
        user.name = REDACTED_NAME
        user.email = _tombstone_email(user.id)
        user.avatar_url = None
        # A face is personal data: the uploaded photo goes with the record.
        # The object is dropped directly rather than through
        # `AccountService.clear_avatar`, which would commit mid-erasure.
        if user.avatar_path:
            account_service._discard_avatar_object(user.avatar_path)
            user.avatar_path = None
        user.mfa_secret = None
        user.mfa_recovery_codes = None
        user.status = "erased"
        # Not a blank hash: an empty or predictable value could be matched by
        # some future code path. An unknown random one can never be presented.
        user.password_hash = token_urlsafe(48)
        db.add(user)
        report._bump(report.erased, "user")

        sessions = db.scalars(select(UserSession).where(UserSession.user_id == user.id)).all()
        for session_row in sessions:
            db.delete(session_row)
        report._bump(report.erased, "sessions", len(sessions))

        resets = db.scalars(
            select(PasswordResetToken).where(PasswordResetToken.user_id == user.id)
        ).all()
        for reset in resets:
            db.delete(reset)
        report._bump(report.erased, "password_reset_tokens", len(resets))

    def _erase_saved_signatures(
        self, db: Session, email: str, user: User | None, report: ErasureReport
    ) -> None:
        # A stored handwriting sample is personal data with no evidential role
        # of its own -- what matters legally is the signature already stamped
        # into the sealed PDF, which is untouched.
        query = select(SavedSignature).where(SavedSignature.recipient_email == email)
        rows = list(db.scalars(query).all())
        if user is not None:
            rows += [
                row
                for row in db.scalars(
                    select(SavedSignature).where(SavedSignature.user_id == user.id)
                ).all()
                if row not in rows
            ]
        for row in rows:
            db.delete(row)
        report._bump(report.erased, "saved_signatures", len(rows))

    def _erase_contacts(self, db: Session, email: str, report: ErasureReport) -> None:
        rows = db.scalars(select(Contact).where(Contact.email == email)).all()
        for row in rows:
            db.delete(row)
        report._bump(report.erased, "contacts", len(rows))

    def _erase_recipients(self, db: Session, email: str, report: ErasureReport) -> None:
        rows = db.scalars(
            select(Recipient).join(Document, Document.id == Recipient.document_id).where(
                Recipient.email == email
            )
        ).all()
        for row in rows:
            document = db.get(Document, row.document_id)
            if document is not None and document.status in ERASABLE_DOCUMENT_STATUSES:
                row.name = REDACTED_NAME
                row.email = _tombstone_email(row.id)
                row.phone_number = None
                db.add(row)
                report._bump(report.erased, "recipients_on_drafts")
            else:
                # Sent or executed: this is a record of a real transaction.
                report._bump(report.retained, "recipients_on_sent_or_executed_documents")

    def _count_retained_audit(
        self, db: Session, email: str, user: User | None, report: ErasureReport
    ) -> None:
        """Count, never modify. Modifying would break the chain, correctly."""
        total = 0
        if user is not None:
            total += len(list(db.scalars(select(AuditLog).where(AuditLog.user_ref == user.id)).all()))
        report._bump(report.retained, "audit_entries", total)


erasure_service = ErasureService()
