"""Team schemas (ORG-8).

A team is a sharing boundary inside one tenant: team folders and the documents
filed in them are visible to members only (see ``folder_service``).
"""

from pydantic import BaseModel, ConfigDict, Field


class TeamCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=255)


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=255)


class TeamMemberAdd(BaseModel):
    user_id: str
    role: str = Field(default="member", pattern=r"^(lead|member)$")


class TeamMemberRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    name: str
    email: str
    role: str


class TeamResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    name: str
    description: str | None = None
    member_count: int = 0
    #: Live, non-template documents filed in this team's folders.
    document_count: int = 0
    template_count: int = 0
    #: ``lead``/``member`` when the caller belongs to the team, else null.
    my_role: str | None = None
    members: list[TeamMemberRow] = Field(default_factory=list)
