"""Named sender branding themes (ORG-7): CRUD, the single-default invariant,
the per-envelope choice, and what the invitation email does with one."""

import base64

from fastapi import status
from fastapi.testclient import TestClient

from app.core.database import get_db
from app.tests.conftest import upgrade_plan
from app.tests.test_document_flow import add_field, add_recipient, create_uploaded_document


def register(client: TestClient, *, org: str, name: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def branded_tenant(client: TestClient, *, org: str, email: str) -> dict[str, str]:
    """A tenant on a plan that actually sells ``custom_branding``."""
    headers = register(client, org=org, name="Ada", email=email)
    upgrade_plan(client, headers, "business")
    return headers


def make_theme(client: TestClient, headers: dict[str, str], **body) -> dict:
    payload = {"name": "House brand"} | body
    response = client.post("/api/branding-themes", json=payload, headers=headers)
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return response.json()


def test_branding_is_gated_on_the_entitlement(client: TestClient) -> None:
    headers = register(client, org="Free Co", name="Ada", email="ada@free.com")
    client.get("/api/billing/plans")

    blocked = client.post("/api/branding-themes", json={"name": "House brand"}, headers=headers)
    assert blocked.status_code == 402, blocked.text
    assert blocked.json()["detail"]["feature"] == "custom_branding"


def test_first_theme_becomes_the_default_whether_or_not_it_asked(client: TestClient) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")

    first = make_theme(client, headers, name="House brand", is_default=False)
    assert first["is_default"] is True, "a tenant with themes but no default brands nothing"

    second = make_theme(client, headers, name="Partner brand")
    assert second["is_default"] is False


def test_promoting_a_theme_demotes_the_previous_default(client: TestClient) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    first = make_theme(client, headers, name="House brand")
    second = make_theme(client, headers, name="Partner brand")

    promoted = client.patch(
        f"/api/branding-themes/{second['id']}", json={"is_default": True}, headers=headers
    )
    assert promoted.status_code == 200, promoted.text

    themes = {t["id"]: t for t in client.get("/api/branding-themes", headers=headers).json()}
    assert themes[second["id"]]["is_default"] is True
    assert themes[first["id"]]["is_default"] is False


def test_the_only_default_cannot_simply_be_cleared(client: TestClient) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, headers)

    refused = client.patch(
        f"/api/branding-themes/{theme['id']}", json={"is_default": False}, headers=headers
    )
    assert refused.status_code == status.HTTP_409_CONFLICT, refused.text


def test_theme_names_are_unique_within_a_tenant_only(client: TestClient) -> None:
    acme = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(client, acme, name="House brand")

    clash = client.post("/api/branding-themes", json={"name": "House brand"}, headers=acme)
    assert clash.status_code == status.HTTP_409_CONFLICT, clash.text

    # The same name in another tenant is a different brand, not a collision.
    other = branded_tenant(client, org="Globex", email="bob@globex.com")
    make_theme(client, other, name="House brand")


def test_a_tenant_cannot_read_or_edit_another_tenants_theme(client: TestClient) -> None:
    acme = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, acme)

    globex = branded_tenant(client, org="Globex", email="bob@globex.com")
    assert client.get(f"/api/branding-themes/{theme['id']}", headers=globex).status_code == 404
    assert (
        client.patch(
            f"/api/branding-themes/{theme['id']}", json={"name": "Stolen"}, headers=globex
        ).status_code
        == 404
    )


def test_deleting_the_default_promotes_a_successor_and_frees_its_envelopes(client: TestClient) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    first = make_theme(client, headers, name="House brand")
    second = make_theme(client, headers, name="Partner brand")

    document = client.post("/api/documents", json={"title": "NDA"}, headers=headers).json()
    client.put(
        f"/api/documents/{document['id']}/routing",
        json={"branding_theme_id": first["id"]},
        headers=headers,
    )

    removed = client.delete(f"/api/branding-themes/{first['id']}", headers=headers)
    assert removed.status_code == status.HTTP_204_NO_CONTENT, removed.text

    remaining = client.get("/api/branding-themes", headers=headers).json()
    assert [t["id"] for t in remaining] == [second["id"]]
    assert remaining[0]["is_default"] is True, "a tenant is never left with themes but no default"

    # The envelope keeps sending; it falls back to the default it now has.
    routing = client.get(f"/api/documents/{document['id']}/routing", headers=headers).json()
    assert routing["branding_theme_id"] is None
    assert routing["effective_branding_theme_id"] == second["id"]


