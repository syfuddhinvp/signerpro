"""The header bell's feed.

The `notifications` table shipped in a migration and was then read by nothing,
so these tests exist mainly to hold two properties the shell depends on: the
badge counts every unread row rather than the returned page, and one user
never sees another's rows.
"""

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.notification import Notification
from app.models.user import User
from app.tests.conftest import auth_headers


def _session():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _seed(headers: dict[str, str], count: int, *, unread: int, title: str = "Ready to sign") -> User:
    """Write `count` rows for the caller, `unread` of them unread."""
    from app.core.security import decode_access_token
    from app.models.mixins import now_utc

    claims = decode_access_token(headers["Authorization"].split()[1])
    session, generator = _session()
    user = session.get(User, claims["sub"])
    for index in range(count):
        session.add(
            Notification(
                user_id=user.id,
                organization_id=user.organization_id,
                title=f"{title} {index}",
                detail="Purchase agreement",
                tone="info",
                screen="audit",
                read_at=None if index < unread else now_utc(),
            )
        )
    session.commit()
    generator.close()
    return user


def test_feed_lists_rows_and_counts_every_unread(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 6, unread=4)

    # A page smaller than the feed: the badge must still say 4, not 2.
    response = client.get("/api/notifications", params={"limit": 2}, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["items"]) == 2
    assert body["unread"] == 4
    assert body["total"] == 6
    assert body["items"][0]["screen"] == "audit"


def test_empty_feed_is_not_an_error(client: TestClient) -> None:
    headers = auth_headers(client)
    response = client.get("/api/notifications", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["unread"] == 0
    assert body["total"] == 0
    # Every tone the page offers is present at zero, so its filter controls do
    # not appear and disappear as the feed fills and empties.
    assert body["facets"] == {"tones": {"bad": 0, "warn": 0, "good": 0, "info": 0}, "unread": 0, "read": 0}


def test_status_unread_filters_the_page_but_not_the_badge(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 5, unread=2)

    body = client.get("/api/notifications", params={"status": "unread"}, headers=headers).json()
    assert len(body["items"]) == 2
    assert body["total"] == 2
    assert body["unread"] == 2


def test_marking_one_read_drops_the_badge_once(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 3, unread=3)
    target = client.get("/api/notifications", headers=headers).json()["items"][0]["id"]

    first = client.post(f"/api/notifications/{target}/read", headers=headers)
    assert first.status_code == 200
    assert first.json() == {"updated": 1, "deleted": 0, "unread": 2}

    # Idempotent: reading an already-read row changes nothing.
    again = client.post(f"/api/notifications/{target}/read", headers=headers)
    assert again.json() == {"updated": 0, "deleted": 0, "unread": 2}


def test_read_all_clears_the_badge(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 4, unread=3)

    response = client.post("/api/notifications/read-all", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"updated": 3, "deleted": 0, "unread": 0}
    assert client.get("/api/notifications", headers=headers).json()["unread"] == 0


def test_another_users_notification_is_not_readable(client: TestClient) -> None:
    headers = auth_headers(client)
    owner = _seed(headers, 1, unread=1)

    # A second tenant, with its own row.
    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Beta Legal",
            "name": "Other Admin",
            "email": "other@example.com",
            "password": "strong-password",
        },
    )
    assert other.status_code == 201, other.text
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    # The other tenant sees an empty feed, not Acme's row.
    assert client.get("/api/notifications", headers=other_headers).json()["total"] == 0

    session, generator = _session()
    row_id = (
        session.query(Notification).filter(Notification.user_id == owner.id).one().id
    )
    generator.close()

    # And cannot mark it read — 404, so the id is not confirmed to exist.
    assert client.post(f"/api/notifications/{row_id}/read", headers=other_headers).status_code == 404
    assert client.get("/api/notifications", headers=headers).json()["unread"] == 1


def test_feed_requires_a_session(client: TestClient) -> None:
    assert client.get("/api/notifications").status_code == 401


# --- the producer (audit event -> bell row) ---------------------------------


