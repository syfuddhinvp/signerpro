"""Regression tests for the signing-session and field-validation findings.

Each test here pins behaviour that was verified broken in the audit:

* SIGN-1  a session leaked every other recipient's fields *and their values*;
* FLD-3   a conditionally-hidden required field deadlocked the signer;
* FLD-4   dropdown/radio option sets were never enforced server-side;
* FLD-5   ``initials`` fields could never be filled;
* FLD-6   ``attachment`` fields had no upload endpoint at all;
* RTE-3   ``role: "copy"`` recipients blocked execution of the envelope;
* RTE-1   nothing in the app ever ran the expiry sweep.
"""

import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import status
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.models.document import Document
from app.models.field import Field
from app.models.field_attachment import FieldAttachment
from app.models.signing_token import SigningToken
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document, token_from_link


def db_session(client: TestClient):
    return next(client.app.dependency_overrides[get_db]())


def add_recipient(
    client: TestClient,
    document_id: str,
    headers: dict[str, str],
    name: str,
    email: str,
    *,
    role: str = "sign",
    order: int = 1,
) -> str:
    response = client.post(
        f"/api/documents/{document_id}/recipients",
        headers=headers,
        json={"name": name, "email": email, "role_name": name, "role": role, "signing_order": order},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def add_field(
    client: TestClient,
    document_id: str,
    headers: dict[str, str],
    recipient_id: str,
    field_type: str,
    label: str,
    y: int,
    **extra,
) -> str:
    payload = {
        "recipient_id": recipient_id,
        "type": field_type,
        "label": label,
        "required": True,
        "page_number": 1,
        "x": 72,
        "y": y,
        "width": 180,
        "height": 48 if field_type in {"signature", "initials"} else 32,
    }
    payload.update(extra)
    response = client.post(f"/api/documents/{document_id}/fields", headers=headers, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def send(client: TestClient, document_id: str, headers: dict[str, str]) -> dict[str, str]:
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    return {item["email"]: token_from_link(item["signing_link"]) for item in sent.json()["signing_links"]}


# --------------------------------------------------------------- SIGN-1


def test_a_session_never_returns_another_recipients_fields_or_values(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com")
    bob = add_recipient(client, document_id, headers, "Bob", "bob@example.com")

    alice_name = add_field(client, document_id, headers, alice, "full_name", "Alice name", 680)
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 620)
    bob_salary = add_field(client, document_id, headers, bob, "text", "Bob salary", 520)
    add_field(client, document_id, headers, bob, "signature", "Bob signature", 460)

    tokens = send(client, document_id, headers)
    assert client.post(f"/api/sign/{tokens['bob@example.com']}/consent").status_code == 200
    assert (
        client.post(
            f"/api/sign/{tokens['bob@example.com']}/fields/{bob_salary}/value",
            json={"value": "240000"},
        ).status_code
        == 200
    )

    alice_token = tokens["alice@example.com"]
    assert client.post(f"/api/sign/{alice_token}/consent").status_code == 200
    session = client.get(f"/api/sign/{alice_token}").json()

    ids = {field["id"] for field in session["fields"]}
    assert ids == set(session["assigned_field_ids"])
    assert alice_name in ids and len(ids) == 2
    # Nothing of Bob's is in `fields` at all.
    assert bob_salary not in ids
    assert all(field["recipient_id"] == alice for field in session["fields"])

    # Bob's placements are still exposed for layout — but redacted: no label,
    # no value, no recipient id anywhere in the serialised payload.
    placements = session["other_field_placements"]
    assert len(placements) == 2
    assert bob_salary in {item["id"] for item in placements}
    for placement in placements:
        assert set(placement) == {"id", "type", "page_number", "x", "y", "width", "height"}
    body = client.get(f"/api/sign/{alice_token}").text
    assert "240000" not in body
    assert "Bob salary" not in body


# --------------------------------------------------------------- FLD-3


def _spouse_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]):
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    has_spouse = add_field(
        client, document_id, headers, signer, "checkbox", "Has spouse", 680, required=False
    )
    spouse_name = add_field(
        client,
        document_id,
        headers,
        signer,
        "text",
        "Spouse name",
        620,
        condition={"field_id": has_spouse, "op": "checked"},
    )
    signature = add_field(client, document_id, headers, signer, "signature", "Signature", 560)
    return document_id, has_spouse, spouse_name, signature


