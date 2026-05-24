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

