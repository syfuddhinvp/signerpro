"""The platform mail outbox (`/api/saas/mail`).

Two things are load-bearing here and are asserted directly: that a message the
product sends on its own is in the outbox without any caller having logged it,
and that the stored body has had its bearer link masked -- an outbox that keeps
signing links verbatim is a credential store every platform admin can read.
"""

import base64

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.email import EmailMessage, SendOutcome, email_service
from app.main import app
from app.models.user import User
from app.schemas.mail import MailAttachment
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document


def _promote(client: TestClient, headers: dict[str, str]) -> None:
    generator = app.dependency_overrides[get_db]()
    session = next(generator)
    user = session.get(User, client.get("/api/auth/me", headers=headers).json()["id"])
    user.is_platform_admin = True
    session.add(user)
    session.commit()
    generator.close()


def _admin(client: TestClient) -> dict[str, str]:
    headers = auth_headers(client)
    _promote(client, headers)
    return headers


def _send_an_invitation(client: TestClient, headers: dict[str, str], pdf_bytes: bytes) -> None:
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Dana Reed", "dana@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Sign here", 640)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text


def test_product_mail_lands_in_the_outbox_with_its_link_masked(
    client: TestClient, pdf_bytes: bytes
) -> None:
    headers = _admin(client)
    _send_an_invitation(client, headers, pdf_bytes)

    page = client.get("/api/saas/mail", headers=headers)
    assert page.status_code == 200, page.text
    body = page.json()
    invitations = [row for row in body["items"] if row["category"] == "invitation"]
    assert invitations, body["items"]
    row = invitations[0]
    assert row["to_email"] == "dana@example.com"
    # The list omits bodies on purpose: a page of branded HTML is megabytes the
    # table never renders. The snippet is what the list shows instead.
    assert row["body_html"] is None
    assert row["snippet"] and "Hello Dana Reed" in row["snippet"]

    detail = client.get(f"/api/saas/mail/{row['id']}", headers=headers).json()
    assert "/sign/[redacted]" in detail["body_text"]
    assert "/sign/[redacted]" in detail["body_html"]


def test_a_one_time_passcode_is_stored_without_its_body(client: TestClient) -> None:
    """A verification mail *is* the code, so masking a link would leave it."""
    from app.core.email import EmailMessage, email_service

    email_service.send(
        EmailMessage(
            to_email="dana@example.com",
            subject="SignFlow Verification Code",
            body="Your secure verification code is: 483920",
            category="verification",
            body_is_secret=True,
        )
    )
    headers = _admin(client)
    rows = client.get("/api/saas/mail", params={"category": "verification"}, headers=headers).json()["items"]
    assert rows and rows[0]["subject"] == "SignFlow Verification Code"
    detail = client.get(f"/api/saas/mail/{rows[0]['id']}", headers=headers).json()
    assert detail["body_text"] is None
    assert "483920" not in (detail["body_html"] or "")


def test_composing_custom_mail_records_one_row_per_addressee(client: TestClient) -> None:
    headers = _admin(client)
    response = client.post(
        "/api/saas/mail/send",
        json={
            "to": ["one@example.com", "two@example.com"],
            "subject": "Scheduled maintenance",
            "body": "We will be briefly unavailable.\n\nNo action is needed.",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    result = response.json()
    assert result["sent"] == 2 and result["failed"] == 0
    assert {row["to_email"] for row in result["items"]} == {"one@example.com", "two@example.com"}

    listed = client.get("/api/saas/mail", params={"category": "custom"}, headers=headers).json()
    assert listed["total"] == 2
    detail = client.get(f"/api/saas/mail/{result['items'][0]['id']}", headers=headers).json()
    assert "We will be briefly unavailable." in detail["body_text"]
    # Composed text is escaped into the standard shell, never injected as markup.
    assert "<p style=" in detail["body_html"]


def test_the_outbox_is_platform_admin_only(client: TestClient) -> None:
    headers = auth_headers(client)  # a tenant admin, not a platform admin
    assert client.get("/api/saas/mail", headers=headers).status_code == 403
    assert client.post(
        "/api/saas/mail/send",
        json={"to": ["one@example.com"], "subject": "Hi", "body": "Hello"},
        headers=headers,
    ).status_code == 403


def test_composed_mail_carries_copies_and_attachments(client: TestClient, monkeypatch) -> None:
    """Cc, Bcc and files reach the gateway, and copies ride one message only.

    A Cc repeated on every addressee's message delivers one copy per addressee
    to each copied address -- a note to twenty people landing in a manager's
    inbox twenty times.
    """
    seen: list[EmailMessage] = []
    monkeypatch.setattr(
        email_service, "_deliver", lambda message, org: seen.append(message) or SendOutcome(True, "sent", "console", None, "no-reply@test")
    )

    headers = _admin(client)
    response = client.post(
        "/api/saas/mail/send",
        json={
            "to": ["one@example.com", "two@example.com"],
            "cc": ["lead@example.com"],
            "bcc": ["audit@example.com"],
            "subject": "Scheduled maintenance",
            "body": "We will be briefly unavailable.",
            "attachments": [
                {
                    "filename": "notice.txt",
                    "content_type": "text/plain",
                    "content": base64.b64encode(b"hello").decode(),
                }
            ],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text

    assert [m.cc for m in seen] == [("lead@example.com",), ()]
    assert [m.bcc for m in seen] == [("audit@example.com",), ()]
    # The files, though, belong to the message and go to every addressee.
    assert all(m.attachments[0].content == b"hello" for m in seen)
    assert seen[0].attachments[0].filename == "notice.txt"


def test_an_attachment_filename_is_a_label_not_a_path(client: TestClient) -> None:
    headers = _admin(client)
    response = client.post(
        "/api/saas/mail/send",
        json={
            "to": ["one@example.com"],
            "subject": "Hi",
            "body": "Hello",
            "attachments": [
                {
                    "filename": "../../etc/passwd",
                    "content": base64.b64encode(b"x").decode(),
                }
            ],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert MailAttachment(filename="../../etc/passwd", content="eA==").filename == "passwd"


def test_an_oversized_attachment_is_refused(client: TestClient) -> None:
    headers = _admin(client)
    response = client.post(
        "/api/saas/mail/send",
        json={
            "to": ["one@example.com"],
            "subject": "Hi",
            "body": "Hello",
            "attachments": [
                {
                    "filename": "scan.pdf",
                    "content": base64.b64encode(b"x" * (5 * 1024 * 1024 + 1)).decode(),
                }
            ],
        },
        headers=headers,
    )
    assert response.status_code == 422
