"""Stripe Connect (tenants connect their OWN Stripe account) -- adapter tests.

Nothing touches the network: ``StripeConnectService.transport`` is replaced
with a canned responder, exactly as ``test_billing_enforcement.py`` does for
the platform-billing Stripe adapter.
"""

from __future__ import annotations

import hashlib
import hmac
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.organization import Organization
from app.services.stripe_connect_service import StripeConnectService
from app.tests.conftest import auth_headers


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _organization(client: TestClient, headers: dict[str, str]) -> tuple[Organization, object]:
    org_id = client.get("/api/auth/me", headers=headers).json()["organization_id"]
    db, generator = _db()
    organization = db.query(Organization).filter(Organization.id == org_id).first()
    return organization, db


@pytest.fixture()
def connect_service(monkeypatch: pytest.MonkeyPatch) -> StripeConnectService:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    monkeypatch.setenv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_connect_fake")
    from app.core.config import get_settings

    get_settings.cache_clear()
    service = StripeConnectService()
    yield service
    get_settings.cache_clear()


def _account_payload(**overrides) -> dict:
    """A v1-shaped ``GET /v1/accounts/{id}`` response, for ``refresh_status``
    and the ``account.updated`` webhook -- both of which stay on v1."""
    payload = {
        "id": "acct_123",
        "charges_enabled": False,
        "payouts_enabled": False,
        "details_submitted": False,
        "default_currency": "usd",
        "livemode": False,
        "requirements": {"disabled_reason": None},
    }
    payload.update(overrides)
    return payload


def _v2_account_payload(*, active: bool = False, **overrides) -> dict:
    """A ``POST /v2/core/accounts`` response shape."""
    payload = {
        "id": "acct_123",
        "object": "v2.core.account",
        "livemode": False,
        "configuration": {
            "merchant": {
                "applied": "2026-01-01T00:00:00.000Z" if active else None,
                "capabilities": {
                    "card_payments": {
                        "status": "active" if active else "pending",
                        "status_details": [],
                    },
                    "stripe_balance": {"payouts": {"status": "active" if active else "pending"}},
                },
            }
        },
        "defaults": {"currency": "usd"},
    }
    payload.update(overrides)
    return payload


def _set_v2_account_transport(monkeypatch: pytest.MonkeyPatch, response: dict | None = None) -> list[tuple]:
    """Fake the Accounts v2 create call; returns the recorded calls list."""
    calls: list[tuple] = []

    def fake(method, url, params, headers):
        calls.append((method, url, params, headers))
        return 200, (response if response is not None else _v2_account_payload())

    monkeypatch.setattr(StripeConnectService, "transport", staticmethod(fake))
    return calls


def test_ensure_account_is_idempotent(client: TestClient, connect_service: StripeConnectService, monkeypatch):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)

    calls = _set_v2_account_transport(monkeypatch)

    first = connect_service.ensure_account(
        db, organization=organization, user_email="owner@example.com", country="US", entity_type="company"
    )
    # A reconnect against an existing row must not require identity fields.
    second = connect_service.ensure_account(db, organization=organization)

    assert first.id == second.id
    assert first.provider_account_id == "acct_123"
    # Only the first call hits Stripe; the second is served from the local row.
    assert len(calls) == 1
    method, url, params, headers_sent = calls[0]
    assert method == "POST"
    assert url.endswith("/v2/core/accounts")
    # v2 is a JSON body, not `_flatten_form`'d -- a nested dict survives intact.
    assert params["configuration"]["merchant"]["capabilities"]["card_payments"]["requested"] is True
    assert params["contact_email"] == "owner@example.com"
    # `identity.country` is sent lowercased, regardless of the case supplied.
    assert params["identity"]["country"] == "us"
    assert params["identity"]["entity_type"] == "company"
    assert "identity" in params["include"]
    # `full`, not `express`: see the comment on `ensure_account` and
    # `test_stripe_connect_v2.py` -- Express alongside Stripe-held
    # negative-balance liability is preview-only.
    assert params["dashboard"] == "full"
    assert headers_sent["Stripe-Version"] == "2026-08-26.dahlia"
    assert headers_sent["Content-Type"] == "application/json"