def test_an_envelope_names_a_theme_and_reports_the_effective_one(client: TestClient) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    default = make_theme(client, headers, name="House brand")
    other = make_theme(client, headers, name="Partner brand")
    document = client.post("/api/documents", json={"title": "NDA"}, headers=headers).json()

    # Nothing chosen: the tenant's default is what recipients will see.
    untouched = client.get(f"/api/documents/{document['id']}/routing", headers=headers).json()
    assert untouched["branding_theme_id"] is None
    assert untouched["effective_branding_theme_id"] == default["id"]

    chosen = client.put(
        f"/api/documents/{document['id']}/routing",
        json={"branding_theme_id": other["id"]},
        headers=headers,
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["effective_branding_theme_id"] == other["id"]

    # An explicit null releases it back to the default.
    cleared = client.put(
        f"/api/documents/{document['id']}/routing",
        json={"branding_theme_id": None},
        headers=headers,
    )
    assert cleared.json()["branding_theme_id"] is None
    assert cleared.json()["effective_branding_theme_id"] == default["id"]


def test_an_envelope_cannot_be_pointed_at_another_tenants_theme(client: TestClient) -> None:
    globex = branded_tenant(client, org="Globex", email="bob@globex.com")
    theirs = make_theme(client, globex, name="Globex brand")

    acme = branded_tenant(client, org="Acme", email="ada@acme.com")
    document = client.post("/api/documents", json={"title": "NDA"}, headers=acme).json()

    refused = client.put(
        f"/api/documents/{document['id']}/routing",
        json={"branding_theme_id": theirs["id"]},
        headers=acme,
    )
    assert refused.status_code == 404, refused.text


def test_the_theme_list_carries_over_pre_theme_branding_once(client: TestClient) -> None:
    """A tenant that set accent/logo before themes existed should not have to
    retype them, and must not gain a new "Default" on every read."""
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    client.patch(
        "/api/organizations/me",
        json={"accent_color": "#1d4ed8", "logo_url": "https://cdn.example.com/acme.png"},
        headers=headers,
    )

    seeded = client.get("/api/branding-themes", headers=headers).json()
    assert len(seeded) == 1
    assert seeded[0]["primary_color"] == "#1d4ed8"
    assert seeded[0]["logo_url"] == "https://cdn.example.com/acme.png"
    assert seeded[0]["is_default"] is True

    assert len(client.get("/api/branding-themes", headers=headers).json()) == 1


def test_the_invitation_email_carries_the_theme_and_the_envelopes_own_message(client: TestClient) -> None:
    from app.models.document import Document
    from app.models.recipient import Recipient
    from app.services.branding_service import branding_service
    from app.services.email_service import signflow_email_service

    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(
        client,
        headers,
        name="House brand",
        headline="Acme needs your signature",
        message="Acme Realty sends every agreement through SignerPro.",
        contact_sender_email="processing@acme.com",
        footer_signature="Acme Realty · 17 Station Street",
    )
    created = client.post("/api/documents", json={"title": "NDA"}, headers=headers).json()
    client.put(
        f"/api/documents/{created['id']}/routing",
        json={"invite_subject": "Please sign the NDA", "invite_message": "Closing is Friday."},
        headers=headers,
    )

    db = next(client.app.dependency_overrides[get_db]())
    document = db.get(Document, created["id"])
    recipient = Recipient(
        document_id=document.id, name="Nicole", email="nicole@example.com", signing_order=1
    )
    theme = branding_service.resolve_for_document(db, document=document)
    subject, body = signflow_email_service.invitation_body(
        document=document, recipient=recipient, link="https://app.test/sign/abc", theme=theme
    )

    # The envelope's own subject is more specific than the theme's headline.
    assert subject == "Please sign the NDA"
    assert "Acme needs your signature" in body
    assert "Acme Realty sends every agreement" in body
    assert "Closing is Friday." in body
    assert "processing@acme.com" in body
    assert "17 Station Street" in body
    assert "https://app.test/sign/abc" in body


def test_an_unbranded_tenant_still_gets_a_sane_invitation(client: TestClient) -> None:
    from app.models.document import Document
    from app.models.recipient import Recipient
    from app.services.email_service import signflow_email_service

    headers = register(client, org="Free Co", name="Ada", email="ada@free.com")
    created = client.post("/api/documents", json={"title": "NDA"}, headers=headers).json()
    db = next(client.app.dependency_overrides[get_db]())
    document = db.get(Document, created["id"])
    recipient = Recipient(
        document_id=document.id, name="Nicole", email="nicole@example.com", signing_order=1
    )

    subject, body = signflow_email_service.invitation_body(
        document=document, recipient=recipient, link="https://app.test/sign/abc", theme=None
    )
    assert subject == "Signature requested: NDA"
    assert "You were invited to review and sign a document" in body
    assert "https://app.test/sign/abc" in body


# --- the branded invitation as HTML (ORG-7) --------------------------------


def _document_and_recipient(client: TestClient, headers: dict[str, str]):
    from app.models.document import Document
    from app.models.recipient import Recipient

    created = client.post("/api/documents", json={"title": "NDA"}, headers=headers).json()
    db = next(client.app.dependency_overrides[get_db]())
    document = db.get(Document, created["id"])
    recipient = Recipient(
        document_id=document.id, name="Nicole", email="nicole@example.com", signing_order=1
    )
    return db, document, recipient


def test_the_html_invitation_carries_the_logo_colours_and_position(client: TestClient) -> None:
    from app.services.branding_service import branding_service
    from app.services.email_service import signflow_email_service

    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(
        client,
        headers,
        name="House brand",
        logo_url="https://cdn.example.com/acme.png",
        logo_position="right",
        primary_color="#0777CF",
        primary_text_color="#FFFFFF",
        headline="Acme needs your signature",
    )
    db, document, recipient = _document_and_recipient(client, headers)
    theme = branding_service.resolve_for_document(db, document=document)

    html = signflow_email_service.invitation_html(
        document=document, recipient=recipient, link="https://app.test/sign/abc", theme=theme
    )
    assert "https://cdn.example.com/acme.png" in html
    assert "text-align:right" in html
    assert "background:#0777CF" in html
    assert "color:#FFFFFF" in html
    assert "Acme needs your signature" in html
    assert 'href="https://app.test/sign/abc"' in html


def test_the_html_invitation_escapes_tenant_authored_text(client: TestClient) -> None:
    """A theme's message and a document's invite message are typed by a sender
    and rendered in someone else's mail client. They are data, not markup."""
    from app.services.branding_service import branding_service
    from app.services.email_service import signflow_email_service

    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(client, headers, name="House brand", message="<script>alert(1)</script>")
    db, document, recipient = _document_and_recipient(client, headers)
    theme = branding_service.resolve_for_document(db, document=document)

    html = signflow_email_service.invitation_html(
        document=document, recipient=recipient, link="https://app.test/sign/abc", theme=theme
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_an_unbranded_tenant_still_gets_a_sane_html_invitation(client: TestClient) -> None:
    from app.services.email_service import signflow_email_service

    headers = register(client, org="Free Co", name="Ada", email="ada@free.com")
    _, document, recipient = _document_and_recipient(client, headers)

    html = signflow_email_service.invitation_html(
        document=document, recipient=recipient, link="https://app.test/sign/abc", theme=None
    )
    assert "You were invited to review and sign a document" in html
    assert "<img" not in html, "an unbranded tenant must not borrow SignerPro's logo"


def test_the_invitation_goes_out_as_both_text_and_html(client: TestClient, pdf_bytes: bytes) -> None:
    """The text part is never dropped: a client that refuses HTML must still
    receive the whole invitation."""
    from unittest.mock import patch

    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(client, headers, name="House brand", primary_color="#0777CF")
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Nicole", "nicole@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Sign here", 640)

    with patch("app.core.email.email_service.send", return_value=True) as send:
        sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text

    assert send.call_count >= 1
    message = send.call_args_list[0].args[0]
    assert "Open your secure signing link:" in message.body
    assert message.html is not None and "#0777CF" in message.html


# --- branding on the signing chrome (ORG-7) --------------------------------


def _sent_envelope_token(client: TestClient, headers: dict[str, str], pdf_bytes: bytes) -> str:
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Nicole", "nicole@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Sign here", 640)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    link = sent.json()["signing_links"][0]["signing_link"]
    return link.rsplit("/", 1)[-1]


def test_the_signing_chrome_can_read_the_brand_before_any_gate(client: TestClient, pdf_bytes: bytes) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(
        client, headers, name="House brand",
        logo_url="https://cdn.example.com/acme.png", primary_color="#0777CF",
    )
    token = _sent_envelope_token(client, headers, pdf_bytes)

    branding = client.get(f"/api/sign/{token}/branding")
    assert branding.status_code == 200, branding.text
    body = branding.json()
    assert body["organization_name"] == "Acme"
    assert body["logo_url"] == "https://cdn.example.com/acme.png"
    assert body["primary_color"] == "#0777CF"


def test_a_bad_signing_token_is_unbranded_rather_than_an_error(client: TestClient, pdf_bytes: bytes) -> None:
    """The header must not become an oracle for whether a guessed token is
    real: an invalid token answers exactly as an unbranded tenant does."""
    unknown = client.get("/api/sign/not-a-real-token/branding")
    assert unknown.status_code == 200, unknown.text
    assert unknown.json() == {
        "organization_name": None, "theme_name": None, "logo_url": None,
        "logo_position": "left", "primary_color": None, "primary_text_color": None,
    }

    plain = register(client, org="Free Co", name="Ada", email="ada@free.com")
    token = _sent_envelope_token(client, plain, pdf_bytes)
    assert client.get(f"/api/sign/{token}/branding").json() == unknown.json()


def test_the_signing_session_carries_the_brand(client: TestClient, pdf_bytes: bytes) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(client, headers, name="House brand", primary_color="#0777CF")
    token = _sent_envelope_token(client, headers, pdf_bytes)

    session = client.get(f"/api/sign/{token}")
    assert session.status_code == 200, session.text
    assert session.json()["branding"]["primary_color"] == "#0777CF"


def test_the_signer_brand_never_carries_the_tenants_internals(client: TestClient, pdf_bytes: bytes) -> None:
    """A signing link is held by someone outside the organization: the payload
    must not hand them theme ids or envelope counts."""
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    make_theme(client, headers, name="House brand", primary_color="#0777CF")
    token = _sent_envelope_token(client, headers, pdf_bytes)

    body = client.get(f"/api/sign/{token}/branding").json()
    assert set(body) == {
        "organization_name", "theme_name", "logo_url",
        "logo_position", "primary_color", "primary_text_color",
    }


# --- an uploaded logo (ORG-7) ----------------------------------------------

PNG_1PX = base64.b64encode(
    bytes.fromhex(
        "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
        "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae4260 82"
        .replace(" ", "")
    )
).decode()


def test_a_logo_is_uploaded_rather_than_linked(client: TestClient) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, headers, name="House brand")

    uploaded = client.put(
        f"/api/branding-themes/{theme['id']}/logo",
        json={"image_base64": PNG_1PX},
        headers=headers,
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["logo_uploaded"] is True
    # The URL points at the public frontend origin, not at the storage key:
    # a recipient's mail client has no session and cannot reach the API.
    assert f"/brand/{theme['id']}/logo" in body["logo_url"]
    assert body["logo_url"].startswith("http")


def test_the_uploaded_logo_is_served_to_anyone_holding_the_url(client: TestClient) -> None:
    """It goes into invitation emails, so it has to work with no session."""
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, headers, name="House brand")
    client.put(
        f"/api/branding-themes/{theme['id']}/logo",
        json={"image_base64": PNG_1PX},
        headers=headers,
    )

    served = client.get(f"/api/branding-themes/{theme['id']}/logo")
    assert served.status_code == 200, served.text
    assert served.headers["content-type"] == "image/png"
    assert served.content.startswith(b"\x89PNG")


def test_a_theme_with_no_logo_serves_a_404_rather_than_an_empty_image(client: TestClient) -> None:
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, headers, name="House brand")
    assert client.get(f"/api/branding-themes/{theme['id']}/logo").status_code == 404
    assert client.get("/api/branding-themes/not-a-theme/logo").status_code == 404


