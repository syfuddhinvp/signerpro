"""Calculated fields and currency (W10).

`formula` was retired from the palette because it computed nothing -- a plain
input wearing an `fx` badge -- and `currency` because it neither formatted nor
validated an amount. These tests are what let both be offered honestly again.
"""

import pytest
from fastapi.testclient import TestClient

from app.services import formula_service
from app.services.formula_service import FormulaError, evaluate, format_currency, parse
from app.tests.conftest import auth_headers
from app.tests.test_document_flow import add_recipient, create_uploaded_document, token_from_link


# --- the evaluator ---------------------------------------------------------


@pytest.mark.parametrize(
    "expression, values, expected",
    [
        ("{{subtotal}} * 0.2", {"subtotal": "1,250.00"}, "250.00"),
        ("({{price}} - {{discount}}) * {{qty}}", {"price": "100", "discount": "10", "qty": "3"}, "270.00"),
        ("{{a}} + {{b}}", {"a": "1.005", "b": "2.005"}, "3.01"),
        ("-{{a}}", {"a": "5"}, "-5.00"),
        ("{{a}} / {{b}}", {"a": "10", "b": "4"}, "2.50"),
        # What people actually type into a money field.
        ("{{a}} + 1", {"a": "$1,234.50"}, "1,235.50"),
        ("{{a}} + 1", {"a": "(50)"}, "-49.00"),
    ],
)
def test_expressions_evaluate_in_decimal(expression, values, expected) -> None:
    assert evaluate(expression, values) == expected


def test_an_incomplete_formula_is_blank_not_zero() -> None:
    """Rendering an unfilled total as 0.00 in a contract is a fabricated number."""
    assert evaluate("{{a}} + {{b}}", {"a": "1"}) is None
    assert evaluate("{{a}} + {{b}}", {}) is None


def test_division_by_zero_blanks_rather_than_raising() -> None:
    """An authoring mistake meeting particular data must not 500 the signer."""
    assert evaluate("{{a}} / {{b}}", {"a": "1", "b": "0"}) is None


@pytest.mark.parametrize(
    "hostile",
    [
        '__import__("os").system("id")',
        'open("/etc/passwd").read()',
        "().__class__.__bases__",
        "9**9**9",                      # a literal that would hang the process
        "[x for x in range(10)]",
        "lambda: 1",
        "a + 1",                        # a bare name is not a field reference
        '"a string"',
        "{{a}} if 1 else 2",
    ],
)
def test_the_evaluator_is_a_whitelist_not_a_sandbox(hostile) -> None:
    """`eval` on an author-supplied string is RCE with extra steps."""
    with pytest.raises(FormulaError):
        parse(hostile)


def test_an_over_long_expression_is_refused() -> None:
    with pytest.raises(FormulaError):
        parse("1+" * formula_service.MAX_EXPRESSION_LENGTH)


def test_currency_formats_and_rejects() -> None:
    assert format_currency("$1,234.5") == "1,234.50"
    assert format_currency("(50)") == "-50.00"
    assert format_currency("abc") is None


# --- end to end ------------------------------------------------------------


def _document_with_total(client: TestClient, pdf_bytes: bytes, headers, expression="{{subtotal}} * 0.2"):
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")

    subtotal = client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id, "type": "number", "label": "Subtotal",
            "page_number": 1, "x": 60, "y": 100, "width": 120, "height": 32,
            "merge_tag": "subtotal",
        },
        headers=headers,
    )
    assert subtotal.status_code == 201, subtotal.text

    total = client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id, "type": "formula", "label": "VAT",
            "page_number": 1, "x": 60, "y": 160, "width": 120, "height": 32,
            "options": {"expression": expression},
        },
        headers=headers,
    )
    return document_id, recipient_id, subtotal.json()["id"], total


