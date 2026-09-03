"""Scheduled expiry of documents and signing tokens.

Nothing else in the system fires the ``expired`` document/recipient statuses or
the ``token_expired`` audit event — expiry was only ever evaluated lazily when
somebody happened to open a link. This service is the scheduled counterpart.

It is deliberately self-contained (models only, no other service modules),
idempotent, and batched.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.enums import DocumentStatus, RecipientStatus
from app.models.recipient import Recipient
from app.models.signing_token import SigningToken

logger = get_logger(__name__)

DOCUMENT_EXPIRED_EVENT = "document_expired"
TOKEN_EXPIRED_EVENT = "token_expired"

#: Statuses that are already final — never re-transitioned.
TERMINAL_DOCUMENT_STATUSES = frozenset(
    {
        DocumentStatus.completed,
        DocumentStatus.declined,
        DocumentStatus.voided,
        DocumentStatus.expired,
    }
)

#: In-flight statuses an expiry sweep may transition.
#:
#: Only envelopes that are actually *out for signature* can expire. A draft or
#: prepared document carrying an ``expires_at`` has never been sent to anybody,
#: so expiring it would strand work the sender has not yet dispatched — it can
#: simply be sent later, at which point ``send()`` recomputes the deadline.
EXPIRABLE_DOCUMENT_STATUSES = (
    DocumentStatus.sent,
    DocumentStatus.viewed,
    DocumentStatus.partially_completed,
)

TERMINAL_RECIPIENT_STATUSES = frozenset(
    # ``notified`` is terminal too: a CC has discharged everything ever asked
    # of them the moment the copy is delivered.
    {
        RecipientStatus.completed,
        RecipientStatus.notified,
        RecipientStatus.declined,
        RecipientStatus.expired,
    }
)


@dataclass
class ExpiryReport:
    documents_expired: int = 0
    recipients_expired: int = 0
    tokens_expired: int = 0

    def as_dict(self) -> dict[str, int]:
        return asdict(self)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


class ExpiryService:
    def _batch_size(self, batch_size: int | None) -> int:
        return batch_size or get_settings().expiry_batch_size

    # -- documents -----------------------------------------------------
    def expire_documents(
        self, db: Session, *, now: datetime | None = None, batch_size: int | None = None
    ) -> ExpiryReport:
        now = now or datetime.now(timezone.utc)
        limit = self._batch_size(batch_size)
        report = ExpiryReport()

        documents = db.scalars(
            select(Document)
            .where(
                Document.expires_at.is_not(None),
                Document.status.in_(EXPIRABLE_DOCUMENT_STATUSES),
            )
            .order_by(Document.expires_at)
            .limit(limit)
        ).all()

        for document in documents:
            expires_at = _aware(document.expires_at)
            if expires_at is None or expires_at > now:
                continue
            # Idempotent: a document already in a terminal status is skipped by
            # the query above, so reaching here means a real transition.
            document.status = DocumentStatus.expired
            report.documents_expired += 1

            recipients = db.scalars(
                select(Recipient).where(Recipient.document_id == document.id)
            ).all()
            for recipient in recipients:
                if recipient.status in TERMINAL_RECIPIENT_STATUSES:
                    continue
                recipient.status = RecipientStatus.expired
                report.recipients_expired += 1

            db.add(
                AuditLog(
                    document_id=document.id,
                    event_type=DOCUMENT_EXPIRED_EVENT,
                    event_message=f"Document expired at {expires_at.isoformat()}",
                    log_metadata={
                        "expires_at": expires_at.isoformat(),
                        "source": "expiry_scheduler",
                    },
                )
            )
            logger.info(
                "expiry.document_expired",
                extra={"document_id": document.id, "organization_id": document.organization_id},
            )

        return report

    # -- signing tokens -------------------------------------------------
    def expire_tokens(
        self, db: Session, *, now: datetime | None = None, batch_size: int | None = None
    ) -> ExpiryReport:
        now = now or datetime.now(timezone.utc)
        limit = self._batch_size(batch_size)
        report = ExpiryReport()

        tokens = db.scalars(
            select(SigningToken)
            .where(
                SigningToken.revoked_at.is_(None),
                SigningToken.used_at.is_(None),
            )
            .order_by(SigningToken.expires_at)
            .limit(limit)
        ).all()

        for token in tokens:
            expires_at = _aware(token.expires_at)
            if expires_at is None or expires_at > now:
                continue
            # Revoking is what makes this idempotent: the next sweep will not
            # select this row again.
            token.revoked_at = now
            report.tokens_expired += 1
            db.add(
                AuditLog(
                    document_id=token.document_id,
                    recipient_id=token.recipient_id,
                    event_type=TOKEN_EXPIRED_EVENT,
                    event_message="Signing token expired",
                    log_metadata={
                        "token_id": token.id,
                        "expires_at": expires_at.isoformat(),
                        "source": "expiry_scheduler",
                    },
                )
            )
            logger.info(
                "expiry.token_expired",
                extra={"document_id": token.document_id, "token_id": token.id},
            )

        return report

    # -- entrypoint ------------------------------------------------------
    def run(
        self,
        db: Session,
        *,
        now: datetime | None = None,
        batch_size: int | None = None,
        commit: bool = True,
    ) -> ExpiryReport:
        now = now or datetime.now(timezone.utc)
        documents = self.expire_documents(db, now=now, batch_size=batch_size)
        tokens = self.expire_tokens(db, now=now, batch_size=batch_size)
        report = ExpiryReport(
            documents_expired=documents.documents_expired,
            recipients_expired=documents.recipients_expired,
            tokens_expired=tokens.tokens_expired,
        )
        if commit:
            db.commit()
        logger.info("expiry.sweep_complete", extra=report.as_dict())
        return report


expiry_service = ExpiryService()
