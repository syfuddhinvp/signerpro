"""Short-lived embed sessions (API-7) and the tenant embed settings (API-9)."""

from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.hashing import sha256_bytes
from app.models.document import Document
from app.models.embed_session import EmbedSession
from app.models.organization import Organization
from app.models.recipient import Recipient
from app.schemas.embed import EmbedSessionCreate, EmbedSessionResponse


def hash_embed_token(raw_token: str) -> str:
    return sha256_bytes(raw_token.encode("utf-8"))


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _normalize_origin(origin: str) -> str:
    parsed = urlparse(origin if "//" in origin else f"//{origin}")
    host = parsed.netloc or parsed.path
    scheme = parsed.scheme or "https"
    return f"{scheme}://{host}".rstrip("/").lower()


class EmbedService:
    def _get_org(self, db: Session, organization_id: str) -> Organization:
        org = db.get(Organization, organization_id)
        if not org:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
        return org

    # ---- settings (API-9) -------------------------------------------------
    def get_settings_payload(self, db: Session, *, organization_id: str) -> dict:
        org = self._get_org(db, organization_id)
        return {
            "allowed_origins": list(org.allowed_origins or []),
            "default_return_url": org.default_return_url,
            "live_mode_enabled": bool(org.live_mode_enabled),
        }

    def update_settings(self, db: Session, *, organization_id: str, payload) -> dict:
        org = self._get_org(db, organization_id)
        if payload.allowed_origins is not None:
            org.allowed_origins = [_normalize_origin(item) for item in payload.allowed_origins if item.strip()]
        if payload.default_return_url is not None:
            org.default_return_url = payload.default_return_url or None
        if payload.live_mode_enabled is not None:
            org.live_mode_enabled = payload.live_mode_enabled
        db.commit()
        return self.get_settings_payload(db, organization_id=organization_id)

    # ---- sessions (API-7) -------------------------------------------------
    def create(
        self,
        db: Session,
        *,
        organization_id: str,
        payload: EmbedSessionCreate,
    ) -> tuple[EmbedSession, str]:
        org = self._get_org(db, organization_id)
        document_id = payload.document.document_id or payload.document.template_id
        if document_id:
            document = db.get(Document, document_id)
            if not document or document.organization_id != organization_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
        contacts: list[dict] = []
        if payload.recipient_id:
            recipient = db.get(Recipient, payload.recipient_id)
            if not recipient or (document_id and recipient.document_id != document_id):
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")
            owner = db.get(Document, recipient.document_id)
            if not owner or owner.organization_id != organization_id:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recipient not found")
            contacts.append({"recipient_id": recipient.id, "name": recipient.name, "email": recipient.email})
            document_id = document_id or recipient.document_id
        for contact in payload.contacts:
            contacts.append(contact.model_dump(exclude_none=True))
        if payload.landing == "signing" and not payload.recipient_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A recipient_id is required for the signing landing")

        raw_token = token_urlsafe(32)
        session = EmbedSession(
            organization_id=organization_id,
            document_id=document_id,
            token_hash=hash_embed_token(raw_token),
            landing=payload.landing,
            external_id=payload.document.external_id,
            return_url=payload.return_url or org.default_return_url,
            allowed_origins=list(org.allowed_origins or []),
            contact_ids=contacts,
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=payload.ttl_minutes),
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session, raw_token

    def response(self, session: EmbedSession, *, raw_token: str | None = None) -> EmbedSessionResponse:
        base = get_settings().app_base_url.rstrip("/")
        url = f"{base}/embed/{session.landing}?session={raw_token}" if raw_token else ""
        return EmbedSessionResponse(
            id=session.id,
            url=url,
            landing=session.landing,
            document_id=session.document_id,
            external_id=session.external_id,
            return_url=session.return_url,
            allowed_origins=list(session.allowed_origins or []),
            contacts=list(session.contact_ids or []),
            expires_at=session.expires_at,
            consumed_at=session.consumed_at,
            created_at=session.created_at,
            expired=self.is_expired(session),
        )

    def is_expired(self, session: EmbedSession) -> bool:
        return _aware(session.expires_at) <= datetime.now(timezone.utc)

    def list_for_organization(self, db: Session, *, organization_id: str) -> list[EmbedSession]:
        return list(
            db.scalars(
                select(EmbedSession)
                .where(EmbedSession.organization_id == organization_id)
                .order_by(EmbedSession.created_at.desc())
            )
        )

    def get_for_organization(self, db: Session, *, session_id: str, organization_id: str) -> EmbedSession:
        session = db.get(EmbedSession, session_id)
        if not session or session.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Embed session not found")
        return session

    def revoke(self, db: Session, *, session: EmbedSession) -> EmbedSession:
        """Revocation is expiry: the session is pushed into the past."""
        session.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
        db.refresh(session)
        return session

    def resolve(self, db: Session, *, raw_token: str, origin: str | None) -> EmbedSession:
        session = db.scalar(select(EmbedSession).where(EmbedSession.token_hash == hash_embed_token(raw_token)))
        if not session:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Embed session is invalid")
        if self.is_expired(session):
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Embed session has expired")
        # Single-use, as the route has always claimed. ``consumed_at`` was
        # stamped but never checked, so a leaked URL replayed indefinitely
        # until it expired.
        if session.consumed_at is not None:
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Embed session has already been used",
            )

        allowed = [_normalize_origin(item) for item in (session.allowed_origins or [])]
        if allowed:
            if not origin or _normalize_origin(origin) not in allowed:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin is not allowed for this embed session")
        elif origin is not None:
            # No allowlist is the default for every new organization, and the
            # check used to be skipped entirely in that case — a leaked embed
            # URL worked from any site. Fail closed instead: with nothing
            # configured, only first-party (our own app) and server-side
            # (no Origin header) exchanges are honoured.
            if _normalize_origin(origin) != _normalize_origin(get_settings().app_base_url):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "This organization has no embed allowlist configured, so only "
                        "first-party origins may exchange a session. Set allowed_origins "
                        "in the embed settings."
                    ),
                )

        session.consumed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(session)
        return session


embed_service = EmbedService()
