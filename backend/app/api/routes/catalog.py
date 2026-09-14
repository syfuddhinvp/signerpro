"""The platform template catalog.

Two routers, two audiences:

* ``router`` — any signed-in sender browses the published catalog and imports
  an entry into their organization's template library.
* ``platform_router`` — platform admins curate the catalog itself.

Both are mounted in ``app.main``. The tenant router is mounted under
``/api/templates/catalog`` so the catalog reads as part of the template
library it feeds; its routes must be registered *before*
``templates.router``'s ``/{template_id}`` or "catalog" is swallowed as a
template id.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_platform_admin
from app.core.database import get_db
from app.core.storage import storage
from app.models.user import User
from app.schemas.catalog import (
    CatalogImportRequest,
    CatalogListResponse,
    CatalogTemplateCreate,
    CatalogTemplateDetail,
    CatalogTemplateResponse,
    CatalogTemplateUpdate,
)
from app.schemas.template import TemplateResponse
from app.services.catalog_seed import seed_catalog
from app.services.catalog_service import catalog_service
from app.services.template_service import template_service


router = APIRouter(prefix="/api/templates/catalog", tags=["templates"])
platform_router = APIRouter(prefix="/api/platform/catalog-templates", tags=["platform"])


# ── tenant: browse and import ──────────────────────────────────────────────


@router.get("", response_model=CatalogListResponse)
def browse_catalog(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    jurisdiction: str | None = Query(default=None),
    sort: str = Query(default="recommended", description="recommended | title | recent"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CatalogListResponse:
    return catalog_service.list_entries(
        db,
        organization_id=user.organization_id,
        published_only=True,
        q=q,
        category=category,
        jurisdiction=jurisdiction,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get("/{catalog_id}", response_model=CatalogTemplateDetail)
def get_catalog_entry(
    catalog_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> CatalogTemplateDetail:
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=True)
    imported = entry.slug in catalog_service.imported_slugs(db, organization_id=user.organization_id)
    return catalog_service.detail(entry, imported=imported)


@router.post("/{catalog_id}/import", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
def import_catalog_entry(
    catalog_id: str,
    payload: CatalogImportRequest | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> TemplateResponse:
    """Copy a catalog entry into this organization as an ordinary template.

    The sender then uses it exactly like one they built: assign real signers,
    then ``POST /api/templates/{id}/use``. Importing costs no document quota —
    nothing has been sent yet.
    """
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=True)
    template = catalog_service.import_to_org(db, entry=entry, user=user, payload=payload or CatalogImportRequest())
    return template_service.single_response(db, template)


# ── platform: curate ───────────────────────────────────────────────────────


@platform_router.get("", response_model=CatalogListResponse)
def list_catalog(
    q: str | None = Query(default=None),
    category: str | None = Query(default=None),
    include_unpublished: bool = Query(default=True),
    sort: str = Query(default="recommended"),
    limit: int = Query(default=100, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> CatalogListResponse:
    return catalog_service.list_entries(
        db,
        organization_id=None,
        published_only=not include_unpublished,
        q=q,
        category=category,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@platform_router.post("", response_model=CatalogTemplateDetail, status_code=status.HTTP_201_CREATED)
def create_catalog_entry(
    payload: CatalogTemplateCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> CatalogTemplateDetail:
    entry = catalog_service.create(db, payload=payload, user=admin)
    return catalog_service.detail(entry)


@platform_router.get("/{catalog_id}", response_model=CatalogTemplateDetail)
def read_catalog_entry(
    catalog_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> CatalogTemplateDetail:
    return catalog_service.detail(catalog_service.get(db, catalog_id=catalog_id, published_only=False))


@platform_router.patch("/{catalog_id}", response_model=CatalogTemplateDetail)
def update_catalog_entry(
    catalog_id: str,
    payload: CatalogTemplateUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> CatalogTemplateDetail:
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=False)
    return catalog_service.detail(catalog_service.update(db, entry=entry, payload=payload))


@platform_router.delete("/{catalog_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_catalog_entry(
    catalog_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> None:
    catalog_service.delete(db, entry=catalog_service.get(db, catalog_id=catalog_id, published_only=False))


@platform_router.post("/{catalog_id}/file", response_model=CatalogTemplateDetail)
async def upload_catalog_file(
    catalog_id: str,
    upload: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> CatalogTemplateDetail:
    """Attach (or replace) the authoritative PDF behind a catalog entry.

    Entries seed unpublished precisely because this step has not happened yet:
    publishing one with no file would let tenants import an empty template.
    """
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=False)
    return catalog_service.detail(await catalog_service.attach_file(db, entry=entry, upload=upload))


@platform_router.post("/{catalog_id}/draft-template", response_model=TemplateResponse, status_code=status.HTTP_201_CREATED)
def open_draft_template(
    catalog_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> TemplateResponse:
    """The curator's editable copy of an entry, for the document builder.

    Placement is authored in the ordinary builder rather than in a second
    field editor built for the catalog: the builder already knows how to drag
    a signature box onto a page. This hands back a template in the curator's
    own organization; ``POST .../adopt/{template_id}`` saves it back.

    Idempotent — calling it twice returns the same draft, so re-opening the
    builder cannot silently discard the placement already done.
    """
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=False)
    template = catalog_service.draft_template(db, entry=entry, user=admin)
    return template_service.single_response(db, template)


@platform_router.post("/{catalog_id}/adopt/{template_id}", response_model=CatalogTemplateDetail)
def adopt_template_into_entry(
    catalog_id: str,
    template_id: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_platform_admin),
) -> CatalogTemplateDetail:
    """Save a template's roles, field placement and PDF into the entry.

    Tenants who already imported the form keep their copy untouched; this
    changes what future imports produce.
    """
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=False)
    template = template_service.get_for_user(db, template_id=template_id, user=admin)
    return catalog_service.detail(catalog_service.adopt_template(db, entry=entry, template=template, user=admin))


@platform_router.post("/{catalog_id}/publish", response_model=CatalogTemplateResponse)
def publish_catalog_entry(
    catalog_id: str,
    published: bool = Query(default=True),
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> CatalogTemplateResponse:
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=False)
    entry = catalog_service.update(db, entry=entry, payload=CatalogTemplateUpdate(published=published))
    return catalog_service.response(entry)


@platform_router.post("/seed", response_model=CatalogListResponse)
def seed_default_catalog(
    db: Session = Depends(get_db),
    _: User = Depends(require_platform_admin),
) -> CatalogListResponse:
    """Upsert the built-in blueprints. Idempotent, and never un-publishes or
    overwrites copy a curator has edited."""
    seed_catalog(db)
    return catalog_service.list_entries(db, organization_id=None, published_only=False, limit=200)


@router.get("/{catalog_id}/pdf")
def catalog_pdf(
    catalog_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> FileResponse:
    """Preview the form before adding it. Published entries only, so this is
    not a way to read a draft the platform has not released."""
    entry = catalog_service.get(db, catalog_id=catalog_id, published_only=True)
    if not entry.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="This form has no PDF yet")
    return FileResponse(storage.path(entry.file_path), media_type="application/pdf", filename=f"{entry.slug}.pdf")
