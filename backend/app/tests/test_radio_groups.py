"""Radio groups: one field per button, one answer for the group.

A radio group is authored as a *set* of ``radio`` fields, one per button, tied
together by their ``options`` (``frontend/lib/sf/radioGroups.ts``):

    {"kind": "radio", "group": ..., "choice": ..., "choices": [...]}

``choices`` is the whole group's list on every member, so the closed set the API
enforces is the question's set rather than one button's label, and the group's
answer is a single value every member carries. Two things follow, and both are
pinned here: the API has to accept any of the group's choices on any of its
buttons, and the flattened PDF has to draw each button as a button -- filled
only where the answer is that button's own choice. Before this a radio field
was flattened by printing its value as a line of text, which for a group of
buttons stamped the chosen label into every circle on the page.
"""

from io import BytesIO

from fastapi import status
from fastapi.testclient import TestClient
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from app.services.field_service import field_service
from app.services.pdf_service import pdf_service
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import create_uploaded_document
from app.tests.test_signing_correctness import add_field, add_recipient, send


CHOICES = ["Gold", "Silver", "Bronze"]


def member(index: int) -> dict:
    return {
        "kind": "radio",
        "group": "rg-1",
        "choice": CHOICES[index],
        "choices": CHOICES,
        "groupLabel": "Tier",
    }


class _Row:
    """The slice of a ``Field`` row the flattening code reads."""

    def __init__(self, options, value=None):
        self.options = options
        self.value = value


def test_every_button_of_a_group_accepts_any_of_the_groups_choices() -> None:
    # `allowed_options` reads the group's list, not the button's own label --
    # otherwise picking "Silver" would be rejected on two buttons out of three.
    for index in range(3):
        assert field_service.allowed_options(_Row(member(index))) == CHOICES


def test_a_signer_can_pick_any_button_of_the_group(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    signer = add_recipient(client, document_id, headers, "Signer", "signer@example.com")
    buttons = [
        add_field(client, document_id, headers, signer, "radio", "Tier", 700 - index * 30, options=member(index))
        for index in range(3)
    ]

    token = send(client, document_id, headers)["signer@example.com"]
    assert client.post(f"/api/sign/{token}/consent").status_code == status.HTTP_200_OK

    # The group's answer is written to every one of its buttons.
    for field_id in buttons:
        saved = client.post(f"/api/sign/{token}/fields/{field_id}/value", json={"value": "Silver"})
        assert saved.status_code == status.HTTP_200_OK, saved.text

    rejected = client.post(f"/api/sign/{token}/fields/{buttons[0]}/value", json={"value": "Platinum"})
    assert rejected.status_code == status.HTTP_400_BAD_REQUEST


def _content_of(options, value) -> str:
    packet = BytesIO()
    pdf = canvas.Canvas(packet, pagesize=(612, 792))
    choice = pdf_service._radio_choice(_Row(options, value))
    assert choice is not None
    pdf_service._draw_radio(pdf, 60, 600, 20, 20, filled=str(value or "").strip() == choice)
    pdf.save()
    page = PdfReader(BytesIO(packet.getvalue())).pages[0]
    return page.get_contents().get_data().decode("latin-1")


def test_the_picked_button_is_drawn_filled_and_the_others_are_not() -> None:
    picked = _content_of(member(1), "Silver")
    unpicked = _content_of(member(0), "Silver")
    # A circle is drawn as bezier curves ("c") either way -- the ring is part of
    # the question, so an unpicked button still shows on the executed document.
    assert " c\n" in picked and " c\n" in unpicked
    # Only the picked one carries a filled path.
    assert "\nf*\n" in picked
    assert "\nf*\n" not in unpicked


def test_a_radio_authored_before_groups_is_not_treated_as_a_button() -> None:
    # One box listing its choices: it has no `choice` of its own, so it keeps
    # being flattened as the value it holds.
    assert pdf_service._radio_choice(_Row(["Yes", "No"], "Yes")) is None
    assert pdf_service._radio_choice(_Row({"choices": CHOICES}, "Gold")) is None
