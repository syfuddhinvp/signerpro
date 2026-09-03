from fastapi import APIRouter, Depends, Header, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.config import get_settings
from app.core.database import get_db
from app.models.user import User
from app.schemas.billing import (
    BillingSettingsResponse,
    BillingSettingsUpdate,
    CancelRequest,
    ChangePlanRequest,
    ChargeResponse,
    CheckoutRequest,
    CheckoutResponse,
    CheckoutStatusResponse,
    PaymentMethodCreate,
    PaymentMethodResponse,
    PlanChangePreview,
    PlanResponse,
    SeatChangeRequest,
    SeatChangeResponse,
    SetupSessionRequest,
    SubscriptionResponse,
    UpcomingInvoiceResponse,
    UsageResponse,
)
from app.services.billing_service import billing_service
from app.services.entitlement_service import entitlement_service


router = APIRouter(prefix="/api/billing", tags=["billing"])


def _subscription_response(db: Session, organization_id: str) -> SubscriptionResponse:
    context = entitlement_service.resolve(db, organization_id)
    subscription = context.subscription
    # BIL-7: seats and the next invoice come from the same derivation the
    # upcoming-invoice preview uses, so the two screens always agree.
    upcoming = billing_service.next_invoice(db, organization_id)
    plan = context.plan
    return SubscriptionResponse(
        seats_licensed=upcoming["seats_licensed"],
        seats_activated=upcoming["seats_activated"],
        seat_price_cents=plan.seat_price_cents if plan else None,
        is_seat_based=bool(plan.is_seat_based) if plan else False,
        cycle=upcoming["cycle"],
        next_invoice_total_cents=upcoming["total_cents"],
        next_invoice_at=upcoming["due_at"],
        id=subscription.id if subscription else None,
        organization_id=organization_id,
        plan_code=context.plan_code,
        plan_name=context.plan_name,
        status=context.subscription_status,
        current_period_start=subscription.current_period_start if subscription else context.period_start,
        current_period_end=subscription.current_period_end if subscription else context.period_end,
        trial_ends_at=subscription.trial_ends_at if subscription else None,
        cancel_at_period_end=bool(subscription.cancel_at_period_end) if subscription else False,
        canceled_at=subscription.canceled_at if subscription else None,
        provider=subscription.provider if subscription else None,
        entitlements=context.entitlements,
    )


@router.get("/plans", response_model=list[PlanResponse])
def list_plans(db: Session = Depends(get_db)) -> list[PlanResponse]:
    """Public plan catalogue."""
    return [PlanResponse.model_validate(plan) for plan in billing_service.list_plans(db)]


