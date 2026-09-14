from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import DocumentStatus, WorkflowType


ReminderCadence = Literal["24h", "48h", "7d", "none"]
DocType = Literal["agreement", "nda", "order", "hr"]
LibrarySort = Literal["recent", "name", "status", "owner"]
LibraryQuick = Literal[
    "all",
    "inbox",
    "outbox",
    "completed",
    "drafts",
    "favorites",
    "expiring",
    "shared",
    "mine",
    "archived",
    "trash",
]
BulkAction = Literal["archive", "restore", "unarchive", "delete", "move", "purge"]


class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    workflow_type: WorkflowType = WorkflowType.parallel
    is_template: bool = False


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    workflow_type: WorkflowType | None = None
    is_template: bool | None = None
    doc_type: DocType | None = None
    folder_id: str | None = None


class DocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    sender_id: str
    title: str
    status: DocumentStatus
    workflow_type: WorkflowType
    is_template: bool
    original_file_path: str | None
    final_file_path: str | None
    original_sha256: str | None
    field_config_sha256: str | None
    final_sha256: str | None
    page_count: int
    sent_at: datetime | None
    completed_at: datetime | None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime
    owner_user_id: str | None = None
    folder_id: str | None = None
    source_template_id: str | None = None
    #: Set on a template imported from (or being authored for) the platform
    #: catalog. The builder reads it to offer "save back to the catalog".
    source_catalog_slug: str | None = None
    doc_type: str | None = None
    archived_at: datetime | None = None
    deleted_at: datetime | None = None
    reminder_cadence: str = "48h"
    expires_in_days: int = 14
    invite_subject: str | None = None
    invite_message: str | None = None
    recipients_total: int = 0
    recipients_completed: int = 0


class DocumentListItem(DocumentResponse):
    owner_name: str | None = None
    is_favorite: bool = False


class DocumentCounts(BaseModel):
    """Sidebar/library badge counts.

    The first block is the original status-oriented set (kept for backwards
    compatibility). The second block mirrors the library's `quick` filters
    one-for-one, so a badge can never disagree with the list it links to.
    """

    all: int = 0
    action: int = 0
    waiting: int = 0
    completed: int = 0
    draft: int = 0
    voided: int = 0
    archived: int = 0
    trashed: int = 0
    templates: int = 0
    # quick-filter buckets (`quick=<name>` on GET /api/documents/library)
    inbox: int = 0
    outbox: int = 0
    drafts: int = 0
    favorites: int = 0
    expiring: int = 0
    shared: int = 0
    mine: int = 0


class DocumentLibraryPage(BaseModel):
    items: list[DocumentListItem]
    total: int
    limit: int
    offset: int
    counts: DocumentCounts


class DocumentRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class DocumentPagesRequest(BaseModel):
    """The page numbers to keep, in the order they should end up in.

    One shape covers both edits the builder offers: a page left out is removed,
    a page in a new position is renumbered. ``[1, 3, 2]`` swaps the last two
    pages of a three-page document; ``[1, 3]`` drops page 2.
    """

    order: list[int] = Field(min_length=1, max_length=2000)


class DocumentDuplicateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)


class DocumentMoveRequest(BaseModel):
    folder_id: str | None = None


class BulkActionRequest(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=200)
    action: BulkAction
    folder_id: str | None = None


class BulkActionSkipped(BaseModel):
    document_id: str
    reason: str


class BulkActionResult(BaseModel):
    action: str
    updated: int
    document_ids: list[str]
    skipped: list[BulkActionSkipped]


class BulkDownloadRequest(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=200)


class RoutingUpdate(BaseModel):
    workflow_type: WorkflowType | None = None
    reminder_cadence: ReminderCadence | None = None
    expires_in_days: int | None = Field(default=None, ge=1, le=365)
    invite_subject: str | None = Field(default=None, max_length=255)
    invite_message: str | None = None
    #: Sender branding (ORG-7). An explicit ``null`` releases the envelope back
    #: to the tenant's default theme; omitting the key leaves the choice alone.
    branding_theme_id: str | None = None


class RoutingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    document_id: str
    workflow_type: WorkflowType
    reminder_cadence: str
    expires_in_days: int
    invite_subject: str | None
    invite_message: str | None
    #: The theme the envelope names, or ``None`` for the tenant's default.
    branding_theme_id: str | None = None
    #: The theme that will actually be used -- the named one, or the default
    #: resolved for it. Lets the workflow screen show what recipients will see
    #: without a second request.
    effective_branding_theme_id: str | None = None


class SendDocumentResponse(BaseModel):
    document: DocumentResponse
    signing_links: list[dict[str, str]]


class UploadPdfResponse(BaseModel):
    document: DocumentResponse
    sha256: str
    page_count: int

