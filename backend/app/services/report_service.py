"""Reporting aggregates (RPT-1…RPT-8).

Everything is scoped to one organization and to a time range. Ranges are
resolved from a range key (`7d`, `30d`, `90d`, `12m`) or explicit `start`/`end`
timestamps; the range applies to `documents.created_at` and to the audit trail.
"""

import csv
import io
import statistics
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.enums import DocumentStatus, RecipientStatus
from app.models.recipient import Recipient
from app.models.report import CustomReport, ReportExport, ReportSchedule
from app.models.user import User


RANGE_DAYS = {"7d": 7, "30d": 30, "90d": 90, "12m": 365}
REPORT_KEYS = {"documents", "templates", "template_usage", "completed_copies", "recipients", "audit", "senders", "invites"}
CUSTOM_REPORT_FIELDS = [
    "document_title",
    "document_status",
    "sender_name",
    "recipient_email",
    "recipient_status",
    "created_at",
    "completed_at",
    "age_days",
    "turnaround_seconds",
]


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _humanize(seconds: float | None) -> str:
    if seconds is None:
        return "—"
    if seconds < 3600:
        return f"{max(1, int(seconds // 60))}m"
    if seconds < 86400:
        return f"{seconds / 3600:.1f}h"
    return f"{seconds / 86400:.1f}d"


