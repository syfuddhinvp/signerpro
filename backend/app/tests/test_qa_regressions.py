"""Regressions for defects a green suite did not catch.

Each test here failed against the code as it stood before its fix. They are
grouped by the defect rather than by module, because the point of each one is
the specific hole, not the surface it happens to sit behind.
"""

import hashlib
import hmac
import json
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.mixins import now_utc
from app.services import formula_service
from app.tests.conftest import auth_headers, upgrade_plan


# ---------------------------------------------------------------------------
# 1. The Stripe webhook header
# ---------------------------------------------------------------------------


def test_stripe_signature_header_is_accepted(client: TestClient, monkeypatch) -> None:
    """Stripe signs into ``Stripe-Signature``; the route only read ``X-Signature``.

    Every existing billing-webhook test used the simulated provider and its
    ``X-Signature`` header, so the suite was green while no real Stripe event
    could ever be processed in production -- no activations, no ``past_due``,
    no cancellations.
    """
    from app.services.billing_service import StripePaymentProvider, billing_service

    provider = StripePaymentProvider(secret_key="sk_test_fake", webhook_secret="whsec_fake")
    monkeypatch.setattr(billing_service, "_provider", provider, raising=False)

    payload = json.dumps({"id": "evt_hdr_1", "type": "ping", "data": {"object": {}}}).encode()
    timestamp = str(int(now_utc().timestamp()))
    digest = hmac.new(b"whsec_fake", f"{timestamp}.".encode() + payload, hashlib.sha256).hexdigest()

    response = client.post(
        "/api/billing/webhook",
        content=payload,
        headers={
            "Stripe-Signature": f"t={timestamp},v1={digest}",
            "content-type": "application/json",
        },
    )
    assert response.status_code != 401, "a validly-signed Stripe event was rejected"
    assert response.status_code == 200, response.text


def test_x_signature_header_still_accepted(client: TestClient) -> None:
    """The simulated provider's header keeps working; neither depends on the other."""
    from app.tests.test_entitlements import sign_webhook_body  # type: ignore[attr-defined]

    raw = json.dumps({"id": "evt_hdr_2", "type": "ping", "data": {}}).encode()
    response = client.post(
        "/api/billing/webhook", content=raw, headers={"X-Signature": sign_webhook_body(raw)}
    )
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# 2. Non-finite numbers in a contract total
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("literal", ["NaN", "Infinity", "-Infinity"])
def test_non_finite_values_are_not_numbers(literal: str) -> None:
    """``Decimal`` parses all of these. None of them is money.

    ``NaN`` was the dangerous one: it did not raise, so it flowed through the
    arithmetic and stamped the literal string "NaN" into an executed contract
    as the total. ``Infinity`` instead blew up ``quantize`` and 500'd the
    signing endpoint.
    """
    assert formula_service._to_decimal(literal) is None
    assert formula_service.format_currency(literal) is None


def test_unquantizable_magnitudes_are_rejected_too() -> None:
    """``Decimal("1e999").is_finite()`` is True, so the finite check does not
    catch it -- it only refuses at ``quantize``, which is why ``_format`` has
    to be total rather than raising."""
    assert formula_service._to_decimal("1e999") is not None  # genuinely "finite"
    assert formula_service.format_currency("1e999") is None
    assert formula_service.evaluate("{{a}} + 1", {"a": "1e999"}) is None


def test_formula_over_non_finite_input_is_blank_not_a_crash() -> None:
    """The whole evaluate() path, not just the parser: blank field, no exception."""
    assert formula_service.evaluate("{{a}} + 1", {"a": "Infinity"}) is None
    assert formula_service.evaluate("{{a}} + 1", {"a": "NaN"}) is None
    # A real number still computes, so the guard did not swallow the feature.
    assert formula_service.evaluate("{{a}} + 1", {"a": "41"}) == "42.00"


def test_format_is_inside_the_error_guard() -> None:
    """``_format`` quantizes, and quantize raises on a value past the context
    precision. Sitting outside the try, it turned bad data into a 500."""
    huge = "9" * 200
    result = formula_service.evaluate("{{a}} * {{b}}", {"a": huge, "b": huge})
    assert result is None or Decimal(result.replace(",", "")).is_finite()


# ---------------------------------------------------------------------------
# 3. The envelope quota bypass via is_template
# ---------------------------------------------------------------------------


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


def _exhaust_envelope_quota(client: TestClient, headers: dict[str, str]) -> None:
    """Create real documents until the plan says no."""
    for index in range(500):
        response = client.post(
            "/api/documents", json={"title": f"filler {index}"}, headers=headers
        )
        if response.status_code == 402:
            return
        assert response.status_code == 201, response.text
    pytest.fail("never hit the envelope quota; the plan limit may have changed")


def test_flipping_a_template_to_a_document_is_charged(client: TestClient) -> None:
    """Templates skip the quota at creation, which made the flag a way around it.

    Create as a template (no check, no metering), then PATCH it back to a real
    document: an org over its limit could send unlimited envelopes, and none of
    them appeared in the usage report.
    """
    headers = auth_headers(client)
    _exhaust_envelope_quota(client, headers)

    created = client.post(
        "/api/documents", json={"title": "smuggled", "is_template": True}, headers=headers
    )
    assert created.status_code == 201, "templates should still be exempt at creation"
    document_id = created.json()["id"]

    flipped = client.patch(
        f"/api/documents/{document_id}", json={"is_template": False}, headers=headers
    )
    assert flipped.status_code == 402, (
        f"an over-quota org converted a template into a billable document: {flipped.status_code}"
    )

    unchanged = client.get(f"/api/documents/{document_id}", headers=headers).json()
    assert unchanged["is_template"] is True, "the flip was rejected but still applied"


