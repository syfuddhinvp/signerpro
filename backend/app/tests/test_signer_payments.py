"""Pay-then-sign (PAY-1): allocation, direct-charge intents, and the gate.

Nothing touches the network: `SignerPaymentService.transport` is the same
injectable seam `StripePaymentProvider`/`StripeConnectService` use, and every
test here substitutes a canned callable for it (see `FakeStripe` below,
modelled on the one in `test_billing_enforcement.py`).
"""

from datetime import datetime, timezone

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.core.database import get_db
from app.models.document import Document
from app.models.field import Field
from app.models.payment_account import PaymentAccount
from app.models.recipient import Recipient
from app.models.signer_payment import SignerPayment
from app.schemas.payment import PaymentAllocationInput, PaymentRequestCreate
from app.services.signer_payment_service import signer_payment_service
from app.services.signing_service import signing_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document, token_from_link
from app.tests.test_signing_correctness import add_field, add_recipient, send


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def _org_id(client: TestClient, headers: dict[str, str]) -> str:
    return client.get("/api/auth/me", headers=headers).json()["organization_id"]


def connect_stripe(client: TestClient, headers: dict[str, str]) -> None:
    """Give the tenant a payable connected account, bypassing onboarding."""
    db = db_session(client)
    account = PaymentAccount(
        organization_id=_org_id(client, headers),
        provider="stripe",
        provider_account_id="acct_fake",
        charges_enabled=True,
        payouts_enabled=True,
        details_submitted=True,
    )
    db.add(account)
    db.commit()


def add_payment_field(
    client: TestClient,
    document_id: str,
    headers: dict[str, str],
    recipient_id: str,
    label: str,
    y: int,
    **options,
) -> str:
    return add_field(client, document_id, headers, recipient_id, "payment", label, y, options=options)


class FakeStripe:
    """Canned Stripe responses, keyed like `test_billing_enforcement.FakeStripe`."""

    def __init__(self, responses: dict[str, tuple[int, dict] | list[tuple[int, dict]]] | None = None) -> None:
        self.responses = responses or {}
        self.calls: list[tuple[str, str, dict, dict]] = []
        self._next_pi = 0

    def __call__(self, method, url, params, headers):
        path = url.split("api.stripe.com", 1)[-1]
        self.calls.append((method, path, params, headers))
        canned = self.responses.get(f"{method} {path}", self.responses.get(path))
        if canned is not None:
            if isinstance(canned, list):
                return canned.pop(0) if len(canned) > 1 else canned[0]
            return canned
        if method == "POST" and path == "/v1/payment_intents":
            self._next_pi += 1
            pi_id = f"pi_{self._next_pi}"
            return (200, {"id": pi_id, "client_secret": f"{pi_id}_secret", "status": "requires_payment_method"})
        if method == "GET" and path.startswith("/v1/payment_intents/"):
            pi_id = path.rsplit("/", 1)[-1]
            return (200, {"id": pi_id, "client_secret": f"{pi_id}_secret", "status": "requires_payment_method"})
        if method == "POST" and path == "/v1/refunds":
            return (200, {"id": "re_1", "amount": params.get("amount")})
        return (200, {"id": "obj_default"})

    def payment_intent_calls(self) -> list[tuple[str, str, dict, dict]]:
        return [call for call in self.calls if call[1] == "/v1/payment_intents" and call[0] == "POST"]


def setup_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str], *, second_recipient_role: str = "sign"):
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com", order=1)
    bob = add_recipient(client, document_id, headers, "Bob", "bob@example.com", role=second_recipient_role, order=2)
    return document_id, alice, bob


# --------------------------------------------------------------- sync_request


