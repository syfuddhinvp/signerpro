"""Public, unauthenticated verification of an executed document.

The product's central claim is a tamper-evident audit trail. That claim is
only worth something if a party who is *not* a user of this system -- a bank,
a counterparty's lawyer, a court -- can check it. Everything else in this API
requires a session or a signing token, so before this endpoint existed the
claim could only ever be verified by the tenant asserting it. That is why the
audit QR block was removed rather than left pointing at nothing.

**The security model is the hash, not the id.** A document id on its own
reveals nothing: the caller must present the SHA-256 that is stamped on the
executed PDF. Someone holding the paper can verify it; someone who has merely
guessed or scraped an id cannot. A mismatch and a nonexistent document are
answered identically, so this cannot be used to probe which ids exist.

What comes back is deliberately thin -- whether the document is sealed, when,
how many signers, and whether the chain still verifies. No title, no signer
names, no email addresses. Verifying a document must not become a way to read
one.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.ratelimit import public_verification_limiter
from app.models.document import Document
from app.models.enums import DocumentStatus, RecipientStatus
from app.schemas.audit import PublicVerificationResponse
from app.services.audit_service import audit_service
from app.services.pdf_service import pdf_service

router = APIRouter(prefix="/api/verify", tags=["verification"])

#: One response for "no such document" and for "wrong hash". Telling them
#: apart would turn this into an id oracle.
_UNVERIFIED = PublicVerificationResponse(
    verified=False,
    detail="No sealed document matches that identifier and hash.",
)


@router.get(
    "/{document_id}",
    response_model=PublicVerificationResponse,
    dependencies=[Depends(public_verification_limiter)],
)
def verify_document(
    document_id: str, sha256: str = "", db: Session = Depends(get_db)
) -> PublicVerificationResponse:
    presented = (sha256 or "").strip().lower()
    if not presented:
        return _UNVERIFIED

    document = db.get(Document, document_id)
    if document is None or document.status != DocumentStatus.completed:
        return _UNVERIFIED
    if not document.final_sha256 or document.final_sha256.lower() != presented:
        return _UNVERIFIED

    # Re-hash the bytes on disk rather than trusting the column: a seal that
    # only checks the database against itself proves nothing about the file.
    files = pdf_service.verify_stored_files(document)
    verification = audit_service.verify_for_document(db, document)

    return PublicVerificationResponse(
        verified=bool(files.get("final_pdf_intact")) and bool(verification["valid"]),
        document_id=document.id,
        sealed_at=document.completed_at,
        signers_total=len(document.recipients),
        signers_completed=sum(
            1 for item in document.recipients if item.status == RecipientStatus.completed
        ),
        hash_algorithm="SHA-256",
        final_sha256=document.final_sha256,
        final_pdf_intact=files.get("final_pdf_intact"),
        audit_entry_count=verification["entry_count"],
        chain_valid=verification["valid"],
        detail=None,
    )
