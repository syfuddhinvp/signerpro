from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import WorkflowType


class TemplateUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    doc_type: str | None = Field(default=None, max_length=30)
    invite_subject: str | None = Field(default=None, max_length=255)
    invite_message: str | None = None
    folder_id: str | None = None


class TemplateCreateFromDocument(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: str | None = None


class TemplateDuplicateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)


class TemplateUseRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: str | None = None


class TemplateResponse(BaseModel):
    id: str
    organization_id: str
    title: str
    doc_type: str | None
    workflow_type: WorkflowType
    use_count: int
    field_count: int
    recipient_count: int
    owner_user_id: str | None
    owner_name: str | None
    folder_id: str | None
    page_count: int
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TemplateListResponse(BaseModel):
    items: list[TemplateResponse]
    total: int


class TemplateUsageSender(BaseModel):
    name: str
    count: int


class TemplateUsageResponse(BaseModel):
    template_id: str
    use_count: int
    completed_copies: int
    by_sender: list[TemplateUsageSender]
    series: list[int]
