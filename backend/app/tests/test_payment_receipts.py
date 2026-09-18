"""PAY-2: a settled signer payment must leave records this application holds.

The defect these tests pin down: a signer paid a tenant, the money moved, and
the only evidence was (a) mutable columns on `signer_payments` and (b) a
``receipt_url`` pointing at a page hosted on the *tenant's connected Stripe
account*. Nothing was written to the tamper-evident audit chain, yet the
certificate of completion printed "Paid" -- so a sealed document made a
financial claim that chain verification did not cover, and the only
human-readable proof could vanish when the tenant disconnected Stripe. There
was no internal reference, no refundable record outside one envelope's page,
and nothing a dispute could be answered with.

So each test here asserts one of the four things that were missing:
a chained settlement entry, a numbered receipt, a tenant-wide ledger, and a
refund that keeps all of them consistent.

Same no-network discipline as `test_signer_payments.py`: `FakeStripe` stands
in for `SignerPaymentService.transport` and nothing reaches Stripe.
"""

from io import BytesIO

from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.core.database import get_db
from app.models.audit_log import AuditLog
from app.models.payment_receipt import PaymentReceipt
from app.models.signer_payment import SignerPayment
from app.services.audit_service import EVENT_KINDS, audit_service
from app.services.payment_receipt_service import payment_receipt_service
from app.services.signer_payment_service import signer_payment_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document
from app.tests.test_payment_routes import _second_org_headers
from app.tests.test_signer_payments import FakeStripe, add_payment_field, connect_stripe, setup_document
from app.tests.test_signing_correctness import add_field, send


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def _settled_envelope(client: TestClient, pdf_bytes: bytes, monkeypatch, *, settle_via: str = "webhook"):
    """One envelope with one settled 10.00 USD payment by Alice.

    ``settle_via`` picks the settlement channel, because the two carry
    materially different identity evidence and the tests below assert exactly
    that difference.
    """
    headers = auth_headers(client)
    connect_stripe(client, headers)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    field_id = add_payment_field(
        client, document_id, headers, alice, "Alice pay", 500,
        amount_mode="fixed", amount_cents=1000, currency="usd", memo="Deposit",
    )
    add_field(client, document_id, headers, bob, "signature", "Bob sig", 600)

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    tokens = send(client, document_id, headers)
    raw_token = tokens["alice@example.com"]

    if settle_via == "poll":
        # Through the real HTTP routes, so the signer's own IP/user-agent are
        # actually carried by a request rather than injected by the test.
        assert client.post(f"/api/sign/{raw_token}/consent").status_code == 200
        assert client.post(
            f"/api/sign/{raw_token}/payments/{field_id}/intent", json={}
        ).status_code == 200
        # `FakeStripe` answers a bare retrieve with `requires_payment_method`,
        # which is the honest default; the poll only settles when Stripe says
        # the charge cleared, so that answer is canned here for this intent.
        db = db_session(client)
        pending = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
        intent_id = pending.provider_payment_intent_id
        fake.responses[f"GET /v1/payment_intents/{intent_id}"] = (
            200,
            {
                "id": intent_id,
                "status": "succeeded",
                "latest_charge": {"id": "ch_poll", "receipt_url": "https://stripe.test/r/poll"},
            },
        )
        response = client.post(
            f"/api/sign/{raw_token}/payments/{field_id}/refresh",
            headers={"User-Agent": "SignerProTest/1.0"},
        )
        assert response.status_code == 200, response.text
    else:
        db = db_session(client)
        signer_payment_service.create_intent(db, raw_token=raw_token, field_id=field_id)
        row = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
        signer_payment_service.apply_webhook_event(
            db,
            event={
                "id": "evt_1",
                "type": "payment_intent.succeeded",
                "data": {
                    "object": {
                        "id": row.provider_payment_intent_id,
                        "status": "succeeded",
                        "charges": {"data": [{"id": "ch_1", "receipt_url": "https://stripe.test/r/1"}]},
                    }
                },
            },
        )

    db = db_session(client)
    payment = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
    assert str(payment.status) == "succeeded"
    return headers, document_id, alice, bob, field_id, payment, tokens


