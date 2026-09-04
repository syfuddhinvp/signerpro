import re
from decimal import Decimal, InvalidOperation
from io import BytesIO

from fastapi import HTTPException, status
from pypdf import PdfReader
from sqlalchemy.orm import Session

from app.core.pdf_geometry import page_geometry
from app.core.storage import storage
from app.models.document import Document
from app.models.enums import FieldType
from app.models.field import Field
from app.models.user import User
from app.schemas.field import FieldBulkSaveRequest, FieldCreate, FieldUpdate
from app.services import formula_service
from app.services.audit_service import audit_service
from app.services.document_service import document_service


class FieldService:
    def _validate_formula(self, field_type, options) -> None:
        """Reject an unusable expression while the author is still here.

        A formula that only fails at signing time fails in front of the
        counterparty, on a document that has already been sent.
        """
        if field_type != FieldType.formula:
            return
        expression = None
        if isinstance(options, dict):
            expression = options.get("expression")
        if not expression or not str(expression).strip():
            # Placing the field and typing its expression are two separate
            # actions in the builder, so an empty expression is a legal draft.
            # ``validate_for_send`` is what refuses to send one.
            return
        try:
            formula_service.parse(str(expression))
        except formula_service.FormulaError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    def create(self, db: Session, *, document: Document, user: User, payload: FieldCreate) -> Field:
        document_service.ensure_editable(document)
        self._validate_recipient(document, payload.recipient_id)
        self._validate_coordinates(document, payload.page_number, payload.x, payload.y, payload.width, payload.height)
        data = payload.model_dump()
        condition = data.get("condition")
        data["condition"] = condition
        self._validate_condition(document, condition, field_id=None)
        self._validate_validation(data.get("validation"), data.get("validation_pattern"))
        self._validate_formula(data.get("type"), data.get("options"))
        field = Field(document_id=document.id, **data)
        db.add(field)
        db.flush()
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=field.recipient_id,
            user_id=user.id,
            event_type="field_added",
            event_message=f"Field '{field.label}' was added.",
            metadata={"field_id": field.id, "type": field.type},
        )
        db.commit()
        db.refresh(field)
        return field

    def get(self, document: Document, field_id: str) -> Field:
        field = next((item for item in document.fields if item.id == field_id), None)
        if not field:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
        return field

    def update(self, db: Session, *, document: Document, user: User, field_id: str, payload: FieldUpdate) -> Field:
        document_service.ensure_editable(document)
        field = self.get(document, field_id)
        updates = payload.model_dump(exclude_unset=True)
        recipient_id = updates.get("recipient_id", field.recipient_id)
        self._validate_recipient(document, recipient_id)
        page_number = updates.get("page_number", field.page_number)
        x = updates.get("x", field.x)
        y = updates.get("y", field.y)
        width = updates.get("width", field.width)
        height = updates.get("height", field.height)
        self._validate_coordinates(document, page_number, Decimal(x), Decimal(y), Decimal(width), Decimal(height))
        if "condition" in updates:
            updates["condition"] = updates["condition"]
            self._validate_condition(document, updates["condition"], field_id=field.id)
        if "validation" in updates or "validation_pattern" in updates:
            self._validate_validation(
                updates.get("validation", field.validation),
                updates.get("validation_pattern", field.validation_pattern),
            )
        if "options" in updates or "type" in updates:
            self._validate_formula(
                updates.get("type", field.type), updates.get("options", field.options)
            )
        for key, value in updates.items():
            setattr(field, key, value)
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=field.recipient_id,
            user_id=user.id,
            event_type="field_updated",
            event_message=f"Field '{field.label}' was updated.",
            metadata={"field_id": field.id},
        )
        db.commit()
        db.refresh(field)
        return field

    def delete(self, db: Session, *, document: Document, user: User, field_id: str) -> None:
        document_service.ensure_editable(document)
        field = self.get(document, field_id)
        audit_service.log(
            db,
            document_id=document.id,
            recipient_id=field.recipient_id,
            user_id=user.id,
            event_type="field_deleted",
            event_message=f"Field '{field.label}' was deleted.",
            metadata={"field_id": field.id},
        )
        db.delete(field)
        db.commit()

    # ------------------------------------------------------------------
    # Bulk save (FLD-3)
    # ------------------------------------------------------------------

    def bulk_save(self, db: Session, *, document: Document, user: User, payload: FieldBulkSaveRequest) -> list[Field]:
        """Replace the document's whole field set in one transaction.

        Items carrying an ``id`` that already belongs to this document are
        updated in place (keeping any captured ``value``); everything else is
        created, and any existing field not named in the payload is removed.
        """
        document_service.ensure_editable(document)
        existing = {field.id: field for field in document.fields}
        seen: set[str] = set()
        result: list[Field] = []
        page_cache: dict[int, tuple[Decimal, Decimal]] = {}

        for item in payload.fields:
            data = item.model_dump()
            field_id = data.pop("id", None)
            self._validate_recipient(document, data["recipient_id"])
            self._validate_coordinates(
                document,
                data["page_number"],
                data["x"],
                data["y"],
                data["width"],
                data["height"],
                page_cache=page_cache,
            )
            self._validate_validation(data.get("validation"), data.get("validation_pattern"))
            self._validate_formula(data.get("type"), data.get("options"))
            if field_id and field_id in existing:
                field = existing[field_id]
                data.pop("value", None)
                for key, value in data.items():
                    setattr(field, key, value)
                seen.add(field_id)
            else:
                if field_id and field_id not in existing:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Field {field_id} does not belong to this document",
                    )
                field = Field(document_id=document.id, **data)
                db.add(field)
                db.flush()
                seen.add(field.id)
            result.append(field)

        # Conditions can reference fields created in this same call, so they are
        # validated once every id exists.
        for field in result:
            self._validate_condition_ids(
                field.condition, allowed_ids=seen, field_id=field.id
            )

        removed = 0
        for field_id, field in existing.items():
            if field_id not in seen:
                db.delete(field)
                removed += 1

        audit_service.log(
            db,
            document_id=document.id,
            user_id=user.id,
            event_type="field_updated",
            event_message=f"Field set saved ({len(result)} field(s), {removed} removed).",
            metadata={"saved": len(result), "removed": removed},
        )
        db.commit()
        db.refresh(document)
        return sorted(document.fields, key=lambda item: (item.page_number, float(item.y), float(item.x)))

    # ------------------------------------------------------------------
    # Field logic (FLD-2)
    # ------------------------------------------------------------------

    def _validate_validation(self, validation: str | None, pattern: str | None) -> None:
        if validation == "custom":
            if not pattern:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="A validation_pattern is required when validation is 'custom'",
                )
            try:
                re.compile(pattern)
            except re.error as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="validation_pattern is not a valid regular expression"
                ) from exc

    def _validate_condition(self, document: Document, condition: dict | None, *, field_id: str | None) -> None:
        allowed = {item.id for item in document.fields}
        self._validate_condition_ids(condition, allowed_ids=allowed, field_id=field_id)

    def _validate_condition_ids(self, condition: dict | None, *, allowed_ids: set[str], field_id: str | None) -> None:
        if not condition:
            return
        target = condition.get("field_id")
        if target == field_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A field cannot depend on itself")
        if target not in allowed_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="condition.field_id must reference another field on this document",
            )

    def condition_is_met(self, document: Document, field: Field) -> bool:
        """Server-side evaluation of a field's conditional-visibility rule."""
        condition = field.condition or None
        if not condition:
            return True
        source = next((item for item in document.fields if item.id == condition.get("field_id")), None)
        if source is None:
            return True
        value = (source.value or "").strip()
        op = condition.get("op")
        if op == "checked":
            return value.lower() in {"true", "1", "yes", "on"}
        if op == "notEmpty":
            return bool(value)
        if op == "equals":
            return value == str(condition.get("value") or "")
        return True

    #: Field types whose ``options`` describe a closed set of acceptable values.
    CHOICE_FIELD_TYPES = frozenset({FieldType.dropdown, FieldType.radio})

    def allowed_options(self, field: Field) -> list[str]:
        """The closed set of values a choice field accepts, as strings.

        ``options`` is authored by the builder and has historically been stored
        in three shapes, all of which are accepted here:

        * ``["A", "B"]`` — a plain list of labels;
        * ``[{"value": "a", "label": "A"}, ...]`` — objects (``value`` wins,
          falling back to ``label``);
        * ``{"choices": [...]}`` / ``{"options": [...]}`` — a wrapper object.

        An unrecognised or empty shape yields ``[]``, which means "no option
        set was authored" and disables enforcement rather than locking the
        signer out of a field nobody constrained.
        """
        raw = field.options
        if isinstance(raw, dict):
            raw = raw.get("choices", raw.get("options"))
        if not isinstance(raw, list):
            return []
        allowed: list[str] = []
        for item in raw:
            if isinstance(item, dict):
                candidate = item.get("value", item.get("label"))
            else:
                candidate = item
            if candidate is None:
                continue
            text = str(candidate).strip()
            if text:
                allowed.append(text)
        return allowed

    #: A field type that *is* a format carries that format whether or not the
    #: sender picked a validation kind: an `email` field is an email field even
    #: when it was created through the API, a template or an older builder that
    #: left `validation` at "none". Without this a signer could type
    #: "dfghgdfhfdh" into an Email field and have it flattened into the
    #: executed contract verbatim.
    #: Deliberately narrow: `currency` ("$1,200") and the date types have too
    #: many legitimate shapes for the checks below to be the arbiter, so they
    #: are only enforced when the sender asked for a kind explicitly.
    TYPE_IMPLIED_VALIDATION: dict[FieldType, str] = {
        FieldType.email: "email",
        FieldType.number: "numeric",
    }

    def effective_validation(self, field: Field) -> str:
        """The validation kind actually enforced for a field."""

        kind = field.validation or "none"
        if kind != "none":
            return kind
        return self.TYPE_IMPLIED_VALIDATION.get(field.type, "none")

    def formula_expression(self, field: Field) -> str | None:
        """The expression authored on a formula field, if any."""
        options = field.options
        if isinstance(options, dict):
            expression = options.get("expression")
            return expression if isinstance(expression, str) and expression.strip() else None
        return None

    def recompute_formulas(self, db: Session, document: Document) -> None:
        """Derive every formula field on ``document`` from the others.

        Server-side and authoritative: a computed total ends up in an executed
        contract, so it is never whatever the browser posted. Called after any
        value changes.
        """
        fields = list(document.fields)
        values = {
            item.merge_tag: item.value
            for item in fields
            if item.merge_tag and item.type != FieldType.formula
        }
        for item in fields:
            if item.type != FieldType.formula:
                continue
            expression = self.formula_expression(item)
            if not expression:
                continue
            try:
                computed = formula_service.evaluate(expression, values)
            except formula_service.FormulaError:
                # An expression that no longer parses (a referenced field was
                # deleted, say) leaves the field blank rather than stamping a
                # stale number that no longer means anything.
                computed = None
            if item.value != computed:
                item.value = computed
                db.add(item)

    def validate_value(self, document: Document, field: Field, value: str | None) -> None:
        """Enforce authoring intent when a signer submits a value."""
        # A formula is derived, never submitted: accepting a posted value would
        # let a signer choose the total on their own contract.
        if field.type == FieldType.formula:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field '{field.label}' is calculated and cannot be filled in directly",
            )
        if field.read_only:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' is read-only")
        if not self.condition_is_met(document, field):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field '{field.label}' is hidden by its conditional rule",
            )
        text = (value or "").strip()
        if not text:
            return
        # FLD-4: a dropdown/radio is a closed set. It was previously enforced
        # only by the builder UI, so any client could post an arbitrary string
        # and have it flattened verbatim into the executed contract.
        if field.type in self.CHOICE_FIELD_TYPES:
            allowed = self.allowed_options(field)
            if allowed and text not in allowed:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Field '{field.label}' must be one of: {', '.join(allowed)}",
                )
        kind = self.effective_validation(field)
        if kind == "email":
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", text):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' must be an email address")
        elif kind == "numeric":
            try:
                number = Decimal(text.replace(",", ""))
            except (InvalidOperation, ValueError) as exc:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' must be numeric") from exc
            # Decimal() happily parses "NaN", "Infinity" and "1e999", so
            # declaring a field numeric was not enough to keep them out of a
            # formula that references it. "Numeric" here means a real quantity.
            if not number.is_finite():
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' must be numeric")

        # A currency field that neither formats nor validates an amount is why
        # this type was withdrawn from the palette. Now it does both.
        if field.type == FieldType.currency and formula_service.format_currency(text) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Field '{field.label}' must be an amount",
            )
        elif kind == "date":
            from datetime import date

            ok = False
            # The last two are what a native `datetime-local` control emits, so
            # a Date and Time field validated as a date is not rejected for
            # carrying the time the sender asked for.
            for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
                try:
                    from datetime import datetime as _dt

                    _dt.strptime(text, fmt)
                    ok = True
                    break
                except ValueError:
                    continue
            if not ok:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' must be a date")
        elif kind == "custom" and field.validation_pattern:
            try:
                matched = re.fullmatch(field.validation_pattern, text) is not None
            except re.error:
                matched = True
            if not matched:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail=f"Field '{field.label}' does not match its required format"
                )

    def _validate_recipient(self, document: Document, recipient_id: str) -> None:
        if not any(recipient.id == recipient_id for recipient in document.recipients):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field recipient must belong to this document")

    def _validate_coordinates(
        self,
        document: Document,
        page_number: int,
        x: Decimal,
        y: Decimal,
        width: Decimal,
        height: Decimal,
        page_cache: dict[int, tuple[Decimal, Decimal]] | None = None,
    ) -> None:
        if not document.original_file_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Upload a PDF before placing fields")
        if page_number < 1 or page_number > document.page_count:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid field page number")
        if x < 0 or y < 0 or width <= 0 or height <= 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid field coordinates")
        if page_cache is not None and page_number in page_cache:
            page_width, page_height = page_cache[page_number]
        else:
            reader = PdfReader(BytesIO(storage.read_bytes(document.original_file_path)))
            page = reader.pages[page_number - 1]
            # Bounds-check against the page as the builder drew it: CropBox
            # sized, /Rotate applied. Measuring the MediaBox rejected legal
            # placements on rotated pages and accepted ones that fell off it.
            geometry = page_geometry(page)
            page_width = Decimal(str(geometry.width))
            page_height = Decimal(str(geometry.height))
            if page_cache is not None:
                page_cache[page_number] = (page_width, page_height)
        if x + width > page_width or y + height > page_height:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field must fit inside the PDF page")


field_service = FieldService()

