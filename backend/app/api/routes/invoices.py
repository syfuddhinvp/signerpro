from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.core.database import get_db
from app.models.invoice import Invoice, InvoiceStatus
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.user import User
from app.schemas.operations import InvoiceMarkPaid, InvoiceResponse, PlatformInvoiceResponse

router = APIRouter(prefix="/api", tags=["invoices"])


def _response(invoice: Invoice) -> InvoiceResponse:
    return InvoiceResponse(
        id=invoice.id,
        organization_id=invoice.organization_id,
        number=invoice.number,
        status=invoice.status,
        currency=invoice.currency,
        subtotal_cents=invoice.subtotal_cents,
        tax_cents=invoice.tax_cents,
        total_cents=invoice.total_cents,
        amount_paid_cents=invoice.amount_paid_cents,
        amount_due_cents=invoice.amount_due_cents,
        is_overdue=invoice.is_overdue,
        period_start=invoice.period_start,
        period_end=invoice.period_end,
        issued_at=invoice.issued_at,
        due_at=invoice.due_at,
        paid_at=invoice.paid_at,
        line_items=invoice.line_items,
        hosted_url=invoice.hosted_url,
    )


@router.get("/invoices", response_model=list[InvoiceResponse])
def list_invoices(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[InvoiceResponse]:
    """Invoices for the caller's own organization."""
    query = select(Invoice).where(Invoice.organization_id == user.organization_id)
    if status_filter:
        query = query.where(Invoice.status == status_filter)
    invoices = db.scalars(query.order_by(Invoice.issued_at.desc())).all()
    return [_response(invoice) for invoice in invoices]


@router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvoiceResponse:
    invoice = db.get(Invoice, invoice_id)
    # Same tenant-scoping discipline as documents: a cross-tenant id is a 404,
    # never a 403, so the endpoint does not confirm the row exists.
    if not invoice or invoice.organization_id != user.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return _response(invoice)


@router.get("/saas/invoices", response_model=list[PlatformInvoiceResponse])
def list_all_invoices(
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[PlatformInvoiceResponse]:
    """Every invoice across every tenant."""
    query = select(Invoice, Organization.name).join(Organization, Organization.id == Invoice.organization_id)
    if status_filter:
        query = query.where(Invoice.status == status_filter)
    rows = db.execute(query.order_by(Invoice.issued_at.desc())).all()
    return [
        PlatformInvoiceResponse(**_response(invoice).model_dump(), organization_name=org_name)
        for invoice, org_name in rows
    ]


@router.post("/saas/invoices/{invoice_id}/mark-paid", response_model=PlatformInvoiceResponse)
def mark_invoice_paid(
    invoice_id: str,
    payload: InvoiceMarkPaid,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> PlatformInvoiceResponse:
    """Record a payment received outside the provider (wire, cheque, credit)."""
    invoice = db.get(Invoice, invoice_id)
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    if invoice.status == InvoiceStatus.void:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A void invoice cannot be paid")

    invoice.amount_paid_cents = payload.amount_cents if payload.amount_cents is not None else invoice.total_cents
    if invoice.amount_paid_cents >= invoice.total_cents:
        invoice.status = InvoiceStatus.paid
        invoice.paid_at = now_utc()
    db.add(invoice)
    db.commit()
    db.refresh(invoice)

    org = db.get(Organization, invoice.organization_id)
    return PlatformInvoiceResponse(
        **_response(invoice).model_dump(), organization_name=org.name if org else "Unknown"
    )
