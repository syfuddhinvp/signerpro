from sqlalchemy import ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class DocumentDlpFinding(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """One pattern-type aggregate from ``dlp_service.scan_text`` (FLG-5 "dlp").

    Deliberately does not store the matched text: only the pattern type, how
    many times it matched, and byte offsets into the extracted text so a
    reviewer can locate (not read) the hit. Rows are written only when the
    "dlp" security-posture row is enabled; see ``document_service`` for the
    scan/enforcement hook and ``platform_service`` for what the scan does and
    does not cover.
    """

    __tablename__ = "document_dlp_findings"
    __table_args__ = (Index("ix_document_dlp_findings_document_id", "document_id"),)

    document_id: Mapped[str] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    # credit_card | ssn | iban | email
    pattern_type: Mapped[str] = mapped_column(String(40), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # [[start, end], ...] offsets into the extracted text -- never the matched value.
    offsets: Mapped[list | None] = mapped_column(JSON, nullable=True)

    document: Mapped["Document"] = relationship()
