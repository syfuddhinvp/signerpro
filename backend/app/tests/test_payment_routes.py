"""HTTP surface for PAY-1: account management, sender collection views, the
Connect webhook, and the signer-token payment endpoints.

Nothing touches the network: `StripeConnectService.transport` and
`SignerPaymentService.transport` are the same injectable seam used by
`test_signer_payments.py`; every test here substitutes a canned callable.
"""

from __future__ import annotations

import hashlib
import hmac
import time

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.enums import UserRole
from app.models.payment_account import PaymentAccount
from app.models.signer_payment import SignerPayment
from app.models.user import User
from app.services.signer_payment_service import signer_payment_service
from app.services.stripe_connect_service import stripe_connect_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document
from app.tests.test_signer_payments import FakeStripe, add_payment_field, connect_stripe, setup_document
from app.tests.test_signing_correctness import add_field, add_recipient, send


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


def _second_org_headers(client: TestClient) -> dict[str, str]:
    """A second, unrelated tenant admin -- for tenant-isolation checks."""
    response = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Other Org",
            "name": "Other Admin",
            "email": "other-admin@example.com",
            "password": "strong-password",
        },
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _member_headers(client: TestClient, headers: dict[str, str]) -> dict[str, str]:
    """A non-admin user in the same org, for admin-only enforcement checks."""
    db = db_session(client)
    org_id = _org_id(client, headers)
    from app.core.security import hash_password

    user = User(
        organization_id=org_id,
        name="Just A Sender",
        email="sender@example.com",
        password_hash=hash_password("strong-password"),
        role=UserRole.sender,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token(subject=user.id)
    return {"Authorization": f"Bearer {token}"}


#: `conftest.py` deliberately blanks every Stripe credential so an
#: unconfigured provider is genuinely unconfigured; tests that need one set
#: it themselves via `monkeypatch.setenv`, exactly as `test_signer_payments.py`
#: does -- `_stripe_setting` falls back to the environment whenever the
#: cached `Settings` object holds a falsy value, so this reaches it without
#: needing to bust any cache.
TEST_WEBHOOK_SECRET = "whsec_test_fake"


def _connect_signature(raw_body: bytes, *, secret: str = TEST_WEBHOOK_SECRET) -> str:
    timestamp = str(int(time.time()))
    digest = hmac.new(secret.encode(), f"{timestamp}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def _payment_context(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]):
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="fixed", amount_cents=1500, currency="USD", memo="Deposit",
    )
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    add_field(client, document_id, headers, bob, "signature", "Bob signature", 400)
    connect_stripe(client, headers)
    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200
    return document_id, field_id, raw_token, tokens


# --------------------------------------------------------------- account


def test_account_endpoints_round_trip(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers = auth_headers(client)
    assert client.get("/api/payments/account", headers=headers).json() is None

    # Account creation and onboarding links go through Accounts v2 now (Stripe
    # rejects new connected accounts on v1) -- these two canned entries are
    # v2-shaped; the refresh below stays on v1, which Stripe still serves for
    # a v2-created account id.
    fake = FakeStripe(
        {
            "POST /v2/core/accounts": (200, {"id": "acct_new", "livemode": False, "configuration": {"merchant": {}}}),
            "POST /v2/core/account_links": (200, {"url": "https://connect.stripe.com/setup/xyz", "expires_at": "2026-01-01T00:05:00Z"}),
        }
    )
    monkeypatch.setattr(type(stripe_connect_service), "transport", staticmethod(fake))

    base_url = get_settings().app_base_url.rstrip("/")
    response = client.post(
        "/api/payments/account/link",
        json={
            "return_url": f"{base_url}/settings/payments",
            "refresh_url": f"{base_url}/settings/payments",
            "country": "US",
            "entity_type": "company",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["url"] == "https://connect.stripe.com/setup/xyz"

    got = client.get("/api/payments/account", headers=headers).json()
    assert got is not None
    assert got["provider_account_id"] == "acct_new"

    fake.responses["GET /v1/accounts/acct_new"] = (200, {"id": "acct_new", "charges_enabled": True, "payouts_enabled": True, "details_submitted": True, "livemode": False})
    refreshed = client.post("/api/payments/account/refresh", headers=headers)
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["charges_enabled"] is True

    deleted = client.delete("/api/payments/account", headers=headers)
    assert deleted.status_code == 204
    assert client.get("/api/payments/account", headers=headers).json() is None


def test_account_link_requires_country_and_entity_type_first_time(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers = auth_headers(client)
    fake = FakeStripe()
    monkeypatch.setattr(type(stripe_connect_service), "transport", staticmethod(fake))

    base_url = get_settings().app_base_url.rstrip("/")
    response = client.post(
        "/api/payments/account/link",
        json={"return_url": f"{base_url}/settings/payments", "refresh_url": f"{base_url}/settings/payments"},
        headers=headers,
    )
    assert response.status_code == 400, response.text
    # Never reaches Stripe -- caught before any transport call.
    assert not fake.calls


def test_account_link_does_not_require_country_and_entity_type_on_reconnect(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers = auth_headers(client)
    db = db_session(client)
    account = PaymentAccount(
        organization_id=_org_id(client, headers),
        provider="stripe",
        provider_account_id="acct_existing",
        charges_enabled=False,
        payouts_enabled=False,
        details_submitted=False,
    )
    db.add(account)
    db.commit()

    fake = FakeStripe(
        {
            "POST /v2/core/account_links": (
                200,
                {"url": "https://connect.stripe.com/setup/resume", "expires_at": "2026-01-01T00:05:00Z"},
            ),
        }
    )
    monkeypatch.setattr(type(stripe_connect_service), "transport", staticmethod(fake))

    base_url = get_settings().app_base_url.rstrip("/")
    response = client.post(
        "/api/payments/account/link",
        json={"return_url": f"{base_url}/settings/payments", "refresh_url": f"{base_url}/settings/payments"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["url"] == "https://connect.stripe.com/setup/resume"


def test_return_url_off_origin_is_rejected(client: TestClient, monkeypatch) -> None:
    headers = auth_headers(client)
    fake = FakeStripe()
    monkeypatch.setattr(type(stripe_connect_service), "transport", staticmethod(fake))

    response = client.post(
        "/api/payments/account/link",
        json={"return_url": "https://evil.example.com/steal", "refresh_url": "https://evil.example.com/steal"},
        headers=headers,
    )
    assert response.status_code == 400


# --------------------------------------------------------------- tenant isolation


def test_org_a_cannot_read_org_bs_document_payments(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers_a = auth_headers(client)
    document_id, field_id, raw_token, _ = _payment_context(client, pdf_bytes, headers_a)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    signer_payment_service.create_intent(db_session(client), raw_token=raw_token, field_id=field_id)

    headers_b = _second_org_headers(client)
    assert client.get(f"/api/documents/{document_id}/payments", headers=headers_b).status_code == 404
    assert client.get(f"/api/documents/{document_id}/payment-request", headers=headers_b).status_code == 404


def test_org_a_cannot_refund_org_bs_payment(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers_a = auth_headers(client)
    document_id, field_id, raw_token, _ = _payment_context(client, pdf_bytes, headers_a)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    signer_payment_service.create_intent(db_session(client), raw_token=raw_token, field_id=field_id)
    payment = db_session(client).query(SignerPayment).filter(SignerPayment.field_id == field_id).one()

    headers_b = _second_org_headers(client)
    response = client.post(f"/api/payments/{payment.id}/refund", json={}, headers=headers_b)
    assert response.status_code == 404


# --------------------------------------------------------------- refund is admin-only


def test_refund_is_admin_only(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers = auth_headers(client)
    document_id, field_id, raw_token, _ = _payment_context(client, pdf_bytes, headers)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    signer_payment_service.create_intent(db_session(client), raw_token=raw_token, field_id=field_id)
    payment = db_session(client).query(SignerPayment).filter(SignerPayment.field_id == field_id).one()

    member_headers = _member_headers(client, headers)
    response = client.post(f"/api/payments/{payment.id}/refund", json={}, headers=member_headers)
    assert response.status_code == 403


# --------------------------------------------------------------- webhook


def test_webhook_rejects_bad_signature(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(
        type(stripe_connect_service), "_connect_webhook_secret", lambda self: TEST_WEBHOOK_SECRET
    )
    body = b'{"id": "evt_1", "type": "account.updated", "data": {"object": {"id": "acct_x"}}}'
    response = client.post(
        "/api/webhooks/stripe/connect", content=body, headers={"Stripe-Signature": "t=1,v1=deadbeef"}
    )
    assert response.status_code == 400


def test_webhook_idempotent_on_redelivery(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    # `_connect_webhook_secret` reads the cached `Settings` object directly
    # (not through `_stripe_setting`'s env fallback), so the secret has to be
    # patched on the service itself rather than via `monkeypatch.setenv`.
    monkeypatch.setattr(
        type(stripe_connect_service), "_connect_webhook_secret", lambda self: TEST_WEBHOOK_SECRET
    )
    headers = auth_headers(client)
    document_id, field_id, raw_token, _ = _payment_context(client, pdf_bytes, headers)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    signer_payment_service.create_intent(db_session(client), raw_token=raw_token, field_id=field_id)
    payment = db_session(client).query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
    pi_id = payment.provider_payment_intent_id

    body = (
        '{"id": "evt_pi_1", "type": "payment_intent.succeeded", '
        '"data": {"object": {"id": "%s", "status": "succeeded", '
        '"charges": {"data": [{"id": "ch_1", "receipt_url": "https://example.com/r"}]}}}}' % pi_id
    ).encode()
    headers_sig = {"Stripe-Signature": _connect_signature(body)}

    first = client.post("/api/webhooks/stripe/connect", content=body, headers=headers_sig)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "processed"

    second = client.post("/api/webhooks/stripe/connect", content=body, headers=headers_sig)
    assert second.status_code == 200
    assert second.json()["status"] == "duplicate"

    db = db_session(client)
    db.expire_all()
    row = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
    assert row.status == "succeeded"


# --------------------------------------------------------------- signer-token surface


def test_signer_intent_requires_a_valid_token(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token, _ = _payment_context(client, pdf_bytes, headers)

    response = client.post(f"/api/sign/not-a-real-token/payments/{field_id}/intent", json={})
    assert response.status_code == 404


def test_signer_intent_reachable_with_valid_token(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers = auth_headers(client)
    document_id, field_id, raw_token, _ = _payment_context(client, pdf_bytes, headers)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))

    response = client.post(f"/api/sign/{raw_token}/payments/{field_id}/intent", json={})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["amount_cents"] == 1500
    assert body["client_secret"]


def test_signer_cannot_create_intent_for_another_recipients_field(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    """A signer's token must never reach a payment field allocated to someone else.

    Both recipients are given the same (parallel) signing order so both
    tokens are immediately usable -- the point of this test is the
    field-ownership check, not the signing-order gate.
    """
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com", order=1)
    bob = add_recipient(client, document_id, headers, "Bob", "bob@example.com", order=1)
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="fixed", amount_cents=1500, currency="USD", memo="Deposit",
    )
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    add_field(client, document_id, headers, bob, "signature", "Bob signature", 400)
    connect_stripe(client, headers)

    tokens = send(client, document_id, headers)
    bob_token = tokens["bob@example.com"]
    assert client.post(f"/api/sign/{bob_token}/consent").status_code == 200

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))

    response = client.post(f"/api/sign/{bob_token}/payments/{field_id}/intent", json={})
    assert response.status_code == 403  # "Signer cannot edit another recipient's field"
