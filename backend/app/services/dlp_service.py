"""Regex-based DLP scanning of extracted document text (FLG-5 "dlp" row).

**What this actually does:** the four patterns below are run against text
*already extracted* from the PDF by ``pypdf`` (the same extraction the rest of
the app uses; no new PDF library is added). A bare "16 consecutive digits"
regex flags almost every invoice number and phone sequence, so credit-card
candidates are additionally verified with the Luhn checksum before they count
as a finding.

**What this does not do**, and the posture-row copy in ``platform_service``
must keep saying so:

* No OCR. A scanned page or an image-only PDF has no extractable text, so
  nothing on it is scanned — this is a text-pattern scanner, not a vision
  model.
* No ML/statistical classification. Four fixed regexes, nothing else. Names,
  addresses, phone numbers, national IDs other than a US SSN, and anything
  that doesn't match one of the four shapes below is invisible to it.
* No cross-tenant learning or false-positive suppression beyond the Luhn
  check. A well-formed but unissued card number, or a random 9-digit number
  in SSN-dash format, will still be flagged.

**What is never done with a match:** the matched substring itself is never
returned, stored, or logged. Every finding is reduced to a pattern type, a
count, and byte offsets into the extracted text before it leaves
``scan_text`` — enough for the caller to explain *what kind* of thing was
found and *how much* of it, never *what it was*.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

#: Digit groups of plausible card length, with optional space/dash separators
#: between groups of digits, bounded so we don't grab part of a longer number.
_CARD_CANDIDATE_RE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
_SSN_RE = re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")
#: IBAN: ISO 13616 -- 2 letter country code, 2 check digits, up to 30
#: alphanumerics. This is a shape check only, not the mod-97 checksum.
_IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")

#: Finding type keys, stable strings persisted to the database and used in
#: user-facing "blocked because of: X, Y" messages.
CREDIT_CARD = "credit_card"
SSN = "ssn"
IBAN = "iban"
EMAIL = "email"

FINDING_LABELS = {
    CREDIT_CARD: "credit card number",
    SSN: "US Social Security number",
    IBAN: "IBAN",
    EMAIL: "email address",
}

#: Finding types that actually block a send. ``EMAIL`` is deliberately absent:
#: this is an e-signature product, so nearly every document legitimately
#: carries the signer's own email address. Blocking on it would mean enabling
#: the "dlp" posture row stops essentially every send in the product -- an
#: unusable control that operators would simply turn back off. Emails are
#: still scanned and recorded as findings for review; they just aren't a
#: reason to refuse delivery.
BLOCKING_FINDING_TYPES: frozenset[str] = frozenset({CREDIT_CARD, SSN, IBAN})


def _luhn_is_valid(digits: str) -> bool:
    """Standard Luhn/mod-10 checksum used by every major card network."""
    total = 0
    reverse = digits[::-1]
    for index, char in enumerate(reverse):
        digit = int(char)
        if index % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


@dataclass
class DlpFinding:
    """One pattern type's aggregate result. Never carries the matched text."""

    pattern_type: str
    count: int
    offsets: list[tuple[int, int]] = field(default_factory=list)


def _find_credit_cards(text: str) -> DlpFinding | None:
    offsets: list[tuple[int, int]] = []
    for match in _CARD_CANDIDATE_RE.finditer(text):
        digits = re.sub(r"[ -]", "", match.group())
        if 13 <= len(digits) <= 19 and _luhn_is_valid(digits):
            offsets.append((match.start(), match.end()))
    if not offsets:
        return None
    return DlpFinding(pattern_type=CREDIT_CARD, count=len(offsets), offsets=offsets)


def _find_simple(pattern: re.Pattern[str], pattern_type: str, text: str) -> DlpFinding | None:
    offsets = [(match.start(), match.end()) for match in pattern.finditer(text)]
    if not offsets:
        return None
    return DlpFinding(pattern_type=pattern_type, count=len(offsets), offsets=offsets)


def scan_text(text: str) -> list[DlpFinding]:
    """Scan already-extracted text and return one finding per pattern type
    that matched at least once. Returns an empty list for clean text."""
    if not text:
        return []
    findings = [
        _find_credit_cards(text),
        _find_simple(_SSN_RE, SSN, text),
        _find_simple(_IBAN_RE, IBAN, text),
        _find_simple(_EMAIL_RE, EMAIL, text),
    ]
    return [finding for finding in findings if finding is not None]
