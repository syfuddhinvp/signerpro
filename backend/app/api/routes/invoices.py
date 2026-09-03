from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, request_ip, require_org_admin, require_platform_admin
from app.core.database import get_db
from app.models.invoice import Invoice, InvoiceStatus
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.user import User
from app.schemas.operations import (
    InvoiceMarkPaid,
    InvoicePayRequest,
    InvoiceResponse,
    InvoiceVoid,
    PlatformInvoiceResponse,
)
from app.services import platform_service
from app.services.billing_service import billing_service

router = APIRouter(prefix="/api", tags=["invoices"])

#: BIL-12: the UI's four filter chips. ``past_due`` is not a single stored
#: status -- an invoice can be explicitly ``past_due`` or merely ``open`` past
#: its due date -- so the alias is resolved server-side and the client sends
#: one word.
_STATUS_ALIASES = {"past_due", "overdue"}


def _response(invoice: Invoice, organization_name: str | None = None) -> InvoiceResponse:
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
        # A row parked in `past_due` is overdue by definition, even though
        # Invoice.is_overdue only inspects the `open` + due_at case.
        is_overdue=invoice.is_overdue or invoice.status == InvoiceStatus.past_due,
        period_start=invoice.period_start,
        period_end=invoice.period_end,
        issued_at=invoice.issued_at,
        due_at=invoice.due_at,
        paid_at=invoice.paid_at,
        line_items=invoice.line_items,
        hosted_url=invoice.hosted_url,
        provider_payment_intent_id=invoice.provider_payment_intent_id,
        payment_method_label=invoice.payment_method_label,
        period_label=invoice.period_label,
        organization_name=organization_name,
    )


def _platform_response(invoice: Invoice, organization_name: str) -> PlatformInvoiceResponse:
    return PlatformInvoiceResponse(
        **_response(invoice, organization_name).model_dump(exclude={"organization_name"}),
        organization_name=organization_name,
    )


def _apply_status_filter(query, status_filter: str | None):
    if not status_filter:
        return query
    if status_filter in _STATUS_ALIASES:
        return query.where(
            or_(
                Invoice.status == InvoiceStatus.past_due,
                (Invoice.status == InvoiceStatus.open) & (Invoice.due_at < now_utc()),
            )
        )
    return query.where(Invoice.status == status_filter)


