"""Optional PAdES sealing of the executed PDF (W14).

Everything else in this product is a **Simple Electronic Signature** under
ESIGN/UETA: the evidence is the audit trail, the captured consent and the
hash, not a cryptographic signature on the document itself. That is a real and
defensible product, and `DECISIONS.md` D1 exists to stop it being marketed as
more.

This module is what makes more available, without changing the claim by
accident.

**It is off unless a certificate is configured.** With no
``PADES_CERTIFICATE_PATH``, sealing behaves exactly as it always has and the
product remains SES — no silent upgrade, no half-claim. Configure a
certificate and the executed PDF additionally carries a PAdES-B-B signature.

**A self-signed certificate is not a qualified signature.** The applied
signature is only ever as good as the certificate behind it. A self-signed key
produces a document that is cryptographically sealed and *not* trusted by any
reader's trust store, which is worth something (tamper-evidence at the file
level) and is emphatically not QES. ``describe()`` returns the honest label
for whatever is configured, and that is what the UI and the certificate page
should say rather than a hardcoded string.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

logger = logging.getLogger(__name__)


class PadesConfigurationError(RuntimeError):
    """A certificate was configured but cannot be used."""


@dataclass(frozen=True)
class SealResult:
    pdf: bytes
    #: True only when a cryptographic signature was actually applied.
    signed: bool
    #: The honest description of what the signature is worth.
    level: str


#: What we may truthfully call the output.
LEVEL_NONE = "Simple Electronic Signature (ESIGN/UETA)"
LEVEL_PADES = "PAdES-B-B advanced electronic signature"


def _settings():
    from app.core.config import get_settings

    return get_settings()


def is_configured() -> bool:
    settings = _settings()
    return bool(getattr(settings, "pades_certificate_path", None))


def describe() -> str:
    """The label for the signature level actually in force."""
    return LEVEL_PADES if is_configured() else LEVEL_NONE


def seal(pdf_bytes: bytes, *, field_name: str = "SignForgeSeal") -> SealResult:
    """Apply a PAdES signature if one is configured; otherwise pass through.

    Never raises on a signing failure at completion time. A signer finishing a
    contract must not be blocked by a misconfigured certificate on the server:
    the document is still sealed by hash and audit trail, which is the product
    guarantee. The failure is logged loudly instead.
    """
    if not is_configured():
        return SealResult(pdf=pdf_bytes, signed=False, level=LEVEL_NONE)

    try:
        signed = _sign(pdf_bytes, field_name=field_name)
    except Exception:  # noqa: BLE001 -- see the docstring
        logger.exception(
            "PAdES sealing failed; the document is still sealed by hash and audit trail, "
            "but carries no cryptographic signature."
        )
        return SealResult(pdf=pdf_bytes, signed=False, level=LEVEL_NONE)
    return SealResult(pdf=signed, signed=True, level=LEVEL_PADES)


def _sign(pdf_bytes: bytes, *, field_name: str) -> bytes:
    from pyhanko.sign import signers
    from pyhanko.sign.fields import SigFieldSpec, append_signature_field

    settings = _settings()
    certificate_path = Path(settings.pades_certificate_path)
    if not certificate_path.exists():
        raise PadesConfigurationError(f"PADES_CERTIFICATE_PATH does not exist: {certificate_path}")

    passphrase = getattr(settings, "pades_certificate_passphrase", None)
    signer = signers.SimpleSigner.load_pkcs12(
        pfx_file=str(certificate_path),
        passphrase=passphrase.encode() if passphrase else None,
    )
    if signer is None:
        raise PadesConfigurationError(
            "The PKCS#12 file could not be loaded. Check PADES_CERTIFICATE_PASSPHRASE."
        )

    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter

    writer = IncrementalPdfFileWriter(BytesIO(pdf_bytes))
    # An invisible field: the visual record of who signed is already the
    # stamped signature and the certificate page. A second, decorative
    # signature widget would imply a different thing had been signed.
    append_signature_field(writer, SigFieldSpec(sig_field_name=field_name))

    output = BytesIO()
    signers.sign_pdf(
        writer,
        signers.PdfSignatureMetadata(field_name=field_name),
        signer=signer,
        output=output,
    )
    return output.getvalue()
