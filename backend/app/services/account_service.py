"""Cross-cutting account preferences: saved signatures, notification
preferences, integrations, cloud targets and the account audit feed
(SIGN-3, PREF-1…PREF-4)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.storage import storage
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.integration import CloudTarget, Integration
from app.models.notification import NotificationPreference
from app.models.saved_signature import SavedSignature
from app.models.user import User
from app.schemas.account import (
    AccountAuditEntry,
    AccountAuditFeed,
    CloudTargetItem,
    CloudTargetsUpdate,
    IntegrationConnectRequest,
    IntegrationResponse,
    NotificationPreferenceResponse,
    NotificationPreferencesUpdate,
    SavedSignatureCreate,
    SavedSignatureResponse,
)

# The catalogue is product copy, not tenant data: rows are created lazily the
# first time a preference is toggled, and defaults come from here.
NOTIFICATION_EVENTS: tuple[tuple[str, str, bool], ...] = (
    ("document_sent", "A document I sent is delivered", True),
    ("document_viewed", "A recipient views my document", True),
    ("document_signed", "A recipient signs my document", True),
    ("document_completed", "A document completes", True),
    ("document_declined", "A recipient declines", True),
    ("document_expiring", "A document is about to expire", True),
    ("reminder_sent", "A reminder is sent on my behalf", False),
    ("weekly_summary", "Weekly activity summary", False),
)

INTEGRATION_CATALOGUE: tuple[tuple[str, str, str], ...] = (
    ("salesforce", "Salesforce", "Sync signed agreements to opportunities"),
    ("hubspot", "HubSpot", "Attach completed documents to deals"),
    ("slack", "Slack", "Post envelope activity to a channel"),
    ("google_drive", "Google Drive", "Archive completed PDFs"),
    ("dropbox", "Dropbox", "Archive completed PDFs"),
    ("box", "Box", "Archive completed PDFs"),
    ("sharepoint", "SharePoint", "Archive completed PDFs"),
    ("zapier", "Zapier", "Trigger automations on envelope events"),
)

CLOUD_TARGET_PROVIDERS: tuple[str, ...] = ("google_drive", "dropbox", "box", "sharepoint")

_SIGNATURE_TYPE_LABELS = {"drawn": "Drawn", "typed": "Typed", "uploaded": "Uploaded"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AccountService:
    # --- saved signatures (SIGN-3) ---------------------------------------

    def _to_signature_response(self, row: SavedSignature) -> SavedSignatureResponse:
        preview_url = storage.url_for(row.image_path) if row.image_path else None
        return SavedSignatureResponse(
            id=row.id,
            label=row.label,
            signature_type=row.signature_type,
            signature_text=row.signature_text,
            type_face=row.type_face,
            is_passkey_bound=row.is_passkey_bound,
            adopted_at=row.adopted_at,
            preview_url=preview_url,
            method=_SIGNATURE_TYPE_LABELS.get(row.signature_type, row.signature_type),
            face=row.type_face,
        )

    def list_signatures(self, db: Session, *, user: User) -> list[SavedSignatureResponse]:
        rows = db.scalars(
            select(SavedSignature)
            .where(SavedSignature.user_id == user.id)
            .order_by(SavedSignature.adopted_at.desc())
        ).all()
        return [self._to_signature_response(row) for row in rows]

    def create_signature(
        self, db: Session, *, user: User, payload: SavedSignatureCreate
    ) -> SavedSignatureResponse:
        image_path = None
        if payload.signature_type in {"drawn", "uploaded"}:
            if not payload.signature_image_base64:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A signature image is required for drawn or uploaded signatures",
                )
        if payload.signature_type == "typed" and not (payload.signature_text or "").strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Typed signature text is required")

        row = SavedSignature(
            user_id=user.id,
            recipient_email=user.email,
            label=(payload.label or payload.signature_text or user.name)[:120],
            signature_type=payload.signature_type,
            signature_text=(payload.signature_text or None),
            type_face=payload.type_face,
            is_passkey_bound=payload.is_passkey_bound,
            adopted_at=_now(),
        )
        db.add(row)
        db.flush()
        if payload.signature_image_base64:
            # Reuses the signer-side validator: base64, size cap, PNG/JPEG magic.
            from app.services.pdf_service import pdf_service

            image_path = pdf_service.save_drawn_signature(
                document_id="account",
                recipient_id=user.id,
                field_id=row.id,
                data_url_or_base64=payload.signature_image_base64,
            )
            row.image_path = image_path
        db.commit()
        db.refresh(row)
        return self._to_signature_response(row)

    def delete_signature(self, db: Session, *, user: User, signature_id: str) -> None:
        row = db.get(SavedSignature, signature_id)
        if not row or row.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved signature not found")
        if row.image_path:
            try:
                storage.delete(row.image_path)
            except Exception:  # storage cleanup must never block the delete
                pass
        db.delete(row)
        db.commit()

    # --- notification preferences (PREF-2) -------------------------------

    def list_notification_preferences(
        self, db: Session, *, user: User
    ) -> list[NotificationPreferenceResponse]:
        rows = {
            row.event_key: row
            for row in db.scalars(
                select(NotificationPreference).where(NotificationPreference.user_id == user.id)
            ).all()
        }
        return [
            NotificationPreferenceResponse(
                event_key=key,
                label=label,
                enabled=rows[key].enabled if key in rows else default,
                extra_recipients=list((rows[key].extra_recipients or []) if key in rows else []),
            )
            for key, label, default in NOTIFICATION_EVENTS
        ]

    def update_notification_preferences(
        self, db: Session, *, user: User, payload: NotificationPreferencesUpdate
    ) -> list[NotificationPreferenceResponse]:
        known = {key for key, _label, _default in NOTIFICATION_EVENTS}
        unknown = set(payload.prefs) - known
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown notification keys: {', '.join(sorted(unknown))}",
            )
        existing = {
            row.event_key: row
            for row in db.scalars(
                select(NotificationPreference).where(NotificationPreference.user_id == user.id)
            ).all()
        }
        extra = [str(address) for address in payload.extra_recipients] if payload.extra_recipients is not None else None
        touched = set(payload.prefs) | (known if extra is not None else set())
        for key in touched:
            row = existing.get(key)
            if row is None:
                default = next(default for k, _l, default in NOTIFICATION_EVENTS if k == key)
                row = NotificationPreference(user_id=user.id, event_key=key, enabled=default)
                db.add(row)
                existing[key] = row
            if key in payload.prefs:
                row.enabled = payload.prefs[key]
            if extra is not None:
                row.extra_recipients = extra
        db.commit()
        return self.list_notification_preferences(db, user=user)

    # --- integrations (PREF-3) -------------------------------------------

    def list_integrations(self, db: Session, *, user: User) -> list[IntegrationResponse]:
        rows = {
            row.provider: row
            for row in db.scalars(
                select(Integration).where(Integration.organization_id == user.organization_id)
            ).all()
        }
        catalogue = [
            IntegrationResponse(
                provider=provider,
                label=rows[provider].label if provider in rows else label,
                detail=rows[provider].detail if provider in rows else detail,
                connected=rows[provider].connected if provider in rows else False,
                connected_at=rows[provider].connected_at if provider in rows else None,
            )
            for provider, label, detail in INTEGRATION_CATALOGUE
        ]
        known = {provider for provider, _l, _d in INTEGRATION_CATALOGUE}
        catalogue.extend(
            IntegrationResponse(
                provider=row.provider,
                label=row.label,
                detail=row.detail,
                connected=row.connected,
                connected_at=row.connected_at,
            )
            for provider, row in sorted(rows.items())
            if provider not in known
        )
        return catalogue

    def connect_integration(
        self, db: Session, *, user: User, provider: str, payload: IntegrationConnectRequest
    ) -> IntegrationResponse:
        catalogue = {p: (label, detail) for p, label, detail in INTEGRATION_CATALOGUE}
        row = db.scalar(
            select(Integration).where(
                Integration.organization_id == user.organization_id, Integration.provider == provider
            )
        )
        default_label, default_detail = catalogue.get(provider, (provider.replace("_", " ").title(), None))
        if row is None:
            row = Integration(
                organization_id=user.organization_id,
                provider=provider,
                label=payload.label or default_label,
            )
            db.add(row)
        row.label = payload.label or row.label or default_label
        row.detail = payload.detail or row.detail or default_detail
        row.connected = True
        row.connected_at = _now()
        if payload.credentials is not None:
            # Stored through EncryptedString; never echoed back in a response.
            import json

            row.credentials = json.dumps(payload.credentials)
        if payload.config is not None:
            row.config = payload.config
        db.commit()
        db.refresh(row)
        return IntegrationResponse(
            provider=row.provider,
            label=row.label,
            detail=row.detail,
            connected=row.connected,
            connected_at=row.connected_at,
        )

    def disconnect_integration(self, db: Session, *, user: User, provider: str) -> None:
        row = db.scalar(
            select(Integration).where(
                Integration.organization_id == user.organization_id, Integration.provider == provider
            )
        )
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found")
        row.connected = False
        row.connected_at = None
        row.credentials = None
        db.commit()

    # --- cloud targets (PREF-4) ------------------------------------------

    def list_cloud_targets(self, db: Session, *, user: User) -> list[CloudTargetItem]:
        rows = {
            row.provider: row
            for row in db.scalars(
                select(CloudTarget).where(CloudTarget.organization_id == user.organization_id)
            ).all()
        }
        providers = list(CLOUD_TARGET_PROVIDERS) + [p for p in sorted(rows) if p not in CLOUD_TARGET_PROVIDERS]
        return [
            CloudTargetItem(
                provider=provider,
                path=rows[provider].path if provider in rows else None,
                enabled=rows[provider].enabled if provider in rows else False,
            )
            for provider in providers
        ]

    def update_cloud_targets(
        self, db: Session, *, user: User, payload: CloudTargetsUpdate
    ) -> list[CloudTargetItem]:
        rows = {
            row.provider: row
            for row in db.scalars(
                select(CloudTarget).where(CloudTarget.organization_id == user.organization_id)
            ).all()
        }
        for target in payload.targets:
            row = rows.get(target.provider)
            if row is None:
                row = CloudTarget(organization_id=user.organization_id, provider=target.provider)
                db.add(row)
                rows[target.provider] = row
            row.path = target.path
            row.enabled = target.enabled
        db.commit()
        return self.list_cloud_targets(db, user=user)

    # --- account audit feed ----------------------------------------------

    def audit_feed(
        self, db: Session, *, user: User, limit: int = 50, offset: int = 0
    ) -> AccountAuditFeed:
        """Audit entries attributable to this user or to their documents."""
        base = (
            select(AuditLog, Document.title)
            .join(Document, Document.id == AuditLog.document_id)
            .where(Document.organization_id == user.organization_id)
            .where((AuditLog.user_id == user.id) | (Document.sender_id == user.id))
        )
        total = db.scalar(
            select(func.count())
            .select_from(AuditLog)
            .join(Document, Document.id == AuditLog.document_id)
            .where(Document.organization_id == user.organization_id)
            .where((AuditLog.user_id == user.id) | (Document.sender_id == user.id))
        ) or 0
        rows = db.execute(
            base.order_by(AuditLog.created_at.desc()).limit(limit).offset(offset)
        ).all()
        return AccountAuditFeed(
            items=[
                AccountAuditEntry(
                    id=log.id,
                    document_id=log.document_id,
                    document_title=title,
                    event_type=log.event_type,
                    event_message=log.event_message,
                    ip_address=log.ip_address,
                    user_agent=log.user_agent,
                    log_metadata=log.log_metadata,
                    created_at=log.created_at,
                )
                for log, title in rows
            ],
            total=int(total),
        )


account_service = AccountService()
