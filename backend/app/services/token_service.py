from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import generate_signing_token, hash_signing_token
from app.models.signing_token import SigningToken


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class TokenService:
    def create_for_recipient(
        self,
        db: Session,
        *,
        document_id: str,
        recipient_id: str,
        expires_at: datetime | None = None,
    ) -> tuple[str, SigningToken]:
        """Mint a signing link, superseding any live link for this recipient.

        ``expires_at`` is the envelope's own deadline (``Document.expires_at``,
        derived from the per-document ``expires_in_days``). A signing link must
        never outlive the envelope it signs, so callers pass it through. When it
        is omitted -- or already in the past -- the global
        ``SIGNING_TOKEN_EXPIRE_DAYS`` default applies.
        """
        settings = get_settings()
        # Supersede any live link previously issued to this recipient so a reminder
        # does not leave an extra valid signing URL in an inbox.
        now = datetime.now(timezone.utc)
        db.execute(
            update(SigningToken)
            .where(SigningToken.recipient_id == recipient_id, SigningToken.revoked_at.is_(None))
            .values(revoked_at=now)
            .execution_options(synchronize_session="fetch")
        )
        raw_token = generate_signing_token()
        signing_token = SigningToken(
            document_id=document_id,
            recipient_id=recipient_id,
            token_hash=hash_signing_token(raw_token),
            expires_at=self._resolve_expiry(expires_at, now=now, settings=settings),
        )
        db.add(signing_token)
        return raw_token, signing_token

    def _resolve_expiry(self, expires_at: datetime | None, *, now: datetime, settings) -> datetime:
        fallback = now + timedelta(days=settings.signing_token_expire_days)
        if expires_at is None:
            return fallback
        deadline = _as_aware_utc(expires_at)
        return deadline if deadline > now else fallback

    def get_valid_token(self, db: Session, raw_token: str) -> SigningToken:
        token_hash = hash_signing_token(raw_token)
        signing_token = db.scalar(select(SigningToken).where(SigningToken.token_hash == token_hash))
        if not signing_token:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Signing link is invalid")
        if signing_token.revoked_at is not None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Signing link has been revoked")
        if _as_aware_utc(signing_token.expires_at) <= datetime.now(timezone.utc):
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Signing link has expired")
        return signing_token


token_service = TokenService()
