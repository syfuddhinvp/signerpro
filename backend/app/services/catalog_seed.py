"""Default catalog entries — what a brand-new deployment's catalog contains.

These are *blueprints*, not copies of the official PDFs: each carries the
roles and field placement for a form, and a platform admin attaches the
authoritative PDF (via ``attach_file``) before publishing. Entries ship
unpublished for exactly that reason — a form with no PDF behind it would
otherwise be importable, and the tenant would get an empty template.

Redistributing a government agency's PDF is a licensing question per form and
per jurisdiction, which is why no PDF bytes live in this repository.

Seeding upserts on ``slug``: re-running it updates the blueprint in place and
never creates a second copy of the same form. Curator edits to title,
description and placement are preserved — only the fields a new build
legitimately owns are refreshed.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.catalog_template import CatalogTemplate


SIGNER = {"key": "signer", "name": "Signer", "signing_order": 1, "role": "sign", "color": "#2563eb"}
EMPLOYER = {"key": "employer", "name": "Employer representative", "signing_order": 2, "role": "sign", "color": "#059669"}

# Coordinates are fractions of the page (0–1), the same units the builder
# writes to ``fields.x``.
CATALOG_DEFAULTS: list[dict] = [
    {
        "slug": "irs-w9",
        "title": "IRS Form W-9 — Request for Taxpayer Identification Number",
        "description": (
            "Collects a US payee's name, TIN and certification. Commonly requested "
            "before paying a contractor or vendor."
        ),
        "category": "government",
        "authority": "IRS",
        "jurisdiction": "US",
        "tags": ["tax", "contractor", "onboarding"],
        "page_count": 1,
        "sort_order": 10,
        "roles": [SIGNER],
        "fields": [
            {"role": "signer", "type": "full_name", "label": "Name", "page_number": 1,
             "x": 0.08, "y": 0.18, "width": 0.60, "height": 0.030},
            {"role": "signer", "type": "company", "label": "Business name", "page_number": 1,
             "x": 0.08, "y": 0.23, "width": 0.60, "height": 0.030, "required": False},
            {"role": "signer", "type": "address", "label": "Address", "page_number": 1,
             "x": 0.08, "y": 0.34, "width": 0.55, "height": 0.030},
            {"role": "signer", "type": "text", "label": "Taxpayer identification number", "page_number": 1,
             "x": 0.08, "y": 0.52, "width": 0.40, "height": 0.030},
            {"role": "signer", "type": "signature", "label": "Signature of US person", "page_number": 1,
             "x": 0.12, "y": 0.72, "width": 0.34, "height": 0.055},
            {"role": "signer", "type": "date", "label": "Date", "page_number": 1,
             "x": 0.62, "y": 0.72, "width": 0.20, "height": 0.030},
        ],
    },
    {
        "slug": "uscis-i9",
        "title": "USCIS Form I-9 — Employment Eligibility Verification",
        "description": (
            "Section 1 is completed and signed by the employee; Section 2 by an "
            "employer representative after examining documents."
        ),
        "category": "government",
        "authority": "USCIS",
        "jurisdiction": "US",
        "tags": ["hr", "onboarding", "eligibility"],
        "page_count": 2,
        "sort_order": 20,
        "roles": [
            {"key": "signer", "name": "Employee", "signing_order": 1, "role": "sign", "color": "#2563eb"},
            EMPLOYER,
        ],
        "fields": [
            {"role": "signer", "type": "full_name", "label": "Employee name", "page_number": 1,
             "x": 0.08, "y": 0.20, "width": 0.55, "height": 0.030},
            {"role": "signer", "type": "address", "label": "Address", "page_number": 1,
             "x": 0.08, "y": 0.27, "width": 0.55, "height": 0.030},
            {"role": "signer", "type": "date", "label": "Date of birth", "page_number": 1,
             "x": 0.68, "y": 0.27, "width": 0.22, "height": 0.030},
            {"role": "signer", "type": "email", "label": "Email address", "page_number": 1,
             "x": 0.08, "y": 0.34, "width": 0.40, "height": 0.030, "required": False},
            {"role": "signer", "type": "signature", "label": "Signature of employee", "page_number": 1,
             "x": 0.10, "y": 0.62, "width": 0.34, "height": 0.055},
            {"role": "signer", "type": "date", "label": "Today's date", "page_number": 1,
             "x": 0.62, "y": 0.62, "width": 0.20, "height": 0.030},
            {"role": "employer", "type": "signature", "label": "Signature of employer representative", "page_number": 2,
             "x": 0.10, "y": 0.70, "width": 0.34, "height": 0.055},
            {"role": "employer", "type": "title", "label": "Title of employer representative", "page_number": 2,
             "x": 0.10, "y": 0.78, "width": 0.34, "height": 0.030},
            {"role": "employer", "type": "date", "label": "Today's date", "page_number": 2,
             "x": 0.62, "y": 0.70, "width": 0.20, "height": 0.030},
        ],
    },
    {
        "slug": "irs-w4",
        "title": "IRS Form W-4 — Employee's Withholding Certificate",
        "description": "Tells an employer how much federal income tax to withhold from an employee's pay.",
        "category": "government",
        "authority": "IRS",
        "jurisdiction": "US",
        "tags": ["tax", "hr", "payroll"],
        "page_count": 1,
        "sort_order": 30,
        "roles": [{"key": "signer", "name": "Employee", "signing_order": 1, "role": "sign", "color": "#2563eb"}],
        "fields": [
            {"role": "signer", "type": "full_name", "label": "Name", "page_number": 1,
             "x": 0.08, "y": 0.16, "width": 0.50, "height": 0.030},
            {"role": "signer", "type": "text", "label": "Social security number", "page_number": 1,
             "x": 0.64, "y": 0.16, "width": 0.26, "height": 0.030},
            {"role": "signer", "type": "address", "label": "Address", "page_number": 1,
             "x": 0.08, "y": 0.23, "width": 0.55, "height": 0.030},
            {"role": "signer", "type": "signature", "label": "Employee's signature", "page_number": 1,
             "x": 0.12, "y": 0.76, "width": 0.34, "height": 0.055},
            {"role": "signer", "type": "date", "label": "Date", "page_number": 1,
             "x": 0.62, "y": 0.76, "width": 0.20, "height": 0.030},
        ],
    },
    {
        "slug": "mutual-nda",
        "title": "Mutual Non-Disclosure Agreement",
        "description": "A two-party mutual NDA. Both sides sign; neither is the sole discloser.",
        "category": "legal",
        "jurisdiction": None,
        "tags": ["nda", "confidentiality"],
        "page_count": 2,
        "sort_order": 40,
        "roles": [
            {"key": "party_a", "name": "Disclosing party", "signing_order": 1, "role": "sign", "color": "#2563eb"},
            {"key": "party_b", "name": "Receiving party", "signing_order": 2, "role": "sign", "color": "#059669"},
        ],
        "fields": [
            {"role": "party_a", "type": "signature", "label": "Signature", "page_number": 2,
             "x": 0.10, "y": 0.55, "width": 0.34, "height": 0.055},
            {"role": "party_a", "type": "full_name", "label": "Printed name", "page_number": 2,
             "x": 0.10, "y": 0.63, "width": 0.34, "height": 0.030},
            {"role": "party_a", "type": "date", "label": "Date", "page_number": 2,
             "x": 0.10, "y": 0.69, "width": 0.20, "height": 0.030},
            {"role": "party_b", "type": "signature", "label": "Signature", "page_number": 2,
             "x": 0.56, "y": 0.55, "width": 0.34, "height": 0.055},
            {"role": "party_b", "type": "full_name", "label": "Printed name", "page_number": 2,
             "x": 0.56, "y": 0.63, "width": 0.34, "height": 0.030},
            {"role": "party_b", "type": "date", "label": "Date", "page_number": 2,
             "x": 0.56, "y": 0.69, "width": 0.20, "height": 0.030},
        ],
    },
    {
        "slug": "offer-letter",
        "title": "Employment Offer Letter",
        "description": "Offer of employment, countersigned by the candidate to accept.",
        "category": "hr",
        "jurisdiction": None,
        "tags": ["hr", "hiring", "onboarding"],
        "page_count": 2,
        "sort_order": 50,
        "roles": [
            {"key": "candidate", "name": "Candidate", "signing_order": 1, "role": "sign", "color": "#2563eb"},
            {"key": "employer", "name": "Hiring manager", "signing_order": 2, "role": "approve", "color": "#059669"},
        ],
        "fields": [
            {"role": "candidate", "type": "full_name", "label": "Candidate name", "page_number": 1,
             "x": 0.10, "y": 0.22, "width": 0.45, "height": 0.030},
            {"role": "candidate", "type": "signature", "label": "Accepted by", "page_number": 2,
             "x": 0.10, "y": 0.62, "width": 0.34, "height": 0.055},
            {"role": "candidate", "type": "date", "label": "Date accepted", "page_number": 2,
             "x": 0.56, "y": 0.62, "width": 0.20, "height": 0.030},
            {"role": "employer", "type": "signature", "label": "On behalf of the company", "page_number": 2,
             "x": 0.10, "y": 0.76, "width": 0.34, "height": 0.055},
            {"role": "employer", "type": "date", "label": "Date", "page_number": 2,
             "x": 0.56, "y": 0.76, "width": 0.20, "height": 0.030},
        ],
    },
]


def seed_catalog(db: Session) -> list[CatalogTemplate]:
    """Upsert the default blueprints. Idempotent; safe to re-run."""
    existing = {
        entry.slug: entry
        for entry in db.scalars(
            select(CatalogTemplate).where(
                CatalogTemplate.slug.in_([item["slug"] for item in CATALOG_DEFAULTS])
            )
        ).unique()
    }
    out: list[CatalogTemplate] = []
    for item in CATALOG_DEFAULTS:
        entry = existing.get(item["slug"])
        if entry is None:
            entry = CatalogTemplate(
                slug=item["slug"],
                title=item["title"],
                description=item.get("description"),
                category=item["category"],
                authority=item.get("authority"),
                jurisdiction=item.get("jurisdiction"),
                tags=item.get("tags", []),
                page_count=item["page_count"],
                roles=item["roles"],
                fields=item["fields"],
                sort_order=item.get("sort_order", 0),
                # No PDF yet: publishing is a curator's decision, taken once
                # the authoritative file is attached.
                published=False,
            )
            db.add(entry)
        else:
            # Refresh the blueprint only. Title, description and published are
            # left alone: a curator may have corrected the copy or attached a
            # file, and a redeploy must not undo that.
            entry.roles = item["roles"]
            entry.fields = item["fields"]
            entry.page_count = max(entry.page_count, item["page_count"])
        out.append(entry)
    db.commit()
    return out
