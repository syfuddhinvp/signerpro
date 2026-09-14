"""Every outbound message this system produces, as a row (the platform outbox).

Written by ``app.core.email.EmailService.send`` itself rather than by its
callers: a send path that forgets to log is a message that silently never
appears in the outbox, and there is no way to notice that from the outbox.

Bodies are stored **redacted** -- see ``app.core.email.redact_secrets``. A
signing link, an invitation link and a password-reset link are all bearer
credentials, so an outbox that kept them verbatim would be a store of live
credentials that every platform admin could read and use.
"""

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import UUIDPrimaryKeyMixin, now_utc


#: What the message was about. Filter facet in the console, and the reason a
#: body is redacted or not.
CATEGORIES = ["invitation", "auth", "verification", "member_invite", "custom", "system"]

#: ``sent`` -- a provider accepted it (or the console fallback stood in for one
#: in development). ``failed`` -- a provider was configured and refused.
#: ``suppressed`` -- a sandbox organization, which never emits real mail.
STATUSES = ["sent", "failed", "suppressed"]


class EmailLog(Base, UUIDPrimaryKeyMixin):
    __tablename__ = "email_logs"
    __table_args__ = (
        Index("ix_email_logs_created_at", "created_at"),
        Index("ix_email_logs_org_category_status", "organization_id", "category", "status"),
    )

    #: Null for platform-originated mail that belongs to no tenant.
    organization_id: Mapped[str | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now_utc, nullable=False)

    to_email: Mapped[str] = mapped_column(String(320), nullable=False)
    from_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    subject: Mapped[str] = mapped_column(String(512), nullable=False)
    body_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    body_html: Mapped[str | None] = mapped_column(Text, nullable=True)

    category: Mapped[str] = mapped_column(String(20), nullable=False, default="system", server_default="system")
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="sent", server_default="sent")
    #: resend | smtp | console | none -- which path actually carried it.
    provider: Mapped[str] = mapped_column(String(12), nullable=False, default="console", server_default="console")
    #: The provider's own complaint, when ``status`` is ``failed``.
    error: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    document_id: Mapped[str | None] = mapped_column(
        ForeignKey("documents.id", ondelete="SET NULL"), nullable=True
    )
    #: Set only for mail a human composed in the platform console.
    sent_by_user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