def test_flipping_within_quota_records_usage(client: TestClient) -> None:
    """The conversion is billable, so it must also be metered -- not merely allowed."""
    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")

    created = client.post(
        "/api/documents", json={"title": "promoted", "is_template": True}, headers=headers
    )
    assert created.status_code == 201, created.text
    document_id = created.json()["id"]

    before = client.get("/api/billing/usage", headers=headers).json()
    flipped = client.patch(
        f"/api/documents/{document_id}", json={"is_template": False}, headers=headers
    )
    assert flipped.status_code == 200, flipped.text
    after = client.get("/api/billing/usage", headers=headers).json()

    assert after != before, "the converted document was never metered"


def test_template_to_template_patch_is_not_double_charged(client: TestClient) -> None:
    """Re-asserting the current value must not bill for a conversion that
    did not happen."""
    headers = auth_headers(client)
    upgrade_plan(client, headers, "business")

    created = client.post(
        "/api/documents", json={"title": "still a template", "is_template": True}, headers=headers
    )
    document_id = created.json()["id"]

    before = client.get("/api/billing/usage", headers=headers).json()
    response = client.patch(
        f"/api/documents/{document_id}", json={"is_template": True}, headers=headers
    )
    assert response.status_code == 200, response.text
    assert client.get("/api/billing/usage", headers=headers).json() == before


# ---------------------------------------------------------------------------
# 4. Delivery failures that used to be silent
# ---------------------------------------------------------------------------


def test_email_send_reports_provider_failure(monkeypatch) -> None:
    """A configured provider that fails must not look like a successful send."""
    from app.core import email as email_module

    settings = email_module.get_settings()
    monkeypatch.setattr(settings, "resend_api_key", None, raising=False)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com", raising=False)
    monkeypatch.setattr(settings, "smtp_from_email", "no-reply@example.com", raising=False)

    def explode(*args, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(email_module.smtplib, "SMTP", explode)

    delivered = email_module.email_service.send(
        email_module.EmailMessage(to_email="x@example.com", subject="s", body="b")
    )
    assert delivered is False, "a dead SMTP server reported success"


def test_email_send_with_no_provider_is_truthful(monkeypatch) -> None:
    """With nothing configured the console fallback IS the intended delivery."""
    from app.core import email as email_module

    settings = email_module.get_settings()
    monkeypatch.setattr(settings, "resend_api_key", None, raising=False)
    monkeypatch.setattr(settings, "smtp_host", None, raising=False)

    assert (
        email_module.email_service.send(
            email_module.EmailMessage(to_email="x@example.com", subject="s", body="b")
        )
        is True
    )


def test_sms_send_reports_provider_failure(monkeypatch) -> None:
    from app.services import sms_service as sms_module

    settings = sms_module.get_settings()
    monkeypatch.setattr(settings, "twilio_account_sid", "AC_fake", raising=False)
    monkeypatch.setattr(settings, "twilio_auth_token", "token", raising=False)
    monkeypatch.setattr(settings, "twilio_from_number", "+15550000000", raising=False)

    def explode(*args, **kwargs):
        raise OSError("connection refused")

    monkeypatch.setattr(sms_module.httpx, "post", explode)

    delivered = sms_module.sms_service.send_sms(to_phone="+15551234567", body="code")
    assert delivered is False, "a dead SMS provider reported success"


def test_sms_send_with_no_provider_is_truthful(monkeypatch) -> None:
    from app.services import sms_service as sms_module

    settings = sms_module.get_settings()
    monkeypatch.setattr(settings, "twilio_account_sid", None, raising=False)
    monkeypatch.setattr(settings, "twilio_auth_token", None, raising=False)
    monkeypatch.setattr(settings, "twilio_from_number", None, raising=False)

    assert sms_module.sms_service.send_sms(to_phone="+15551234567", body="code") is True


def test_a_poisoned_value_does_not_permanently_brick_the_document() -> None:
    """The 500 was not confined to the write that caused it.

    ``recompute_formulas`` re-evaluates every formula on the document on
    *every* subsequent ``save_field_value``, and caught only ``FormulaError``.
    So once a non-finite value was stored in a referenced field, each later
    save raised again and the envelope became permanently unsignable -- not one
    failed request, a dead document. This drives the recompute path twice, the
    way a second signer's save would.
    """
    from types import SimpleNamespace

    from app.models.enums import FieldType
    from app.services.field_service import field_service

    added: list = []
    db = SimpleNamespace(add=added.append)

    source = SimpleNamespace(
        merge_tag="a", type=FieldType.text, value="1e999", options=None, label="Amount"
    )
    total = SimpleNamespace(
        merge_tag="total",
        type=FieldType.formula,
        value=None,
        options={"expression": "{{a}} + 1"},
        label="Total",
    )
    document = SimpleNamespace(fields=[source, total])

    for pass_number in (1, 2):
        field_service.recompute_formulas(db, document)  # must not raise
        assert total.value is None, f"pass {pass_number} stamped {total.value!r} as a total"

    # And the document is not poisoned: a real number still computes afterwards.
    source.value = "41"
    field_service.recompute_formulas(db, document)
    assert total.value == "42.00"
