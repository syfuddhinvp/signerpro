import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.services import webhook_service as webhook_module
from app.services.webhook_service import (
    WebhookUrlError,
    sign_payload,
    validate_endpoint_url,
    webhook_service,
)
from app.tests.conftest import auth_headers, upgrade_plan
from app.tests.test_document_flow import (
    add_field,
    add_recipient,
    create_uploaded_document,
    token_from_link,
)


class RecordingTransport:
    """Stand-in for httpx: records every outbound call, returns a scripted status."""

    def __init__(self, status_code: int = 200, raises: Exception | None = None) -> None:
        self.status_code = status_code
        self.raises = raises
        self.calls: list[tuple[str, bytes, dict[str, str]]] = []

    def __call__(self, url: str, body: bytes, headers: dict[str, str]):
        self.calls.append((url, body, headers))
        if self.raises is not None:
            raise self.raises
        return self.status_code, "ok"


def _entitled_headers(client: TestClient) -> dict[str, str]:
    """A tenant that has actually bought the ``webhooks`` entitlement.

    Team declares ``webhooks: False`` and that is now enforced, so these tests
    pay for Business first. Previously they exercised the surface from an
    unentitled org, which is exactly the hole AUDIT_REPORT.md section 7 found.
    """
    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")
    return headers


@pytest.fixture()
def transport():
    original = webhook_service.transport
    original_sync = webhook_service.synchronous
    recorder = RecordingTransport()
    webhook_service.transport = recorder
    webhook_service.synchronous = True  # deliver inline so tests are deterministic
    yield recorder
    webhook_service.transport = original
    webhook_service.synchronous = original_sync


def create_endpoint(client: TestClient, headers, **overrides) -> dict:
    payload = {"url": "http://hooks.example.test/signflow", "description": "primary"}
    payload.update(overrides)
    response = client.post("/api/webhooks", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def sign_document(client: TestClient, pdf_bytes: bytes, headers) -> str:
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer_id = add_recipient(client, document_id, headers, "Signer One", "one@example.com")
    field_id = add_field(client, document_id, headers, signer_id, "text", "Input", 680)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "Yes"})
    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["document_status"] == "completed"
    return document_id


# --------------------------------------------------------------------------- #
# URL safety
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "url",
    [
        "https://127.0.0.1/hook",
        "https://localhost/hook",
        "https://10.0.0.5/hook",
        "https://192.168.1.10/hook",
        "https://169.254.169.254/latest/meta-data",
        "https://[::1]/hook",
        "ftp://example.com/hook",
        "http://example.com/hook",  # plain http rejected in production
        "not-a-url",
    ],
)
def test_unsafe_urls_are_rejected_in_production(url: str) -> None:
    with pytest.raises(WebhookUrlError):
        validate_endpoint_url(url, allow_insecure=False)


def test_public_https_url_is_accepted() -> None:
    assert validate_endpoint_url("https://example.com/hook", allow_insecure=True)


def test_api_rejects_ssrf_url(client: TestClient) -> None:
    headers = _entitled_headers(client)
    response = client.post(
        "/api/webhooks",
        headers=headers,
        json={"url": "ftp://example.com/hook"},
    )
    assert response.status_code == 400


# --------------------------------------------------------------------------- #
# Management API
# --------------------------------------------------------------------------- #

def test_event_type_catalogue(client: TestClient) -> None:
    headers = _entitled_headers(client)
    response = client.get("/api/webhooks/event-types", headers=headers)
    assert response.status_code == 200
    names = {item["event_type"] for item in response.json()}
    assert {"document.completed", "recipient.signed", "document.declined"} <= names
    # No CRM vocabulary leaked into the public catalogue
    assert not [name for name in names if "loan" in name or "realtor" in name or "crm" in name]


def test_catalogue_covers_the_whole_lifecycle_from_creation(client: TestClient) -> None:
    """The lifecycle an integration can subscribe to starts at creation."""
    headers = _entitled_headers(client)
    names = {
        item["event_type"]
        for item in client.get("/api/webhooks/event-types", headers=headers).json()
    }
    assert "document.created" in names