def test_signing_a_document_notifies_its_owner(client: TestClient, pdf_bytes: bytes) -> None:
    """The feed is produced from audit events, not written by hand.

    This is the property the header actually depends on: a signer acting on an
    envelope puts a row in the owner's bell without anyone calling a
    notification API.
    """
    from app.tests.test_document_flow import (
        add_field,
        add_recipient,
        create_uploaded_document,
        token_from_link,
    )

    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    buyer_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    name_field = add_field(client, document_id, headers, buyer_id, "full_name", "Buyer full name", 680)
    sig_field = add_field(client, document_id, headers, buyer_id, "signature", "Buyer signature", 620)

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text

    # Sending is the owner's own action, so it raises no bell for them.
    assert client.get("/api/notifications", headers=headers).json()["unread"] == 0

    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    assert client.post(f"/api/sign/{token}/consent").status_code == 200
    assert client.post(
        f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"}
    ).status_code == 200
    assert client.post(
        f"/api/sign/{token}/fields/{sig_field}/signature",
        json={"signature_type": "typed", "signature_text": "Buyer One"},
    ).status_code == 200
    assert client.post(f"/api/sign/{token}/complete").status_code == 200

    feed = client.get("/api/notifications", headers=headers).json()
    titles = [item["title"] for item in feed["items"]]
    assert "Document completed" in titles
    assert "Recipient signed" in titles
    assert feed["unread"] == len(feed["items"])
    completed = next(item for item in feed["items"] if item["title"] == "Document completed")
    assert completed["tone"] == "good"
    # The row leads back to the envelope it is about.
    assert completed["screen"] == "audit"
    assert completed["target_id"] == document_id
    assert "Buyer Seller Packet" in completed["detail"]


def test_a_switched_off_preference_raises_no_row(client: TestClient, pdf_bytes: bytes) -> None:
    """`NOTIFICATION_EVENTS` switches used to govern nothing. They govern this."""
    from app.tests.test_document_flow import (
        add_field,
        add_recipient,
        create_uploaded_document,
        token_from_link,
    )

    headers = auth_headers(client)
    off = client.put(
        "/api/me/notification-preferences",
        json={"prefs": {"document_signed": False, "document_completed": False}},
        headers=headers,
    )
    assert off.status_code == 200, off.text

    document_id = create_uploaded_document(client, pdf_bytes, headers)
    buyer_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    name_field = add_field(client, document_id, headers, buyer_id, "full_name", "Buyer full name", 680)
    sig_field = add_field(client, document_id, headers, buyer_id, "signature", "Buyer signature", 620)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{name_field}/value", json={"value": "Buyer One"})
    client.post(
        f"/api/sign/{token}/fields/{sig_field}/signature",
        json={"signature_type": "typed", "signature_text": "Buyer One"},
    )
    client.post(f"/api/sign/{token}/complete")

    titles = [item["title"] for item in client.get("/api/notifications", headers=headers).json()["items"]]
    assert "Recipient signed" not in titles
    assert "Document completed" not in titles


# --- the notifications page: filters ---------------------------------------


def _seed_mixed(headers: dict[str, str]) -> User:
    """A feed with several tones, ages and read states, for the filters."""
    from app.core.security import decode_access_token
    from app.models.mixins import now_utc
    from datetime import timedelta

    claims = decode_access_token(headers["Authorization"].split()[1])
    session, generator = _session()
    user = session.get(User, claims["sub"])
    now = now_utc()
    specs = [
        ("Document completed", "Purchase agreement — completed.", "good", 0, None),
        ("Recipient signed", "Purchase agreement — buyer signed.", "good", 1, None),
        ("Document declined", "Mutual NDA — declined by seller.", "bad", 2, None),
        ("Document expired", "Contractor agreement — expired.", "warn", 40, now),
        ("Document viewed", "Mutual NDA — opened.", "info", 100, now),
    ]
    for title, detail, tone, days_ago, read_at in specs:
        session.add(
            Notification(
                user_id=user.id,
                organization_id=user.organization_id,
                title=title,
                detail=detail,
                tone=tone,
                screen="audit",
                read_at=read_at,
                created_at=now - timedelta(days=days_ago),
            )
        )
    session.commit()
    generator.close()
    return user


