from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.schemas.webhook import (
    WebhookDeliveryResponse,
    WebhookEndpointCreate,
    WebhookEndpointCreated,
    WebhookEndpointResponse,
    WebhookEndpointUpdate,
    WebhookEventTypeResponse,
)
from app.services.webhook_service import (
    EVENT_CATALOGUE,
    EVENT_TYPES,
    WebhookUrlError,
    generate_secret,
    validate_endpoint_url,
    webhook_service,
)


from app.models.plan import ENTITLEMENT_WEBHOOKS  # noqa: E402
from app.services.entitlement_service import (  # noqa: E402
    EntitlementContext,
    entitlement_service,
)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


def _get_endpoint(db: Session, endpoint_id: str, user: User) -> WebhookEndpoint:
    endpoint = db.get(WebhookEndpoint, endpoint_id)
    if not endpoint or endpoint.organization_id != user.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Webhook endpoint not found")
    return endpoint


def _get_delivery(db: Session, delivery_id: str, user: User) -> WebhookDelivery:
    delivery = db.get(WebhookDelivery, delivery_id)
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found")
    _get_endpoint(db, delivery.endpoint_id, user)
    return delivery


def _validate_events(event_types: list[str] | None) -> list[str] | None:
    if event_types is None:
        return None
    unknown = [item for item in event_types if item != "*" and item not in EVENT_CATALOGUE]
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown event types: {', '.join(sorted(unknown))}",
        )
    return event_types


def _validate_url(url: str) -> str:
    try:
        return validate_endpoint_url(url)
    except WebhookUrlError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/event-types", response_model=list[WebhookEventTypeResponse])
def list_event_types(user: User = Depends(get_current_user)) -> list[WebhookEventTypeResponse]:
    """The catalogue of events an endpoint may subscribe to."""
    return [WebhookEventTypeResponse(event_type=name, description=EVENT_CATALOGUE[name]) for name in EVENT_TYPES]


@router.get("", response_model=list[WebhookEndpointResponse])
def list_endpoints(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return list(
        db.execute(
            select(WebhookEndpoint)
            .where(WebhookEndpoint.organization_id == user.organization_id)
            .order_by(WebhookEndpoint.created_at.desc())
        ).scalars()
    )


@router.post("", response_model=WebhookEndpointCreated, status_code=status.HTTP_201_CREATED)
def create_endpoint(
    payload: WebhookEndpointCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _entitlement: EntitlementContext = Depends(
        entitlement_service.requires(ENTITLEMENT_WEBHOOKS)
    ),
):
    """Create an endpoint. The signing secret is returned here and never again.

    ``webhooks`` is a Business-and-above entitlement and is enforced here: it
    was sold but never checked, so a Team org could register endpoints
    (AUDIT_REPORT.md section 7, finding 2).
    """
    endpoint = WebhookEndpoint(
        organization_id=user.organization_id,
        url=_validate_url(payload.url),
        secret=generate_secret(),
        event_types=_validate_events(payload.event_types),
        is_active=payload.is_active,
        description=payload.description,
    )
    db.add(endpoint)
    db.commit()
    db.refresh(endpoint)
    return endpoint


@router.get("/{endpoint_id}", response_model=WebhookEndpointResponse)
def get_endpoint(endpoint_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return _get_endpoint(db, endpoint_id, user)


@router.patch("/{endpoint_id}", response_model=WebhookEndpointResponse)
def update_endpoint(
    endpoint_id: str,
    payload: WebhookEndpointUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    endpoint = _get_endpoint(db, endpoint_id, user)
    data = payload.model_dump(exclude_unset=True)
    if "url" in data and data["url"] is not None:
        endpoint.url = _validate_url(data["url"])
    if "event_types" in data:
        endpoint.event_types = _validate_events(data["event_types"])
    if "description" in data:
        endpoint.description = data["description"]
    if data.get("is_active") is not None:
        endpoint.is_active = data["is_active"]
    db.commit()
    db.refresh(endpoint)
    return endpoint


@router.post("/{endpoint_id}/rotate-secret", response_model=WebhookEndpointCreated)
def rotate_secret(endpoint_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    endpoint = _get_endpoint(db, endpoint_id, user)
    endpoint.secret = generate_secret()
    db.commit()
    db.refresh(endpoint)
    return endpoint


@router.delete("/{endpoint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_endpoint(endpoint_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> None:
    endpoint = _get_endpoint(db, endpoint_id, user)
    db.delete(endpoint)
    db.commit()


@router.get("/{endpoint_id}/deliveries", response_model=list[WebhookDeliveryResponse])
def list_deliveries(
    endpoint_id: str,
    delivery_status: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delivery log, newest first. Filter by status to see the dead letters."""
    _get_endpoint(db, endpoint_id, user)
    query = select(WebhookDelivery).where(WebhookDelivery.endpoint_id == endpoint_id)
    if delivery_status:
        query = query.where(WebhookDelivery.status == delivery_status)
    return list(db.execute(query.order_by(WebhookDelivery.created_at.desc()).limit(limit)).scalars())


@router.post("/deliveries/{delivery_id}/replay", response_model=WebhookDeliveryResponse)
def replay_delivery(delivery_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    delivery = _get_delivery(db, delivery_id, user)
    return webhook_service.replay(db, delivery)


@router.post("/{endpoint_id}/test", response_model=list[WebhookDeliveryResponse])
def send_test_event(
    endpoint_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    _entitlement: EntitlementContext = Depends(
        entitlement_service.requires(ENTITLEMENT_WEBHOOKS)
    ),
):
    """Fire a synthetic ``webhook.test`` event at this endpoint only."""
    endpoint = _get_endpoint(db, endpoint_id, user)
    deliveries = webhook_service.emit(
        db,
        organization_id=user.organization_id,
        event_type="webhook.test",
        data={"message": "This is a SignFlow test event.", "endpoint_id": endpoint.id},
        dispatch=False,
        only_endpoint_id=endpoint.id,
    )
    if not deliveries:
        # endpoint does not subscribe to webhook.test; queue one anyway
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This endpoint is inactive or not subscribed to webhook.test",
        )
    db.commit()
    ids = [item.id for item in deliveries]
    bind = db.get_bind()
    background_tasks.add_task(webhook_service.deliver_ids, bind, ids)
    for item in deliveries:
        db.refresh(item)
    return deliveries
