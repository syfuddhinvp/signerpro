"""Optional PAdES sealing (W14).

The important tests here are the ones that pin the *claim*: with no
certificate configured the product applies no cryptographic signature and says
so, and a signing failure never blocks a signer from completing a contract.
"""

import subprocess
from pathlib import Path

import pytest

from app.services import pades_service


@pytest.fixture()
def self_signed_p12(tmp_path: Path) -> Path:
    """A throwaway PKCS#12. Self-signed, and the tests say what that is worth."""
    key = tmp_path / "key.pem"
    cert = tmp_path / "cert.pem"
    bundle = tmp_path / "bundle.p12"
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", str(key),
         "-out", str(cert), "-days", "1", "-nodes", "-subj", "/CN=SignerPro Test"],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["openssl", "pkcs12", "-export", "-out", str(bundle), "-inkey", str(key),
         "-in", str(cert), "-passout", "pass:"],
        check=True, capture_output=True,
    )
    return bundle


def _pdf() -> bytes:
    from io import BytesIO

    from reportlab.pdfgen import canvas

    buffer = BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.drawString(72, 720, "Executed contract")
    pdf.save()
    return buffer.getvalue()


def test_without_a_certificate_nothing_is_signed_and_the_claim_stays_ses() -> None:
    """No silent upgrade, and no half-claim (DECISIONS.md D1)."""
    original = _pdf()
    result = pades_service.seal(original)
    assert result.signed is False
    assert result.pdf == original
    assert result.level == pades_service.LEVEL_NONE
    assert "Simple Electronic Signature" in pades_service.describe()


def test_with_a_certificate_the_pdf_carries_a_real_signature(monkeypatch, self_signed_p12) -> None:
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "pades_certificate_path", str(self_signed_p12), raising=False)
    monkeypatch.setattr(settings, "pades_certificate_passphrase", None, raising=False)

    result = pades_service.seal(_pdf())
    assert result.signed is True
    assert result.level == pades_service.LEVEL_PADES
    assert result.pdf.startswith(b"%PDF-")

    # Read it back with pyhanko rather than trusting our own return value.
    from io import BytesIO

    from pyhanko.pdf_utils.reader import PdfFileReader

    reader = PdfFileReader(BytesIO(result.pdf))
    assert len(reader.embedded_signatures) == 1
    embedded = reader.embedded_signatures[0]
    assert embedded.field_name == "SignerProSeal"
    # The signature covers the document: tampering must be detectable, which is
    # the only reason to apply one at all.
    assert embedded.signed_data is not None


def test_a_broken_certificate_never_blocks_a_signer(monkeypatch) -> None:
    """A misconfigured server must not stop someone completing a contract.

    The document is still sealed by hash and audit trail -- that is the product
    guarantee -- so this degrades to SES and logs loudly rather than raising.
    """
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "pades_certificate_path", "/nonexistent/cert.p12", raising=False)

    original = _pdf()
    result = pades_service.seal(original)
    assert result.signed is False
    assert result.pdf == original
    assert result.level == pades_service.LEVEL_NONE
