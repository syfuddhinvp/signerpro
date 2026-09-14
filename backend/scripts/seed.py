from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from sqlalchemy import select

from app.core.database import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models.document import Document
from app.models.enums import UserRole, WorkflowType
from app.models.organization import Organization
from app.models.recipient import Recipient
from app.models.user import User
from app.services.billing_service import billing_service
from app.services.catalog_seed import seed_catalog


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # Plan catalogue + a subscription for every organization (idempotent).
        created_plans = billing_service.ensure_default_plans(db)
        if created_plans:
            print(f"Seeded {len(created_plans)} plan(s): {', '.join(p.code for p in created_plans)}")
        for org in db.scalars(select(Organization)):
            billing_service.get_or_create_subscription(db, org.id)

        # Platform template catalog blueprints (idempotent, unpublished until
        # a curator attaches the authoritative PDF).
        entries = seed_catalog(db)
        print(f"Catalog templates available: {len(entries)}")

        # Check and migrate old local email if it exists
        old_admin = db.scalar(select(User).where(User.email == "admin@signflow.local"))
        if old_admin:
            old_admin.email = "admin@signflow.com"
            old_admin.is_platform_admin = True
            db.commit()
            print("Migrated admin@signflow.local to admin@signflow.com")

        existing = db.scalar(select(User).where(User.email == "admin@signflow.com"))
        if existing:
            if not existing.is_platform_admin:
                existing.is_platform_admin = True
                db.commit()
                print("Promoted admin@signflow.com to platform admin.")
            print("Seed data already exists.")
            return
        organization = Organization(name="SignFlow Demo Realty")
        db.add(organization)
        db.flush()
        admin = User(
            organization_id=organization.id,
            name="Demo Admin",
            email="admin@signflow.com",
            password_hash=hash_password("password123"),
            role=UserRole.admin,
            is_platform_admin=True,
        )
        db.add(admin)
        db.flush()
        document = Document(
            organization_id=organization.id,
            sender_id=admin.id,
            title="Demo Purchase Agreement",
            workflow_type=WorkflowType.parallel,
        )
        db.add(document)
        db.flush()
        db.add_all(
            [
                Recipient(document_id=document.id, name="Buyer Example", email="buyer@example.com", role_name="Buyer", signing_order=1),
                Recipient(document_id=document.id, name="Seller Example", email="seller@example.com", role_name="Seller", signing_order=1),
            ]
        )
        db.commit()
        print("Seed data created.")
        print("Admin email: admin@signflow.com")
        print("Admin password: password123")
    finally:
        db.close()


if __name__ == "__main__":
    main()

