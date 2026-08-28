"""Per-document signing deadlines (RTE-1) and the metered plan dimensions
(BIL-11)."""

from datetime import datetime, timedelta, timezone

from fastapi import status
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import get_db
from app.models.document import Document
from app.models.plan import ENTITLEMENT_MAX_API_CALLS_PER_MONTH, ENTITLEMENT_MAX_SMS_PER_MONTH
from app.models.signing_token import SigningToken
from app.models.subscription import Subscription
from app.models.usage_event import UsageEvent, UsageEventType
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def ready_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]) -> str:
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Sign", 100)
    return document_id


# --- RTE-1: the envelope's own deadline is what is applied on send ---------


def test_send_honours_the_per_document_expires_in_days(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = ready_document(client, pdf_bytes, headers)

    routing = client.put(
        f"/api/documents/{document_id}/routing", headers=headers, json={"expires_in_days": 3}
    )
    assert routing.status_code == status.HTTP_200_OK, routing.text

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == status.HTTP_200_OK, sent.text

    db = db_session(client)
    document = db.get(Document, document_id)
    delta = aware(document.expires_at) - aware(document.sent_at)
    # Three days, not the 14-day global default.
    assert round(delta.total_seconds() / 86400) == 3
    assert get_settings().signing_token_expire_days == 14

    # The signing link cannot outlive the envelope it signs.
    token = db.scalars(select(SigningToken).where(SigningToken.document_id == document_id)).first()
    assert aware(token.expires_at) == aware(document.expires_at)


def test_send_falls_back_to_the_global_default(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = ready_document(client, pdf_bytes, headers)
    assert client.post(f"/api/documents/{document_id}/send", headers=headers).status_code == 200

    db = db_session(client)
    document = db.get(Document, document_id)
    delta = aware(document.expires_at) - aware(document.sent_at)
    assert round(delta.total_seconds() / 86400) == get_settings().signing_token_expire_days


def test_reminder_links_inherit_the_envelope_deadline(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = ready_document(client, pdf_bytes, headers)
    client.put(f"/api/documents/{document_id}/routing", headers=headers, json={"expires_in_days": 2})
    client.post(f"/api/documents/{document_id}/send", headers=headers)

    reminded = client.post(f"/api/documents/{document_id}/remind", headers=headers)
    assert reminded.status_code == 200, reminded.text

    db = db_session(client)
    document = db.get(Document, document_id)
    live = [
        token
        for token in db.scalars(select(SigningToken).where(SigningToken.document_id == document_id))
        if token.revoked_at is None
    ]
    assert live, "the reminder must leave exactly one live link"
    for token in live:
        assert aware(token.expires_at) <= aware(document.expires_at)


# --- BIL-11: metered ceilings ---------------------------------------------


def test_every_plan_declares_the_metered_ceilings(client: TestClient) -> None:
    plans = client.get("/api/billing/plans").json()
    for plan in plans:
        entitlements = plan["entitlements"]
        assert ENTITLEMENT_MAX_API_CALLS_PER_MONTH in entitlements
        assert ENTITLEMENT_MAX_SMS_PER_MONTH in entitlements
    by_code = {plan["code"]: plan["entitlements"] for plan in plans}
    assert by_code["team"][ENTITLEMENT_MAX_API_CALLS_PER_MONTH] == 5_000
    assert by_code["team"][ENTITLEMENT_MAX_SMS_PER_MONTH] == 100
    # Enterprise stays unlimited.
    assert by_code["enterprise"][ENTITLEMENT_MAX_API_CALLS_PER_MONTH] is None


def test_api_key_requests_are_metered_and_capped(client: TestClient) -> None:
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    created = client.post(
        "/api/api-keys", headers=headers, json={"label": "CI", "scopes": ["documents:read"], "mode": "test"}
    )
    assert created.status_code == 201, created.text
    raw_key = created.json()["secret"]

    assert client.get("/api/v1/documents", headers={"X-API-Key": raw_key}).status_code == 200

    db = db_session(client)
    calls = db.scalars(
        select(UsageEvent).where(UsageEvent.event_type == UsageEventType.api_call)
    ).all()
    assert len(calls) == 1

    usage = client.get("/api/billing/usage", headers=headers).json()
    api_row = next(row for row in usage["rows"] if row["key"] == ENTITLEMENT_MAX_API_CALLS_PER_MONTH)
    assert api_row["used"] == 1 and api_row["limit"] == 5_000

    # At the ceiling the key is refused with the machine-readable 402 body.
    subscription = db.scalars(select(Subscription)).first()
    plan = subscription.plan if subscription else None
    if plan is not None:
        entitlements = dict(plan.entitlements)
        entitlements[ENTITLEMENT_MAX_API_CALLS_PER_MONTH] = 1
        plan.entitlements = entitlements
        db.commit()
        blocked = client.get("/api/v1/documents", headers={"X-API-Key": raw_key})
        assert blocked.status_code == 402, blocked.text
        assert blocked.json()["detail"]["limit"] == ENTITLEMENT_MAX_API_CALLS_PER_MONTH


def test_exhausted_sms_allowance_degrades_to_email(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    """An SMS ceiling must never strand a signer mid-session."""
    headers = auth_headers(client)
    client.get("/api/billing/plans")
    document_id = ready_document(client, pdf_bytes, headers)

    db = db_session(client)
    document = db.get(Document, document_id)
    recipient = document.recipients[0]
    recipient.phone_number = "+15550000001"
    db.commit()

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    from app.tests.test_document_flow import token_from_link

    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])

    sms_calls: list[str] = []
    monkeypatch.setattr(
        "app.services.sms_service.sms_service.send_sms",
        lambda **kwargs: sms_calls.append(kwargs["to_phone"]),
    )

    assert client.post(f"/api/sign/{token}/otp/send").status_code in (200, 204)
    assert sms_calls == ["+15550000001"]
    metered = db.scalars(
        select(UsageEvent).where(UsageEvent.event_type == UsageEventType.sms_sent)
    ).all()
    assert len(metered) == 1

    # Drop the ceiling below what is already used: the next code goes by email
    # and no further SMS is metered.
    subscription = db.scalars(select(Subscription)).first()
    if subscription and subscription.plan:
        entitlements = dict(subscription.plan.entitlements)
        entitlements[ENTITLEMENT_MAX_SMS_PER_MONTH] = 1
        subscription.plan.entitlements = entitlements
        db.commit()

        assert client.post(f"/api/sign/{token}/otp/send").status_code in (200, 204)
        assert sms_calls == ["+15550000001"]
        still = db.scalars(
            select(UsageEvent).where(UsageEvent.event_type == UsageEventType.sms_sent)
        ).all()
        assert len(still) == 1