def test_a_hidden_required_field_does_not_deadlock_completion(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, has_spouse, spouse_name, signature = _spouse_document(client, pdf_bytes, headers)
    token = send(client, document_id, headers)["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200

    # "Has spouse" is unchecked, so "Spouse name" is hidden and unwritable...
    rejected = client.post(f"/api/sign/{token}/fields/{spouse_name}/value", json={"value": "Jo"})
    assert rejected.status_code == 400
    assert "conditional" in rejected.json()["detail"]

    # ...and therefore must not be counted as outstanding, either in progress
    # or at completion. This combination used to be an unfinishable envelope.
    session = client.get(f"/api/sign/{token}").json()
    assert session["required_total"] == 1  # the signature only

    assert (
        client.post(
            f"/api/sign/{token}/fields/{signature}/signature",
            json={"signature_type": "typed", "signature_text": "Signer One"},
        ).status_code
        == 200
    )
    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["document_status"] == "completed"


def test_a_visible_required_field_still_blocks_completion(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, has_spouse, spouse_name, signature = _spouse_document(client, pdf_bytes, headers)
    token = send(client, document_id, headers)["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200

    assert client.post(f"/api/sign/{token}/fields/{has_spouse}/value", json={"value": True}).status_code == 200
    assert (
        client.post(
            f"/api/sign/{token}/fields/{signature}/signature",
            json={"signature_type": "typed", "signature_text": "Signer One"},
        ).status_code
        == 200
    )
    blocked = client.post(f"/api/sign/{token}/complete")
    assert blocked.status_code == 400
    assert "Spouse name" in blocked.json()["detail"]

    assert client.post(f"/api/sign/{token}/fields/{spouse_name}/value", json={"value": "Jo"}).status_code == 200
    assert client.post(f"/api/sign/{token}/complete").status_code == 200


def test_a_value_captured_before_the_field_was_hidden_is_dropped(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, has_spouse, spouse_name, signature = _spouse_document(client, pdf_bytes, headers)
    token = send(client, document_id, headers)["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200

    client.post(f"/api/sign/{token}/fields/{has_spouse}/value", json={"value": True})
    client.post(f"/api/sign/{token}/fields/{spouse_name}/value", json={"value": "Jo"})
    # The signer changes their mind: the field is hidden again.
    client.post(f"/api/sign/{token}/fields/{has_spouse}/value", json={"value": False})
    client.post(
        f"/api/sign/{token}/fields/{signature}/signature",
        json={"signature_type": "typed", "signature_text": "Signer One"},
    )
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    fields = client.get(f"/api/documents/{document_id}/fields", headers=headers).json()
    hidden = next(field for field in fields if field["id"] == spouse_name)
    # A hidden field is not part of the record, so its stale value must not be
    # stamped into the executed PDF.
    assert not hidden["value"]


# --------------------------------------------------------------- FLD-4


def test_dropdown_and_radio_reject_values_outside_their_option_set(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    plan = add_field(
        client, document_id, headers, signer, "dropdown", "Plan", 680, options=["A", "B"]
    )
    tier = add_field(
        client,
        document_id,
        headers,
        signer,
        "radio",
        "Tier",
        620,
        options=[{"value": "gold", "label": "Gold"}, {"value": "silver", "label": "Silver"}],
    )
    free_text = add_field(client, document_id, headers, signer, "text", "Notes", 560)
    token = send(client, document_id, headers)["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200

    rejected = client.post(f"/api/sign/{token}/fields/{plan}/value", json={"value": "ZZZ-not-an-option"})
    assert rejected.status_code == 400
    assert "must be one of" in rejected.json()["detail"]
    assert client.post(f"/api/sign/{token}/fields/{plan}/value", json={"value": "B"}).status_code == 200

    assert client.post(f"/api/sign/{token}/fields/{tier}/value", json={"value": "Gold"}).status_code == 400
    assert client.post(f"/api/sign/{token}/fields/{tier}/value", json={"value": "gold"}).status_code == 200

    # A field with no authored option set is unconstrained, as before.
    assert client.post(f"/api/sign/{token}/fields/{free_text}/value", json={"value": "anything"}).status_code == 200


# --------------------------------------------------------------- FLD-5


def test_an_initials_field_can_be_signed_and_completes(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    initials = add_field(client, document_id, headers, signer, "initials", "Initials", 680)
    token = send(client, document_id, headers)["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200

    signed = client.post(
        f"/api/sign/{token}/fields/{initials}/signature",
        json={"signature_type": "typed", "signature_text": "S.O."},
    )
    assert signed.status_code == 200, signed.text
    assert signed.json()["value"] == "S.O."

    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["document_status"] == "completed"


# --------------------------------------------------------------- RTE-3


def test_a_copy_recipient_neither_signs_nor_blocks_completion(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com", order=1)
    add_recipient(client, document_id, headers, "Counsel", "counsel@example.com", role="copy", order=2)
    signature = add_field(client, document_id, headers, signer, "signature", "Signature", 680)

    # A CC recipient owns no field at all — send used to reject this outright.
    tokens = send(client, document_id, headers)
    assert set(tokens) == {"signer@example.com", "counsel@example.com"}

    cc_token = tokens["counsel@example.com"]
    cc_session = client.get(f"/api/sign/{cc_token}").json()
    assert cc_session["read_only"] is True
    assert cc_session["can_decline"] is False and cc_session["can_reassign"] is False
    assert cc_session["recipient"]["role"] == "copy"
    blocked = client.post(f"/api/sign/{cc_token}/complete")
    assert blocked.status_code == 403
    assert "copy only" in blocked.json()["detail"]

    token = tokens["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200
    assert (
        client.post(
            f"/api/sign/{token}/fields/{signature}/signature",
            json={"signature_type": "typed", "signature_text": "Signer One"},
        ).status_code
        == 200
    )
    completed = client.post(f"/api/sign/{token}/complete")
    assert completed.status_code == 200, completed.text
    # The envelope executes without counsel ever signing it.
    assert completed.json()["document_status"] == "completed"

    # And counsel lands in ``notified`` — a terminal state that does not claim
    # they signed. Marking them ``completed`` (as the first pass did, to get
    # past a completion gate that required every row to have a completed_at)
    # would have put a signature they never gave into the audit record.
    recipients = client.get(f"/api/documents/{document_id}/recipients", headers=headers).json()
    cc = next(item for item in recipients if item["email"] == "counsel@example.com")
    assert cc["status"] == "notified"
    assert cc["completed_at"] is None
    signer_row = next(item for item in recipients if item["email"] == "signer@example.com")
    assert signer_row["status"] == "completed"


def test_a_copy_recipient_does_not_hold_up_sequential_routing(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    created = client.post(
        "/api/documents", headers=headers, json={"title": "Sequential", "workflow_type": "sequential"}
    )
    document_id = created.json()["id"]
    assert (
        client.post(
            f"/api/documents/{document_id}/upload-pdf",
            headers=headers,
            files={"upload": ("packet.pdf", pdf_bytes, "application/pdf")},
        ).status_code
        == 200
    )
    first = add_recipient(client, document_id, headers, "First", "first@example.com", order=1)
    add_recipient(client, document_id, headers, "CC", "cc@example.com", role="copy", order=2)
    second = add_recipient(client, document_id, headers, "Second", "second@example.com", order=3)
    first_sig = add_field(client, document_id, headers, first, "signature", "First signature", 680)
    second_sig = add_field(client, document_id, headers, second, "signature", "Second signature", 600)

    tokens = send(client, document_id, headers)
    # The CC is notified immediately, outside the sequence.
    assert set(tokens) == {"first@example.com", "cc@example.com"}

    token = tokens["first@example.com"]
    client.post(f"/api/sign/{token}/consent")
    client.post(
        f"/api/sign/{token}/fields/{first_sig}/signature",
        json={"signature_type": "typed", "signature_text": "First"},
    )
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    # Order 3 is activated even though the order-2 CC never completed.
    recipients = client.get(f"/api/documents/{document_id}/recipients", headers=headers).json()
    by_email = {item["email"]: item for item in recipients}
    assert by_email["second@example.com"]["status"] == "sent"


def test_an_approver_completes_without_owning_a_signature_field(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    add_recipient(client, document_id, headers, "Approver", "approver@example.com", role="approve")
    signature = add_field(client, document_id, headers, signer, "signature", "Signature", 680)

    tokens = send(client, document_id, headers)
    token = tokens["signer@example.com"]
    client.post(f"/api/sign/{token}/consent")
    client.post(
        f"/api/sign/{token}/fields/{signature}/signature",
        json={"signature_type": "typed", "signature_text": "Signer One"},
    )
    # The approver still gates execution — they simply have nothing to fill in.
    assert client.post(f"/api/sign/{token}/complete").json()["document_status"] == "partially_completed"

    approver_token = tokens["approver@example.com"]
    assert client.post(f"/api/sign/{approver_token}/consent").status_code == 200
    approved = client.post(f"/api/sign/{approver_token}/complete")
    assert approved.status_code == 200, approved.text
    assert approved.json()["document_status"] == "completed"

    events = [item["event_type"] for item in client.get(f"/api/documents/{document_id}/audit-logs", headers=headers).json()]
    assert "recipient_approved" in events


# --------------------------------------------------------------- RTE-1 expiry


def test_the_admin_expiry_sweep_actually_expires_a_live_envelope(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    add_field(client, document_id, headers, signer, "signature", "Signature", 680)
    token = send(client, document_id, headers)["signer@example.com"]

    db = db_session(client)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    document = db.get(Document, document_id)
    document.expires_at = past
    for signing_token in db.query(SigningToken).filter(SigningToken.document_id == document_id):
        signing_token.expires_at = past
    db.commit()

    swept = client.post("/api/documents/expiry-sweep", headers=headers)
    assert swept.status_code == 200, swept.text
    assert swept.json()["documents_expired"] == 1
    assert swept.json()["tokens_expired"] == 1

    db.expire_all()
    assert db.get(Document, document_id).status == "expired"
    # The signing link is dead, not merely stale.
    assert client.get(f"/api/sign/{token}").status_code in {403, 410}

    # Idempotent: a second sweep transitions nothing.
    again = client.post("/api/documents/expiry-sweep", headers=headers)
    assert again.json() == {"documents_expired": 0, "recipients_expired": 0, "tokens_expired": 0}


def test_a_draft_carrying_a_deadline_is_not_expired(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    db = db_session(client)
    document = db.get(Document, document_id)
    document.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    db.commit()

    swept = client.post("/api/documents/expiry-sweep", headers=headers)
    assert swept.json()["documents_expired"] == 0


# --------------------------------------------------------------- FLD-6


PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00"
    b"\x00\x00IEND\xaeB`\x82"
)


def _attachment_document(client: TestClient, pdf_bytes: bytes, headers: dict[str, str]):
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    attachment = add_field(client, document_id, headers, signer, "attachment", "Proof of ID", 680)
    signature = add_field(client, document_id, headers, signer, "signature", "Signature", 600)
    token = send(client, document_id, headers)["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200
    return document_id, attachment, signature, token


def test_a_signer_can_upload_an_attachment_and_the_sender_can_read_it(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id, attachment, signature, token = _attachment_document(client, pdf_bytes, headers)

    # The text endpoint refuses: an attachment field is a file, not a string.
    typed = client.post(f"/api/sign/{token}/fields/{attachment}/value", json={"value": "passport.png"})
    assert typed.status_code == 400

    uploaded = client.post(
        f"/api/sign/{token}/fields/{attachment}/attachment",
        files={"upload": ("passport.png", PNG_BYTES, "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["filename"] == "passport.png"
    assert uploaded.json()["size_bytes"] == len(PNG_BYTES)

    client.post(
        f"/api/sign/{token}/fields/{signature}/signature",
        json={"signature_type": "typed", "signature_text": "Signer One"},
    )
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    downloaded = client.get(
        f"/api/documents/{document_id}/fields/{attachment}/attachment", headers=headers
    )
    assert downloaded.status_code == 200
    assert downloaded.content == PNG_BYTES

    # The evidence lives in ``field_attachments``, not smuggled into the
    # field's authoring ``options`` blob.
    db = db_session(client)
    row = db.query(FieldAttachment).filter(FieldAttachment.field_id == attachment).one()
    assert row.document_id == document_id
    assert row.filename == "passport.png"
    assert row.content_type == "image/png"
    assert row.size_bytes == len(PNG_BYTES)
    assert row.sha256 == hashlib.sha256(PNG_BYTES).hexdigest()
    assert row.file_path and not row.file_path.startswith("/")
    field_row = db.query(Field).filter(Field.id == attachment).one()
    assert "attachment" not in (field_row.options or {})


def test_an_attachment_field_with_no_upload_has_nothing_to_download(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id, attachment, _signature, _token = _attachment_document(client, pdf_bytes, headers)
    missing = client.get(
        f"/api/documents/{document_id}/fields/{attachment}/attachment", headers=headers
    )
    assert missing.status_code == 404


def test_re_uploading_an_attachment_replaces_the_stored_row(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id, attachment, _signature, token = _attachment_document(client, pdf_bytes, headers)
    for _ in range(2):
        assert (
            client.post(
                f"/api/sign/{token}/fields/{attachment}/attachment",
                files={"upload": ("passport.png", PNG_BYTES, "image/png")},
            ).status_code
            == 200
        )
    db = db_session(client)
    assert db.query(FieldAttachment).filter(FieldAttachment.field_id == attachment).count() == 1
    downloaded = client.get(
        f"/api/documents/{document_id}/fields/{attachment}/attachment", headers=headers
    )
    assert downloaded.status_code == 200 and downloaded.content == PNG_BYTES


def test_attachment_uploads_are_validated_like_the_sender_upload(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    _document_id, attachment, _signature, token = _attachment_document(client, pdf_bytes, headers)

    bad_extension = client.post(
        f"/api/sign/{token}/fields/{attachment}/attachment",
        files={"upload": ("payload.exe", b"MZ\x90\x00", "application/octet-stream")},
    )
    assert bad_extension.status_code == 400
    assert "Unsupported attachment type" in bad_extension.json()["detail"]

    # A renamed executable does not become a PNG.
    lying_extension = client.post(
        f"/api/sign/{token}/fields/{attachment}/attachment",
        files={"upload": ("payload.png", b"MZ\x90\x00 not a png", "image/png")},
    )
    assert lying_extension.status_code == 400
    assert "do not match" in lying_extension.json()["detail"]


def test_a_signer_who_uploads_to_another_recipients_attachment_is_refused(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    alice = add_recipient(client, document_id, headers, "Alice", "alice@example.com")
    bob = add_recipient(client, document_id, headers, "Bob", "bob@example.com")
    add_field(client, document_id, headers, alice, "signature", "Alice signature", 680)
    bob_attachment = add_field(client, document_id, headers, bob, "attachment", "Bob ID", 600)
    add_field(client, document_id, headers, bob, "signature", "Bob signature", 540)

    tokens = send(client, document_id, headers)
    alice_token = tokens["alice@example.com"]
    client.post(f"/api/sign/{alice_token}/consent")
    refused = client.post(
        f"/api/sign/{alice_token}/fields/{bob_attachment}/attachment",
        files={"upload": ("id.png", PNG_BYTES, "image/png")},
    )
    assert refused.status_code == 403


# --------------------------------------------------------------- SIGN-8


def test_a_completed_signer_receives_the_signed_copy_from_their_link(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    signature = add_field(client, document_id, headers, signer, "signature", "Signature", 680)
    token = send(client, document_id, headers)["signer@example.com"]
    client.post(f"/api/sign/{token}/consent")

    before = client.get(f"/api/sign/{token}/pdf")
    assert before.status_code == 200

    client.post(
        f"/api/sign/{token}/fields/{signature}/signature",
        json={"signature_type": "typed", "signature_text": "Signer One"},
    )
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    after = client.get(f"/api/sign/{token}/pdf")
    assert after.status_code == 200
    # Their copy is now the executed document, not the blank original.
    assert after.content != before.content
    assert "-signed.pdf" in after.headers["content-disposition"]

    # ...but the link is read-only: nothing can be written through it.
    assert (
        client.post(
            f"/api/sign/{token}/fields/{signature}/signature",
            json={"signature_type": "typed", "signature_text": "Again"},
        ).status_code
        == 409
    )


def test_an_email_field_rejects_a_non_address_even_with_validation_none(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """An Email field carries its format whether or not a kind was picked.

    The builder sets ``validation: "email"`` when it places one, but a field
    created through the API, a template or an older client leaves it at "none"
    — and the signing surface then accepted "dfghgdfhfdh" and flattened it into
    the executed contract.
    """

    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    field_id = add_field(
        client, document_id, headers, recipient_id, "email", "Work email", 120, validation="none"
    )
    tokens = send(client, document_id, headers)
    token = tokens["buyer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == 200

    bad = client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "dfghgdfhfdh"})
    assert bad.status_code == 400, bad.text
    assert "email" in bad.json()["detail"].lower()

    good = client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "buyer@example.com"})
    assert good.status_code == 200, good.text


def test_a_stamp_takes_an_image_and_rejects_a_pdf(client: TestClient, pdf_bytes: bytes) -> None:
    """A stamp is a mark on the page, so only an image can go in it."""

    png = (
        b"\x89PNG\r\n\x1a\n"
        + b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        + b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    stamp = add_field(client, document_id, headers, recipient_id, "stamp", "Company seal", 200)
    tokens = send(client, document_id, headers)
    token = tokens["buyer@example.com"]
    client.post(f"/api/sign/{token}/consent")

    refused = client.post(
        f"/api/sign/{token}/fields/{stamp}/attachment",
        files={"upload": ("seal.pdf", pdf_bytes, "application/pdf")},
    )
    assert refused.status_code == 400, refused.text
    assert "stamp image" in refused.json()["detail"]

    saved = client.post(
        f"/api/sign/{token}/fields/{stamp}/attachment",
        files={"upload": ("seal.png", png, "image/png")},
    )
    assert saved.status_code == 200, saved.text

    # And the signer can read their own stamp back, so a reload still shows it.
    fetched = client.get(f"/api/sign/{token}/fields/{stamp}/attachment")
    assert fetched.status_code == 200, fetched.text
    assert fetched.content == png