def test_a_formula_field_is_computed_server_side(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id, _, subtotal_id, total = _document_with_total(client, pdf_bytes, headers)
    assert total.status_code == 201, total.text
    total_id = total.json()["id"]

    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{subtotal_id}/value", json={"value": "1250"})

    fields = client.get(f"/api/sign/{token}").json()["fields"]
    computed = next(f for f in fields if f["id"] == total_id)
    assert computed["value"] == "250.00"


def test_a_signer_cannot_post_their_own_total(client: TestClient, pdf_bytes: bytes) -> None:
    """Otherwise the counterparty chooses the number on their own contract."""
    headers = auth_headers(client)
    document_id, _, _, total = _document_with_total(client, pdf_bytes, headers)
    total_id = total.json()["id"]
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")

    response = client.post(f"/api/sign/{token}/fields/{total_id}/value", json={"value": "1.00"})
    assert response.status_code == 400
    assert "calculated" in response.text


def test_a_required_formula_does_not_block_completion(client: TestClient, pdf_bytes: bytes) -> None:
    """It cannot be filled in, so requiring one would deadlock the envelope."""
    headers = auth_headers(client)
    document_id, _, subtotal_id, _ = _document_with_total(client, pdf_bytes, headers)
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    client.post(f"/api/sign/{token}/fields/{subtotal_id}/value", json={"value": "10"})
    assert client.post(f"/api/sign/{token}/complete").status_code == 200


def test_a_bad_expression_is_rejected_while_authoring(client: TestClient, pdf_bytes: bytes) -> None:
    """Not at signing time, in front of the counterparty, on a sent document."""
    headers = auth_headers(client)
    _, _, _, total = _document_with_total(
        client, pdf_bytes, headers, expression='__import__("os").system("id")'
    )
    assert total.status_code == 400
    assert "may only contain" in total.text or "not a valid" in total.text


def test_a_currency_field_rejects_a_non_amount(client: TestClient, pdf_bytes: bytes) -> None:
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    field = client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id, "type": "currency", "label": "Fee",
            "page_number": 1, "x": 60, "y": 100, "width": 120, "height": 32,
        },
        headers=headers,
    ).json()
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 200, sent.text
    token = token_from_link(sent.json()["signing_links"][0]["signing_link"])
    client.post(f"/api/sign/{token}/consent")
    assert client.post(
        f"/api/sign/{token}/fields/{field['id']}/value", json={"value": "not money"}
    ).status_code == 400
    assert client.post(
        f"/api/sign/{token}/fields/{field['id']}/value", json={"value": "$1,200.5"}
    ).status_code == 200


def test_a_calculated_field_may_be_drafted_without_an_expression(
    client: TestClient, pdf_bytes: bytes
) -> None:
    """Placing the field and writing its expression are two separate actions."""
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    placed = client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id, "type": "formula", "label": "Total",
            "page_number": 1, "x": 60, "y": 100, "width": 120, "height": 32,
        },
        headers=headers,
    )
    assert placed.status_code == 201, placed.text


def test_but_it_cannot_be_sent_without_one(client: TestClient, pdf_bytes: bytes) -> None:
    """Blank in a draft is fine; blank in an executed contract is not."""
    headers = auth_headers(client)
    document_id = create_uploaded_document(client, pdf_bytes, headers)
    recipient_id = add_recipient(client, document_id, headers, "Buyer", "buyer@example.com")
    client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id, "type": "signature", "label": "Sign",
            "page_number": 1, "x": 60, "y": 300, "width": 180, "height": 44,
        },
        headers=headers,
    )
    client.post(
        f"/api/documents/{document_id}/fields",
        json={
            "recipient_id": recipient_id, "type": "formula", "label": "Total",
            "page_number": 1, "x": 60, "y": 100, "width": 120, "height": 32,
        },
        headers=headers,
    )
    sent = client.post(f"/api/documents/{document_id}/send", headers=headers)
    assert sent.status_code == 400
    assert "needs an expression" in sent.text
