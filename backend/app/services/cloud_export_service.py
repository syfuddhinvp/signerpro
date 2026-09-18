"""Push completed documents to the tenant's cloud storage.

Same delivery contract as ``webhook_service``, for the same reasons. A
``CloudExport`` row is written in the *same transaction* as the completion that
caused it, so the queue survives a restart and can never be lost by a thread
dying mid-upload. The upload itself happens after that transaction commits, off
the request path: a Dropbox outage must never stop a document from completing.

Retries
-------
Transient failures (timeouts, 5xx, rate limits) leave the row ``pending`` with
a ``next_attempt_at`` a backoff away; ``process_due_retries()`` -- a cron
entrypoint, exactly like the webhook one -- sweeps them. After
``MAX_ATTEMPTS`` the row goes ``failed`` and waits for a manual retry.

Auth failures are different in kind: a revoked grant will still be revoked in
six hours. Those fail the row permanently on the first attempt and latch the
integration ``needs_reauth``, so the tenant is asked to reconnect instead of
the platform hammering a dead grant.
"""

from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import event as sa_event, select
from sqlalchemy.orm import Session

from app.core.storage import storage
from app.models.document import Document
from app.models.integration import CloudExport, CloudTarget
from app.models.mixins import uuid_str
from app.schemas.account import CloudExportItem
from app.services.audit_service import audit_service
from app.services.cloud_integration_service import cloud_integration_service
from app.services.cloud_providers import get_provider
from app.services.cloud_providers.base import CloudAuthError, CloudProviderError

MAX_ATTEMPTS = 6
BACKOFF_BASE_SECONDS = 60
BACKOFF_CAP_SECONDS = 6 * 60 * 60
#: Longer than one upload attempt, so an in-flight PUT can finish on SIGTERM.
DRAIN_TIMEOUT_SECONDS = 35.0

STATUS_PENDING = "pending"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"

_UNSAFE_FILENAME = re.compile(r"[^A-Za-z0-9 ._-]+")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def export_filename(document: Document) -> str:
    """A filename a human recognises, safe on both providers' path rules."""
    title = _UNSAFE_FILENAME.sub(" ", (document.title or "").strip()).strip()
    title = re.sub(r"\s+", " ", title)[:120].strip()
    return f"{title or 'document'}.pdf"


