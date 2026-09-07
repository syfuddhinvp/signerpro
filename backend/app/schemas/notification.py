"""Bell-feed and notifications-page payloads.

The `notifications` table has existed since the support-and-logs migration but
nothing ever read it, so the header had no feed to draw and the shell rendered
no bell at all. These are the rows it reads.
"""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class NotificationStatus(str, Enum):
    """Which half of the feed to return. `all` is the default everywhere."""

    all = "all"
    unread = "unread"
    read = "read"


class NotificationRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    detail: str | None
    #: info | good | warn | bad — the tone the UI tints the row with.
    tone: str
    #: Where the row leads, as a shell screen key, when it leads anywhere.
    screen: str | None
    target_id: str | None
    read_at: datetime | None
    created_at: datetime


class NotificationFacets(BaseModel):
    """Counts for the page's filter controls.

    These are deliberately computed over the feed *ignoring* the filter being
    offered, so a filter chip can say how many rows it would return — a facet
    computed after its own filter would always read as the current selection.
    """

    #: `{"good": 12, "bad": 1, ...}`, unfiltered by tone.
    tones: dict[str, int]
    unread: int
    read: int


class NotificationFeed(BaseModel):
    items: list[NotificationRow]
    #: Unread across the whole feed, ignoring every filter and the page size —
    #: this is the header badge, so it must not be `len(items)`.
    unread: int
    #: Rows matching the current filter, ignoring the page size.
    total: int
    facets: NotificationFacets


class NotificationBulkRequest(BaseModel):
    """A page action over the rows the user selected."""

    ids: list[str] = Field(min_length=1, max_length=200)
    action: Literal["read", "unread", "delete"]


class NotificationWriteResponse(BaseModel):
    """What changed, so the caller can settle its badge without a refetch."""

    updated: int = 0
    deleted: int = 0
    unread: int