def test_tone_filter_selects_one_tone(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed_mixed(headers)

    body = client.get("/api/notifications", params={"tone": "bad"}, headers=headers).json()
    assert [item["title"] for item in body["items"]] == ["Document declined"]
    assert body["total"] == 1
    # The tone facets are not narrowed by the tone filter — a chip has to say
    # how many rows it would select, not echo the current selection.
    assert body["facets"]["tones"] == {"bad": 1, "warn": 1, "good": 2, "info": 1}


def test_an_unknown_tone_is_rejected(client: TestClient) -> None:
    headers = auth_headers(client)
    assert client.get("/api/notifications", params={"tone": "purple"}, headers=headers).status_code == 400


def test_search_covers_the_detail_line_not_just_the_title(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed_mixed(headers)

    # "Mutual NDA" appears only in the detail; the titles are a fixed
    # vocabulary, so a title-only search would find nothing a user looks for.
    body = client.get("/api/notifications", params={"q": "Mutual NDA"}, headers=headers).json()
    assert {item["title"] for item in body["items"]} == {"Document declined", "Document viewed"}
    assert body["total"] == 2
    # Facets follow the search, because every chip on the page shares it.
    assert body["facets"]["tones"] == {"bad": 1, "warn": 0, "good": 0, "info": 1}
    assert body["facets"]["unread"] == 1
    assert body["facets"]["read"] == 1


def test_since_days_filters_by_age(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed_mixed(headers)

    recent = client.get("/api/notifications", params={"since_days": 7}, headers=headers).json()
    assert recent["total"] == 3
    # The badge still counts the unread rows the filter excluded.
    assert recent["unread"] == 3
    assert client.get("/api/notifications", params={"since_days": 365}, headers=headers).json()["total"] == 5


def test_read_status_and_paging(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed_mixed(headers)

    read = client.get("/api/notifications", params={"status": "read"}, headers=headers).json()
    assert read["total"] == 2
    assert all(item["read_at"] for item in read["items"])

    # Newest first, and the offset walks that order.
    page = client.get("/api/notifications", params={"limit": 2, "offset": 2}, headers=headers).json()
    assert [item["title"] for item in page["items"]] == ["Document declined", "Document expired"]
    assert page["total"] == 5


# --- the notifications page: actions ---------------------------------------


def test_bulk_read_and_unread(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 4, unread=4)
    ids = [item["id"] for item in client.get("/api/notifications", headers=headers).json()["items"]]

    marked = client.post("/api/notifications/bulk", json={"ids": ids[:2], "action": "read"}, headers=headers)
    assert marked.status_code == 200, marked.text
    assert marked.json() == {"updated": 2, "deleted": 0, "unread": 2}

    # Undo, because a bulk misclick is easy and reading is otherwise final.
    back = client.post("/api/notifications/bulk", json={"ids": ids[:2], "action": "unread"}, headers=headers)
    assert back.json() == {"updated": 2, "deleted": 0, "unread": 4}


def test_bulk_delete_ignores_ids_the_caller_does_not_own(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 3, unread=3)
    ids = [item["id"] for item in client.get("/api/notifications", headers=headers).json()["items"]]

    # A stale selection must still apply to the rows that do exist.
    response = client.post(
        "/api/notifications/bulk",
        json={"ids": [ids[0], "does-not-exist"], "action": "delete"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"updated": 0, "deleted": 1, "unread": 2}
    assert client.get("/api/notifications", headers=headers).json()["total"] == 2


def test_bulk_rejects_an_empty_selection(client: TestClient) -> None:
    headers = auth_headers(client)
    assert client.post("/api/notifications/bulk", json={"ids": [], "action": "read"}, headers=headers).status_code == 422


def test_deleting_one_row(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 2, unread=2)
    target = client.get("/api/notifications", headers=headers).json()["items"][0]["id"]

    assert client.delete(f"/api/notifications/{target}", headers=headers).json() == {
        "updated": 0, "deleted": 1, "unread": 1,
    }
    assert client.delete(f"/api/notifications/{target}", headers=headers).status_code == 404


def test_clear_read_leaves_unread_rows_alone(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 5, unread=2)

    response = client.post("/api/notifications/clear-read", headers=headers)
    assert response.json() == {"updated": 0, "deleted": 3, "unread": 2}
    # The unread rows survive: a "clear" that discarded them would lose the
    # only in-app record of an event nobody has seen.
    body = client.get("/api/notifications", headers=headers).json()
    assert body["total"] == 2
    assert body["unread"] == 2


def test_marking_unread_restores_the_badge(client: TestClient) -> None:
    headers = auth_headers(client)
    _seed(headers, 2, unread=0)
    target = client.get("/api/notifications", headers=headers).json()["items"][0]["id"]

    assert client.post(f"/api/notifications/{target}/unread", headers=headers).json() == {
        "updated": 1, "deleted": 0, "unread": 1,
    }
    # Idempotent, like its opposite.
    assert client.post(f"/api/notifications/{target}/unread", headers=headers).json()["updated"] == 0


def test_page_actions_cannot_reach_another_users_rows(client: TestClient) -> None:
    headers = auth_headers(client)
    owner = _seed(headers, 2, unread=2)

    other = client.post(
        "/api/auth/register",
        json={
            "organization_name": "Beta Legal",
            "name": "Other Admin",
            "email": "other2@example.com",
            "password": "strong-password",
        },
    )
    other_headers = {"Authorization": f"Bearer {other.json()['access_token']}"}

    session, generator = _session()
    ids = [row.id for row in session.query(Notification).filter(Notification.user_id == owner.id)]
    generator.close()

    assert client.delete(f"/api/notifications/{ids[0]}", headers=other_headers).status_code == 404
    assert client.post(
        "/api/notifications/bulk", json={"ids": ids, "action": "delete"}, headers=other_headers
    ).json() == {"updated": 0, "deleted": 0, "unread": 0}
    assert client.post("/api/notifications/clear-read", headers=other_headers).json()["deleted"] == 0
    # Untouched.
    assert client.get("/api/notifications", headers=headers).json()["total"] == 2