def test_create_onboarding_link(client: TestClient, connect_service: StripeConnectService, monkeypatch):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)

    calls = []

    def fake(method, url, params, headers):
        calls.append((method, url, params))
        if url.endswith("/v2/core/accounts"):
            return 200, _v2_account_payload()
        assert url.endswith("/v2/core/account_links")
        assert params["account"] == "acct_123"
        assert params["use_case"]["type"] == "account_onboarding"
        assert params["use_case"]["account_onboarding"]["configurations"] == ["merchant"]
        return 200, {
            "url": "https://connect.stripe.com/setup/abc",
            "expires_at": "2026-01-01T00:05:00Z",
        }

    monkeypatch.setattr(StripeConnectService, "transport", staticmethod(fake))

    link = connect_service.create_onboarding_link(
        db,
        organization=organization,
        return_url="https://app.example.com/settings/payments?done=1",
        refresh_url="https://app.example.com/settings/payments",
        country="GB",
        entity_type="individual",
    )
    assert link.url == "https://connect.stripe.com/setup/abc"
    assert link.expires_at.year == 2026
    assert link.expires_at.tzinfo is not None


def test_refresh_status_mirrors_flags_and_stamps_onboarded_at_once(
    client: TestClient, connect_service: StripeConnectService, monkeypatch
):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)

    _set_v2_account_transport(monkeypatch)
    connect_service.ensure_account(db, organization=organization, country="US", entity_type="company")

    monkeypatch.setattr(
        StripeConnectService,
        "transport",
        staticmethod(
            lambda m, u, p, h: (
                200,
                _account_payload(charges_enabled=True, payouts_enabled=True, details_submitted=True),
            )
        ),
    )
    refreshed = connect_service.refresh_status(db, organization=organization)
    assert refreshed.charges_enabled is True
    assert refreshed.payouts_enabled is True
    first_onboarded_at = refreshed.onboarded_at
    assert first_onboarded_at is not None

    # A second refresh with charges still enabled must not restamp onboarded_at.
    refreshed_again = connect_service.refresh_status(db, organization=organization)
    assert refreshed_again.onboarded_at == first_onboarded_at


def test_require_payable_account_rejects_when_charges_disabled(
    client: TestClient, connect_service: StripeConnectService, monkeypatch
):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)

    _set_v2_account_transport(monkeypatch)
    connect_service.ensure_account(db, organization=organization, country="US", entity_type="company")

    with pytest.raises(HTTPException) as excinfo:
        connect_service.require_payable_account(db, organization_id=organization.id)
    assert excinfo.value.status_code == 409


def test_disconnect_drops_local_row_but_never_calls_stripe(
    client: TestClient, connect_service: StripeConnectService, monkeypatch
):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)

    _set_v2_account_transport(monkeypatch)
    connect_service.ensure_account(db, organization=organization, country="US", entity_type="company")
    assert connect_service.get_account(db, organization.id) is not None

    def refuse(method, url, params, headers):
        raise AssertionError("disconnect must not call Stripe")

    monkeypatch.setattr(StripeConnectService, "transport", staticmethod(refuse))
    monkeypatch.setattr(StripeConnectService, "transport", staticmethod(refuse))

    connect_service.disconnect(db, organization=organization)
    assert connect_service.get_account(db, organization.id) is None


def test_ensure_account_rejects_invalid_country_before_calling_stripe(
    client: TestClient, connect_service: StripeConnectService, monkeypatch
):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)
    calls = _set_v2_account_transport(monkeypatch)

    with pytest.raises(HTTPException) as excinfo:
        connect_service.ensure_account(db, organization=organization, country="USA", entity_type="company")
    assert excinfo.value.status_code == 400
    assert calls == []


def test_ensure_account_rejects_invalid_entity_type_before_calling_stripe(
    client: TestClient, connect_service: StripeConnectService, monkeypatch
):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)
    calls = _set_v2_account_transport(monkeypatch)

    with pytest.raises(HTTPException) as excinfo:
        connect_service.ensure_account(db, organization=organization, country="US", entity_type="business")
    assert excinfo.value.status_code == 400
    assert calls == []


def test_verify_connect_webhook_rejects_bad_signature(connect_service: StripeConnectService):
    body = b'{"id": "evt_1", "type": "account.updated"}'
    assert connect_service.verify_connect_webhook(raw_body=body, signature="t=123,v1=deadbeef") is False


def test_verify_connect_webhook_rejects_stale_timestamp(connect_service: StripeConnectService):
    body = b'{"id": "evt_1", "type": "account.updated"}'
    stale_timestamp = int(time.time()) - 10_000
    expected = hmac.new(
        b"whsec_connect_fake", f"{stale_timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()
    signature = f"t={stale_timestamp},v1={expected}"
    assert connect_service.verify_connect_webhook(raw_body=body, signature=signature) is False


def test_verify_connect_webhook_accepts_valid_signature(connect_service: StripeConnectService):
    body = b'{"id": "evt_1", "type": "account.updated"}'
    timestamp = int(time.time())
    expected = hmac.new(b"whsec_connect_fake", f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    signature = f"t={timestamp},v1={expected}"
    assert connect_service.verify_connect_webhook(raw_body=body, signature=signature) is True
