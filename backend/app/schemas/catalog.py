"""Schemas for the platform template catalog.

Tenants read ``CatalogTemplateResponse``; only platform admins ever send a
``CatalogTemplateCreate``/``Update``.
"""

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

from app.models.enums import FieldType


CATEGORIES = {"government", "legal", "hr", "finance", "real_estate", "health", "other"}
RECIPIENT_ROLES = {"sign", "approve", "copy", "inperson"}


class CatalogRole(BaseModel):
    """A placeholder recipient. No email: the sender supplies that later."""

    key: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    signing_order: int = Field(default=1, ge=1, le=99)
    #: Matches ``recipients.role`` — a form may need an approver or a CC.
    role: str = Field(default="sign", max_length=20)
    #: ``recipients.color`` is String(9) ("#RRGGBBAA"); do not exceed it.
    color: str | None = Field(default=None, max_length=9)

    @field_validator("role")
    @classmethod
    def _known_role(cls, value: str) -> str:
        if value not in RECIPIENT_ROLES:
            raise ValueError(f"role must be one of {sorted(RECIPIENT_ROLES)}")
        return value


class CatalogField(BaseModel):
    role: str = Field(min_length=1, max_length=40)
    type: FieldType
    label: str = Field(min_length=1, max_length=255)
    page_number: int = Field(ge=1)
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    required: bool = True
    placeholder: str | None = Field(default=None, max_length=255)
    default_value: str | None = None
    options: list | dict | None = None


class CatalogTemplateBase(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = None
    category: str = Field(default="other", max_length=40)
    authority: str | None = Field(default=None, max_length=120)
    jurisdiction: str | None = Field(default=None, max_length=16)
    form_revision: str | None = Field(default=None, max_length=60)
    tags: list[str] | None = None
    page_count: int = Field(default=1, ge=1)
    roles: list[CatalogRole] = Field(default_factory=list)
    fields: list[CatalogField] = Field(default_factory=list)
    published: bool = False
    sort_order: int = 0

    @field_validator("category")
    @classmethod
    def _known_category(cls, value: str) -> str:
        if value not in CATEGORIES:
            raise ValueError(f"category must be one of {sorted(CATEGORIES)}")
        return value


class CatalogTemplateCreate(CatalogTemplateBase):
    slug: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class CatalogTemplateUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    category: str | None = Field(default=None, max_length=40)
    authority: str | None = Field(default=None, max_length=120)
    jurisdiction: str | None = Field(default=None, max_length=16)
    form_revision: str | None = Field(default=None, max_length=60)
    tags: list[str] | None = None
    page_count: int | None = Field(default=None, ge=1)
    roles: list[CatalogRole] | None = None
    fields: list[CatalogField] | None = None
    published: bool | None = None
    sort_order: int | None = None

    @field_validator("category")
    @classmethod
    def _known_category(cls, value: str | None) -> str | None:
        if value is not None and value not in CATEGORIES:
            raise ValueError(f"category must be one of {sorted(CATEGORIES)}")
        return value


class CatalogTemplateResponse(BaseModel):
    id: str
    slug: str
    title: str
    description: str | None
    category: str
    authority: str | None
    jurisdiction: str | None
    form_revision: str | None
    tags: list[str]
    page_count: int
    role_count: int
    field_count: int
    has_file: bool
    published: bool
    sort_order: int
    #: Whether this organization has already imported the entry — the browse
    #: screen shows "Added" rather than a second "Add to my templates".
    imported: bool = False
    created_at: datetime
    updated_at: datetime


class CatalogTemplateDetail(CatalogTemplateResponse):
    roles: list[CatalogRole]
    fields: list[CatalogField]


class CatalogListResponse(BaseModel):
    items: list[CatalogTemplateResponse]
    total: int
    #: Categories present in the published catalog, for the filter control.
    categories: list[str]


class CatalogImportRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: str | None = None
