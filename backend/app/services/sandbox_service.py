"""Sandbox tenancy (API-11).

A sandbox is a *paired organization*: a shadow ``organizations`` row that
shadows a live one. Test-mode API keys and sandbox-header session calls resolve
to that row, and because every query in this codebase is already scoped by
``organization_id``, isolation is a property of the schema rather than of each
call site. Nothing can leak live data into the sandbox through a filter someone
forgot to write, which is the failure mode an ``is_sandbox`` column on twenty
tables invites.

Two rules make the pairing safe:

* **Side effects are suppressed.** ``is_sandbox`` gates outbound email, SMS and
  billing. Callers do not opt in; the senders check the organization.
* **Sandbox users cannot sign in.** Each live member gets a mirror ``users`` row
  in the sandbox org so that services taking a ``User`` work unchanged, but the
  mirror carries an unusable password hash and a non-routable address, and the
  login path refuses any user whose organization is a sandbox.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from secrets import token_hex

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.contact import Contact
from app.models.document import Document
from app.models.enums import DocumentStatus, RecipientStatus, WorkflowType
from app.models.organization import Organization
from app.models.recipient import Recipient
from app.models.user import User

#: Mirror users get an address in a domain reserved by RFC 6761 as
#: permanently non-resolvable, so a suppression bug still cannot deliver.
SANDBOX_EMAIL_DOMAIN = "sandbox.invalid"

#: Never a valid hash for any verifier, so ``verify(password, hash)`` cannot
#: succeed even if the login guard were bypassed.
_UNUSABLE_PASSWORD = "!sandbox-no-login!"


def is_sandbox_organization(db: Session, organization_id: str | None) -> bool:
    """True when ``organization_id`` names a sandbox org. Cheap and defensive:
    the senders call it on every send, and an unknown id is treated as live."""
    if not organization_id:
        return False
    org = db.get(Organization, organization_id)
    return bool(org and org.is_sandbox)


class SandboxService:
    # ---- pairing ---------------------------------------------------------
    def sandbox_for(self, db: Session, *, live_organization_id: str) -> Organization:
        """The sandbox paired with a live organization, created on first use.

        Calling this with a sandbox org's own id returns that org, so the
        resolution in ``deps`` is idempotent and a test key can never mint a
        sandbox of a sandbox.
        """
        org = db.get(Organization, live_organization_id)
        if org is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
        if org.is_sandbox:
            return org

        existing = db.scalars(
            select(Organization).where(Organization.sandbox_of_organization_id == org.id)
        ).first()
        if existing is not None:
            return existing

        sandbox = Organization(
            name=f"{org.name} (Sandbox)",
            slug=None,
            region=org.region,
            is_sandbox=True,
            sandbox_of_organization_id=org.id,
            owner_user_id=org.owner_user_id,
            accent_color=org.accent_color,
            # The sandbox must exercise the same entitlements as the tenant it
            # shadows, or a Business-gated call would 402 in test and 200 in
            # live — the exact class of surprise a sandbox exists to prevent.
            subscription_tier=org.subscription_tier,
            subscription_status=org.subscription_status,
            # Deliberately *not* copied: allowed_origins and
            # default_return_url. Embed settings are configured once on the
            # live tenant and read through ``embed_service._settings_org``, so
            # the sandbox cannot drift behind an edited allow-list -- a stale
            # empty copy here would have quietly weakened the origin lock for
            # every sandbox session.
            live_mode_enabled=False,
        )
        db.add(sandbox)
        db.commit()
        db.refresh(sandbox)
        return sandbox

    def live_for(self, db: Session, *, sandbox_organization_id: str) -> Organization | None:
        """The live organization a sandbox shadows, or None if not a sandbox."""
        org = db.get(Organization, sandbox_organization_id)
        if org is None or not org.is_sandbox or not org.sandbox_of_organization_id:
            return None
        return db.get(Organization, org.sandbox_of_organization_id)

    # ---- mirror users ----------------------------------------------------
    def mirror_user_for(self, db: Session, *, live_user: User) -> User:
        """The sandbox counterpart of a live user, created on first use.

        Services throughout the app take a ``User`` and read
        ``user.organization_id``; handing them the mirror is what lets the
        whole service layer run against the sandbox without modification.
        """
        if live_user.organization_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User has no organization")
        sandbox = self.sandbox_for(db, live_organization_id=live_user.organization_id)
        email = self.mirror_email_for(live_user)
        existing = db.scalars(select(User).where(User.email == email)).first()
        if existing is not None:
            return existing

        mirror = User(
            email=email,
            password_hash=_UNUSABLE_PASSWORD,
            role=live_user.role,
            name=live_user.name,
            organization_id=sandbox.id,
            status="active",
        )
        db.add(mirror)
        db.commit()
        db.refresh(mirror)
        return mirror

    def mirror_email_for(self, live_user: User) -> str:
        """Deterministic, non-routable address keyed by the live user's id.

        Keyed by id rather than by their address so that a user changing their
        email does not orphan their sandbox data.
        """
        return f"sandbox-{live_user.id}@{SANDBOX_EMAIL_DOMAIN}"

    def is_mirror(self, user: User) -> bool:
        return user.email.endswith(f"@{SANDBOX_EMAIL_DOMAIN}")

    # ---- seed / reset ----------------------------------------------------
    def seed(self, db: Session, *, organization_id: str, sender: User) -> dict:
        """Populate a sandbox with contacts and documents across the statuses
        worth testing against. Refuses to touch a live organization."""
        org = self._require_sandbox(db, organization_id)
        now = datetime.now(timezone.utc)

        contact_specs = [
            ("Casey Example", "casey@example.com", "Example Industries", "customers", "sign"),
            ("Dana Example", "dana@example.com", "Example Industries", "customers", "approve"),
            ("Morgan Example", "morgan@example.com", "Example Legal", "counsel", "sign"),
            ("Ari Example", "ari@example.com", "Example Holdings", "vendors", "copy"),
        ]
        contacts: list[Contact] = []
        for name, email, company, group_key, role in contact_specs:
            contact = Contact(
                organization_id=org.id,
                name=name,
                email=email,
                company=company,
                default_role=role,
                group_key=group_key,
                source="manual",
                tags=["sandbox"],
                created_by_user_id=sender.id,
            )
            db.add(contact)
            contacts.append(contact)
        db.flush()

        document_specs = [
            ("Master Services Agreement — Example Industries", DocumentStatus.completed, 2),
            ("Mutual NDA — Example Legal", DocumentStatus.sent, 1),
            ("Statement of Work #1 — Example Holdings", DocumentStatus.draft, 0),
            ("Order Form — Example Industries", DocumentStatus.viewed, 1),
        ]
        documents: list[Document] = []
        for title, doc_status, recipient_count in document_specs:
            document = Document(
                organization_id=org.id,
                sender_id=sender.id,
                owner_user_id=sender.id,
                title=title,
                status=doc_status,
                workflow_type=WorkflowType.sequential,
                page_count=3,
                doc_type="agreement",
                sent_at=None if doc_status is DocumentStatus.draft else now - timedelta(days=3),
                completed_at=now - timedelta(days=1) if doc_status is DocumentStatus.completed else None,
                expires_at=now + timedelta(days=11),
            )
            db.add(document)
            db.flush()
            for index in range(recipient_count):
                contact = contacts[index % len(contacts)]
                db.add(
                    Recipient(
                        document_id=document.id,
                        name=contact.name,
                        email=contact.email,
                        role=contact.default_role,
                        contact_id=contact.id,
                        signing_order=index + 1,
                        status=(
                            RecipientStatus.completed
                            if doc_status is DocumentStatus.completed
                            else RecipientStatus.viewed
                            if doc_status is DocumentStatus.viewed and index == 0
                            else RecipientStatus.sent
                        ),
                        completed_at=now - timedelta(days=1) if doc_status is DocumentStatus.completed else None,
                    )
                )
            documents.append(document)

        db.commit()
        return self.status_payload(db, organization_id=org.id)

    def reset(self, db: Session, *, organization_id: str) -> dict:
        """Delete every document and contact in a sandbox.

        This is the operation that made the old fake Test/Live toggle dangerous
        — a ``DELETE`` there would have hit real records. Here the sandbox
        guard is the whole point, so it is checked before anything is removed.
        """
        org = self._require_sandbox(db, organization_id)

        documents = list(db.scalars(select(Document).where(Document.organization_id == org.id)))
        for document in documents:
            db.delete(document)
        contacts = list(db.scalars(select(Contact).where(Contact.organization_id == org.id)))
        for contact in contacts:
            db.delete(contact)
        db.commit()
        return {
            "deleted_documents": len(documents),
            "deleted_contacts": len(contacts),
            **self.status_payload(db, organization_id=org.id),
        }

    # ---- status ----------------------------------------------------------
    def status_payload(self, db: Session, *, organization_id: str) -> dict:
        org = db.get(Organization, organization_id)
        if org is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
        document_count = len(list(db.scalars(select(Document.id).where(Document.organization_id == org.id))))
        contact_count = len(list(db.scalars(select(Contact.id).where(Contact.organization_id == org.id))))
        return {
            "organization_id": org.id,
            "is_sandbox": bool(org.is_sandbox),
            "live_organization_id": org.sandbox_of_organization_id,
            "document_count": document_count,
            "contact_count": contact_count,
            "side_effects_suppressed": bool(org.is_sandbox),
        }

    def _require_sandbox(self, db: Session, organization_id: str) -> Organization:
        org = db.get(Organization, organization_id)
        if org is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
        if not org.is_sandbox:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This operation is only available in the sandbox. Send it with a test-mode key "
                "or the X-SignerPro-Sandbox header.",
            )
        return org


sandbox_service = SandboxService()
