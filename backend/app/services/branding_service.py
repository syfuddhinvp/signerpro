"""Sender branding themes (ORG-7).

The invariant this module owns: a tenant has at most one default theme, and
an envelope that names no theme gets that one. Both halves live here so that
no route can create a second default or leave a tenant with none.
"""

from base64 import b64decode

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.storage import StoragePathError, storage

from app.models.branding_theme import BrandingTheme
from app.models.document import Document
from app.models.organization import Organization
from app.schemas.branding import (
    BrandingThemeCreate,
    BrandingThemeResponse,
    BrandingThemeUpdate,
)
from app.services.entitlement_service import entitlement_service


#: Guard rail, not a plan limit: a tenant with hundreds of themes is a runaway
#: integration, and the picker on the workflow screen is a select.
MAX_THEMES_PER_ORG = 50

#: A logo is fetched by every recipient's mail client, so it is kept small on
#: purpose -- a 5 MB PNG in an invitation is a bad experience for them and a
#: bandwidth bill for us.
LOGO_MAX_BYTES = 1024 * 1024

#: Magic numbers rather than the declared content type: the browser's word for
#: what a file is comes from its extension, and this one is served back out to
#: third parties. PNG, JPEG, GIF and SVG cover what a brand kit ever contains --
#: except SVG, which is deliberately absent: it is a document that can carry
#: script, and we serve it from our own origin.
_LOGO_TYPES: tuple[tuple[bytes, str, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "png", "image/png"),
    (b"\xff\xd8\xff", "jpg", "image/jpeg"),
    (b"GIF87a", "gif", "image/gif"),
    (b"GIF89a", "gif", "image/gif"),
)


