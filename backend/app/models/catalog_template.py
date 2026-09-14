"""The platform template catalog — ready-made forms every tenant can start from.

An organization's own templates are ``Document`` rows with ``is_template``
set, and they stay that way. A catalog entry is deliberately *not* a
``Document``: it belongs to the platform rather than to any organization, so
giving it an ``organization_id`` would mean inventing a fake tenant to own the
IRS W-9, and every tenant-scoped query in the codebase would then have to
learn about that exception.

Instead a catalog entry is a blueprint: the source PDF plus the roles and
field boxes that should be stamped onto it. ``catalog_service.import_to_org``
turns one into a normal org template, after which every existing template code
path — use, duplicate, archive, usage — applies unchanged.
"""

from sqlalchemy import Boolean, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.mixins import TimestampMixin, UUIDPrimaryKeyMixin


class CatalogTemplate(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "catalog_templates"
    __table_args__ = (
        Index("ix_catalog_templates_slug", "slug", unique=True),
        Index("ix_catalog_templates_category", "category"),
        Index("ix_catalog_templates_published", "published"),
    )

    # Stable, human-readable handle ("irs-w9", "i-9-employment-eligibility").
    # Seeds upsert on this, so re-running a seed updates an entry instead of
    # creating a second copy of the same form.
    slug: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # government | legal | hr | finance | real_estate | health | other
    category: Mapped[str] = mapped_column(String(40), nullable=False, default="other", server_default="other")
    # The body that publishes the form ("IRS", "USCIS"), for government forms.
    authority: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # ISO-ish region the form applies to: "US", "US-CA", "GB". Null = anywhere.
    jurisdiction: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # The publisher's own revision ("Rev. October 2018"), not our row version.
    form_revision: Mapped[str | None] = mapped_column(String(60), nullable=True)
    tags: Mapped[list | None] = mapped_column(JSON, nullable=True)

    file_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")

    # [{"key": "signer", "name": "Signer", "signing_order": 1, "color": "#..."}]
    # Roles are placeholders: they carry no email, because the sender fills
    # those in on the document the import produces.
    roles: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # [{"role": "signer", "type": "signature", "page_number": 1, "x": ...,
    #   "y": ..., "width": ..., "height": ..., "label": ..., "required": true}]
    # Coordinates use the same units as ``fields.x`` so an import is a copy,
    # not a conversion.
    fields: Mapped[list | None] = mapped_column(JSON, nullable=True)

    # Unpublished entries are visible to platform admins only, so an entry can
    # be drafted and proofed before tenants can see it.
    published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
