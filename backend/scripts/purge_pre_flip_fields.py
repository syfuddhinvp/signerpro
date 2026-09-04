"""One-shot: drop field placements authored before the C1 origin fix.

AUDIT_REPORT.md C1: the browser authored field coordinates from the top-left
and ReportLab stamped them from the bottom-left, with no origin flip anywhere
between. Every field placed before that fix is stamped vertically mirrored --
a signature meant for the foot of page 3 lands across its header.

Why this purges rather than migrates
------------------------------------
There is no correct historical value to recover. The stored ``y`` was never
read under a consistent origin, so "migrating" it would mean inventing an
intent nobody recorded. Re-placement on an unsent draft is cheap; silently
rewriting coordinates underneath an executed contract is not defensible.

So this is deliberately narrow:

* **Draft documents only.** Anything sent, completed, declined or voided is
  left strictly alone. Those are legally retained records, and the executed
  PDF already carries whatever was stamped -- right or wrong. Rewriting or
  deleting their fields would change the record after the fact.
* Affected documents are reported by id so their owners can be told to
  re-place the fields.

Deliberately a script and not an Alembic data migration: this is an operator
decision with a printed count, not something that should happen silently as a
side effect of a deploy. In an environment with no pre-fix data -- which is
every environment that has not carried production data across the C1 fix --
it is a no-op and costs nothing.

    python scripts/purge_pre_flip_fields.py --before 2026-09-01 [--apply]

Without ``--apply`` it only reports. Nothing is deleted until you ask.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from sqlalchemy import delete, select

from app.core.database import SessionLocal
from app.models.document import Document
from app.models.enums import DocumentStatus
from app.models.field import Field

#: Only these are touched. Everything else is a record, not a draft.
PURGEABLE = (DocumentStatus.draft,)


def affected(db, *, cutoff: datetime):
    """Field ids on draft documents created before ``cutoff``, by document."""
    rows = db.execute(
        select(Field.id, Field.document_id)
        .join(Document, Document.id == Field.document_id)
        .where(Document.status.in_(PURGEABLE), Document.created_at < cutoff)
    ).all()
    by_document: dict[str, list[str]] = {}
    for field_id, document_id in rows:
        by_document.setdefault(document_id, []).append(field_id)
    return by_document


def purge(db, *, cutoff: datetime, apply: bool = False) -> tuple[int, int]:
    by_document = affected(db, cutoff=cutoff)
    field_ids = [fid for ids in by_document.values() for fid in ids]
    if apply and field_ids:
        db.execute(delete(Field).where(Field.id.in_(field_ids)))
        db.commit()
    return len(by_document), len(field_ids)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--before",
        required=True,
        help="ISO date. Fields on drafts created before this are considered pre-flip.",
    )
    parser.add_argument(
        "--apply", action="store_true", help="Actually delete. Without it, this only reports."
    )
    args = parser.parse_args()

    cutoff = datetime.fromisoformat(args.before).replace(tzinfo=timezone.utc)
    db = SessionLocal()
    try:
        documents, fields = purge(db, cutoff=cutoff, apply=args.apply)
    finally:
        db.close()

    verb = "Deleted" if args.apply else "Would delete"
    print(f"{verb} {fields} field placements across {documents} draft documents authored before {cutoff.date()}.")
    if not args.apply and fields:
        print("Re-run with --apply to perform the deletion. Owners must re-place these fields.")
    if fields == 0:
        print("Nothing to do: no draft documents predate the C1 fix in this database.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
