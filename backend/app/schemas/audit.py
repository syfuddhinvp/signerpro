from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    recipient_id: str | None
    user_id: str | None
    event_type: str
    event_message: str
    ip_address: str | None
    user_agent: str | None
    log_metadata: dict[str, Any] | None
    created_at: datetime



class AuditTrailEntry(AuditLogResponse):
    """An audit entry with its hash-chain link and UI classification (SIGN-2)."""

    checksum: str
    previous_checksum: str
    kind: str


class AuditChainVerification(BaseModel):
    entry_count: int
    chain_head: str
    hash_algorithm: str
    valid: bool
    #: Position of the first broken link (None when the chain verifies).
    broken_at_index: int | None = None
    broken_at_entry_id: str | None = None
    reason: str | None = None


class CertificateSummaryResponse(BaseModel):
    envelope_id: str
    document_title: str
    document_status: str
    signers_completed: int
    signers_total: int
    sealed_at: datetime | None
    hash_algorithm: str
    time_source: str
    certificate_authority: str
    #: What the signature on this document is actually worth. Never hardcoded:
    #: it reflects whether PAdES sealing is configured (DECISIONS.md D1).
    signature_level: str = "Simple Electronic Signature (ESIGN/UETA)"
    #: The hash recorded when the document was sealed.
    final_sha256: str | None
    original_sha256: str | None
    #: Recomputed from the bytes on disk at request time, not trusted from the
    #: database. ``None`` when there is no final PDF to hash.
    final_sha256_actual: str | None = None
    #: False means the stored file no longer matches the seal.
    final_pdf_intact: bool | None = None
    original_sha256_actual: str | None = None
    original_pdf_intact: bool | None = None
    chain_head: str
    audit_entry_count: int
    chain_valid: bool
    chain_invalid_reason: str | None = None


class PublicVerificationResponse(BaseModel):
    """Answer to an unauthenticated verification check.

    Every identifying field is optional because the negative answer carries
    none of them -- a failed check must not disclose that a document exists.
    """

    verified: bool
    detail: str | None = None
    document_id: str | None = None
    sealed_at: datetime | None = None
    signers_total: int | None = None
    signers_completed: int | None = None
    hash_algorithm: str | None = None
    final_sha256: str | None = None
    #: Recomputed from the bytes on disk, never trusted from the database.
    final_pdf_intact: bool | None = None
    audit_entry_count: int | None = None
    chain_valid: bool | None = None
    signature_level: str | None = None
