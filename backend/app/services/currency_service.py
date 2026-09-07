"""Parsing and formatting for ``currency`` fields (W10).

``currency`` was retired from the palette because it lied: it neither
formatted nor validated an amount. This module is what lets it be offered
honestly.

Arithmetic is ``Decimal`` throughout. A contract amount handled in binary
floating point would be wrong in the way that ends up in a dispute.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, Overflow


def to_decimal(raw: str | None) -> Decimal | None:
    text = (raw or "").strip()
    if not text:
        return None
    # Tolerate what people actually type into a money field.
    cleaned = text.replace(",", "").replace("$", "").replace("£", "").replace("€", "").strip()
    if cleaned.startswith("(") and cleaned.endswith(")"):  # accounting negatives
        cleaned = "-" + cleaned[1:-1]
    try:
        number = Decimal(cleaned)
    except InvalidOperation:
        return None
    # ``Decimal`` accepts "NaN", "Infinity" and "1e999". None of them are money.
    # Left in, NaN was the dangerous one: it does not raise, so it flowed
    # through arithmetic and stamped the literal string "NaN" into an executed
    # contract. Infinity instead blew up quantize() and 500'd the signer. A
    # field that is not a finite number is not a number.
    if not number.is_finite():
        return None
    return number


def _format(value: Decimal) -> str | None:
    """Two decimal places, which is what a contract amount is.

    Total, rather than raising, because there is no caller for whom an
    exception here is the right answer. ``Decimal`` treats "1e999" as a
    perfectly finite number -- ``is_finite()`` is True -- and only refuses at
    ``quantize``, so a value that passed every earlier guard could still blow
    up at the last step and 500 the signing endpoint. Anything that will not
    quantize is not a contract amount; it is a blank.
    """
    try:
        quantized = value.quantize(Decimal("0.01"))
    except (InvalidOperation, Overflow):
        return None
    return f"{quantized:,}"


def format_currency(raw: str | None) -> str | None:
    """Normalise what a signer typed into a ``currency`` field.

    Returns ``None`` when it is not a number, so the caller can reject it
    rather than stamp an unparseable string into the contract.
    """
    number = to_decimal(raw)
    return None if number is None else _format(number)  # _format is total
