from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

DEFAULT_GROUPS: list[tuple[str, str]] = [
    ("customers", "Customers"),
    ("internal", "Internal"),
    ("counsel", "Counsel"),
    ("vendors", "Vendors"),
]

CONTACT_ROLES = {"sign", "approve", "copy", "inperson"}
CONTACT_SOURCES = {"manual", "crm", "scim", "api"}


class ContactCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    company: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=2000)
    default_role: str = Field(default="sign", max_length=20)
    group: str = Field(default="customers", max_length=40)
    source: str = Field(default="manual", max_length=20)
    tags: list[str] = Field(default_factory=list)
    color: str | None = Field(default=None, max_length=9)
    external_id: str | None = Field(default=None, max_length=255)


class ContactUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    email: EmailStr | None = None
    company: str | None = Field(default=None, max_length=255)
    title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=500)
    description: str | None = Field(default=None, max_length=2000)
    default_role: str | None = Field(default=None, max_length=20)
    group: str | None = Field(default=None, max_length=40)
    tags: list[str] | None = None
    color: str | None = Field(default=None, max_length=9)


class ContactResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    name: str
    email: EmailStr
    company: str | None
    title: str | None
    phone: str | None
    address: str | None = None
    description: str | None = None
    default_role: str
    group: str
    source: str
    tags: list[str]
    color: str | None
    envelope_count: int = 0
    last_signed_at: datetime | None = None
    external_id: str | None = None
    # The teammate who created the record — SignNow's "Owner" row.
    owner_name: str | None = None
    owner_email: str | None = None
    created_at: datetime
    updated_at: datetime


class ContactListResponse(BaseModel):
    items: list[ContactResponse]
    total: int
    counts: dict[str, int]


class ContactHistoryEntry(BaseModel):
    document_id: str
    title: str
    status: str
    event: str
    occurred_at: datetime | None


class ContactGroupCreate(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=80)
    sort_order: int = 0


class ContactGroupUpdate(BaseModel):
    key: str | None = Field(default=None, min_length=1, max_length=40)
    label: str | None = Field(default=None, min_length=1, max_length=80)
    sort_order: int | None = None


class ContactGroupResponse(BaseModel):
    id: str
    key: str
    label: str
    sort_order: int
    contact_count: int


class ContactImportRequest(BaseModel):
    contacts: list[ContactCreate] = Field(default_factory=list)
    dry_run: bool = False


class ContactImportError(BaseModel):
    row: int
    message: str


class ContactImportResponse(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[ContactImportError]


class ContactAddRecipientsRequest(BaseModel):
    document_id: str
    contact_ids: list[str] = Field(min_length=1)