def test_equal_split_sums_exactly_to_the_total_including_the_remainder_cent(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    carol = add_recipient(client, document_id, headers, "Carol", "carol@example.com", order=3)
    for recipient_id, name in [(alice, "Alice pay"), (bob, "Bob pay"), (carol, "Carol pay")]:
        add_payment_field(client, document_id, headers, recipient_id, name, 500)

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=1000,  # not evenly divisible by 3
        split_mode="equal",
        allocations=[
            PaymentAllocationInput(recipient_id=alice, amount_cents=0),
            PaymentAllocationInput(recipient_id=bob, amount_cents=0),
            PaymentAllocationInput(recipient_id=carol, amount_cents=0),
        ],
    )
    payment_request = signer_payment_service.sync_request(db, document=document, payload=payload)
    assert payment_request.total_cents == 1000

    db.refresh(document)
    amounts = {
        field.recipient_id: field.options["amount_cents"]
        for field in document.fields
        if field.type == "payment"
    }
    assert sum(amounts.values()) == 1000
    # Remainder cent(s) go to the earliest recipients.
    assert amounts[alice] in (334, 333)
    assert sorted(amounts.values(), reverse=True)[0] - sorted(amounts.values())[0] <= 1


def test_custom_split_rejected_when_it_does_not_sum_to_the_total(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    add_payment_field(client, document_id, headers, alice, "Alice pay", 500)
    add_payment_field(client, document_id, headers, bob, "Bob pay", 500)

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=1000,
        split_mode="custom",
        allocations=[
            PaymentAllocationInput(recipient_id=alice, amount_cents=400),
            PaymentAllocationInput(recipient_id=bob, amount_cents=400),  # 800 != 1000
        ],
    )
    try:
        signer_payment_service.sync_request(db, document=document, payload=payload)
        assert False, "expected a 400 for a mismatched custom split"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_a_cc_recipient_cannot_be_allocated_money(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    add_payment_field(client, document_id, headers, alice, "Alice pay", 500)

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=500,
        split_mode="single",
        allocations=[PaymentAllocationInput(recipient_id=bob, amount_cents=500)],
    )
    try:
        signer_payment_service.sync_request(db, document=document, payload=payload)
        assert False, "expected a 400 for allocating money to a CC recipient"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_allocation_forces_fixed_mode_even_on_a_signer_entered_field(client: TestClient, pdf_bytes: bytes) -> None:
    """An allocation is an obligation, not a choice: `sync_request` must not
    leave a `signer_entered` field free to be paid at whatever the signer
    types in, once it has been given a share of a split.
    """
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    add_payment_field(
        client, document_id, headers, alice, "Alice pay", 500,
        amount_mode="signer_entered", min_cents=50, max_cents=None,
    )

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=333, split_mode="single",
        allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=333)],
    )
    signer_payment_service.sync_request(db, document=document, payload=payload)

    db.refresh(document)
    field = next(f for f in document.fields if f.type == "payment" and f.recipient_id == alice)
    assert field.options["amount_mode"] == "fixed"
    assert field.options["amount_cents"] == 333


def test_allocation_forces_required_true_even_on_a_field_authored_optional(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """THE HOLE: `outstanding_payment_fields` (the settlement gate) only
    considers `required` fields. A payment field authored `required=False`
    that is then handed an allocation by `sync_request` must have `required`
    flipped to `True` -- an allocation is an obligation, and the obligation
    and the gate must never be able to disagree.
    """
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    field_id = add_field(
        client, document_id, headers, alice, "payment", "Alice pay", 500,
        required=False,
        options={"amount_mode": "fixed", "amount_cents": 1500, "currency": "USD"},
    )

    db = db_session(client)
    field = db.get(Field, field_id)
    assert field.required is False  # authored optional

    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=2000, split_mode="single",
        allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=2000)],
    )
    signer_payment_service.sync_request(db, document=document, payload=payload)

    db.refresh(field)
    assert field.required is True, "an allocated field must be forced required, whatever it was authored as"

    # And it must now genuinely appear in the settlement gate's own view of
    # this recipient's outstanding payment fields.
    db.refresh(document)
    recipient = db.get(Recipient, alice)
    outstanding_ids = {f.id for f in signer_payment_service.outstanding_payment_fields(document, recipient)}
    assert field_id in outstanding_ids


def test_allocation_requires_an_existing_payment_field(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    # No payment field placed for Alice at all.

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=500,
        split_mode="single",
        allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=500)],
    )
    try:
        signer_payment_service.sync_request(db, document=document, payload=payload)
        assert False, "expected a 400 when the recipient has no payment field"
    except HTTPException as exc:
        assert exc.status_code == 400