@router.get("/subscription", response_model=SubscriptionResponse)
def my_subscription(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> SubscriptionResponse:
    return _subscription_response(db, user.organization_id)


@router.get("/usage", response_model=UsageResponse)
def my_usage(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> UsageResponse:
    return UsageResponse.model_validate(entitlement_service.usage_summary(db, user.organization_id))


@router.post("/checkout", response_model=CheckoutResponse)
def create_checkout(
    payload: CheckoutRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> CheckoutResponse:
    base_url = get_settings().app_base_url.rstrip("/")
    default_url = f"{base_url}/account/billing"
    session = billing_service.start_checkout(
        db,
        organization_id=user.organization_id,
        plan_code=payload.plan_code,
        success_url=payload.success_url or default_url,
        cancel_url=payload.cancel_url or default_url,
        ui_mode=payload.ui_mode,
        return_url=payload.return_url or payload.success_url or default_url,
    )
    return _checkout_response(session)


def _checkout_response(session) -> CheckoutResponse:
    return CheckoutResponse(
        session_id=session.session_id,
        url=session.url,
        client_secret=session.client_secret,
        provider=session.provider,
        plan_code=session.plan_code,
        mode=session.mode,
        ui_mode=session.ui_mode,
        livemode=session.livemode,
    )


@router.post("/setup-session", response_model=CheckoutResponse)
def create_setup_session(
    payload: SetupSessionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> CheckoutResponse:
    """Open a provider session that stores a card and charges nothing.

    This replaces the card form the app used to render. No PAN, expiry or CVC
    field exists in this application any more: they are typed into the
    provider's own iframe and this endpoint never sees them.
    """
    base_url = get_settings().app_base_url.rstrip("/")
    session = billing_service.start_setup_session(
        db,
        organization_id=user.organization_id,
        return_url=payload.return_url or f"{base_url}/account/billing",
        ui_mode=payload.ui_mode,
    )
    return _checkout_response(session)


@router.get("/checkout/{session_id}", response_model=CheckoutStatusResponse)
def confirm_checkout(
    session_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> CheckoutStatusResponse:
    """Confirm a session *with the provider* after the browser comes back.

    The UI calls this on the return_url landing and reports whatever it says.
    A session that is still ``open`` is reported as such -- a redirect is not
    a receipt.
    """
    return CheckoutStatusResponse.model_validate(
        billing_service.confirm_checkout_session(
            db, organization_id=user.organization_id, session_id=session_id
        )
    )


@router.post("/change-plan", response_model=SubscriptionResponse)
def change_plan(
    payload: ChangePlanRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SubscriptionResponse:
    billing_service.change_plan(
        db,
        organization_id=user.organization_id,
        plan_code=payload.plan_code,
        payment_method_id=payload.payment_method_id,
    )
    return _subscription_response(db, user.organization_id)


@router.post("/cancel", response_model=SubscriptionResponse)
def cancel_subscription(
    payload: CancelRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SubscriptionResponse:
    billing_service.cancel(db, organization_id=user.organization_id, at_period_end=payload.at_period_end)
    return _subscription_response(db, user.organization_id)


@router.post("/resume", response_model=SubscriptionResponse)
def resume_subscription(
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SubscriptionResponse:
    billing_service.resume(db, organization_id=user.organization_id)
    return _subscription_response(db, user.organization_id)


@router.post("/webhook")
async def provider_webhook(
    request: Request,
    db: Session = Depends(get_db),
    signature: str | None = Header(default=None, alias="X-Signature"),
) -> dict[str, str]:
    """Payment-provider webhook receiver.

    Signature verification and payload parsing are both provider-specific and
    live behind ``PaymentProvider``. Delivery is idempotent: a repeated event id
    returns ``duplicate`` without re-applying state.
    """
    raw_body = await request.body()
    return billing_service.handle_webhook(db, raw_body=raw_body, signature=signature)


# ---------------------------------------------------------------------------
# Plan change preview (proration), seats, cycle
# ---------------------------------------------------------------------------


@router.get("/change-plan/preview", response_model=PlanChangePreview)
def preview_change_plan(
    plan_code: str = Query(max_length=50),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PlanChangePreview:
    """What switching to ``plan_code`` costs today. Read-only."""
    return PlanChangePreview.model_validate(
        billing_service.preview_plan_change(
            db, organization_id=user.organization_id, plan_code=plan_code
        )
    )


@router.post("/seats", response_model=SeatChangeResponse)
def change_seats(
    payload: SeatChangeRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SeatChangeResponse:
    """Add (``delta > 0``) or release (``delta < 0``) licensed seats."""
    result = billing_service.change_seats(
        db,
        organization_id=user.organization_id,
        delta=payload.delta,
        payment_method_id=payload.payment_method_id,
    )
    return SeatChangeResponse(
        subscription=_subscription_response(db, user.organization_id),
        seats_licensed=result["seats_licensed"],
        seats_activated=result["seats_activated"],
        proration_cents=result["proration_cents"],
        effective_at=result["effective_at"],
    )


# ---------------------------------------------------------------------------
# Billing settings (BIL-6)
# ---------------------------------------------------------------------------


@router.get("/settings", response_model=BillingSettingsResponse)
def get_billing_settings(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> BillingSettingsResponse:
    return BillingSettingsResponse.model_validate(
        billing_service.settings_response(db, user.organization_id)
    )


@router.patch("/settings", response_model=BillingSettingsResponse)
def update_billing_settings(
    payload: BillingSettingsUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> BillingSettingsResponse:
    billing_service.update_settings(
        db,
        organization_id=user.organization_id,
        changes=payload.model_dump(exclude_unset=True),
    )
    return BillingSettingsResponse.model_validate(
        billing_service.settings_response(db, user.organization_id)
    )


# ---------------------------------------------------------------------------
# Payment methods (BIL-2, BIL-3)
# ---------------------------------------------------------------------------


@router.get("/payment-methods", response_model=list[PaymentMethodResponse])
def list_payment_methods(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[PaymentMethodResponse]:
    return [
        PaymentMethodResponse.model_validate(pm)
        for pm in billing_service.list_payment_methods(db, user.organization_id)
    ]


@router.post(
    "/payment-methods",
    response_model=PaymentMethodResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_payment_method(
    payload: PaymentMethodCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> PaymentMethodResponse:
    """Store a *tokenised* instrument.

    Only a provider token is accepted; a raw card number or bank account has
    no field to arrive in and must never reach this service.
    """
    pm = billing_service.add_payment_method(
        db,
        organization_id=user.organization_id,
        type=payload.type,
        provider_token=payload.provider_token,
        holder_name=payload.holder_name,
        country=payload.country,
        po_number=payload.po_number,
        make_default=payload.make_default,
    )
    return PaymentMethodResponse.model_validate(pm)


@router.post("/payment-methods/{payment_method_id}/default", response_model=PaymentMethodResponse)
def set_default_payment_method(
    payment_method_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> PaymentMethodResponse:
    pm = billing_service.set_default_payment_method(
        db, organization_id=user.organization_id, payment_method_id=payment_method_id
    )
    return PaymentMethodResponse.model_validate(pm)


@router.delete("/payment-methods/{payment_method_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_payment_method(
    payment_method_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> None:
    billing_service.remove_payment_method(
        db, organization_id=user.organization_id, payment_method_id=payment_method_id
    )


# ---------------------------------------------------------------------------
# Upcoming invoice (BIL-4) and charge history (BIL-5)
# ---------------------------------------------------------------------------


@router.get("/upcoming-invoice", response_model=UpcomingInvoiceResponse)
def upcoming_invoice(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> UpcomingInvoiceResponse:
    return UpcomingInvoiceResponse.model_validate(
        billing_service.next_invoice(db, user.organization_id)
    )


@router.get("/charges", response_model=list[ChargeResponse])
def list_charges(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ChargeResponse]:
    return [
        ChargeResponse.model_validate(charge)
        for charge in billing_service.list_charges(
            db, user.organization_id, limit=limit, offset=offset
        )
    ]
