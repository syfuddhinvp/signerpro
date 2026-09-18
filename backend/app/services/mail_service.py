"""The platform mail outbox: reading what was sent, and composing new mail.

The outbox rows themselves are written by ``app.core.email.EmailService``, not
here -- see ``EmailService._record``. This module is the read model over them
plus the one write path a human drives, the platform console's compose form.
"""

from __future__ import annotations

import re
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core import email_layout as layout
from app.core.email import EmailAttachment, EmailMessage, email_service
from app.models.email_log import CATEGORIES, STATUSES, EmailLog
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.user import User
from app.schemas.mail import MailLogPage, MailLogRow, MailSendRequest, MailSendResult


#: How much of a body the list shows beside the subject.
SNIPPET_LENGTH = 140


def _snippet(body_text: str | None) -> str | None:
    """The first line or so of a message, with its whitespace collapsed.

    Computed rather than stored: it is a function of the body, and a stored
    copy would be one more thing to keep in step with a redaction.
    """
    if not body_text:
        return None
    flat = re.sub(r"\s+", " ", body_text).strip()
    if len(flat) <= SNIPPET_LENGTH:
        return flat
    return flat[:SNIPPET_LENGTH].rstrip() + "…"


def _custom_html(body: str) -> str:
    """The composed body in the same shell the product's own mail uses.

    The admin writes plain text and gets a paragraph per blank-line-separated
    block; everything is escaped, so the compose form is not a way to inject
    arbitrary markup into a recipient's mail client.
    """
    return layout.shell(layout.paragraphs(body))


class MailService:
    # -- reading ----------------------------------------------------------

    def rows(self, db: Session, logs: list[EmailLog]) -> list[MailLogRow]:
        """Resolve the two foreign keys a row displays, in one query each."""
        org_ids = {log.organization_id for log in logs if log.organization_id}
        user_ids = {log.sent_by_user_id for log in logs if log.sent_by_user_id}
        org_names = (
            dict(db.execute(select(Organization.id, Organization.name).where(Organization.id.in_(org_ids))).all())
            if org_ids
            else {}
        )
        user_emails = (
            dict(db.execute(select(User.id, User.email).where(User.id.in_(user_ids))).all())
            if user_ids
            else {}
        )
        return [
            MailLogRow(
                id=log.id,
                created_at=log.created_at,
                to_email=log.to_email,
                from_email=log.from_email,
                subject=log.subject,
                category=log.category,
                status=log.status,
                provider=log.provider,
                error=log.error,
                body_text=log.body_text,
                body_html=log.body_html,
                snippet=_snippet(log.body_text),
                document_id=log.document_id,
                organization_id=log.organization_id,
                organization_name=org_names.get(log.organization_id) if log.organization_id else None,
                sent_by_email=user_emails.get(log.sent_by_user_id) if log.sent_by_user_id else None,
            )
            for log in logs
        ]

    def page(
        self,
        db: Session,
        *,
        category: str | None = None,
        status: str | None = None,
        q: str | None = None,
        organization_id: str | None = None,
        since_days: int | None = None,
        limit: int = 100,
        offset: int = 0,
        with_bodies: bool = False,
    ) -> MailLogPage:
        """A filtered window on the outbox, newest first.

        ``with_bodies`` is off for the list: a page of 200 branded invitations
        is a few megabytes of duplicated HTML that the table never renders. The
        preview fetches the one row it opens.
        """
        query = select(EmailLog)
        if category and category != "all":
            query = query.where(EmailLog.category == category)
        if status and status != "all":
            query = query.where(EmailLog.status == status)
        if organization_id:
            query = query.where(EmailLog.organization_id == organization_id)
        if since_days:
            query = query.where(EmailLog.created_at >= now_utc() - timedelta(days=since_days))
        if q:
            term = f"%{q.lower()}%"
            query = query.where(
                or_(
                    func.lower(EmailLog.to_email).like(term),
                    func.lower(EmailLog.subject).like(term),
                )
            )

        total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
        logs = list(db.scalars(query.order_by(EmailLog.created_at.desc()).limit(limit).offset(offset)))
        items = self.rows(db, logs)
        if not with_bodies:
            # The snippet stays: it is a line, not a message, and it is what
            # makes the list readable without opening every row.
            items = [item.model_copy(update={"body_text": None, "body_html": None}) for item in items]
        return MailLogPage(items=items, total=total, categories=CATEGORIES, statuses=STATUSES)

    # -- composing --------------------------------------------------------

    def send_custom(self, db: Session, *, payload: MailSendRequest, actor: User) -> MailSendResult:
        """Send one composed message to each addressee, and return their rows.

        One message per addressee rather than one message with many recipients:
        the outbox is per-recipient, and so is delivery success. A provider that
        refuses one address must not be recorded as having refused the rest.
        """
        organization = db.get(Organization, payload.organization_id) if payload.organization_id else None
        html = _custom_html(payload.body) if payload.send_html else None
        started = now_utc()

        attachments = tuple(
            EmailAttachment(
                filename=attachment.filename,
                content_type=attachment.content_type,
                content=attachment.decoded(),
            )
            for attachment in payload.attachments
        )

        sent = failed = 0
        for index, address in enumerate(payload.to):
            # One message per addressee, but the copies ride only the first of
            # them: a Cc repeated on every message would deliver one copy per
            # addressee to each copied address, which is how a note to twenty
            # people lands in a manager's inbox twenty times.
            copies = index == 0
            delivered = email_service.send(
                EmailMessage(
                    to_email=str(address),
                    subject=payload.subject,
                    body=payload.body,
                    html=html,
                    category="custom",
                    cc=tuple(str(a) for a in payload.cc) if copies else (),
                    bcc=tuple(str(a) for a in payload.bcc) if copies else (),
                    attachments=attachments,
                ),
                organization=organization,
                sent_by_user_id=actor.id,
            )
            if delivered:
                sent += 1
            else:
                failed += 1

        # The gateway wrote the rows on a session of its own, so they are read
        # back rather than held: this is the one place that cares which rows a
        # single request produced.
        logs = list(
            db.scalars(
                select(EmailLog)
                .where(
                    EmailLog.sent_by_user_id == actor.id,
                    EmailLog.created_at >= started,
                )
                .order_by(EmailLog.created_at.desc())
                .limit(len(payload.to))
            )
        )
        return MailSendResult(sent=sent, failed=failed, items=self.rows(db, logs))


mail_service = MailService()