class ReportService:
    # ---- range ------------------------------------------------------------
    def resolve_range(
        self,
        *,
        range_key: str | None = "30d",
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> tuple[datetime, datetime, str]:
        now = datetime.now(timezone.utc)
        if start or end:
            resolved_end = _aware(end) or now
            resolved_start = _aware(start) or (resolved_end - timedelta(days=30))
            if resolved_start > resolved_end:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="start must be before end")
            return resolved_start, resolved_end, "custom"
        key = range_key or "30d"
        if key not in RANGE_DAYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"range must be one of: {', '.join(sorted(RANGE_DAYS))}",
            )
        return now - timedelta(days=RANGE_DAYS[key]), now, key

    # ---- base sets --------------------------------------------------------
    def _documents(
        self,
        db: Session,
        *,
        organization_id: str,
        start: datetime,
        end: datetime,
        templates: bool = False,
    ) -> list[Document]:
        rows = db.scalars(
            select(Document).where(
                Document.organization_id == organization_id,
                Document.deleted_at.is_(None),
                Document.is_template.is_(templates),
            )
        )
        return [item for item in rows if start <= (_aware(item.created_at) or start) <= end]

    def _turnaround_seconds(self, document: Document) -> float | None:
        sent = _aware(document.sent_at) or _aware(document.created_at)
        completed = _aware(document.completed_at)
        if not sent or not completed:
            return None
        return max(0.0, (completed - sent).total_seconds())

    # ---- RPT-1 ------------------------------------------------------------
    def overview(self, db: Session, *, organization_id: str, start: datetime, end: datetime) -> dict[str, Any]:
        documents = self._documents(db, organization_id=organization_id, start=start, end=end)
        templates = self._documents(db, organization_id=organization_id, start=start, end=end, templates=True)
        completed = [item for item in documents if item.status == DocumentStatus.completed]
        turnarounds = [value for value in (self._turnaround_seconds(item) for item in completed) if value is not None]
        recipients = [recipient for document in documents for recipient in document.recipients]
        emails = {recipient.email.lower() for recipient in recipients}
        senders = {document.sender_id for document in documents}
        use_rows = list(
            db.scalars(
                select(Document).where(
                    Document.organization_id == organization_id,
                    Document.source_template_id.is_not(None),
                    Document.deleted_at.is_(None),
                )
            )
        )
        uses = [item for item in use_rows if start <= (_aware(item.created_at) or start) <= end]
        # A "first-time recipient" has no completed document before this range.
        earlier = db.scalars(
            select(Recipient).join(Document, Recipient.document_id == Document.id).where(
                Document.organization_id == organization_id
            )
        )
        prior_emails = {
            item.email.lower()
            for item in earlier
            if (_aware(item.created_at) or start) < start
        }
        completion_rate = round(len(completed) / len(documents) * 100, 1) if documents else 0.0
        median_seconds = int(statistics.median(turnarounds)) if turnarounds else 0
        return {
            "range_start": start,
            "range_end": end,
            "documents_created": len(documents),
            "documents_completed": len(completed),
            "completion_rate_pct": completion_rate,
            "median_completion_seconds": median_seconds,
            "median_completion_label": _humanize(median_seconds or None),
            "templates_created": len(templates),
            "templates_uses": len(uses),
            "sender_count": len(senders),
            "recipient_count": len(emails),
            "first_time_recipients": len(emails - prior_emails),
            "tiles": [
                {"key": "documents_created", "label": "Documents created", "value": len(documents), "meta": "in range"},
                {"key": "completion_rate", "label": "Completion rate", "value": completion_rate, "meta": "%"},
                {"key": "median_completion", "label": "Median completion", "value": median_seconds, "meta": _humanize(median_seconds or None)},
                {"key": "templates_uses", "label": "Template uses", "value": len(uses), "meta": f"{len(templates)} created"},
                {"key": "recipient_count", "label": "Recipients", "value": len(emails), "meta": f"{len(emails - prior_emails)} first-time"},
                {"key": "sender_count", "label": "Senders", "value": len(senders), "meta": "active"},
            ],
        }

    # ---- RPT-2 ------------------------------------------------------------
    def invites(self, db: Session, *, organization_id: str, start: datetime, end: datetime) -> dict[str, Any]:
        documents = self._documents(db, organization_id=organization_id, start=start, end=end)
        recipients = [recipient for document in documents for recipient in document.recipients]
        buckets = {"pending_expired": 0, "completed": 0, "declined": 0, "cancelled": 0}
        for recipient in recipients:
            document_status = next(item.status for item in documents if item.id == recipient.document_id)
            if recipient.status == RecipientStatus.completed:
                buckets["completed"] += 1
            elif recipient.status == RecipientStatus.declined:
                buckets["declined"] += 1
            elif document_status == DocumentStatus.voided:
                buckets["cancelled"] += 1
            else:
                buckets["pending_expired"] += 1
        return {
            "total": len(recipients),
            "split": [{"label": label, "count": count} for label, count in buckets.items()],
        }

    # ---- RPT-3 ------------------------------------------------------------
    def documents_report(
        self,
        db: Session,
        *,
        organization_id: str,
        start: datetime,
        end: datetime,
        status_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        documents = self._documents(db, organization_id=organization_id, start=start, end=end)
        if status_filter:
            documents = [item for item in documents if str(item.status) == status_filter]
        documents.sort(key=lambda item: _aware(item.updated_at) or _aware(item.created_at), reverse=True)
        now = datetime.now(timezone.utc)
        items = []
        for document in documents[offset : offset + limit]:
            total = len(document.recipients)
            signed = sum(1 for item in document.recipients if item.status == RecipientStatus.completed)
            items.append(
                {
                    "document_id": document.id,
                    "title": document.title,
                    "status": str(document.status),
                    "signed": signed,
                    "total": total,
                    "age_days": max(0, (now - (_aware(document.created_at) or now)).days),
                    "sender_name": document.sender.name if document.sender else None,
                    "updated_at": document.updated_at,
                }
            )
        return {"items": items, "total": len(documents)}

    # ---- RPT-4 ------------------------------------------------------------
    def templates_report(self, db: Session, *, organization_id: str, start: datetime, end: datetime) -> dict[str, Any]:
        templates = list(
            db.scalars(
                select(Document).where(
                    Document.organization_id == organization_id,
                    Document.is_template.is_(True),
                    Document.deleted_at.is_(None),
                )
            )
        )
        spawned = list(
            db.scalars(
                select(Document).where(
                    Document.organization_id == organization_id,
                    Document.source_template_id.is_not(None),
                    Document.deleted_at.is_(None),
                )
            )
        )
        in_range = [item for item in spawned if start <= (_aware(item.created_at) or start) <= end]
        items = []
        for template in templates:
            uses = [item for item in in_range if item.source_template_id == template.id]
            items.append(
                {
                    "template_id": template.id,
                    "title": template.title,
                    "use_count": len(uses),
                    "completed_copies": sum(1 for item in uses if item.status == DocumentStatus.completed),
                    "field_count": len(template.fields),
                    "owner_name": (template.sender.name if template.sender else None),
                    "updated_at": template.updated_at,
                }
            )
        items.sort(key=lambda row: row["use_count"], reverse=True)
        return {"items": items, "total": len(items)}

    # ---- RPT-5 ------------------------------------------------------------
    def recipients_report(self, db: Session, *, organization_id: str, start: datetime, end: datetime) -> dict[str, Any]:
        documents = self._documents(db, organization_id=organization_id, start=start, end=end)
        by_email: dict[str, dict[str, Any]] = {}
        for document in documents:
            for recipient in document.recipients:
                email = recipient.email.lower()
                row = by_email.setdefault(
                    email,
                    {
                        "email": email,
                        "sent": 0,
                        "delivered": 0,
                        "viewed": 0,
                        "completed": 0,
                        "declined": 0,
                        "expired": 0,
                        "_turnarounds": [],
                    },
                )
                if recipient.status != RecipientStatus.waiting:
                    row["sent"] += 1
                    row["delivered"] += 1
                if recipient.viewed_at or recipient.status in {
                    RecipientStatus.viewed,
                    RecipientStatus.completed,
                }:
                    row["viewed"] += 1
                if recipient.status == RecipientStatus.completed:
                    row["completed"] += 1
                    sent_at = _aware(document.sent_at) or _aware(document.created_at)
                    completed_at = _aware(recipient.completed_at)
                    if sent_at and completed_at:
                        row["_turnarounds"].append(max(0.0, (completed_at - sent_at).total_seconds()))
                elif recipient.status == RecipientStatus.declined:
                    row["declined"] += 1
                elif recipient.status == RecipientStatus.expired:
                    row["expired"] += 1
        items = []
        for row in by_email.values():
            turnarounds = row.pop("_turnarounds")
            median = statistics.median(turnarounds) if turnarounds else None
            row["median_completion_seconds"] = int(median) if median is not None else None
            row["median_completion_label"] = _humanize(median)
            row["completion_rate_pct"] = round(row["completed"] / row["sent"] * 100, 1) if row["sent"] else 0.0
            items.append(row)
        items.sort(key=lambda entry: entry["sent"], reverse=True)
        return {"items": items, "total": len(items)}

    # ---- RPT-7 ------------------------------------------------------------
    def senders_report(self, db: Session, *, organization_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        users = list(db.scalars(select(User).where(User.organization_id == organization_id)))
        documents = self._documents(db, organization_id=organization_id, start=start, end=end)
        result = []
        for user in users:
            owned = [item for item in documents if item.sender_id == user.id]
            result.append(
                {
                    "user_id": user.id,
                    "name": user.name,
                    "role_label": str(user.role),
                    "last_active_at": user.last_active_at,
                    "sent_count": sum(1 for item in owned if item.sent_at is not None),
                    "approved_count": sum(1 for item in owned if item.status == DocumentStatus.completed),
                }
            )
        result.sort(key=lambda row: row["sent_count"], reverse=True)
        return result

    # ---- audit rows (for export) -----------------------------------------
    def audit_rows(self, db: Session, *, organization_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        rows = db.scalars(
            select(AuditLog).join(Document, AuditLog.document_id == Document.id).where(
                Document.organization_id == organization_id
            )
        )
        entries = [item for item in rows if start <= (_aware(item.created_at) or start) <= end]
        entries.sort(key=lambda item: item.created_at, reverse=True)
        return [
            {
                "created_at": item.created_at,
                "document_id": item.document_id,
                "event_type": item.event_type,
                "event_message": item.event_message,
                "ip_address": item.ip_address,
                "user_agent": item.user_agent,
            }
            for item in entries
        ]

    # ---- RPT-6 CSV --------------------------------------------------------
    def rows_for(self, db: Session, *, report_key: str, organization_id: str, start: datetime, end: datetime) -> list[dict[str, Any]]:
        if report_key not in REPORT_KEYS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"report must be one of: {', '.join(sorted(REPORT_KEYS))}",
            )
        if report_key == "documents":
            return self.documents_report(db, organization_id=organization_id, start=start, end=end, limit=100000)["items"]
        if report_key in {"templates", "template_usage"}:
            return self.templates_report(db, organization_id=organization_id, start=start, end=end)["items"]
        if report_key == "completed_copies":
            return [
                {"template_id": row["template_id"], "title": row["title"], "completed_copies": row["completed_copies"]}
                for row in self.templates_report(db, organization_id=organization_id, start=start, end=end)["items"]
            ]
        if report_key == "recipients":
            return self.recipients_report(db, organization_id=organization_id, start=start, end=end)["items"]
        if report_key == "senders":
            return self.senders_report(db, organization_id=organization_id, start=start, end=end)
        if report_key == "invites":
            return self.invites(db, organization_id=organization_id, start=start, end=end)["split"]
        return self.audit_rows(db, organization_id=organization_id, start=start, end=end)

    def to_csv(self, rows: Iterable[dict[str, Any]]) -> str:
        rows = list(rows)
        if not rows:
            return ""
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()), extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: ("" if value is None else value) for key, value in row.items()})
        return buffer.getvalue()

    def create_export(
        self,
        db: Session,
        *,
        organization_id: str,
        user_id: str | None,
        report_key: str,
        range_key: str,
        export_format: str,
        start: datetime,
        end: datetime,
    ) -> ReportExport:
        if export_format not in {"csv", "xlsx"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="format must be 'csv' or 'xlsx'")
        export = ReportExport(
            organization_id=organization_id,
            requested_by_user_id=user_id,
            report_key=report_key,
            range_key=range_key,
            format="csv",  # xlsx is accepted but rendered as CSV for now
            status="running",
        )
        db.add(export)
        db.flush()
        try:
            from app.core.storage import storage

            content = self.to_csv(self.rows_for(db, report_key=report_key, organization_id=organization_id, start=start, end=end))
            key = f"reports/{organization_id}/{export.id}.csv"
            storage.write_bytes(key, content.encode("utf-8"))
            export.file_path = key
            export.status = "ready"
        except HTTPException:
            raise
        except Exception as exc:  # pragma: no cover - defensive
            export.status = "failed"
            export.error = str(exc)
        db.commit()
        db.refresh(export)
        return export

    def get_export(self, db: Session, *, export_id: str, organization_id: str) -> ReportExport:
        export = db.get(ReportExport, export_id)
        if not export or export.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export not found")
        return export

    # ---- RPT-8 custom reports --------------------------------------------
    def validate_fields(self, fields: list[str]) -> list[str]:
        unknown = sorted({item for item in fields if item not in CUSTOM_REPORT_FIELDS})
        if unknown:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown report fields: {', '.join(unknown)}")
        return fields

    def get_custom(self, db: Session, *, report_id: str, organization_id: str) -> CustomReport:
        report = db.get(CustomReport, report_id)
        if not report or report.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom report not found")
        return report

    def run_custom(self, db: Session, *, report: CustomReport, start: datetime, end: datetime) -> dict[str, Any]:
        """Flatten documents × recipients, project the saved fields, group them."""
        documents = self._documents(db, organization_id=report.organization_id, start=start, end=end)
        filters = report.filters or {}
        status_filter = filters.get("status")
        now = datetime.now(timezone.utc)
        rows: list[dict[str, Any]] = []
        for document in documents:
            if status_filter and str(document.status) != status_filter:
                continue
            recipients = document.recipients or [None]
            for recipient in recipients:
                turnaround = self._turnaround_seconds(document)
                full = {
                    "document_title": document.title,
                    "document_status": str(document.status),
                    "sender_name": document.sender.name if document.sender else None,
                    "recipient_email": recipient.email if recipient else None,
                    "recipient_status": str(recipient.status) if recipient else None,
                    "created_at": document.created_at,
                    "completed_at": document.completed_at,
                    "age_days": max(0, (now - (_aware(document.created_at) or now)).days),
                    "turnaround_seconds": int(turnaround) if turnaround is not None else None,
                }
                selected = report.fields or CUSTOM_REPORT_FIELDS
                rows.append({key: full[key] for key in selected})
        groups: list[dict[str, Any]] = []
        if report.group_by:
            if report.group_by not in CUSTOM_REPORT_FIELDS:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown group_by field")
            counts: dict[Any, int] = {}
            for row in rows:
                counts[row.get(report.group_by)] = counts.get(row.get(report.group_by), 0) + 1
            groups = [{"key": str(key), "count": count} for key, count in sorted(counts.items(), key=lambda pair: -pair[1])]
        return {
            "report_id": report.id,
            "name": report.name,
            "fields": report.fields or CUSTOM_REPORT_FIELDS,
            "group_by": report.group_by,
            "row_count": len(rows),
            "rows": rows,
            "groups": groups,
        }

    def create_schedule(
        self,
        db: Session,
        *,
        organization_id: str,
        custom_report_id: str | None,
        report_key: str | None,
        cadence: str,
        export_format: str,
        recipients: list[str],
    ) -> ReportSchedule:
        if cadence not in {"daily", "weekly", "monthly"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cadence must be daily, weekly or monthly")
        delta = {"daily": 1, "weekly": 7, "monthly": 30}[cadence]
        schedule = ReportSchedule(
            organization_id=organization_id,
            custom_report_id=custom_report_id,
            report_key=report_key,
            cadence=cadence,
            format=export_format,
            recipients=recipients,
            next_run_at=datetime.now(timezone.utc) + timedelta(days=delta),
        )
        db.add(schedule)
        db.commit()
        db.refresh(schedule)
        return schedule


report_service = ReportService()
