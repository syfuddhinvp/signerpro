"""Accounts v2 migration coverage: the v2 create/link calls, the
``accounts_v2_access_blocked`` operator message, and Stripe failures
surfacing as a clean 4xx/502 through a real request rather than a 500.

Nothing touches the network -- ``StripeConnectService.transport`` is the same
injectable seam ``test_stripe_connect.py`` uses.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.organization import Organization
from app.services.billing_service import StripeApiError
from app.services.stripe_connect_service import StripeConnectService
from app.tests.conftest import auth_headers


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _organization(client: TestClient, headers: dict[str, str]) -> tuple[Organization, object]:
    org_id = client.get("/api/auth/me", headers=headers).json()["organization_id"]
    db, _ = _db()
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


def test_accounts_v2_access_blocked_gets_an_actionable_message(
    client: TestClient, connect_service: StripeConnectService, monkeypatch
):
    headers = auth_headers(client)
    organization, db = _organization(client, headers)

    def fake(method, url, params, headers):
        return 400, {"error": {"code": "accounts_v2_access_blocked", "message": "Accounts v2 is not enabled."}}

    monkeypatch.setattr(StripeConnectService, "transport", staticmethod(fake))

    with pytest.raises(StripeApiError) as excinfo:
        connect_service.ensure_account(
            db, organization=organization, country="US", entity_type="company"
        )
    # Not Stripe's raw string -- ours, naming the dashboard setting.
    assert "Dashboard" in str(excinfo.value)
    assert "Connect" in str(excinfo.value)
    assert excinfo.value.code == "accounts_v2_access_blocked"


def test_stripe_400_surfaces_as_4xx_not_500(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers = auth_headers(client)

    def fake(method, url, params, headers):
        return 400, {"error": {"code": "parameter_invalid", "message": "Invalid display_name."}}

    from app.services.stripe_connect_service import stripe_connect_service

    monkeypatch.setattr(type(stripe_connect_service), "transport", staticmethod(fake))

    from app.core.config import get_settings

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
    assert 400 <= response.status_code < 500, response.text
    assert "Invalid display_name" in response.json()["detail"]


def test_stripe_5xx_surfaces_as_502(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    headers = auth_headers(client)

    def fake(method, url, params, headers):
        return 503, {"error": {"message": "Stripe is temporarily unavailable."}}

    from app.services.stripe_connect_service import stripe_connect_service

    monkeypatch.setattr(type(stripe_connect_service), "transport", staticmethod(fake))

    from app.core.config import get_settings

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
    assert response.status_code == 502, response.text
    assert "sk_test_fake" not in response.text


def test_v2_create_sends_the_required_responsibilities_defaults(
    client: TestClient, connect_service: StripeConnectService, monkeypatch
):
    """`defaults.responsibilities` is required, and its values are a policy.

    Stripe rejects a merchant-configured v2 account outright when
    `fees_collector`/`losses_collector` are missing -- which is how this
    shipped broken once: every test passed because none of them looked at
    the request body.

    The values are asserted, not just their presence. `stripe` for both
    means Stripe bills its fees to the tenant and Stripe carries a negative
    balance; flipping either to `application` would quietly move every
    tenant's chargeback liability onto this platform, for a transaction it
    takes no cut of.
    """
    headers = auth_headers(client)
    organization, db = _organization(client, headers)
    sent: dict = {}

    def fake(method, url, params, headers):
        sent["url"] = url
        sent["params"] = params
        return 200, {
            "id": "acct_v2_resp",
            "object": "v2.core.account",
            "livemode": False,
            "configuration": {"merchant": {"capabilities": {"card_payments": {"status": "active"}}}},
        }

    monkeypatch.setattr(StripeConnectService, "transport", staticmethod(fake))
    connect_service.ensure_account(db, organization=organization, country="US", entity_type="company")

    assert sent["url"].endswith("/v2/core/accounts")
    responsibilities = sent["params"]["defaults"]["responsibilities"]
    assert responsibilities == {"fees_collector": "stripe", "losses_collector": "stripe"}
    # Pinned together deliberately: `losses_collector: "stripe"` is only a
    # GA combination alongside the full Stripe Dashboard. Paired with
    # `dashboard: "express"` it needs the `2026-08-26.preview` API version,
    # and on a GA version Stripe refuses the whole account with "This
    # account configuration is not supported" -- which is not an obvious
    # error to trace back to a one-word change here.
    assert sent["params"]["dashboard"] == "full"
    # Asked for back, or the created row cannot read its own defaults.
    assert "defaults" in sent["params"]["include"]