class BrandingService:
    # ---------- reads ----------

    def list_for_org(self, db: Session, *, organization_id: str) -> list[BrandingThemeResponse]:
        themes = list(
            db.scalars(
                select(BrandingTheme)
                .where(BrandingTheme.organization_id == organization_id)
                # Default first, then alphabetical: the picker's first row is
                # the one most envelopes will use.
                .order_by(BrandingTheme.is_default.desc(), BrandingTheme.name)
            )
        )
        counts = self._document_counts(db, organization_id=organization_id)
        return [self.response(t, document_count=counts.get(t.id, 0)) for t in themes]

    def get_for_org(self, db: Session, *, theme_id: str, organization_id: str) -> BrandingTheme:
        theme = db.get(BrandingTheme, theme_id)
        if not theme or theme.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Branding theme not found")
        return theme

    def default_for_org(self, db: Session, *, organization_id: str) -> BrandingTheme | None:
        return db.scalars(
            select(BrandingTheme)
            .where(
                BrandingTheme.organization_id == organization_id,
                BrandingTheme.is_default.is_(True),
            )
            .limit(1)
        ).first()

    def resolve_for_document(self, db: Session, *, document: Document) -> BrandingTheme | None:
        """The theme a document's recipient-facing surfaces should use.

        The document's own choice wins; otherwise the tenant's default. A
        document pointing at a theme in another tenant is treated as unset
        rather than honoured -- that can only be a bug or a tampered id, and
        neither should leak one tenant's brand into another's email.
        """
        if document.branding_theme_id:
            theme = db.get(BrandingTheme, document.branding_theme_id)
            if theme and theme.organization_id == document.organization_id:
                return theme
        return self.default_for_org(db, organization_id=document.organization_id)

    def _document_counts(self, db: Session, *, organization_id: str) -> dict[str, int]:
        rows = db.execute(
            select(Document.branding_theme_id, func.count(Document.id))
            .where(
                Document.organization_id == organization_id,
                Document.branding_theme_id.is_not(None),
            )
            .group_by(Document.branding_theme_id)
        ).all()
        return {theme_id: count for theme_id, count in rows}

    # ---------- writes ----------

    def create(
        self, db: Session, *, organization_id: str, payload: BrandingThemeCreate
    ) -> BrandingTheme:
        entitlement_service.check_custom_branding(db, organization_id)
        existing = db.scalar(
            select(func.count())
            .select_from(BrandingTheme)
            .where(BrandingTheme.organization_id == organization_id)
        )
        if existing >= MAX_THEMES_PER_ORG:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"An organization may hold at most {MAX_THEMES_PER_ORG} branding themes",
            )
        self._assert_name_free(db, organization_id=organization_id, name=payload.name, theme_id=None)

        theme = BrandingTheme(
            organization_id=organization_id,
            name=payload.name,
            logo_url=payload.logo_url,
            logo_position=payload.logo_position,
            primary_color=payload.primary_color,
            primary_text_color=payload.primary_text_color,
            headline=payload.headline,
            message=payload.message,
            contact_sender_email=(
                str(payload.contact_sender_email) if payload.contact_sender_email else None
            ),
            footer_signature=payload.footer_signature,
        )
        # The first theme a tenant creates is its default whether it asked or
        # not: a tenant with themes but no default would brand nothing.
        theme.is_default = bool(payload.is_default) or not existing
        db.add(theme)
        db.flush()
        if theme.is_default:
            self._demote_other_defaults(db, organization_id=organization_id, keep_id=theme.id)
        db.commit()
        db.refresh(theme)
        return theme

    def update(self, db: Session, *, theme: BrandingTheme, payload: BrandingThemeUpdate) -> BrandingTheme:
        entitlement_service.check_custom_branding(db, theme.organization_id)
        fields_set = payload.model_fields_set

        if "name" in fields_set and payload.name is not None:
            self._assert_name_free(
                db, organization_id=theme.organization_id, name=payload.name, theme_id=theme.id
            )
            theme.name = payload.name

        # A `null` clears the field; omitting the key leaves it alone. That
        # distinction is the whole reason for reading `model_fields_set`.
        for key in (
            "logo_url", "primary_color", "primary_text_color",
            "headline", "message", "footer_signature",
        ):
            if key in fields_set:
                setattr(theme, key, getattr(payload, key))
        if "logo_position" in fields_set and payload.logo_position is not None:
            theme.logo_position = payload.logo_position
        if "contact_sender_email" in fields_set:
            theme.contact_sender_email = (
                str(payload.contact_sender_email) if payload.contact_sender_email else None
            )

        if "is_default" in fields_set and payload.is_default is not None:
            if payload.is_default:
                theme.is_default = True
                db.flush()
                self._demote_other_defaults(
                    db, organization_id=theme.organization_id, keep_id=theme.id
                )
            elif theme.is_default:
                # Clearing the only default would leave envelopes unbranded
                # with nothing in the UI saying why. Promote another instead.
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Make another theme the default instead of clearing this one",
                )

        db.add(theme)
        db.commit()
        db.refresh(theme)
        return theme

    def delete(self, db: Session, *, theme: BrandingTheme) -> None:
        organization_id = theme.organization_id
        was_default = theme.is_default
        # Envelopes keep sending: releasing them back to the default is the
        # behaviour a NULL already means, so just clear the pointer. The FK is
        # ON DELETE SET NULL too; doing it here keeps the session consistent.
        db.execute(
            Document.__table__.update()
            .where(Document.branding_theme_id == theme.id)
            .values(branding_theme_id=None)
        )
        db.delete(theme)
        db.flush()
        if was_default:
            # Never leave a tenant with themes but no default.
            successor = db.scalars(
                select(BrandingTheme)
                .where(BrandingTheme.organization_id == organization_id)
                .order_by(BrandingTheme.created_at)
                .limit(1)
            ).first()
            if successor:
                successor.is_default = True
                db.add(successor)
        db.commit()

    # ---------- helpers ----------

    def _assert_name_free(
        self, db: Session, *, organization_id: str, name: str, theme_id: str | None
    ) -> None:
        query = select(BrandingTheme.id).where(
            BrandingTheme.organization_id == organization_id,
            BrandingTheme.name == name,
        )
        if theme_id:
            query = query.where(BrandingTheme.id != theme_id)
        if db.scalars(query.limit(1)).first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A branding theme with that name already exists",
            )

    def _demote_other_defaults(self, db: Session, *, organization_id: str, keep_id: str) -> None:
        db.execute(
            BrandingTheme.__table__.update()
            .where(
                BrandingTheme.organization_id == organization_id,
                BrandingTheme.id != keep_id,
                BrandingTheme.is_default.is_(True),
            )
            .values(is_default=False)
        )

    def signer_branding(
        self, db: Session, *, document: Document
    ) -> "SignerBranding | None":
        """What a *recipient* is shown: the resolved theme plus the tenant's
        name. ``None`` when the tenant has no theme, so the signing page falls
        back to SignerPro's own chrome.

        Never carries the theme's internal fields (envelope counts, ids); a
        signing link is held by someone outside the organization.
        """
        from app.schemas.signer import SignerBranding

        theme = self.resolve_for_document(db, document=document)
        if theme is None:
            return None
        organization = db.get(Organization, document.organization_id)
        return SignerBranding(
            organization_name=organization.name if organization else None,
            theme_name=theme.name,
            logo_url=self.logo_url_for(theme),
            logo_position=theme.logo_position,
            primary_color=theme.primary_color,
            primary_text_color=theme.primary_text_color,
        )

    def logo_url_for(self, theme: BrandingTheme) -> str | None:
        """The logo a recipient should fetch, as an absolute URL.

        An uploaded logo wins over an externally hosted one: it is the more
        recent choice, and the only one the UI can set. The URL points at the
        *frontend*, which is the origin that is actually public -- a mail
        client has no session and cannot reach the API directly.
        """
        if theme.logo_path:
            base = get_settings().app_base_url.rstrip("/")
            # Cache-busted by the theme's own mtime so a replaced logo is not
            # served from a mail client's cache forever.
            stamp = int(theme.updated_at.timestamp()) if theme.updated_at else 0
            return f"{base}/brand/{theme.id}/logo?v={stamp}"
        return theme.logo_url

    def response(self, theme: BrandingTheme, *, document_count: int = 0) -> BrandingThemeResponse:
        return BrandingThemeResponse.model_validate(theme).model_copy(
            update={
                "document_count": document_count,
                "logo_url": self.logo_url_for(theme),
                "logo_uploaded": bool(theme.logo_path),
            }
        )

    # ---------- logo ----------

    def set_logo(self, db: Session, *, theme: BrandingTheme, image_base64: str) -> BrandingTheme:
        """Store an uploaded logo and point the theme at it."""
        entitlement_service.check_custom_branding(db, theme.organization_id)
        payload = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
        try:
            image_bytes = b64decode(payload, validate=True)
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Logo is not valid base64"
            ) from exc
        if not image_bytes:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Logo is empty")
        if len(image_bytes) > LOGO_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Logo must be 1 MB or smaller",
            )
        match = next(
            (entry for entry in _LOGO_TYPES if image_bytes.startswith(entry[0])), None
        )
        if match is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Logo must be a PNG, JPEG or GIF image",
            )
        suffix = match[1]

        previous = theme.logo_path
        theme.logo_path = storage.write_bytes(
            f"branding/{theme.organization_id}/{theme.id}/logo.{suffix}", image_bytes
        )
        # An uploaded logo replaces a pasted URL rather than shadowing it, so
        # the two cannot disagree about what the brand is.
        theme.logo_url = None
        if previous and previous != theme.logo_path:
            self._discard_logo_object(previous)
        db.add(theme)
        db.commit()
        db.refresh(theme)
        return theme

    def clear_logo(self, db: Session, *, theme: BrandingTheme) -> BrandingTheme:
        """Drop the uploaded logo; invitations carry no logo again."""
        entitlement_service.check_custom_branding(db, theme.organization_id)
        if theme.logo_path:
            self._discard_logo_object(theme.logo_path)
            theme.logo_path = None
            db.add(theme)
            db.commit()
            db.refresh(theme)
        return theme

    def open_logo(self, theme: BrandingTheme):
        """``(stream, media_type)`` for the uploaded logo."""
        if not theme.logo_path:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No logo")
        try:
            stream = storage.open_stream(theme.logo_path)
        except (OSError, StoragePathError) as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Logo is unavailable"
            ) from exc
        lowered = theme.logo_path.lower()
        if lowered.endswith((".jpg", ".jpeg")):
            media_type = "image/jpeg"
        elif lowered.endswith(".gif"):
            media_type = "image/gif"
        else:
            media_type = "image/png"
        return stream, media_type

    @staticmethod
    def _discard_logo_object(path: str) -> None:
        """A failed delete must not fail the request: the row no longer points
        at the object, so the worst case is an orphan in storage."""
        try:
            storage.delete(path)
        except (OSError, StoragePathError, NotImplementedError):
            pass

    # ---------- outbound rendering ----------

    def seed_from_organization(self, db: Session, *, organization: Organization) -> BrandingTheme | None:
        """Turn a tenant's existing accent/logo into its first theme.

        Branding used to be two columns on the organization. A tenant that set
        them before themes existed should not have to retype them, so the
        first read of an empty theme list materialises them as "Default".
        Returns ``None`` when there was nothing to carry over.
        """
        if not organization.accent_color and not organization.logo_url:
            return None
        if db.scalars(
            select(BrandingTheme.id)
            .where(BrandingTheme.organization_id == organization.id)
            .limit(1)
        ).first():
            return None
        theme = BrandingTheme(
            organization_id=organization.id,
            name="Default",
            is_default=True,
            logo_url=organization.logo_url,
            primary_color=organization.accent_color,
        )
        db.add(theme)
        db.commit()
        db.refresh(theme)
        return theme


branding_service = BrandingService()