# ------------------------------------------------------- the chained record


def test_a_settled_payment_writes_a_chained_audit_entry(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The core defect. Settlement used to write no audit entry at all, so the
    certificate's "Paid" line rested on nothing the hash chain covered."""
    headers, document_id, *_rest, payment, _tokens = _settled_envelope(client, pdf_bytes, monkeypatch)
    db = db_session(client)

    entries = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "signer_payment_succeeded")
        .all()
    )
    assert len(entries) == 1
    entry = entries[0]
    # Human-readable, because the trail is read by lawyers and auditors.
    assert "10.00 USD" in entry.event_message
    # Machine-readable, so a dispute can be reconciled against Stripe.
    assert entry.log_metadata["payment_id"] == payment.id
    assert entry.log_metadata["amount_cents"] == 1000
    assert entry.log_metadata["currency"] == "usd"
    assert entry.log_metadata["stripe_payment_intent_id"] == payment.provider_payment_intent_id
    assert entry.log_metadata["stripe_charge_id"] == payment.provider_charge_id
    assert entry.log_metadata["stripe_connected_account_id"] == payment.provider_account_id
    # Where the money went is recorded, not left to be inferred.
    assert entry.log_metadata["merchant_of_record"] == "tenant_connected_account"


def test_the_settlement_entry_is_covered_by_the_tamper_evident_chain(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A payment entry that sat outside the hash chain would be no better than
    the mutable column it replaced."""
    headers, document_id, *_rest = _settled_envelope(client, pdf_bytes, monkeypatch)

    verification = client.get(f"/api/documents/{document_id}/audit-logs/verify", headers=headers)
    assert verification.status_code == 200, verification.text
    assert verification.json()["valid"] is True

    trail = client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()
    settlement = [row for row in trail if row["event_type"] == "signer_payment_succeeded"]
    assert len(settlement) == 1


def test_payment_events_are_classified_for_the_trail_ui(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """An unclassified event renders as a neutral dot, so money moving looked
    exactly like a field being filled in."""
    for event_type, kind in (
        ("signer_payment_started", "info"),
        ("signer_payment_succeeded", "good"),
        ("signer_payment_failed", "bad"),
        ("signer_payment_refunded", "bad"),
        ("payment_receipt_issued", "good"),
        ("payment_request_synced", "info"),
    ):
        assert EVENT_KINDS.get(event_type) == kind, event_type
        assert audit_service.entry_kind(event_type) == kind


def test_the_signers_own_poll_attributes_the_payment_to_their_device(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A chargeback turns on being able to show who authorised the charge and
    from where. Only the signer's own poll can supply that."""
    headers, document_id, *_rest = _settled_envelope(
        client, pdf_bytes, monkeypatch, settle_via="poll"
    )
    db = db_session(client)
    entry = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "signer_payment_succeeded")
        .one()
    )
    assert entry.user_agent == "SignerProTest/1.0"
    assert entry.ip_address
    assert entry.log_metadata["settled_via"] == "signer_poll"


def test_a_webhook_settlement_records_that_it_could_not_capture_the_signers_device(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The webhook comes from Stripe's servers. Recording their address would
    attribute the payment to Stripe, so the channel is recorded instead and
    the absence reads as a fact rather than a gap in our logging."""
    headers, document_id, *_rest = _settled_envelope(
        client, pdf_bytes, monkeypatch, settle_via="webhook"
    )
    db = db_session(client)
    entry = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "signer_payment_succeeded")
        .one()
    )
    assert entry.log_metadata["settled_via"] == "stripe_webhook"
    assert entry.ip_address is None
    assert entry.user_agent is None


def test_initiating_a_payment_is_logged_before_the_money_moves(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A signer who abandons payment used to leave no trace at all."""
    headers, document_id, *_rest = _settled_envelope(client, pdf_bytes, monkeypatch, settle_via="poll")
    db = db_session(client)
    started = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "signer_payment_started")
        .all()
    )
    assert len(started) == 1
    assert "10.00 USD" in started[0].event_message


