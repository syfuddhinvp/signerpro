"""Turns audit events into bell-feed rows (ACT-4).

Two things already existed and never met: `audit_service` logged every
envelope event, and `account_service.NOTIFICATION_EVENTS` let a user say which
of those events they wanted to hear about. Nothing joined them, so the
preference screen wrote switches that governed nothing and the `notifications`
table stayed empty. This module is that join, and it is the only writer of the
table.

It hangs off `AuditService.subscribe`, so a notification is raised in the same
transaction as the audit row that justifies it — a feed row can never claim an
event the trail does not also record. Subscribers are contractually forbidden
from raising (the service swallows exceptions), which means a bug here degrades
to "no notification" rather than to a failed signature.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.notification import Notification, NotificationPreference
from app.services.account_service import NOTIFICATION_EVENTS

#: Audit `event_type` → (preference key, tone, title).
#:
#: The keys on the left are the trail's vocabulary; the keys in the middle are
#: the *preference* vocabulary the account screen shows, and the two are not
#: the same words — `recipient_completed` is what the trail calls a signature,
#: `document_signed` is what the user was offered a switch for. Only events
#: that appear here raise a notification; everything else in the trail
#: (`field_completed`, `document_viewed` on every page turn) is trail detail,
#: not something worth a bell.
EVENT_MAP: dict[str, tuple[str, str, str]] = {
    "document_sent": ("document_sent", "info", "Document sent"),
    "document_viewed": ("document_viewed", "info", "Document viewed"),
    "recipient_completed": ("document_signed", "good", "Recipient signed"),
    "recipient_approved": ("document_signed", "good", "Recipient approved"),
    "document_completed": ("document_completed", "good", "Document completed"),
    "document_declined": ("document_declined", "bad", "Document declined"),
    "document_expired": ("document_expiring", "warn", "Document expired"),
    "document_voided": ("document_completed", "warn", "Document voided"),
    "reminder_sent": ("reminder_sent", "info", "Reminder sent"),
}

#: Defaults for a user who has never touched the preference screen, read off
#: the same catalogue that screen renders — so "on by default" is stated once.
_DEFAULTS: dict[str, bool] = {key: default for key, _label, default in NOTIFICATION_EVENTS}


def _wants(db: Session, user_id: str, event_key: str) -> bool:
    """Whether `user_id` has this event switched on.

    Rows are created lazily by the preference screen, so an absent row means
    "never touched it" and falls back to the catalogue default.
    """
    enabled = db.execute(
        select(NotificationPreference.enabled).where(
            NotificationPreference.user_id == user_id,
            NotificationPreference.event_key == event_key,
        )
    ).scalar_one_or_none()
    if enabled is None:
        return _DEFAULTS.get(event_key, False)
    return bool(enabled)


def notify_from_audit(db: Session, entry: AuditLog) -> None:
    """Raise a bell row for `entry`, if anyone asked to hear about it."""
    mapped = EVENT_MAP.get(entry.event_type)
    if mapped is None or entry.document_id is None:
        return
    event_key, tone, title = mapped

    document = db.get(Document, entry.document_id)
    if document is None:
        return

    # The envelope's owner is who the bell is for; `owner_user_id` is nullable
    # (a departed user's documents keep the sender), so the sender is the
    # fallback rather than a second recipient of the same row.
    owner_id = document.owner_user_id or document.sender_id
    if not owner_id:
        return

    # Don't tell someone what they just did themselves. A signature by a
    # *recipient* has no `user_id` and so still notifies; the owner hitting
    # "Send" does not need a bell saying they sent it.
    if entry.user_id and entry.user_id == owner_id:
        return

    if not _wants(db, owner_id, event_key):
        return

    db.add(
        Notification(
            user_id=owner_id,
            organization_id=document.organization_id,
            title=title,
            # The trail's own sentence, so the bell and the audit trail cannot
            # tell different stories about the same event.
            detail=f"{document.title} — {entry.event_message}"[:512],
            tone=tone,
            # `audit` is the envelope's own trail — the screen that
            # explains the event the row is reporting. Seeded rows use the
            # same vocabulary (a shell screen key), so the tray routes
            # both kinds through one rule.
            screen="audit",
            target_id=document.id,
        )
    )


def register(audit_service) -> None:
    """Wire the producer to the audit service. Called once, from `app.main`."""
    audit_service.subscribe(notify_from_audit)
