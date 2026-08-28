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
    final_sha256: str | None
    original_sha256: str | None
    chain_head: str
    audit_entry_count: int
    chain_valid: bool
