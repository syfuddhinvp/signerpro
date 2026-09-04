"""Evaluation for ``formula`` fields, and formatting for ``currency`` (W10).

Both types were retired from the palette because they lied: a ``formula``
field was a plain input wearing an ``fx`` badge and computed nothing, and
``currency`` neither formatted nor validated an amount. This module is what
lets them be offered honestly again.

Two rules shape the design.

**Evaluation is server-side and authoritative.** A computed total goes into an
executed contract, so it cannot be whatever the browser posted. The signer
never submits a formula field's value; the server derives it from the other
fields on the document and writes it. A client-side preview may exist for
responsiveness, but it is never the number that gets stamped.

**The evaluator is a whitelist, not a sandbox.** ``eval`` on an author-supplied
string is remote code execution with extra steps, and "sandboxed eval" in
Python has been escaped too many times to be worth defending. This parses to
an AST and walks it, permitting exactly four binary operators, unary minus,
numeric literals, parentheses, and references to other fields. Anything else
-- an attribute, a call, a name, a comprehension, a string -- is rejected at
authoring time, not at signing time.

Expressions reference other fields by merge tag::

    {{subtotal}} * 0.2
    ({{price}} - {{discount}}) * {{quantity}}

Arithmetic is ``Decimal`` throughout. A contract total computed in binary
floating point would be wrong in the way that ends up in a dispute.
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from decimal import Decimal, DivisionByZero, InvalidOperation, Overflow

#: `{{ merge_tag }}` with optional inner whitespace.
REFERENCE = re.compile(r"\{\{\s*([A-Za-z0-9_.-]{1,120})\s*\}\}")

#: Substituted for a reference before parsing, so the expression is valid
#: Python syntax for the AST walk. Never evaluated as a name.
_PLACEHOLDER = "_ref_{}"

_ALLOWED_BINOPS = (ast.Add, ast.Sub, ast.Mult, ast.Div)

#: Guards against an author pasting something pathological: `9**9**9` is a
#: literal that hangs the process before any of our checks see a value.
MAX_EXPRESSION_LENGTH = 500


class FormulaError(ValueError):
    """An expression that cannot be accepted, with a message for the author."""


@dataclass(frozen=True)
class Formula:
    expression: str
    references: tuple[str, ...]


def parse(expression: str) -> Formula:
    """Validate an expression at authoring time. Raises ``FormulaError``."""
    text = (expression or "").strip()
    if not text:
        raise FormulaError("A formula needs an expression.")
    if len(text) > MAX_EXPRESSION_LENGTH:
        raise FormulaError(f"A formula may be at most {MAX_EXPRESSION_LENGTH} characters.")

    references = tuple(dict.fromkeys(REFERENCE.findall(text)))
    substituted = _substitute(text, references)

    try:
        tree = ast.parse(substituted, mode="eval")
    except SyntaxError as exc:
        raise FormulaError("That is not a valid arithmetic expression.") from exc

    _reject_unsupported(tree.body, references)
    return Formula(expression=text, references=references)


def evaluate(expression: str, values: dict[str, str | None]) -> str | None:
    """Compute ``expression`` against merge-tag ``values``.

    Returns ``None`` when a referenced field has not been filled in yet -- an
    incomplete formula is blank, never zero. Rendering an unfilled total as
    ``0.00`` in a contract would be a fabricated number.
    """
    formula = parse(expression)

    resolved: dict[str, Decimal] = {}
    for index, reference in enumerate(formula.references):
        raw = values.get(reference)
        number = _to_decimal(raw)
        if number is None:
            return None
        resolved[_PLACEHOLDER.format(index)] = number

    tree = ast.parse(_substitute(formula.expression, formula.references), mode="eval")
    try:
        result = _eval_node(tree.body, resolved)
        # _format() has to be inside the guard, not after it: it quantizes, and
        # quantize() raises InvalidOperation on a value too large for the
        # context precision. Sitting outside, it turned bad data into a 500 on
        # the signing endpoint rather than a blank field.
        return _format(result)
    except (DivisionByZero, InvalidOperation, Overflow):
        # A division by zero is an authoring mistake meeting particular data,
        # not a crash: leave the field blank rather than 500 the signer.
        return None


# -- internals --------------------------------------------------------------


def _substitute(text: str, references: tuple[str, ...]) -> str:
    index_of = {reference: i for i, reference in enumerate(references)}

    def replace(match: re.Match[str]) -> str:
        return _PLACEHOLDER.format(index_of[match.group(1)])

    return REFERENCE.sub(replace, text)


def _reject_unsupported(node: ast.AST, references: tuple[str, ...]) -> None:
    placeholders = {_PLACEHOLDER.format(i) for i in range(len(references))}

    for child in ast.walk(node):
        if isinstance(child, ast.BinOp):
            if not isinstance(child.op, _ALLOWED_BINOPS):
                raise FormulaError("Only + - * / are supported.")
        elif isinstance(child, ast.UnaryOp):
            if not isinstance(child.op, ast.USub):
                raise FormulaError("Only + - * / are supported.")
        elif isinstance(child, ast.Constant):
            if not isinstance(child.value, (int, float)):
                raise FormulaError("A formula may only contain numbers and field references.")
        elif isinstance(child, ast.Name):
            if child.id not in placeholders:
                raise FormulaError(
                    f"Unknown name '{child.id}'. Reference other fields as {{{{merge_tag}}}}."
                )
        elif isinstance(child, (ast.Expression, ast.Load, *_ALLOWED_BINOPS, ast.USub)):
            # The operator nodes themselves, reached as children of the BinOp
            # and UnaryOp already checked above.
            continue
        else:
            raise FormulaError("A formula may only contain numbers, field references and + - * / ( ).")


def _eval_node(node: ast.AST, values: dict[str, Decimal]) -> Decimal:
    if isinstance(node, ast.Constant):
        return Decimal(str(node.value))
    if isinstance(node, ast.Name):
        return values[node.id]
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
        return -_eval_node(node.operand, values)
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, values)
        right = _eval_node(node.right, values)
        if isinstance(node.op, ast.Add):
            return left + right
        if isinstance(node.op, ast.Sub):
            return left - right
        if isinstance(node.op, ast.Mult):
            return left * right
        if isinstance(node.op, ast.Div):
            if right == 0:
                raise DivisionByZero()
            return left / right
    # Unreachable: parse() rejected everything else before we got here.
    raise FormulaError("Unsupported expression.")


def _to_decimal(raw: str | None) -> Decimal | None:
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
    # contract as the total. Infinity instead blew up quantize() and 500'd the
    # signer. A field that is not a finite number is not a number.
    if not number.is_finite():
        return None
    return number


def _format(value: Decimal) -> str | None:
    """Two decimal places, which is what a contract total is.

    Total, rather than raising, because there is no caller for whom an
    exception here is the right answer. ``Decimal`` treats "1e999" as a
    perfectly finite number -- ``is_finite()`` is True -- and only refuses at
    ``quantize``, so a value that passed every earlier guard could still blow
    up at the last step and 500 the signing endpoint. Anything that will not
    quantize is not a contract total; it is a blank.
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
    number = _to_decimal(raw)
    return None if number is None else _format(number)  # _format is total
