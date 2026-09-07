from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field as PydanticField, field_validator

from app.models.enums import FieldType


ValidationKind = Literal["none", "email", "date", "numeric", "custom"]


class FieldCondition(BaseModel):
    field_id: str
    op: Literal["checked", "equals", "notEmpty"]
    value: Any | None = None


class FieldCreate(BaseModel):
    recipient_id: str
    type: FieldType
    label: str = PydanticField(min_length=1, max_length=255)
    required: bool = True
    page_number: int = PydanticField(ge=1)
    x: Decimal = PydanticField(ge=0)
    y: Decimal = PydanticField(ge=0)
    width: Decimal = PydanticField(gt=0)
    height: Decimal = PydanticField(gt=0)
    placeholder: str | None = PydanticField(default=None, max_length=255)
    default_value: str | None = None
    value: str | None = None
    options: dict[str, Any] | list[Any] | None = None
    validation: ValidationKind = "none"
    validation_pattern: str | None = PydanticField(default=None, max_length=255)
    condition: FieldCondition | None = None
    read_only: bool = False

    @field_validator("x", "y", "width", "height")
    @classmethod
    def limit_precision(cls, value: Decimal) -> Decimal:
        return value.quantize(Decimal("0.0001"))


class FieldUpdate(BaseModel):
    recipient_id: str | None = None
    label: str | None = PydanticField(default=None, min_length=1, max_length=255)
    required: bool | None = None
    page_number: int | None = PydanticField(default=None, ge=1)
    x: Decimal | None = PydanticField(default=None, ge=0)
    y: Decimal | None = PydanticField(default=None, ge=0)
    width: Decimal | None = PydanticField(default=None, gt=0)
    height: Decimal | None = PydanticField(default=None, gt=0)
    placeholder: str | None = PydanticField(default=None, max_length=255)
    default_value: str | None = None
    options: dict[str, Any] | list[Any] | None = None
    type: FieldType | None = None
    value: str | None = None
    validation: ValidationKind | None = None
    validation_pattern: str | None = PydanticField(default=None, max_length=255)
    condition: FieldCondition | None = None
    read_only: bool | None = None

    @field_validator("x", "y", "width", "height")
    @classmethod
    def limit_optional_precision(cls, value: Decimal | None) -> Decimal | None:
        if value is None:
            return None
        return value.quantize(Decimal("0.0001"))


class FieldResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    document_id: str
    recipient_id: str
    type: FieldType
    label: str
    required: bool
    page_number: int
    x: Decimal
    y: Decimal
    width: Decimal
    height: Decimal
    placeholder: str | None
    default_value: str | None
    value: str | None
    options: dict[str, Any] | list[Any] | None
    is_locked: bool
    validation: str
    validation_pattern: str | None
    condition: dict[str, Any] | None
    read_only: bool
    created_at: datetime
    updated_at: datetime


class FieldBulkItem(FieldCreate):
    """A field in a bulk save. ``id`` preserves an existing row (and any value
    already captured on it); omitting it creates a new field."""

    id: str | None = None


class FieldBulkSaveRequest(BaseModel):
    fields: list[FieldBulkItem] = PydanticField(default_factory=list, max_length=1000)