def test_a_logo_must_actually_be_an_image(client: TestClient) -> None:
    """The declared content type is the browser's word for it; the magic number
    is ours. This file is served back out to third parties."""
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, headers, name="House brand")

    svg = base64.b64encode(b'<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>').decode()
    refused = client.put(
        f"/api/branding-themes/{theme['id']}/logo", json={"image_base64": svg}, headers=headers
    )
    assert refused.status_code == 400, refused.text

    not_base64 = client.put(
        f"/api/branding-themes/{theme['id']}/logo", json={"image_base64": "%%%"}, headers=headers
    )
    assert not_base64.status_code == 400


def test_an_oversized_logo_is_refused(client: TestClient) -> None:
    from app.services.branding_service import LOGO_MAX_BYTES

    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, headers, name="House brand")

    huge = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * (LOGO_MAX_BYTES + 1)).decode()
    refused = client.put(
        f"/api/branding-themes/{theme['id']}/logo", json={"image_base64": huge}, headers=headers
    )
    assert refused.status_code == 413, refused.text


def test_uploading_a_logo_clears_a_pasted_url(client: TestClient) -> None:
    """The two must not be able to disagree about what the brand is."""
    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(
        client, headers, name="House brand", logo_url="https://cdn.example.com/old.png"
    )

    uploaded = client.put(
        f"/api/branding-themes/{theme['id']}/logo",
        json={"image_base64": PNG_1PX},
        headers=headers,
    ).json()
    assert "cdn.example.com" not in (uploaded["logo_url"] or "")

    removed = client.delete(f"/api/branding-themes/{theme['id']}/logo", headers=headers).json()
    assert removed["logo_uploaded"] is False
    assert removed["logo_url"] is None
    assert client.get(f"/api/branding-themes/{theme['id']}/logo").status_code == 404


def test_only_an_admin_of_that_tenant_can_change_a_logo(client: TestClient) -> None:
    acme = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, acme, name="House brand")

    globex = branded_tenant(client, org="Globex", email="bob@globex.com")
    stolen = client.put(
        f"/api/branding-themes/{theme['id']}/logo",
        json={"image_base64": PNG_1PX},
        headers=globex,
    )
    assert stolen.status_code == 404, stolen.text


def test_the_invitation_email_carries_the_uploaded_logo(client: TestClient, pdf_bytes: bytes) -> None:
    from unittest.mock import patch

    headers = branded_tenant(client, org="Acme", email="ada@acme.com")
    theme = make_theme(client, headers, name="House brand")
    client.put(
        f"/api/branding-themes/{theme['id']}/logo",
        json={"image_base64": PNG_1PX},
        headers=headers,
    )

    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Nicole", "nicole@example.com")
    add_field(client, document_id, headers, recipient_id, "signature", "Sign here", 640)

    with patch("app.core.email.email_service.send", return_value=True) as send:
        assert client.post(f"/api/documents/{document_id}/send", headers=headers).status_code == 200

    html = send.call_args_list[0].args[0].html
    assert f"/brand/{theme['id']}/logo" in html
