from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import DocumentStatus, WorkflowType


class DocumentCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    workflow_type: WorkflowType = WorkflowType.parallel
    is_template: bool = False


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    workflow_type: WorkflowType | None = None
    is_template: bool | None = None


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
    recipients_total: int = 0
    recipients_completed: int = 0


class SendDocumentResponse(BaseModel):
    document: DocumentResponse
    signing_links: list[dict[str, str]]


class UploadPdfResponse(BaseModel):
    document: DocumentResponse
    sha256: str
    page_count: int