def _load(db: Session, invoice_id: str, *, organization_id: str | None) -> Invoice:
    invoice = db.get(Invoice, invoice_id)
    # Same tenant-scoping discipline as documents: a cross-tenant id is a 404,
    # never a 403, so the endpoint does not confirm the row exists.
    if not invoice or (organization_id is not None and invoice.organization_id != organization_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return invoice


def _org_name(db: Session, organization_id: str) -> str:
    org = db.get(Organization, organization_id)
    return org.name if org else "Unknown"


# ---------------------------------------------------------------------------
# Tenant
# ---------------------------------------------------------------------------


@router.get("/invoices", response_model=list[InvoiceResponse])
def list_invoices(
    status_filter: str | None = Query(default=None, alias="status"),
    scope: str = Query(default="organization", pattern="^(organization|all)$"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[InvoiceResponse]:
    """Invoices for the caller's own organization.

    ``scope=all`` widens to every tenant, but only for a platform admin: for
    anyone else it is silently the same as ``organization`` rather than a 403,
    so a shared client can always ask for the widest scope it is allowed.
    """
    platform = scope == "all" and user.is_platform_admin
    query = select(Invoice, Organization.name).join(
        Organization, Organization.id == Invoice.organization_id
    )
    if not platform:
        query = query.where(Invoice.organization_id == user.organization_id)
    query = _apply_status_filter(query, status_filter)
    rows = db.execute(query.order_by(Invoice.issued_at.desc())).all()
    return [_response(invoice, org_name) for invoice, org_name in rows]


@router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
def get_invoice(
    invoice_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> InvoiceResponse:
    invoice = _load(
        db, invoice_id, organization_id=None if user.is_platform_admin else user.organization_id
    )
    return _response(invoice, _org_name(db, invoice.organization_id))


@router.post("/invoices/{invoice_id}/pay", response_model=InvoiceResponse)
def pay_invoice(
    invoice_id: str,
    payload: InvoicePayRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> InvoiceResponse:
    """Pay an outstanding invoice (BIL-10).

    Idempotent: paying an already-paid invoice returns it unchanged. A decline
    is a 402 with the decline code and the next dunning attempt.
    """
    invoice = _load(db, invoice_id, organization_id=user.organization_id)
    invoice = billing_service.collect_invoice(
        db, invoice=invoice, payment_method_id=payload.payment_method_id
    )
    return _response(invoice, _org_name(db, invoice.organization_id))


@router.get("/invoices/{invoice_id}/pdf")
def invoice_pdf(
    invoice_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    invoice = _load(
        db, invoice_id, organization_id=None if user.is_platform_admin else user.organization_id
    )
    return Response(
        content=billing_service.render_invoice_pdf(db, invoice=invoice),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{invoice.number}.pdf"'},
    )


@router.get("/invoices/{invoice_id}/receipt")
def invoice_receipt(
    invoice_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    """A receipt only exists for a settled invoice."""
    invoice = _load(
        db, invoice_id, organization_id=None if user.is_platform_admin else user.organization_id
    )
    if invoice.status != InvoiceStatus.paid:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A receipt is only available once the invoice is paid",
        )
    return Response(
        content=billing_service.render_invoice_pdf(db, invoice=invoice, receipt=True),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{invoice.number}-receipt.pdf"'},
    )


# ---------------------------------------------------------------------------
# Platform
# ---------------------------------------------------------------------------


def _audit(
    db: Session,
    *,
    admin: User,
    request: Request,
    invoice: Invoice,
    action: str,
    detail: str,
    metadata: dict | None = None,
) -> None:
    """Record a platform-operator action on a tenant's invoice.

    Marking an invoice paid, voiding it and re-attempting collection all move
    money (or the record of it) and all used to leave no trace whatsoever.
    ``billing_service`` has already committed by the time these run, so the
    audit row is committed here too rather than left dangling in the session.
    """
    platform_service.record_platform_audit(
        db,
        action=action,
        actor=admin,
        organization_id=invoice.organization_id,
        detail=detail,
        ip_address=request_ip(request),
        metadata={"invoice_id": invoice.id, "number": invoice.number, **(metadata or {})},
    )
    db.commit()


@router.get("/saas/invoices", response_model=list[PlatformInvoiceResponse])
def list_all_invoices(
    status_filter: str | None = Query(default=None, alias="status"),
    organization_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> list[PlatformInvoiceResponse]:
    """Every invoice across every tenant."""
    query = select(Invoice, Organization.name).join(
        Organization, Organization.id == Invoice.organization_id
    )
    if organization_id:
        query = query.where(Invoice.organization_id == organization_id)
    query = _apply_status_filter(query, status_filter)
    rows = db.execute(query.order_by(Invoice.issued_at.desc())).all()
    return [_platform_response(invoice, org_name) for invoice, org_name in rows]


@router.post("/saas/invoices/{invoice_id}/mark-paid", response_model=PlatformInvoiceResponse)
def mark_invoice_paid(
    invoice_id: str,
    payload: InvoiceMarkPaid,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> PlatformInvoiceResponse:
    """Record a payment received outside the provider (wire, cheque, credit)."""
    invoice = _load(db, invoice_id, organization_id=None)
    invoice = billing_service.mark_invoice_paid(
        db, invoice=invoice, amount_cents=payload.amount_cents
    )
    _audit(
        db,
        admin=admin,
        request=request,
        invoice=invoice,
        action="invoice.marked_paid",
        detail=f"Invoice {invoice.number} marked paid outside the provider",
        metadata={"amount_cents": payload.amount_cents},
    )
    return _platform_response(invoice, _org_name(db, invoice.organization_id))


@router.post("/saas/invoices/{invoice_id}/void", response_model=PlatformInvoiceResponse)
def void_invoice(
    invoice_id: str,
    payload: InvoiceVoid,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> PlatformInvoiceResponse:
    """Void an unpaid invoice. Idempotent; a paid invoice is a 409."""
    invoice = _load(db, invoice_id, organization_id=None)
    invoice = billing_service.void_invoice(db, invoice=invoice, reason=payload.reason)
    _audit(
        db,
        admin=admin,
        request=request,
        invoice=invoice,
        action="invoice.voided",
        detail=f"Invoice {invoice.number} voided: {payload.reason}",
        metadata={"reason": payload.reason},
    )
    return _platform_response(invoice, _org_name(db, invoice.organization_id))


@router.post("/saas/invoices/{invoice_id}/retry-payment", response_model=PlatformInvoiceResponse)
def retry_invoice_payment(
    invoice_id: str,
    payload: InvoicePayRequest,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> PlatformInvoiceResponse:
    """Re-attempt collection on a past-due invoice via the payment provider."""
    invoice = _load(db, invoice_id, organization_id=None)
    invoice = billing_service.collect_invoice(
        db, invoice=invoice, payment_method_id=payload.payment_method_id
    )
    _audit(
        db,
        admin=admin,
        request=request,
        invoice=invoice,
        action="invoice.payment_retried",
        detail=f"Collection re-attempted on invoice {invoice.number} -> {invoice.status}",
        metadata={"status": str(invoice.status)},
    )
    return _platform_response(invoice, _org_name(db, invoice.organization_id))
