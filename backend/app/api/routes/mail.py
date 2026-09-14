"""The platform mail outbox (`/api/saas/mail`).

Every message the system sends is recorded by the email gateway itself; this
router is how a platform admin reads that record, previews a message as it was
delivered, and composes one by hand.

Platform-admin only. The outbox spans every tenant and its rows quote message
bodies, so there is no tenant-scoped twin of this router: a tenant reads its own
delivery history through the per-document audit trail instead.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import request_ip, require_platform_admin
from app.core.database import get_db
from app.models.email_log import EmailLog
from app.models.user import User
from app.schemas.mail import MailLogPage, MailLogRow, MailSendRequest, MailSendResult
from app.services import platform_service
from app.services.mail_service import mail_service

platform_router = APIRouter(prefix="/api/saas/mail", tags=["mail"])


@platform_router.get("", response_model=MailLogPage)
def list_mail(
    category: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    q: str | None = Query(default=None),
    organization_id: str | None = Query(default=None),
    since_days: int | None = Query(default=None, ge=1, le=365),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> MailLogPage:
    """The outbox, newest first. Bodies are omitted — see `GET /{mail_id}`."""
    return mail_service.page(
        db,
        category=category,
        status=status_filter,
        q=q,
        organization_id=organization_id,
        since_days=since_days,
        limit=limit,
        offset=offset,
    )


@platform_router.get("/{mail_id}", response_model=MailLogRow)
def mail_detail(
    mail_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> MailLogRow:
    """One message with its stored body, for the preview pane."""
    log = db.get(EmailLog, mail_id)
    if not log:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    return mail_service.rows(db, [log])[0]


@platform_router.post("/send", response_model=MailSendResult, status_code=status.HTTP_201_CREATED)
def send_mail(
    payload: MailSendRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> MailSendResult:
    """Send a composed message to up to fifty addressees.

    A partial failure is a 201 with a non-zero ``failed``, not an error: some of
    the messages really were sent, and reporting the whole call as failed would
    invite an admin to send the successful ones a second time.
    """
    result = mail_service.send_custom(db, payload=payload, actor=admin)
    platform_service.record_platform_audit(
        db,
        action="mail.sent",
        actor=admin,
        organization_id=payload.organization_id,
        detail=f'Sent "{payload.subject}" to {len(payload.to)} recipient(s)',
        ip_address=request_ip(request),
        metadata={"to": [str(address) for address in payload.to], "failed": result.failed},
    )
    db.commit()
    return result
