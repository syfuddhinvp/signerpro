"""Wipe every seeded/dev row and leave exactly three users behind.

Local development only. The point is a database small enough to reason about:
one platform org holding the super admin, one tenant org holding an admin and
a sender, the plan catalogue, and nothing else. Everything the demo seeds and
the test suites left behind -- documents, audit trails, logs, subscriptions,
API keys -- is gone.

    python scripts/reset_to_minimal.py --dry-run   # show what would go
    python scripts/reset_to_minimal.py             # do it

It refuses to run when ENVIRONMENT=production, and refuses a live Stripe key,
because "delete every row" is not a thing that should ever be one typo away
from a real tenant's data. TRUNCATE ... CASCADE handles the FK graph in one
statement, including the deliberate FK guards (organizations -> documents) that
would otherwise block an ORM delete.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from sqlalchemy import inspect, select, text

from app.core.config import get_settings
from app.core.database import SessionLocal, engine
from app.core.security import hash_password
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.user import User
from app.services.billing_service import billing_service, is_live_stripe_key

#: Alembic's bookkeeping is schema state, not data: truncating it would make
#: the next `alembic upgrade` replay every migration against a live schema.
PRESERVE = {"alembic_version"}

PASSWORD = "password123"

#: example.com, not a .local/.test/.invalid address: the API validates logins
#: with pydantic's EmailStr, which refuses the special-use reserved TLDs, so a
#: `.local` address is rejected by the schema before auth ever sees it.

PLATFORM_ORG = "SignerPro Platform"
TENANT_ORG = "Demo Tenant"

USERS = [
    # (org, name, email, role, is_platform_admin)
    (PLATFORM_ORG, "Super Admin", "superadmin@example.com", UserRole.admin, True),
    (TENANT_ORG, "Tenant Admin", "admin@example.com", UserRole.admin, False),
    (TENANT_ORG, "Tenant User", "user@example.com", UserRole.sender, False),
]


def refuse_if_unsafe() -> None:
    settings = get_settings()
    environment = (settings.environment or "").strip().lower()
    if environment in {"production", "prod"}:
        sys.exit(f"refusing to run with ENVIRONMENT={environment!r}.")
    if is_live_stripe_key(settings.stripe_secret_key):
        sys.exit("refusing to run with a LIVE Stripe key configured.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="report only, change nothing")
    args = parser.parse_args()

    refuse_if_unsafe()

    tables = [t for t in inspect(engine).get_table_names() if t not in PRESERVE]

    db = SessionLocal()
    try:
        populated = []
        for table in sorted(tables):
            count = db.execute(text(f'select count(*) from "{table}"')).scalar() or 0
            if count:
                populated.append((table, count))

        total = sum(count for _, count in populated)
        print(f"{len(populated)} populated table(s), {total} row(s):")
        for table, count in populated:
            print(f"  {count:7d}  {table}")

        if args.dry_run:
            print("\nwould then create:")
            for org, name, email, role, platform in USERS:
                print(f"  {email}  ({role}{', platform admin' if platform else ''})  in {org!r}")
            print(f"  the plan catalogue, and a subscription for {TENANT_ORG!r}")
            print("\ndry run: nothing was deleted.")
            return

        # One statement, so no intermediate state violates a constraint.
        db.execute(text("truncate table " + ", ".join(f'"{t}"' for t in tables) + " cascade"))
        db.commit()
        print(f"\ntruncated {len(tables)} table(s).")

        orgs: dict[str, Organization] = {}
        for name in (PLATFORM_ORG, TENANT_ORG):
            org = Organization(name=name)
            db.add(org)
            orgs[name] = org
        db.flush()

        for org_name, name, email, role, platform in USERS:
            user = User(
                organization_id=orgs[org_name].id,
                name=name,
                email=email,
                password_hash=hash_password(PASSWORD),
                role=role,
                is_platform_admin=platform,
            )
            db.add(user)
            db.flush()
            # First user of an org owns it; the platform org's owner is the
            # super admin, the tenant's is its admin.
            if orgs[org_name].owner_user_id is None:
                orgs[org_name].owner_user_id = user.id
        db.commit()

        created_plans = billing_service.ensure_default_plans(db)
        if created_plans:
            print(f"seeded {len(created_plans)} plan(s): {', '.join(p.code for p in created_plans)}")
        # Only the tenant bills. A subscription for the platform org would show
        # up as revenue against ourselves in every platform report.
        billing_service.get_or_create_subscription(db, orgs[TENANT_ORG].id)
        db.commit()

        print("\nusers now in the database:")
        for user in db.scalars(select(User).order_by(User.email)):
            tag = "platform admin" if user.is_platform_admin else str(user.role)
            print(f"  {user.email}  ({tag})  password: {PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