def test_draft_creation_emits_document_created_before_any_send(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    """A draft is an event, not silence until send time."""
    headers = _entitled_headers(client)
    create_endpoint(client, headers)

    created = client.post("/api/documents", headers=headers, json={"title": "Draft one"})
    assert created.status_code == 201, created.text

    events = [h["X-SignFlow-Event"] for _, _, h in transport.calls]
    assert events == ["document.created"]
    payload = transport.calls[0][1]
    assert b'"status":"draft"' in payload.replace(b", ", b",").replace(b": ", b":")


def test_send_emits_document_sent(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    headers = _entitled_headers(client)
    create_endpoint(client, headers)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer_id = add_recipient(client, document_id, headers, "Signer One", "one@example.com")
    add_field(client, document_id, headers, signer_id, "text", "Input", 680)
    transport.calls.clear()

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    assert "document.sent" in [h["X-SignFlow-Event"] for _, _, h in transport.calls]


def test_view_decline_and_void_emit_their_events(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    headers = _entitled_headers(client)
    create_endpoint(client, headers)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer_id = add_recipient(client, document_id, headers, "Signer One", "one@example.com")
    add_field(client, document_id, headers, signer_id, "text", "Input", 680)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    transport.calls.clear()

    client.post(f"/api/sign/{token}/viewed")
    assert "document.viewed" in [h["X-SignFlow-Event"] for _, _, h in transport.calls]

    client.post(f"/api/sign/{token}/consent")
    transport.calls.clear()
    declined = client.post(f"/api/sign/{token}/decline", json={"reason": "wrong party"})
    assert declined.status_code in {200, 204}, declined.text
    events = [h["X-SignFlow-Event"] for _, _, h in transport.calls]
    assert "recipient.declined" in events
    assert "document.declined" in events


def test_void_emits_document_voided(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    headers = _entitled_headers(client)
    create_endpoint(client, headers)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer_id = add_recipient(client, document_id, headers, "Signer One", "one@example.com")
    add_field(client, document_id, headers, signer_id, "text", "Input", 680)
    client.post(f"/api/documents/{document_id}/send", headers=headers)
    transport.calls.clear()

    voided = client.post(f"/api/documents/{document_id}/void", headers=headers, params={"reason": "superseded"})
    assert voided.status_code == 200, voided.text
    assert "document.voided" in [h["X-SignFlow-Event"] for _, _, h in transport.calls]


def test_templates_are_not_envelopes_and_emit_nothing(
    client: TestClient, transport: RecordingTransport
) -> None:
    headers = _entitled_headers(client)
    create_endpoint(client, headers)
    created = client.post(
        "/api/documents", headers=headers, json={"title": "Template one", "is_template": True}
    )
    assert created.status_code == 201, created.text
    assert transport.calls == []


def test_endpoint_crud_and_secret_shown_once(client: TestClient) -> None:
    headers = _entitled_headers(client)
    created = create_endpoint(client, headers, event_types=["document.completed"])
    assert created["secret"].startswith("whsec_")

    fetched = client.get(f"/api/webhooks/{created['id']}", headers=headers)
    assert fetched.status_code == 200
    assert "secret" not in fetched.json()

    listed = client.get("/api/webhooks", headers=headers)
    assert [item["id"] for item in listed.json()] == [created["id"]]

    updated = client.patch(
        f"/api/webhooks/{created['id']}",
        headers=headers,
        json={"is_active": False, "description": "paused"},
    )
    assert updated.status_code == 200
    assert updated.json()["is_active"] is False

    deleted = client.delete(f"/api/webhooks/{created['id']}", headers=headers)
    assert deleted.status_code == 204
    assert client.get(f"/api/webhooks/{created['id']}", headers=headers).status_code == 404


def test_unknown_event_type_rejected(client: TestClient) -> None:
    headers = _entitled_headers(client)
    response = client.post(
        "/api/webhooks",
        headers=headers,
        json={"url": "http://hooks.example.test/x", "event_types": ["crm_loan_milestone_updated"]},
    )
    assert response.status_code == 400


def test_endpoints_are_tenant_scoped(client: TestClient) -> None:
    headers = _entitled_headers(client)
    created = create_endpoint(client, headers)

    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Co",
            "name": "Other Admin",
            "email": "other@example.com",
            "password": "strong-password",
        },
    )
    assert other.status_code == 201, other.text
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    assert client.get(f"/api/webhooks/{created['id']}", headers=other_headers).status_code == 404
    assert client.get(f"/api/webhooks/{created['id']}/deliveries", headers=other_headers).status_code == 404
    assert client.get("/api/webhooks", headers=other_headers).json() == []


# --------------------------------------------------------------------------- #
# Emission + signing
# --------------------------------------------------------------------------- #

def test_completed_document_emits_neutral_events_with_valid_signature(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers)
    sign_document(client, pdf_bytes, headers)

    events = [headers_["X-SignFlow-Event"] for _, _, headers_ in transport.calls]
    assert "recipient.signed" in events
    assert "document.completed" in events
    assert not [item for item in events if item.startswith("crm")]

    url, body, sent_headers = transport.calls[0]
    assert url == endpoint["url"]
    timestamp = sent_headers["X-SignFlow-Timestamp"]
    expected = hmac.new(
        endpoint["secret"].encode(),
        f"{timestamp}.".encode() + body,
        hashlib.sha256,
    ).hexdigest()
    assert sent_headers["X-SignFlow-Signature"] == f"sha256={expected}"
    assert sign_payload(endpoint["secret"], int(timestamp), body) == sent_headers["X-SignFlow-Signature"]

    deliveries = client.get(f"/api/webhooks/{endpoint['id']}/deliveries", headers=headers).json()
    assert deliveries
    assert all(item["status"] == "succeeded" for item in deliveries)
    assert all(item["status_code"] == 200 for item in deliveries)
    payload = deliveries[0]["payload"]
    assert payload["type"] in {"recipient.signed", "document.completed"}
    assert payload["data"]["document"]["id"]


def test_event_type_subscription_filters_delivery(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers, event_types=["document.completed"])
    sign_document(client, pdf_bytes, headers)
    events = {headers_["X-SignFlow-Event"] for _, _, headers_ in transport.calls}
    assert events == {"document.completed"}
    _ = endpoint


def test_inactive_endpoint_receives_nothing(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers)
    client.patch(f"/api/webhooks/{endpoint['id']}", headers=headers, json={"is_active": False})
    sign_document(client, pdf_bytes, headers)
    assert transport.calls == []


# --------------------------------------------------------------------------- #
# The critical property: a broken endpoint must not break signing
# --------------------------------------------------------------------------- #

def test_broken_endpoint_does_not_break_signing(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    transport.raises = RuntimeError("connection refused")
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers)

    document_id = sign_document(client, pdf_bytes, headers)  # asserts completion internally

    document = client.get(f"/api/documents/{document_id}", headers=headers).json()
    assert document["status"] == "completed"
    final_pdf = client.get(f"/api/documents/{document_id}/final-pdf", headers=headers)
    assert final_pdf.status_code == 200

    deliveries = client.get(f"/api/webhooks/{endpoint['id']}/deliveries", headers=headers).json()
    assert deliveries
    assert all(item["status"] == "failed" for item in deliveries)
    assert all(item["attempt"] == 1 for item in deliveries)
    assert all(item["next_retry_at"] is not None for item in deliveries)
    assert all("connection refused" in item["error"] for item in deliveries)


def test_http_500_from_endpoint_does_not_break_signing(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    transport.status_code = 500
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers)
    sign_document(client, pdf_bytes, headers)
    deliveries = client.get(f"/api/webhooks/{endpoint['id']}/deliveries", headers=headers).json()
    assert all(item["status"] == "failed" and item["status_code"] == 500 for item in deliveries)


# --------------------------------------------------------------------------- #
# Retries, backoff, dead-lettering, replay
# --------------------------------------------------------------------------- #

def _session_for(client: TestClient):
    from app.core.database import get_db
    from app.main import app

    generator = app.dependency_overrides[get_db]()
    return generator, next(generator)


def test_retries_back_off_then_exhaust_and_replay_recovers(
    client: TestClient, pdf_bytes: bytes, transport: RecordingTransport
) -> None:
    transport.raises = RuntimeError("boom")
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers, event_types=["document.completed"])
    sign_document(client, pdf_bytes, headers)

    generator, db = _session_for(client)
    try:
        from app.models.webhook import WebhookDelivery

        delivery = db.query(WebhookDelivery).one()
        assert delivery.attempt == 1
        assert webhook_service.backoff_seconds(1) == 30
        assert webhook_service.backoff_seconds(2) == 60
        assert webhook_service.backoff_seconds(3) == 120

        # Not yet due: process_due_retries leaves it alone.
        assert webhook_service.process_due_retries(db, now=datetime.now(timezone.utc)) == 0

        # Fast-forward past every backoff window until the delivery dead-letters.
        for _ in range(webhook_module.MAX_ATTEMPTS):
            future = datetime.now(timezone.utc) + timedelta(days=1)
            webhook_service.process_due_retries(db, now=future)
        db.refresh(delivery)
        assert delivery.attempt == webhook_module.MAX_ATTEMPTS
        assert delivery.status == "exhausted"
        assert delivery.next_retry_at is None

        # Exhausted deliveries are never retried automatically again.
        assert webhook_service.process_due_retries(db, now=datetime.now(timezone.utc) + timedelta(days=7)) == 0

        delivery_id = delivery.id
    finally:
        generator.close()

    dead_letters = client.get(
        f"/api/webhooks/{endpoint['id']}/deliveries", headers=headers, params={"status": "exhausted"}
    ).json()
    assert [item["id"] for item in dead_letters] == [delivery_id]

    # Manual replay against a now-healthy endpoint succeeds.
    transport.raises = None
    replayed = client.post(f"/api/webhooks/deliveries/{delivery_id}/replay", headers=headers)
    assert replayed.status_code == 200, replayed.text
    assert replayed.json()["status"] == "succeeded"
    assert replayed.json()["attempt"] == 1
    assert replayed.json()["delivered_at"] is not None


def test_replay_is_tenant_scoped(client: TestClient, pdf_bytes: bytes, transport: RecordingTransport) -> None:
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers)
    sign_document(client, pdf_bytes, headers)
    delivery_id = client.get(f"/api/webhooks/{endpoint['id']}/deliveries", headers=headers).json()[0]["id"]

    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Co",
            "name": "Other Admin",
            "email": "other2@example.com",
            "password": "strong-password",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}
    assert client.post(f"/api/webhooks/deliveries/{delivery_id}/replay", headers=other_headers).status_code == 404


