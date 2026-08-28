from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    parent_id: str | None = None
    team_id: str | None = None
    sort_order: int = Field(default=0, ge=0)


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: str | None = None
    team_id: str | None = None
    sort_order: int | None = Field(default=None, ge=0)


class FolderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    parent_id: str | None = None
    team_id: str | None = None
    team_name: str | None = None
    scope: Literal["personal", "team"] = "personal"
    document_count: int = 0
    sort_order: int = 0
    created_at: datetime
    updated_at: datetime
    children: list["FolderResponse"] = Field(default_factory=list)


FolderResponse.model_rebuild()


class FolderTreeResponse(BaseModel):
    personal: list[FolderResponse] = Field(default_factory=list)
    team: list[FolderResponse] = Field(default_factory=list)
    unfiled_count: int = 0


class FolderMoveRequest(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=200)
    folder_id: str | None = None
