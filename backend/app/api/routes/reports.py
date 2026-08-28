from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.storage import storage
from app.models.report import CustomReport, ReportSchedule
from app.models.user import User
from app.schemas.report import (
    CustomReportCreate,
    CustomReportResponse,
    CustomReportRunResponse,
    CustomReportUpdate,
    DocumentReportResponse,
    InviteReportResponse,
    RecipientReportResponse,
    ReportExportRequest,
    ReportExportResponse,
    ReportFieldCatalogueResponse,
    ReportOverviewResponse,
    ReportScheduleCreate,
    ReportScheduleResponse,
    SenderReportRow,
    TemplateReportResponse,
)
from app.services.report_service import CUSTOM_REPORT_FIELDS, RANGE_DAYS, REPORT_KEYS, report_service


router = APIRouter(prefix="/api/reports", tags=["reports"])


def _range(range_key: str | None, start: datetime | None, end: datetime | None):
    return report_service.resolve_range(range_key=range_key, start=start, end=end)


RangeKey = Query(default="30d", alias="range")


@router.get("/fields", response_model=ReportFieldCatalogueResponse)
def report_catalogue(user: User = Depends(get_current_user)) -> ReportFieldCatalogueResponse:
    return ReportFieldCatalogueResponse(
        fields=CUSTOM_REPORT_FIELDS,
        reports=sorted(REPORT_KEYS),
        ranges=sorted(RANGE_DAYS),
    )


@router.get("/overview", response_model=ReportOverviewResponse)
def overview(
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    range_start, range_end, _ = _range(range_key, start, end)
    return report_service.overview(db, organization_id=user.organization_id, start=range_start, end=range_end)


@router.get("/invites", response_model=InviteReportResponse)
def invites(
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    range_start, range_end, _ = _range(range_key, start, end)
    return report_service.invites(db, organization_id=user.organization_id, start=range_start, end=range_end)


@router.get("/documents", response_model=DocumentReportResponse)
def documents_report(
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    range_start, range_end, _ = _range(range_key, start, end)
    return report_service.documents_report(
        db,
        organization_id=user.organization_id,
        start=range_start,
        end=range_end,
        status_filter=status_filter,
        limit=limit,
        offset=offset,
    )


@router.get("/templates", response_model=TemplateReportResponse)
def templates_report(
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    range_start, range_end, _ = _range(range_key, start, end)
    return report_service.templates_report(db, organization_id=user.organization_id, start=range_start, end=range_end)


@router.get("/recipients", response_model=RecipientReportResponse)
def recipients_report(
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    range_start, range_end, _ = _range(range_key, start, end)
    return report_service.recipients_report(db, organization_id=user.organization_id, start=range_start, end=range_end)


@router.get("/senders", response_model=list[SenderReportRow])
def senders_report(
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    range_start, range_end, _ = _range(range_key, start, end)
    return report_service.senders_report(db, organization_id=user.organization_id, start=range_start, end=range_end)


def _export_response(export) -> ReportExportResponse:
    return ReportExportResponse(
        export_id=export.id,
        status=export.status,
        report_key=export.report_key,
        range_key=export.range_key,
        format=export.format,
        download_url=f"/api/reports/exports/{export.id}/download" if export.status == "ready" else None,
        error=export.error,
        created_at=export.created_at,
    )


@router.post("/export", response_model=ReportExportResponse, status_code=202)
def create_export(
    payload: ReportExportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReportExportResponse:
    range_start, range_end, range_key = _range(payload.range, payload.start, payload.end)
    export = report_service.create_export(
        db,
        organization_id=user.organization_id,
        user_id=user.id,
        report_key=payload.report,
        range_key=range_key,
        export_format=payload.format,
        start=range_start,
        end=range_end,
    )
    return _export_response(export)


@router.get("/exports/{export_id}", response_model=ReportExportResponse)
def get_export(export_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> ReportExportResponse:
    return _export_response(report_service.get_export(db, export_id=export_id, organization_id=user.organization_id))


@router.get("/exports/{export_id}/download")
def download_export(export_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> Response:
    export = report_service.get_export(db, export_id=export_id, organization_id=user.organization_id)
    if export.status != "ready" or not export.file_path:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Export is not ready")
    content = storage.read_bytes(export.file_path)
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{export.report_key}-{export.range_key}.csv"'},
    )


@router.get("/{report_key}/csv")
def inline_csv(
    report_key: str,
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """Synchronous CSV of any report, for the grid's Export button."""
    range_start, range_end, resolved = _range(range_key, start, end)
    rows = report_service.rows_for(
        db, report_key=report_key, organization_id=user.organization_id, start=range_start, end=range_end
    )
    return Response(
        content=report_service.to_csv(rows),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{report_key}-{resolved}.csv"'},
    )


# ---- RPT-8: saved custom reports -----------------------------------------


@router.get("/custom", response_model=list[CustomReportResponse])
def list_custom_reports(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[CustomReport]:
    return list(
        db.scalars(
            select(CustomReport)
            .where(CustomReport.organization_id == user.organization_id)
            .order_by(CustomReport.created_at.desc())
        )
    )


@router.post("/custom", response_model=CustomReportResponse, status_code=201)
def create_custom_report(
    payload: CustomReportCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CustomReport:
    report = CustomReport(
        organization_id=user.organization_id,
        created_by_user_id=user.id,
        name=payload.name,
        fields=report_service.validate_fields(payload.fields),
        filters=payload.filters,
        group_by=payload.group_by,
    )
    if report.group_by:
        report_service.validate_fields([report.group_by])
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("/custom/{report_id}", response_model=CustomReportResponse)
def get_custom_report(report_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> CustomReport:
    return report_service.get_custom(db, report_id=report_id, organization_id=user.organization_id)


@router.patch("/custom/{report_id}", response_model=CustomReportResponse)
def update_custom_report(
    report_id: str,
    payload: CustomReportUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CustomReport:
    report = report_service.get_custom(db, report_id=report_id, organization_id=user.organization_id)
    if payload.name is not None:
        report.name = payload.name
    if payload.fields is not None:
        report.fields = report_service.validate_fields(payload.fields)
    if payload.filters is not None:
        report.filters = payload.filters
    if payload.group_by is not None:
        report.group_by = report_service.validate_fields([payload.group_by])[0]
    db.commit()
    db.refresh(report)
    return report


@router.delete("/custom/{report_id}", status_code=204)
def delete_custom_report(report_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    report = report_service.get_custom(db, report_id=report_id, organization_id=user.organization_id)
    db.delete(report)
    db.commit()


@router.post("/custom/{report_id}/run", response_model=CustomReportRunResponse)
def run_custom_report(
    report_id: str,
    range_key: str | None = RangeKey,
    start: datetime | None = None,
    end: datetime | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    report = report_service.get_custom(db, report_id=report_id, organization_id=user.organization_id)
    range_start, range_end, _ = _range(range_key, start, end)
    return report_service.run_custom(db, report=report, start=range_start, end=range_end)


@router.post("/custom/{report_id}/schedule", response_model=ReportScheduleResponse, status_code=201)
def schedule_custom_report(
    report_id: str,
    payload: ReportScheduleCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ReportSchedule:
    report = report_service.get_custom(db, report_id=report_id, organization_id=user.organization_id)
    return report_service.create_schedule(
        db,
        organization_id=user.organization_id,
        custom_report_id=report.id,
        report_key=None,
        cadence=payload.cadence,
        export_format=payload.format,
        recipients=[str(item) for item in payload.recipients],
    )
