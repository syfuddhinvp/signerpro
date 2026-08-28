from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_org_admin
from app.core.config import get_settings
from app.core.database import get_db
from app.models.user import User
from app.schemas.billing import (
    CancelRequest,
    ChangePlanRequest,
    CheckoutRequest,
    CheckoutResponse,
    PlanResponse,
    SubscriptionResponse,
    UsageResponse,
)
from app.services.billing_service import billing_service
from app.services.entitlement_service import entitlement_service


router = APIRouter(prefix="/api/billing", tags=["billing"])


def _subscription_response(db: Session, organization_id: str) -> SubscriptionResponse:
    context = entitlement_service.resolve(db, organization_id)
    subscription = context.subscription
    return SubscriptionResponse(
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
    session = billing_service.start_checkout(
        db,
        organization_id=user.organization_id,
        plan_code=payload.plan_code,
        success_url=payload.success_url or f"{base_url}/dashboard/billing",
        cancel_url=payload.cancel_url or f"{base_url}/dashboard/billing",
    )
    return CheckoutResponse(
        session_id=session.session_id, url=session.url, provider=session.provider, plan_code=session.plan_code
    )


@router.post("/change-plan", response_model=SubscriptionResponse)
def change_plan(
    payload: ChangePlanRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_org_admin),
) -> SubscriptionResponse:
    billing_service.change_plan(db, organization_id=user.organization_id, plan_code=payload.plan_code)
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