# --------------------------------------------------------------------------- #
# Test event
# --------------------------------------------------------------------------- #

def test_send_test_event(client: TestClient, transport: RecordingTransport) -> None:
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers)
    response = client.post(f"/api/webhooks/{endpoint['id']}/test", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()[0]["event_type"] == "webhook.test"
    assert transport.calls
    assert transport.calls[-1][2]["X-SignFlow-Event"] == "webhook.test"


def test_test_event_rejected_when_not_subscribed(client: TestClient, transport: RecordingTransport) -> None:
    headers = _entitled_headers(client)
    endpoint = create_endpoint(client, headers, event_types=["document.completed"])
    response = client.post(f"/api/webhooks/{endpoint['id']}/test", headers=headers)
    assert response.status_code == 400


# --------------------------------------------------------------------------- #
# Webhook activity is itself audited (real, not simulated)
# --------------------------------------------------------------------------- #

def test_webhook_activity_is_audited(client: TestClient, pdf_bytes: bytes, transport: RecordingTransport) -> None:
    headers = _entitled_headers(client)
    create_endpoint(client, headers, event_types=["document.completed"])
    document_id = sign_document(client, pdf_bytes, headers)
    logs = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    assert "webhook_delivery_succeeded" in [item["event_type"] for item in logs]