# ------------------------------------------------------------- the receipt


def test_a_settled_payment_issues_a_numbered_checksummed_receipt(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers, document_id, alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()

    assert receipt.number.startswith("RCP-")
    assert receipt.total_cents == 1000
    assert receipt.subtotal_cents == 1000
    assert receipt.refunded_amount_cents == 0
    assert str(receipt.status) == "issued"
    # Snapshots, so a purged document or an erased recipient cannot make the
    # financial record unreadable.
    assert receipt.payer_email == "alice@example.com"
    assert receipt.document_ref == document_id
    assert receipt.document_title
    assert receipt.issuer_name
    # Stripe's ids are kept as a cross-reference, not as the only evidence.
    assert receipt.provider_payment_intent_id == payment.provider_payment_intent_id
    assert receipt.provider_receipt_url == payment.receipt_url
    # Sealed, and the seal actually checks out.
    assert receipt.checksum
    assert payment_receipt_service.verify(receipt) is True
    # Linked to the chained entry, both directions.
    entry = db.get(AuditLog, receipt.audit_log_id)
    assert entry is not None and entry.event_type == "signer_payment_succeeded"


def test_an_edited_receipt_fails_verification(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """Immutability that is merely a convention is not evidence of anything."""
    _headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()
    assert payment_receipt_service.verify(receipt) is True

    receipt.total_cents = 1
    assert payment_receipt_service.verify(receipt) is False


def test_an_unsealed_receipt_is_reported_unverified_not_verified(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """"Unverifiable" must never render as "verified" -- that is the one
    direction this check is not allowed to fail in."""
    _headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()
    receipt.checksum = None
    assert payment_receipt_service.verify(receipt) is False


def test_a_redelivered_webhook_does_not_issue_a_second_receipt(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """Stripe redelivers events. Two receipts for one payment would be two
    financial documents for money that arrived once."""
    _headers, _document_id, _alice, _bob, field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    signer_payment_service.apply_webhook_event(
        db,
        event={
            "id": "evt_2",
            "type": "payment_intent.succeeded",
            "data": {"object": {"id": payment.provider_payment_intent_id, "status": "succeeded"}},
        },
    )
    assert db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).count() == 1
    # And no duplicate chained settlement entry either.
    assert (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "signer_payment_succeeded", AuditLog.document_id == payment.document_id)
        .count()
        == 1
    )


def test_receipt_numbers_are_sequential_within_one_organization(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers = auth_headers(client)
    connect_stripe(client, headers)
    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")

    numbers: list[str] = []
    for _ in range(2):
        document_id, alice, bob = setup_document(client, pdf_bytes, headers)
        field_id = add_payment_field(
            client, document_id, headers, alice, "Pay", 500,
            amount_mode="fixed", amount_cents=1000, currency="usd",
        )
        add_field(client, document_id, headers, bob, "signature", "Bob sig", 600)
        tokens = send(client, document_id, headers)
        db = db_session(client)
        signer_payment_service.create_intent(db, raw_token=tokens["alice@example.com"], field_id=field_id)
        row = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()
        signer_payment_service.apply_webhook_event(
            db,
            event={
                "id": f"evt_{row.id}",
                "type": "payment_intent.succeeded",
                "data": {"object": {"id": row.provider_payment_intent_id, "status": "succeeded"}},
            },
        )
        receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == row.id).one()
        numbers.append(receipt.number)

    assert numbers[0] != numbers[1]
    assert [int(number.rsplit("-", 1)[1]) for number in numbers] == [1, 2]


def test_a_failed_payment_is_logged_and_gets_no_receipt(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A receipt exists only for money that arrived; a decline still needs a
    record, so the tenant can answer "your site took my money" with facts."""
    headers = auth_headers(client)
    connect_stripe(client, headers)
    document_id, alice, bob = setup_document(client, pdf_bytes, headers)
    field_id = add_payment_field(
        client, document_id, headers, alice, "Pay", 500,
        amount_mode="fixed", amount_cents=1000, currency="usd",
    )
    add_field(client, document_id, headers, bob, "signature", "Bob sig", 600)

    fake = FakeStripe()
    monkeypatch.setattr(type(signer_payment_service), "transport", staticmethod(fake))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_fake")
    tokens = send(client, document_id, headers)
    db = db_session(client)
    signer_payment_service.create_intent(db, raw_token=tokens["alice@example.com"], field_id=field_id)
    row = db.query(SignerPayment).filter(SignerPayment.field_id == field_id).one()

    signer_payment_service.apply_webhook_event(
        db,
        event={
            "id": "evt_fail",
            "type": "payment_intent.payment_failed",
            "data": {
                "object": {
                    "id": row.provider_payment_intent_id,
                    "status": "requires_payment_method",
                    "last_payment_error": {"code": "card_declined", "message": "Your card was declined."},
                }
            },
        },
    )

    entry = (
        db.query(AuditLog)
        .filter(AuditLog.document_id == document_id, AuditLog.event_type == "signer_payment_failed")
        .one()
    )
    assert entry.log_metadata["failure_code"] == "card_declined"
    assert "Your card was declined." in entry.event_message
    assert db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == row.id).count() == 0


# ------------------------------------------------------------------- routes


def test_the_receipt_is_served_as_json_and_as_a_pdf(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )

    by_payment = client.get(f"/api/payments/{payment.id}/receipt", headers=headers)
    assert by_payment.status_code == 200, by_payment.text
    body = by_payment.json()
    assert body["number"].startswith("RCP-")
    assert body["verified"] is True
    assert body["net_cents"] == 1000

    pdf_response = client.get(f"/api/payments/receipts/{body['id']}/pdf", headers=headers)
    assert pdf_response.status_code == 200, pdf_response.text
    assert pdf_response.headers["content-type"] == "application/pdf"
    assert body["number"] in pdf_response.headers["content-disposition"]

    text = "".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf_response.content)).pages)
    assert body["number"] in text
    assert "PAID" in text
    assert "10.00 USD" in text
    assert "alice@example.com" in text
    # The merchant of record is stated, so a signer knows who to approach.
    assert "merchant of record" in text


def test_a_receipt_from_another_organization_is_not_readable(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    _headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()

    other = _second_org_headers(client)
    assert client.get(f"/api/payments/receipts/{receipt.id}", headers=other).status_code == 404
    assert client.get(f"/api/payments/receipts/{receipt.id}/pdf", headers=other).status_code == 404
    assert client.get(f"/api/payments/{payment.id}/receipt", headers=other).status_code == 404


def test_the_ledger_lists_payments_across_envelopes_with_totals(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """Refunding used to be reachable only from one envelope's audit page, so
    money collected across many envelopes had nowhere to be reviewed."""
    headers, document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )

    response = client.get("/api/payments/ledger", headers=headers)
    assert response.status_code == 200, response.text
    page = response.json()

    assert page["total"] == 1
    assert page["succeeded_count"] == 1
    # Per currency, never summed across currencies.
    assert page["collected_cents_by_currency"] == {"USD": 1000}
    entry = page["entries"][0]
    assert entry["payment"]["id"] == payment.id
    assert entry["document_id"] == document_id
    assert entry["document_title"]
    assert entry["payer_email"] == "alice@example.com"
    assert entry["receipt"]["number"].startswith("RCP-")
    assert entry["receipt"]["verified"] is True


def test_the_ledger_is_scoped_to_the_callers_organization(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    _headers, *_rest = _settled_envelope(client, pdf_bytes, monkeypatch)
    other = _second_org_headers(client)
    page = client.get("/api/payments/ledger", headers=other)
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 0


def test_the_envelope_payments_list_carries_the_receipt(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers, document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    rows = client.get(f"/api/documents/{document_id}/payments", headers=headers).json()
    assert len(rows) == 1
    assert rows[0]["receipt"]["number"].startswith("RCP-")


# ------------------------------------------------------------------ refunds


def test_a_refund_updates_the_receipt_in_the_same_transaction(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A receipt still reading PAID after the money went back is exactly the
    kind of inconsistency a regulator or a court treats as a record-keeping
    failure."""
    headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )

    response = client.post(
        f"/api/payments/{payment.id}/refund", json={"amount_cents": 400}, headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["refunded_amount_cents"] == 400
    # Returned on the refund response, so no UI can briefly show a refunded
    # payment beside a receipt that still says PAID.
    assert body["receipt"]["status"] == "partially_refunded"
    assert body["receipt"]["refunded_amount_cents"] == 400
    assert body["receipt"]["net_cents"] == 600
    # Resealed, not silently invalidated.
    assert body["receipt"]["verified"] is True

    # And the refund shows up in the chained trail with the receipt cited.
    db = db_session(client)
    entry = (
        db.query(AuditLog).filter(AuditLog.event_type == "signer_payment_refunded").one()
    )
    assert entry.log_metadata["receipt_number"] == body["receipt"]["number"]
    assert entry.log_metadata["refunded_total_cents"] == 400
    assert "4.00 USD" in entry.event_message


def test_a_full_refund_marks_the_receipt_refunded_and_the_pdf_says_so(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    response = client.post(f"/api/payments/{payment.id}/refund", json={}, headers=headers)
    assert response.status_code == 200, response.text
    receipt_id = response.json()["receipt"]["id"]
    assert response.json()["receipt"]["status"] == "refunded"

    pdf_response = client.get(f"/api/payments/receipts/{receipt_id}/pdf", headers=headers)
    text = "".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf_response.content)).pages)
    assert "REFUNDED IN FULL" in text
    # The one thing the document must not say any more.
    assert "PAID" not in text.replace("REFUNDED IN FULL", "")


def test_two_partial_refunds_do_not_double_count_on_the_receipt(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """`apply_refund` reads the payment's refunded total rather than adding a
    delta, precisely so this cannot drift."""
    headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    assert client.post(
        f"/api/payments/{payment.id}/refund", json={"amount_cents": 300}, headers=headers
    ).status_code == 200
    second = client.post(
        f"/api/payments/{payment.id}/refund", json={"amount_cents": 700}, headers=headers
    )
    assert second.status_code == 200, second.text
    assert second.json()["receipt"]["refunded_amount_cents"] == 1000
    assert second.json()["receipt"]["status"] == "refunded"
    assert second.json()["receipt"]["net_cents"] == 0


# -------------------------------------------------------------- certificate


def test_the_certificate_cites_the_receipt_number_not_only_stripes_id(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """The certificate's payment claim has to be traceable inside this
    application, not only in a third party's dashboard."""
    headers, document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()

    from app.models.document import Document
    from app.services.pdf_service import pdf_service

    document = db.get(Document, document_id)
    certificate = pdf_service.build_audit_certificate(db, document)
    text = "".join(page.extract_text() or "" for page in PdfReader(BytesIO(certificate)).pages)

    assert receipt.number in text
    assert "merchant of record" in text


# --------------------------------------------------------------- backfill


def _backfill():
    """Import the recovery script the same way an operator runs it."""
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "backfill_payment_receipts", "scripts/backfill_payment_receipts.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.backfill


def test_the_backfill_reconstructs_records_for_payments_that_settled_before_pay2(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """Every payment taken before this change settled silently. The recovery
    path has to produce both records -- and mark them as reconstructed, since
    a backfilled record indistinguishable from a contemporaneous one is worse
    than none at all."""
    _headers, document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)

    # Simulate the pre-PAY-2 world: a settled payment with neither record.
    db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).delete()
    db.query(AuditLog).filter(
        AuditLog.event_type.in_(("signer_payment_succeeded", "payment_receipt_issued"))
    ).delete(synchronize_session=False)
    db.commit()
    assert db.query(PaymentReceipt).count() == 0

    summary = _backfill()(db)
    assert summary["receipts_issued"] == 1
    assert summary["audit_entries_written"] == 1
    assert summary["failed"] == 0

    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()
    assert receipt.total_cents == 1000
    assert payment_receipt_service.verify(receipt) is True

    entry = (
        db.query(AuditLog)
        .filter(AuditLog.event_type == "signer_payment_succeeded")
        .one()
    )
    # Marked as reconstructed, with the real payment time in the metadata and
    # the device evidence recorded as absent rather than invented.
    assert entry.log_metadata["backfilled"] is True
    assert entry.log_metadata["paid_at"]
    assert entry.log_metadata["settled_via"] == "unknown_pre_pay2"
    assert entry.ip_address is None
    assert entry.user_agent is None
    assert "reconstructed by backfill" in entry.event_message


def test_the_backfill_is_idempotent(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """It doubles as a reconciliation tool, so re-running it must not issue a
    second financial document for the same money."""
    _headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    backfill = _backfill()

    first = backfill(db)
    assert first["receipts_issued"] == 0
    assert first["already_complete"] == 1

    second = backfill(db)
    assert second["receipts_issued"] == 0
    assert db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).count() == 1


def test_the_backfill_does_not_reissue_a_refunded_payment_as_paid(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """A receipt reading PAID for money that was returned is the exact
    inconsistency this whole change exists to prevent."""
    headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    assert client.post(f"/api/payments/{payment.id}/refund", json={}, headers=headers).status_code == 200

    db = db_session(client)
    db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).delete()
    db.commit()

    _backfill()(db)
    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()
    assert str(receipt.status) == "refunded"
    assert receipt.refunded_amount_cents == 1000
    assert receipt.net_cents == 0


def test_the_backfill_dry_run_writes_nothing(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    _headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    db = db_session(client)
    db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).delete()
    db.commit()

    summary = _backfill()(db, dry_run=True)
    assert summary["receipts_issued"] == 1
    assert db.query(PaymentReceipt).count() == 0


def test_a_refund_is_actually_committed_not_merely_added_to_the_session(
    client: TestClient, pdf_bytes: bytes, monkeypatch
) -> None:
    """`get_db` only closes the session -- it never commits.

    So an audit entry that is added and not committed is silently discarded
    when the request ends: a refund moved real money and left no record of
    who authorised it. The ordinary assertions above cannot see this, because
    the test harness shares one connection and an uncommitted row is still
    visible to a reader inside the same transaction.

    A rollback is the discriminator. Committed rows survive it; rows that
    were only added to a session do not.
    """
    headers, _document_id, _alice, _bob, _field_id, payment, _tokens = _settled_envelope(
        client, pdf_bytes, monkeypatch
    )
    response = client.post(
        f"/api/payments/{payment.id}/refund", json={"amount_cents": 250}, headers=headers
    )
    assert response.status_code == 200, response.text

    db = db_session(client)
    db.rollback()

    entry = (
        db.query(AuditLog).filter(AuditLog.event_type == "signer_payment_refunded").one_or_none()
    )
    assert entry is not None, "the refund audit entry was never committed"
    assert entry.log_metadata["refunded_total_cents"] == 250

    # The receipt's refund state has to survive too, or the record and the
    # money disagree the moment the process restarts.
    receipt = db.query(PaymentReceipt).filter(PaymentReceipt.signer_payment_id == payment.id).one()
    assert receipt.refunded_amount_cents == 250
    assert str(receipt.status) == "partially_refunded"