class CloudExportService:
    #: When True, uploads run inline after commit instead of on a thread.
    synchronous: bool = False

    def __init__(self) -> None:
        self._threads: set[threading.Thread] = set()
        self._threads_lock = threading.Lock()
        self._accepting = True

    # ------------------------------------------------------------------ #
    # Enqueue
    # ------------------------------------------------------------------ #
    def enqueue_for_document(
        self, db: Session, *, document: Document, dispatch: bool = True
    ) -> list[CloudExport]:
        """Queue one export per enabled, connected destination.

        Called from the completion path. Never raises: a broken integration
        must not be able to fail the sealing of a contract.
        """
        try:
            targets = list(
                db.execute(
                    select(CloudTarget).where(
                        CloudTarget.organization_id == document.organization_id,
                        CloudTarget.enabled.is_(True),
                    )
                ).scalars()
            )
        except Exception:  # pragma: no cover - defensive
            return []

        queued: list[CloudExport] = []
        for target in targets:
            if get_provider(target.provider) is None or not (target.path or "").strip():
                continue
            if not cloud_integration_service.is_connected(
                db, organization_id=document.organization_id, provider=target.provider
            ):
                continue
            if self._existing(db, document_id=document.id, provider=target.provider) is not None:
                # Exactly-once. Completion is reachable by more than one route.
                continue
            row = CloudExport(
                id=uuid_str(),
                organization_id=document.organization_id,
                document_id=document.id,
                provider=target.provider,
                remote_path=target.path.strip(),
                status=STATUS_PENDING,
                attempts=0,
                next_attempt_at=_now(),
            )
            db.add(row)
            queued.append(row)
            audit_service.log(
                db,
                document_id=document.id,
                event_type="cloud_export_queued",
                event_message=f"Queued export of the signed PDF to {target.provider}.",
                metadata={"provider": target.provider, "remote_path": row.remote_path},
            )

        if queued and dispatch:
            self._dispatch_after_commit(db, queued)
        return queued

    def _existing(self, db: Session, *, document_id: str, provider: str) -> CloudExport | None:
        return db.scalar(
            select(CloudExport).where(
                CloudExport.document_id == document_id, CloudExport.provider == provider
            )
        )

    # ------------------------------------------------------------------ #
    # Dispatch scheduling
    # ------------------------------------------------------------------ #
    def _dispatch_after_commit(self, db: Session, exports: list[CloudExport]) -> None:
        pending: list[str] = db.info.setdefault("_cloud_export_pending", [])
        pending.extend(export.id for export in exports)

        if db.info.get("_cloud_export_listener"):
            return
        db.info["_cloud_export_listener"] = True
        bind = db.get_bind()

        def _after_commit(session: Session) -> None:
            ids = list(session.info.get("_cloud_export_pending") or [])
            session.info["_cloud_export_pending"] = []
            if not ids:
                return
            if self.synchronous:
                self.export_ids(bind, ids)
            else:
                self._spawn(bind, ids)

        def _after_rollback(session: Session) -> None:
            session.info["_cloud_export_pending"] = []

        sa_event.listen(db, "after_commit", _after_commit)
        sa_event.listen(db, "after_rollback", _after_rollback)

    def _spawn(self, bind: Any, export_ids: list[str]) -> None:
        thread = threading.Thread(
            target=self._export_tracked,
            args=(bind, export_ids),
            name="cloud-export",
            daemon=True,
        )
        with self._threads_lock:
            if not self._accepting:
                # Shutting down: run inline instead. Worst case the process
                # dies before the commit and the row stays `pending` for the
                # retry sweep.
                self.export_ids(bind, export_ids)
                return
            self._threads.add(thread)
        thread.start()

    def _export_tracked(self, bind: Any, export_ids: list[str]) -> None:
        try:
            self.export_ids(bind, export_ids)
        finally:
            with self._threads_lock:
                self._threads.discard(threading.current_thread())

    def drain(self, timeout: float = DRAIN_TIMEOUT_SECONDS) -> int:
        """Stop dispatching and wait for in-flight uploads. Called on shutdown."""
        with self._threads_lock:
            self._accepting = False
            in_flight = list(self._threads)

        deadline = time.monotonic() + timeout
        for thread in in_flight:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            thread.join(remaining)
        return sum(1 for thread in in_flight if thread.is_alive())

    def resume(self) -> None:
        """Re-open dispatch after a ``drain()`` (tests, and a re-entered lifespan)."""
        with self._threads_lock:
            self._accepting = True

    def export_ids(self, bind: Any, export_ids: list[str]) -> None:
        """Open an independent session and attempt the given exports."""
        try:
            with Session(bind=bind, expire_on_commit=False) as session:
                for export_id in export_ids:
                    export = session.get(CloudExport, export_id)
                    if export is None:
                        continue
                    self.attempt_export(session, export)
                    session.commit()
        except Exception:  # pragma: no cover - never propagate into the caller
            pass

    # ------------------------------------------------------------------ #
    # A single attempt
    # ------------------------------------------------------------------ #
    def attempt_export(self, db: Session, export: CloudExport) -> CloudExport:
        if export.status == STATUS_SUCCEEDED:
            return export

        export.attempts += 1
        export.next_attempt_at = None
        provider = get_provider(export.provider)
        document = db.get(Document, export.document_id)

        if provider is None:
            return self._fail_permanently(db, export, f"No adapter for provider {export.provider!r}")
        if document is None or not document.final_file_path:
            return self._fail_permanently(db, export, "The document has no sealed PDF to export")

        integration = cloud_integration_service.get_row(
            db, organization_id=export.organization_id, provider=export.provider
        )
        if integration is None or not integration.connected:
            return self._fail_permanently(db, export, f"{export.provider} is not connected")

        try:
            access_token = cloud_integration_service.access_token_for(db, integration)
            data = storage.read_bytes(document.final_file_path)
            remote_file_id = provider.upload(
                access_token, export.remote_path or "", export_filename(document), data
            )
        except CloudAuthError as exc:
            # The grant is gone. Retrying is pointless and the tenant needs to
            # know, so the integration is latched and the row given up on.
            cloud_integration_service.mark_needs_reauth(db, integration, str(exc))
            return self._fail_permanently(db, export, str(exc), reauth=True)
        except CloudProviderError as exc:
            return self._retry_later(db, export, str(exc))
        except Exception as exc:  # storage read, unexpected adapter bug
            return self._retry_later(db, export, f"{type(exc).__name__}: {exc}")

        export.status = STATUS_SUCCEEDED
        export.remote_file_id = remote_file_id or None
        export.last_error = None
        export.completed_at = _now()
        self._audit(
            db,
            export,
            "cloud_export_succeeded",
            f"Signed PDF exported to {export.provider} ({export.remote_path}).",
        )
        return export

    def _retry_later(self, db: Session, export: CloudExport, message: str) -> CloudExport:
        export.last_error = message[:1000]
        if export.attempts >= MAX_ATTEMPTS:
            export.status = STATUS_FAILED
            self._audit(
                db,
                export,
                "cloud_export_failed",
                f"Export to {export.provider} gave up after {export.attempts} attempts: {export.last_error}",
            )
            return export
        export.status = STATUS_PENDING
        export.next_attempt_at = _now() + timedelta(seconds=self.backoff_seconds(export.attempts))
        self._audit(
            db,
            export,
            "cloud_export_retry_scheduled",
            f"Export to {export.provider} failed (attempt {export.attempts}): {export.last_error}",
        )
        return export

    def _fail_permanently(
        self, db: Session, export: CloudExport, message: str, *, reauth: bool = False
    ) -> CloudExport:
        export.status = STATUS_FAILED
        export.last_error = message[:1000]
        export.next_attempt_at = None
        self._audit(
            db,
            export,
            "cloud_export_failed",
            f"Export to {export.provider} failed permanently: {export.last_error}",
            extra={"needs_reauth": reauth},
        )
        return export

    def backoff_seconds(self, attempt: int) -> int:
        return min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_CAP_SECONDS)

    def _audit(
        self,
        db: Session,
        export: CloudExport,
        event_type: str,
        message: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        try:
            audit_service.log(
                db,
                document_id=export.document_id,
                event_type=event_type,
                event_message=message,
                metadata={
                    "export_id": export.id,
                    "provider": export.provider,
                    "attempt": export.attempts,
                    "remote_path": export.remote_path,
                    "remote_file_id": export.remote_file_id,
                    **(extra or {}),
                },
            )
        except Exception:  # pragma: no cover
            pass

    # ------------------------------------------------------------------ #
    # Retry driver (cron / scheduler entrypoint)
    # ------------------------------------------------------------------ #
    def process_due_retries(
        self, db: Session, *, limit: int = 100, now: datetime | None = None
    ) -> int:
        moment = now or _now()
        candidates = list(
            db.execute(
                select(CloudExport)
                .where(CloudExport.status == STATUS_PENDING)
                # Soonest-due first: the column is naive on SQLite and aware on
                # Postgres, so due-ness is filtered in Python below and the
                # limit must not be spent on far-future rows.
                .order_by(CloudExport.next_attempt_at.nullsfirst(), CloudExport.created_at)
                .limit(limit)
            ).scalars()
        )
        processed = 0
        for export in candidates:
            due = _aware(export.next_attempt_at)
            if due is not None and due > moment:
                continue
            self.attempt_export(db, export)
            processed += 1
        if processed:
            db.commit()
        return processed

    def retry(self, db: Session, export: CloudExport) -> CloudExport:
        """Manual retry: reset the attempt counter and try again immediately."""
        export.attempts = 0
        export.status = STATUS_PENDING
        export.last_error = None
        export.next_attempt_at = None
        self.attempt_export(db, export)
        db.commit()
        return export

    # ------------------------------------------------------------------ #
    # Read surface (account screen)
    # ------------------------------------------------------------------ #
    def list_exports(self, db: Session, *, organization_id: str, limit: int = 50) -> list[CloudExportItem]:
        rows = list(
            db.execute(
                select(CloudExport, Document.title)
                .join(Document, Document.id == CloudExport.document_id, isouter=True)
                .where(CloudExport.organization_id == organization_id)
                .order_by(CloudExport.created_at.desc())
                .limit(limit)
            )
        )
        return [self.serialize(export, title) for export, title in rows]

    def serialize(self, export: CloudExport, document_title: str | None = None) -> CloudExportItem:
        return CloudExportItem(
            id=export.id,
            provider=export.provider,
            document_id=export.document_id,
            document_title=document_title,
            status=export.status,
            attempts=export.attempts,
            remote_path=export.remote_path,
            remote_file_id=export.remote_file_id,
            last_error=export.last_error,
            created_at=export.created_at,
            completed_at=export.completed_at,
        )

    def retry_export(self, db: Session, *, organization_id: str, export_id: str) -> CloudExportItem:
        export = db.get(CloudExport, export_id)
        # Scoped, not merely fetched: another tenant's export id must read as
        # "not found", never as a permission error that confirms it exists.
        if export is None or export.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found")
        if export.status == STATUS_SUCCEEDED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="This export has already succeeded"
            )
        self.retry(db, export)
        document = db.get(Document, export.document_id)
        return self.serialize(export, document.title if document else None)


cloud_export_service = CloudExportService()