# ----------------------------------------------------------- signer side


def _signing_context(client, pdf_bytes, headers, *, amount_mode="fixed", amount_cents=1500, min_cents=None, max_cents=None):
    # `bob` is only along here as a second recipient; giving him a `sign`
    # role but no fields of his own is a fixture bug (`validate_for_send`
    # rightly refuses to send an envelope where a signing recipient has
    # nothing to do), so he is a `copy` recipient instead -- present on the
    # envelope, no obligation, exactly like every other `_signing_context`
    # test needs him to be.
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    options = {"amount_mode": amount_mode, "currency": "USD", "memo": "Deposit"}
    if amount_mode == "fixed":
        options["amount_cents"] = amount_cents
    else:
        options["min_cents"] = min_cents
        options["max_cents"] = max_cents
    field_id = add_payment_field(client, document_id, headers, alice, "Deposit", 500, **options)
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    connect_stripe(client, headers)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200
    return document_id, field_id, raw_token


def test_create_intent_succeeds_with_an_empty_publishable_key_when_the_server_has_none(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The server cannot know whether the signer's browser already holds
    `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, so an unset server-side
    `STRIPE_PUBLISHABLE_KEY` must NOT block the PaymentIntent from being
    created. It returns with an empty `publishable_key`, leaving the client
    free to fall back to its own copy of the (same) platform key.

    "Unset" has to mean unset in BOTH places the key can come from:
    `os.environ`, which `Settings.stripe_publishable_key` layers on top, and
    the declared `stripe_publishable_key_configured` field that pydantic
    resolved from the environment (or `.env`) when the cached `Settings` was
    built. Deleting only the env var left the field holding `conftest.py`'s
    placeholder, so the key would still resolve. `monkeypatch` restores both
    after this test.
    """
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(client, pdf_bytes, headers, amount_mode="fixed", amount_cents=1500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    monkeypatch.delenv("STRIPE_PUBLISHABLE_KEY", raising=False)
    monkeypatch.setattr(get_settings(), "stripe_publishable_key_configured", None)

    db = db_session(client)
    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    assert intent.publishable_key == ""
    assert intent.client_secret  # the intent itself is still valid


def test_create_intent_returns_the_publishable_key_when_configured(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(client, pdf_bytes, headers, amount_mode="fixed", amount_cents=1500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    monkeypatch.setenv("STRIPE_PUBLISHABLE_KEY", "pk_test_fake")
    monkeypatch.setattr(get_settings(), "stripe_publishable_key_configured", "pk_test_fake")

    db = db_session(client)
    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    assert intent.publishable_key == "pk_test_fake"


def test_fixed_field_ignores_a_client_supplied_amount(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(client, pdf_bytes, headers, amount_mode="fixed", amount_cents=1500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id, amount_cents=999999)
    assert intent.amount_cents == 1500  # the field's amount, not the body's

    _, _, sent_params, _ = fake.payment_intent_calls()[0]
    assert sent_params["amount"] == "1500"
    assert "application_fee_amount" not in sent_params


def test_signer_entered_amount_is_clamped_to_field_bounds(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(
        client, pdf_bytes, headers, amount_mode="signer_entered", min_cents=500, max_cents=2000
    )
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    try:
        signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id, amount_cents=50)
        assert False, "expected a 400 below the field minimum"
    except HTTPException as exc:
        assert exc.status_code == 400

    try:
        signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id, amount_cents=9999999)
        assert False, "expected a 400 above the field maximum"
    except HTTPException as exc:
        assert exc.status_code == 400


def test_signer_entered_amount_within_bounds_is_accepted(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(
        client, pdf_bytes, headers, amount_mode="signer_entered", min_cents=500, max_cents=2000
    )
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id, amount_cents=1200)
    assert intent.amount_cents == 1200


def test_allocated_signer_entered_field_charges_the_full_allocation_not_the_minimum(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The money-shortfall attack: a signer allocated 333 of a split must not
    be able to walk away paying Stripe's 50-cent floor.
    """
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="signer_entered", min_cents=50, max_cents=None, currency="USD",
    )
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    connect_stripe(client, headers)

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=333, split_mode="single",
        allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=333)],
    )
    signer_payment_service.sync_request(db, document=document, payload=payload)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    # A fresh session: `send`/`consent` committed on their own sessions, and
    # this one's identity map would otherwise still show the pre-send state.
    db = db_session(client)
    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id, amount_cents=50)
    assert intent.amount_cents == 333, "the signer must be charged their full allocation, not the 50-cent floor"

    _, _, sent_params, _ = fake.payment_intent_calls()[0]
    assert sent_params["amount"] == "333"


def test_defence_in_depth_charges_allocation_even_if_options_still_claim_signer_entered(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A field whose `options` were written straight through the fields API
    (bypassing `sync_request`) could still claim `signer_entered` while
    carrying a `payment_request_id` + `amount_cents`. `create_intent` must
    charge the allocation regardless of the stale mode.
    """
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="signer_entered", min_cents=50, max_cents=None, currency="USD",
    )
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    connect_stripe(client, headers)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200

    db = db_session(client)
    field = db.get(Field, field_id)
    # Simulate options written directly (not through `sync_request`): mode
    # still `signer_entered`, but an allocation is present.
    field.options = {
        "amount_mode": "signer_entered",
        "amount_cents": 333,
        "min_cents": 50,
        "currency": "USD",
        "payment_request_id": "preq_stale",
    }
    db.add(field)
    db.commit()

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id, amount_cents=50)
    assert intent.amount_cents == 333

    _, _, sent_params, _ = fake.payment_intent_calls()[0]
    assert sent_params["amount"] == "333"


def test_double_create_intent_reuses_one_intent_and_idempotency_key(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(client, pdf_bytes, headers)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    first = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    second = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)

    assert first.client_secret == second.client_secret
    creates = fake.payment_intent_calls()
    assert len(creates) == 1, "a double-click must not create a second PaymentIntent"
    idem_keys = {call[3].get("Idempotency-Key") for call in fake.calls if call[1] == "/v1/payment_intents"}
    assert len(idem_keys) == 1 and None not in idem_keys

    rows = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).all()
    assert len(rows) == 1


def test_webhook_idempotency_on_redelivery(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(client, pdf_bytes, headers)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    row = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
    pi_id = row.provider_payment_intent_id

    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": pi_id, "status": "succeeded", "charges": {"data": [{"id": "ch_1", "receipt_url": "https://example.com/r"}]}}},
    }
    first = signer_payment_service.apply_webhook_event(db, event=event)
    assert first.status == "succeeded"
    paid_at_first = first.paid_at

    second = signer_payment_service.apply_webhook_event(db, event=event)
    assert second.status == "succeeded"
    assert second.paid_at == paid_at_first  # untouched by the redelivery

    field = db.get(Field, field_id)
    assert field.value == f"paid:{pi_id}"


def test_assert_payments_settled_gate(client: TestClient, pdf_bytes: bytes, monkeypatch) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(client, pdf_bytes, headers)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    signing_token, document, recipient = signing_service.load_session(db, raw_token=raw_token)

    try:
        signer_payment_service.assert_payments_settled(db, document=document, recipient=recipient)
        assert False, "expected 402 before payment settles"
    except HTTPException as exc:
        assert exc.status_code == 402

    signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    row = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
    }
    signer_payment_service.apply_webhook_event(db, event=event)

    db.refresh(document)
    signer_payment_service.assert_payments_settled(db, document=document, recipient=recipient)  # no raise


def test_a_forged_field_value_does_not_satisfy_the_settlement_gate(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token = _signing_context(client, pdf_bytes, headers)

    # The generic field-value endpoint refuses to write to a payment field at
    # all now -- that hole is closed outright, not just papered over by the
    # settlement gate below.
    response = client.post(
        f"/api/sign/{raw_token}/fields/{field_id}/value",
        json={"value": "paid:pi_fake"},
    )
    assert response.status_code == 400, response.text

    db = db_session(client)
    signing_token, document, recipient = signing_service.load_session(db, raw_token=raw_token)

    # Belt-and-suspenders: even if a value were forged onto the field some
    # other way (bypassing the endpoint entirely, e.g. a direct db write),
    # the gate must still refuse to trust `Field.value` and must consult the
    # `SignerPayment` table instead.
    field = db.get(Field, field_id)
    field.value = "paid:pi_fake"
    db.add(field)
    db.commit()

    try:
        signer_payment_service.assert_payments_settled(db, document=document, recipient=recipient)
        assert False, "a forged Field.value must not satisfy the payment gate"
    except HTTPException as exc:
        assert exc.status_code == 402


# --------------------------------------------------------- amount_owed / settled_payment


def _paid_field_and_row(client, pdf_bytes, headers, monkeypatch, *, amount_cents, amount_mode="fixed", min_cents=None, max_cents=None):
    document_id, field_id, raw_token = _signing_context(
        client, pdf_bytes, headers, amount_mode=amount_mode, amount_cents=amount_cents,
        min_cents=min_cents, max_cents=max_cents,
    )
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    return document_id, field_id, raw_token, fake


def test_amount_owed_is_none_for_pure_signer_entered_and_exact_for_fixed(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    open_field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="signer_entered", min_cents=50, max_cents=None, currency="USD",
    )
    fixed_field_id = add_payment_field(
        client, document_id, headers, alice, "Second deposit", 600,
        amount_mode="fixed", amount_cents=1500, currency="USD",
    )

    db = db_session(client)
    open_field = db.get(Field, open_field_id)
    fixed_field = db.get(Field, fixed_field_id)
    assert signer_payment_service.amount_owed(open_field) is None
    assert signer_payment_service.amount_owed(fixed_field) == 1500


def test_settled_payment_rejects_a_succeeded_amount_below_what_is_owed(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The most important test in the set: a succeeded row that is short of
    the allocation must not settle the gate, and one that meets it must.
    """
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="signer_entered", min_cents=50, max_cents=None, currency="USD",
    )
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    connect_stripe(client, headers)

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=333, split_mode="single",
        allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=333)],
    )
    signer_payment_service.sync_request(db, document=document, payload=payload)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200

    field = db.get(Field, field_id)

    # A succeeded payment that falls short of the 333-cent allocation (e.g. a
    # forged/legacy row for the Stripe minimum) must not settle the field.
    short = SignerPayment(
        organization_id=document.organization_id,
        document_id=document.id,
        recipient_id=alice,
        field_id=field_id,
        amount_cents=50,
        currency="USD",
        status="succeeded",
        provider="stripe",
    )
    db.add(short)
    db.commit()
    assert signer_payment_service.settled_payment(db, field=field) is None

    recipient = db.get(Recipient, alice)
    try:
        signer_payment_service.assert_payments_settled(db, document=document, recipient=recipient)
        assert False, "a short payment must not satisfy the gate"
    except HTTPException as exc:
        assert exc.status_code == 402

    # A succeeded payment that meets the allocation does settle it.
    full = SignerPayment(
        organization_id=document.organization_id,
        document_id=document.id,
        recipient_id=alice,
        field_id=field_id,
        amount_cents=333,
        currency="USD",
        status="succeeded",
        provider="stripe",
    )
    db.add(full)
    db.commit()
    settled = signer_payment_service.settled_payment(db, field=field)
    assert settled is not None and settled.id == full.id


def test_settled_payment_ignores_a_succeeded_row_reduced_below_owed_by_refund(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers = auth_headers(client)
    document_id, field_id, raw_token, fake = _paid_field_and_row(
        client, pdf_bytes, headers, monkeypatch, amount_cents=1500
    )
    db = db_session(client)
    field = db.get(Field, field_id)

    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    row = db.query(SignerPayment).filter_by(field_id=field_id).one()
    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
    }
    signer_payment_service.apply_webhook_event(db, event=event)

    db.refresh(row)
    assert signer_payment_service.settled_payment(db, field=field) is not None

    # A partial refund that leaves net amount below what is owed un-settles it.
    row.refunded_amount_cents = 1
    row.refunded_at = datetime.now(timezone.utc)
    db.add(row)
    db.commit()

    assert signer_payment_service.settled_payment(db, field=field) is None


def test_open_signer_entered_field_with_no_allocation_still_settles_on_any_valid_amount(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The fix must not have broken the open-amount (donation/deposit) case:
    a pure `signer_entered` field with no allocation settles on any amount
    that cleared Stripe's minimum, regardless of exact figure.
    """
    headers = auth_headers(client)
    document_id, field_id, raw_token, fake = _paid_field_and_row(
        client, pdf_bytes, headers, monkeypatch, amount_mode="signer_entered", amount_cents=None,
        min_cents=50, max_cents=None,
    )
    db = db_session(client)
    field = db.get(Field, field_id)
    assert signer_payment_service.amount_owed(field) is None

    signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id, amount_cents=777)
    row = db.query(SignerPayment).filter_by(field_id=field_id).one()
    assert row.amount_cents == 777

    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
    }
    signer_payment_service.apply_webhook_event(db, event=event)

    settled = signer_payment_service.settled_payment(db, field=field)
    assert settled is not None and settled.amount_cents == 777


# --------------------------------------------------- shortfall (post-payment deadlock)


def _settle(db_session, monkeypatch, fake, raw_token, field_id):
    """Drive one `create_intent` to a real `succeeded` row via webhook."""
    signer_payment_service.create_intent(db_session, raw_token=raw_token, field_id=field_id)
    row = db_session.query(SignerPayment).filter(SignerPayment.field_id == field_id).order_by(
        SignerPayment.created_at.desc()
    ).first()
    event = {
        "type": "payment_intent.succeeded",
        "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
    }
    signer_payment_service.apply_webhook_event(db_session, event=event)
    db_session.refresh(row)
    return row


def _allocated_single_payer_context(client, pdf_bytes, headers, *, total_cents):
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    field_id = add_payment_field(
        client, document_id, headers, alice, "Deposit", 500,
        amount_mode="fixed", amount_cents=total_cents, currency="USD",
    )
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 400)
    connect_stripe(client, headers)

    db = db_session(client)
    document = db.get(Document, document_id)
    payload = PaymentRequestCreate(
        total_cents=total_cents, split_mode="single",
        allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=total_cents)],
    )
    signer_payment_service.sync_request(db, document=document, payload=payload)

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200
    return document_id, alice, field_id, raw_token


def test_raised_allocation_charges_only_the_shortfall_not_a_409(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """FIX A: a succeeded row that used to cover the field no longer covers it
    once the sender raises the allocation. The signer must be able to create a
    new intent (no 409 deadlock), and it must be for exactly the shortfall.
    """
    headers = auth_headers(client)
    document_id, alice, field_id, raw_token = _allocated_single_payer_context(client, pdf_bytes, headers, total_cents=500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    _settle(db, monkeypatch, fake, raw_token, field_id)

    # The sender raises the allocation from 500 to 800.
    document = db.get(Document, document_id)
    signer_payment_service.sync_request(
        db, document=document,
        payload=PaymentRequestCreate(
            total_cents=800, split_mode="single",
            allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=800)],
        ),
    )

    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    assert intent.amount_cents == 300, "must charge only the shortfall (800 - 500 already collected)"

    creates = fake.payment_intent_calls()
    _, _, sent_params, _ = creates[-1]
    assert sent_params["amount"] == "300"


def test_partial_refund_reopens_the_field_for_the_shortfall(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """FIX A, refund variant: a partial refund on an otherwise-settled field
    also has to reopen it for exactly the shortfall, not a 409.
    """
    headers = auth_headers(client)
    document_id, alice, field_id, raw_token = _allocated_single_payer_context(client, pdf_bytes, headers, total_cents=500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    row = _settle(db, monkeypatch, fake, raw_token, field_id)

    signer_payment_service.refund(db, payment=row, amount_cents=200)

    intent = signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
    assert intent.amount_cents == 200, "must charge only the refunded shortfall"

    creates = fake.payment_intent_calls()
    _, _, sent_params, _ = creates[-1]
    assert sent_params["amount"] == "200"


def test_paying_off_a_raised_allocations_shortfall_settles_the_gate_and_completes(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """FIX A end-to-end, raised-allocation variant: the shortfall is paid as a
    SECOND `SignerPayment` row (not a top-up of the first row's own amount),
    and `settled_payment` must still recognise the field as covered by
    summing across rows -- the same summation `create_intent` uses to size
    the shortfall in the first place.
    """
    headers = auth_headers(client)
    document_id, alice, field_id, raw_token = _allocated_single_payer_context(client, pdf_bytes, headers, total_cents=500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    _settle(db, monkeypatch, fake, raw_token, field_id)

    document = db.get(Document, document_id)
    signer_payment_service.sync_request(
        db, document=document,
        payload=PaymentRequestCreate(
            total_cents=800, split_mode="single",
            allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=800)],
        ),
    )
    _settle(db, monkeypatch, fake, raw_token, field_id)

    succeeded_rows = (
        db.query(SignerPayment)
        .filter(SignerPayment.field_id == field_id, SignerPayment.status == "succeeded")
        .all()
    )
    assert len(succeeded_rows) == 2, "the shortfall must have been a second row, not a top-up of the first"
    assert signer_payment_service._collected_cents(db, field_id=field_id) == 800

    field = db.get(Field, field_id)
    assert signer_payment_service.settled_payment(db, field=field) is not None

    document = db.get(Document, document_id)
    signature_field = next(f for f in document.fields if f.type.value == "signature")
    assert client.post(
        f"/api/sign/{raw_token}/fields/{signature_field.id}/signature",
        json={"signature_type": "typed", "signature_text": "Alice"},
    ).status_code == 200

    from app.services.signing_service import signing_service as _signing_service

    db.expire_all()
    response = _signing_service.complete(db, raw_token=raw_token, ip_address=None, user_agent=None)
    assert response.recipient_status == "completed"


def test_paying_off_a_partial_refunds_shortfall_settles_the_gate_and_completes(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """FIX A end-to-end, partial-refund variant: same summation requirement,
    but the shortfall this time comes from a refund clawing back part of the
    original charge rather than a raised allocation.
    """
    headers = auth_headers(client)
    document_id, alice, field_id, raw_token = _allocated_single_payer_context(client, pdf_bytes, headers, total_cents=500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    row = _settle(db, monkeypatch, fake, raw_token, field_id)

    signer_payment_service.refund(db, payment=row, amount_cents=200)
    _settle(db, monkeypatch, fake, raw_token, field_id)

    succeeded_rows = (
        db.query(SignerPayment)
        .filter(SignerPayment.field_id == field_id, SignerPayment.status == "succeeded")
        .all()
    )
    assert len(succeeded_rows) == 2, "the shortfall must have been a second row, not a top-up of the first"
    assert signer_payment_service._collected_cents(db, field_id=field_id) == 500

    field = db.get(Field, field_id)
    assert signer_payment_service.settled_payment(db, field=field) is not None

    document = db.get(Document, document_id)
    signature_field = next(f for f in document.fields if f.type.value == "signature")
    assert client.post(
        f"/api/sign/{raw_token}/fields/{signature_field.id}/signature",
        json={"signature_type": "typed", "signature_text": "Alice"},
    ).status_code == 200

    from app.services.signing_service import signing_service as _signing_service

    db.expire_all()
    response = _signing_service.complete(db, raw_token=raw_token, ip_address=None, user_agent=None)
    assert response.recipient_status == "completed"


def test_a_field_settled_in_full_still_409s_on_a_second_intent(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The legitimate already-paid case must not have regressed."""
    headers = auth_headers(client)
    document_id, alice, field_id, raw_token = _allocated_single_payer_context(client, pdf_bytes, headers, total_cents=500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    _settle(db, monkeypatch, fake, raw_token, field_id)

    try:
        signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
        assert False, "a genuinely settled field must still refuse a second intent"
    except HTTPException as exc:
        assert exc.status_code == 409
        assert "already been paid" in exc.detail


def test_collected_cents_sums_two_charges_net_of_refunds(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """`_collected_cents` must sum across MULTIPLE succeeded rows, not just
    read the latest one -- a field topped up in two charges is judged on the
    total, net of any refund on either charge.
    """
    headers = auth_headers(client)
    document_id, alice, field_id, raw_token = _allocated_single_payer_context(client, pdf_bytes, headers, total_cents=1000)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    # First charge: pay 400 of the 1000 owed. Raise... actually simulate by
    # lowering allocation first is unneeded; simplest is two direct rows.
    document = db.get(Document, document_id)
    field = db.get(Field, field_id)

    first = SignerPayment(
        organization_id=document.organization_id,
        document_id=document.id,
        recipient_id=alice,
        field_id=field_id,
        amount_cents=400,
        currency="USD",
        status="succeeded",
        provider="stripe",
    )
    second = SignerPayment(
        organization_id=document.organization_id,
        document_id=document.id,
        recipient_id=alice,
        field_id=field_id,
        amount_cents=300,
        refunded_amount_cents=100,
        currency="USD",
        status="succeeded",
        provider="stripe",
    )
    db.add_all([first, second])
    db.commit()

    # 400 + (300 - 100) = 600, not 300 (the latest row) and not 400 (the first row).
    assert signer_payment_service._collected_cents(db, field_id=field_id) == 600


def test_shortfall_below_stripe_minimum_409s_with_contact_the_sender_wording(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A shortfall too small for Stripe to charge on its own must not loop the
    signer through a 400-about-minimums forever: it is a distinct 409 that
    tells them to contact the sender.
    """
    headers = auth_headers(client)
    # Owe 530; collect 500 up front, leaving a 30-cent shortfall (below the
    # 50-cent Stripe minimum).
    document_id, alice, field_id, raw_token = _allocated_single_payer_context(client, pdf_bytes, headers, total_cents=500)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    db = db_session(client)
    _settle(db, monkeypatch, fake, raw_token, field_id)

    document = db.get(Document, document_id)
    signer_payment_service.sync_request(
        db, document=document,
        payload=PaymentRequestCreate(
            total_cents=530, split_mode="single",
            allocations=[PaymentAllocationInput(recipient_id=alice, amount_cents=530)],
        ),
    )

    try:
        signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
        assert False, "a sub-minimum shortfall must not be silently accepted or loop"
    except HTTPException as exc:
        assert exc.status_code == 409
        assert "contact the sender" in exc.detail


# --------------------------------------------------- FIX B: fail closed on a bad allocation


def test_allocated_field_with_no_amount_raises_400_and_is_not_settled_by_50_cents(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """FIX B: a field carrying a `payment_request_id` but no `amount_cents` is
    a misconfiguration, not an open-ended field. `amount_owed`/the gate must
    fail closed with a 400 naming the field, and a 50-cent charge must not
    settle it.
    """
    headers = auth_headers(client)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers, second_recipient_role="copy")
    field_id = add_payment_field(
        client, document_id, headers, alice, "Broken allocation", 500,
        amount_mode="signer_entered", min_cents=50, max_cents=None, currency="USD",
    )

    db = db_session(client)
    field = db.get(Field, field_id)
    # Simulate a misconfigured allocation: `payment_request_id` set, no amount.
    field.options = {
        "amount_mode": "signer_entered",
        "min_cents": 50,
        "currency": "USD",
        "payment_request_id": "preq_broken",
    }
    db.add(field)
    db.commit()

    try:
        signer_payment_service.amount_owed(field)
        assert False, "expected a 400 for an allocated field with no amount"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert field.label in exc.detail

    # A 50-cent succeeded row must not settle it either.
    document = db.get(Document, document_id)
    payment = SignerPayment(
        organization_id=document.organization_id,
        document_id=document_id,
        recipient_id=alice,
        field_id=field_id,
        amount_cents=50,
        currency="USD",
        status="succeeded",
        provider="stripe",
    )
    db.add(payment)
    db.commit()

    try:
        signer_payment_service.settled_payment(db, field=field)
        assert False, "expected a 400, not a silent settlement, for a misconfigured allocation"
    except HTTPException as exc:
        assert exc.status_code == 400
