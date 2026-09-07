"""Cross-cutting account preferences: saved signatures, notification
preferences, integrations, cloud targets and the account audit feed
(SIGN-3, PREF-1…PREF-4)."""

from __future__ import annotations

from base64 import b64decode
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.storage import StoragePathError, storage
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.integration import CloudTarget, Integration
from app.models.notification import NotificationPreference
from app.models.recipient import Recipient
from app.models.saved_signature import SavedSignature
from app.models.user import User
from app.models.enums import FieldType
from app.schemas.account import (
    AccountAuditEntry,
    AccountAuditFeed,
    CloudTargetItem,
    CloudTargetsUpdate,
    FieldFavoritesResponse,
    FieldFavoritesUpdate,
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
    ("google_drive", "Google Drive", "Archive completed PDFs"),
    ("dropbox", "Dropbox", "Archive completed PDFs"),
)

CLOUD_TARGET_PROVIDERS: tuple[str, ...] = ("google_drive", "dropbox")

_SIGNATURE_TYPE_LABELS = {"drawn": "Drawn", "typed": "Typed", "uploaded": "Uploaded"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


#: Where the builder palette's starred field types live on ``users.preferences``.
#: A short per-user list with no query of its own does not earn a table.
FIELD_FAVORITES_KEY = "favorite_field_types"

#: What a fresh account sees under the palette's Favourites tab.
DEFAULT_FIELD_FAVORITES: tuple[str, ...] = ("signature", "date", "full_name", "checkbox")

_FIELD_TYPES = {t.value for t in FieldType}

#: A profile photo is displayed at 56px; 2 MB is generous for one and small
#: enough that a mis-picked original is rejected rather than stored.
_AVATAR_MAX_BYTES = 2 * 1024 * 1024


class AccountService:
    # --- profile photo (PREF-1) ------------------------------------------

    def set_avatar(self, db: Session, *, user: User, image_base64: str) -> User:
        """Store an uploaded profile photo and point the user at it.

        Kept in our own storage and served by `read_avatar_image`, for the
        same reason signature images are: nothing here needs to be reachable
        by anyone holding a URL.
        """
        payload = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
        try:
            image_bytes = b64decode(payload, validate=True)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Profile photo is not valid base64"
            ) from exc
        if len(image_bytes) > _AVATAR_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Profile photo must be 2 MB or smaller",
            )
        if not image_bytes.startswith((b"\x89PNG", b"\xff\xd8")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Profile photo must be a PNG or JPEG image"
            )
        suffix = "png" if image_bytes.startswith(b"\x89PNG") else "jpg"
        previous = user.avatar_path
        # The extension carries the format, so replacing a PNG with a JPEG
        # writes a different key; the old object is removed below.
        user.avatar_path = storage.write_bytes(f"accounts/{user.id}/avatar.{suffix}", image_bytes)
        if previous and previous != user.avatar_path:
            self._discard_avatar_object(previous)
        db.commit()
        db.refresh(user)
        return user

    def clear_avatar(self, db: Session, *, user: User) -> User:
        """Drop the uploaded photo, falling back to initials (or an IdP URL)."""
        if user.avatar_path:
            self._discard_avatar_object(user.avatar_path)
            user.avatar_path = None
            db.commit()
            db.refresh(user)
        return user

    @staticmethod
    def _discard_avatar_object(path: str) -> None:
        try:
            storage.delete(path)
        except Exception:  # storage cleanup must never block the profile write
            pass

    def open_avatar_image(self, *, user: User):
        """Return `(stream, media_type)` for the user's uploaded photo."""
        if not user.avatar_path:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile photo")
        try:
            stream = storage.open_stream(user.avatar_path)
        except (OSError, StoragePathError) as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Profile photo is unavailable"
            ) from exc
        media_type = "image/jpeg" if user.avatar_path.lower().endswith((".jpg", ".jpeg")) else "image/png"
        return stream, media_type

    # --- saved signatures (SIGN-3) ---------------------------------------

    def _to_signature_response(self, row: SavedSignature) -> SavedSignatureResponse:
        # The API's own route, not a presigned object URL: see
        # `read_signature_image`. Relative on purpose — the frontend calls it
        # through the session proxy, which is what carries the credentials.
        preview_url = f"/api/me/signatures/{row.id}/image" if row.image_path else None
        return SavedSignatureResponse(
            id=row.id,
            label=row.label,
            signature_type=row.signature_type,
            signature_text=row.signature_text,
            type_face=row.type_face,
            is_passkey_bound=row.is_passkey_bound,
            is_default=row.is_default,
            adopted_at=row.adopted_at,
            preview_url=preview_url,
            method=_SIGNATURE_TYPE_LABELS.get(row.signature_type, row.signature_type),
            face=row.type_face,
        )

    def list_signatures(self, db: Session, *, user: User) -> list[SavedSignatureResponse]:
        rows = db.scalars(
            select(SavedSignature)
            .where(SavedSignature.user_id == user.id)
            .order_by(SavedSignature.is_default.desc(), SavedSignature.adopted_at.desc())
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
        # The first signature a user adopts is their default: an account with
        # signatures but no default would offer nothing where one is needed.
        existing = self._user_signatures(db, user=user)
        row.is_default = payload.is_default or not existing
        if row.is_default:
            for other in existing:
                other.is_default = False
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

    def _user_signatures(self, db: Session, *, user: User) -> list[SavedSignature]:
        return list(
            db.scalars(
                select(SavedSignature)
                .where(SavedSignature.user_id == user.id)
                .order_by(SavedSignature.adopted_at.desc())
            ).all()
        )

    def open_signature_image(self, db: Session, *, user: User, signature_id: str):
        """Return `(stream, media_type)` for a signature the user owns."""
        row = db.get(SavedSignature, signature_id)
        if not row or row.user_id != user.id or not row.image_path:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved signature has no image")
        try:
            stream = storage.open_stream(row.image_path)
        except (OSError, StoragePathError) as exc:
            # The row outlived its bytes — a storage volume swapped out, an
            # object deleted underneath us. A 404 is the honest answer.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Signature image is unavailable") from exc
        head = row.image_path.lower()
        media_type = "image/jpeg" if head.endswith((".jpg", ".jpeg")) else "image/png"
        return stream, media_type

    def set_default_signature(
        self, db: Session, *, user: User, signature_id: str
    ) -> list[SavedSignatureResponse]:
        """Make one saved signature the default, clearing the previous one.

        Returns the whole list so the caller re-renders from one answer rather
        than patching a row and hoping the rest still agrees.
        """
        rows = self._user_signatures(db, user=user)
        target = next((r for r in rows if r.id == signature_id), None)
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved signature not found")
        for row in rows:
            row.is_default = row.id == target.id
        db.commit()
        return self.list_signatures(db, user=user)

    def delete_signature(self, db: Session, *, user: User, signature_id: str) -> None:
        row = db.get(SavedSignature, signature_id)
        if not row or row.user_id != user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Saved signature not found")
        if row.image_path:
            try:
                storage.delete(row.image_path)
            except Exception:  # storage cleanup must never block the delete
                pass
        was_default = row.is_default
        db.delete(row)
        db.flush()
        # Deleting the default must not leave the account with signatures and
        # no default; the most recently adopted survivor takes over.
        if was_default:
            remaining = self._user_signatures(db, user=user)
            if remaining:
                remaining[0].is_default = True
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

    # --- palette favourites ----------------------------------------------

    def list_field_favorites(self, db: Session, *, user: User) -> FieldFavoritesResponse:
        stored = (user.preferences or {}).get(FIELD_FAVORITES_KEY)
        if not isinstance(stored, list):
            return FieldFavoritesResponse(types=list(DEFAULT_FIELD_FAVORITES))
        # A type withdrawn from the product since the star was set is dropped on
        # read rather than handed to a palette that has no tile for it.
        return FieldFavoritesResponse(types=[t for t in stored if t in _FIELD_TYPES])

    def update_field_favorites(
        self, db: Session, *, user: User, payload: FieldFavoritesUpdate
    ) -> FieldFavoritesResponse:
        unknown = [t for t in payload.types if t not in _FIELD_TYPES]
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown field types: {', '.join(sorted(set(unknown)))}",
            )
        # De-duplicated, submission order kept: the palette lists favourites in
        # the order they were starred.
        types: list[str] = []
        for t in payload.types:
            if t not in types:
                types.append(t)
        # `preferences` is a JSON column, so it has to be reassigned whole for
        # SQLAlchemy to see the change — mutating the dict in place does not
        # mark the attribute dirty.
        preferences = dict(user.preferences or {})
        preferences[FIELD_FAVORITES_KEY] = types
        user.preferences = preferences
        db.commit()
        return FieldFavoritesResponse(types=types)

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
        # Providers outside the catalogue (retired connectors still sitting in
        # an older organization's rows) are not offered and not reported.
        return catalogue

    def connect_integration(
        self, db: Session, *, user: User, provider: str, payload: IntegrationConnectRequest
    ) -> IntegrationResponse:
        catalogue = {p: (label, detail) for p, label, detail in INTEGRATION_CATALOGUE}
        if provider not in catalogue:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Unknown integration provider"
            )
        row = db.scalar(
            select(Integration).where(
                Integration.organization_id == user.organization_id, Integration.provider == provider
            )
        )
        default_label, default_detail = catalogue[provider]
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
        providers = CLOUD_TARGET_PROVIDERS
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
        self,
        db: Session,
        *,
        user: User,
        limit: int = 50,
        offset: int = 0,
        search: str | None = None,
        event_type: str | None = None,
        actor: str | None = None,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        sort_by: str = "time",
        sort_dir: str = "desc",
    ) -> AccountAuditFeed:
        """Audit entries attributable to this user or to their documents.

        Filtering, counting and paging all happen in SQL: the trail grows
        without bound, so a client-side filter over a fetched window would
        silently search only the part it happened to have.

        ``actor`` is resolved by outer-joining users and recipients -- the feed
        spans every document this user sent, so many entries are somebody
        else's action on those documents.
        """
        actor_expr = func.coalesce(User.email, Recipient.email)

        def as_utc(value: datetime | None) -> datetime | None:
            """`<input type="date">` sends no offset; `created_at` is aware, and
            comparing the two raises on Postgres. Read a bare stamp as UTC."""
            if value is None:
                return None
            return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value

        date_from = as_utc(date_from)
        date_to = as_utc(date_to)

        def scoped(stmt):
            # `select_from` is explicit: a select whose only column is the
            # coalesced actor would otherwise take `users` as its FROM and
            # then join it a second time.
            return (
                stmt.select_from(AuditLog)
                .join(Document, Document.id == AuditLog.document_id)
                .outerjoin(User, User.id == AuditLog.user_id)
                .outerjoin(Recipient, Recipient.id == AuditLog.recipient_id)
                .where(Document.organization_id == user.organization_id)
                .where((AuditLog.user_id == user.id) | (Document.sender_id == user.id))
            )

        def filtered(stmt):
            stmt = scoped(stmt)
            if event_type:
                stmt = stmt.where(AuditLog.event_type == event_type)
            if actor:
                stmt = stmt.where(actor_expr == actor)
            if date_from is not None:
                stmt = stmt.where(AuditLog.created_at >= date_from)
            if date_to is not None:
                stmt = stmt.where(AuditLog.created_at <= date_to)
            if search:
                like = f"%{search.strip()}%"
                stmt = stmt.where(
                    or_(
                        AuditLog.event_type.ilike(like),
                        AuditLog.event_message.ilike(like),
                        AuditLog.ip_address.ilike(like),
                        Document.title.ilike(like),
                        actor_expr.ilike(like),
                    )
                )
            return stmt

        total = db.scalar(filtered(select(func.count()))) or 0
        # Ordering belongs in SQL for the same reason filtering does: sorting a
        # fetched page would only reorder that page.
        sort_column = {
            "time": AuditLog.created_at,
            "action": AuditLog.event_type,
            "document": Document.title,
            "actor": actor_expr,
        }.get(sort_by, AuditLog.created_at)
        order = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        rows = db.execute(
            filtered(select(AuditLog, Document.title, actor_expr))
            # `created_at` breaks ties so paging stays stable on non-unique keys.
            .order_by(order, AuditLog.created_at.desc(), AuditLog.id)
            .limit(limit)
            .offset(offset)
        ).all()

        # Facets come from the unfiltered scope so choosing one filter never
        # empties the other dropdown of options the trail still contains.
        event_types = [
            value
            for (value,) in db.execute(
                scoped(select(AuditLog.event_type).distinct()).order_by(AuditLog.event_type)
            ).all()
            if value
        ]
        actors = [
            value
            for (value,) in db.execute(
                scoped(select(actor_expr.label("actor")).distinct()).order_by("actor")
            ).all()
            if value
        ]

        return AccountAuditFeed(
            items=[
                AccountAuditEntry(
                    id=log.id,
                    document_id=log.document_id,
                    document_title=title,
                    event_type=log.event_type,
                    event_message=log.event_message,
                    actor=actor_email,
                    ip_address=log.ip_address,
                    user_agent=log.user_agent,
                    log_metadata=log.log_metadata,
                    created_at=log.created_at,
                )
                for log, title, actor_email in rows
            ],
            total=int(total),
            event_types=event_types,
            actors=actors,
        )


account_service = AccountService()
