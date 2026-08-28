"""API key issuance, verification and scope enforcement (API-1…API-6, API-10).

Only a SHA-256 hash of the secret is ever persisted. The plaintext secret is
returned exactly once — by create and by roll — and cannot be recovered
afterwards (there is deliberately no reveal endpoint; see API-3).
"""

from datetime import datetime, timedelta, timezone
from secrets import token_urlsafe

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.hashing import sha256_bytes
from app.models.api_key import API_KEY_SCOPES, ApiKey
from app.models.embed_session import EmbedSession
from app.models.usage_event import UsageEventType
from app.models.user import User


VALID_SCOPES = {scope for scope, _ in API_KEY_SCOPES}
VALID_MODES = {"live", "test"}


def hash_api_key(raw_key: str) -> str:
    return sha256_bytes(raw_key.encode("utf-8"))


def _as_aware_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class ApiKeyService:
    def scope_catalogue(self) -> list[dict[str, str]]:
        return [{"scope": scope, "label": scope, "description": description} for scope, description in API_KEY_SCOPES]

    def validate_scopes(self, scopes: list[str]) -> list[str]:
        unknown = sorted({item for item in scopes if item not in VALID_SCOPES})
        if unknown:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown scopes: {', '.join(unknown)}",
            )
        # De-duplicate but keep the catalogue order stable for the UI.
        return [scope for scope, _ in API_KEY_SCOPES if scope in set(scopes)]

    def _validate_mode(self, mode: str) -> str:
        if mode not in VALID_MODES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="mode must be 'live' or 'test'")
        return mode

    def _mint_secret(self, mode: str) -> tuple[str, str, str]:
        body = token_urlsafe(24).replace("-", "").replace("_", "")[:32]
        raw = f"sk_{mode}_{body}"
        prefix = f"sk_{mode}_{body[:4]}"
        return raw, prefix, body[-4:]

    def list_for_organization(self, db: Session, *, organization_id: str, include_revoked: bool = True) -> list[ApiKey]:
        stmt = select(ApiKey).where(ApiKey.organization_id == organization_id)
        if not include_revoked:
            stmt = stmt.where(ApiKey.revoked_at.is_(None))
        return list(db.scalars(stmt.order_by(ApiKey.created_at.desc())))

    def get_for_organization(self, db: Session, *, key_id: str, organization_id: str) -> ApiKey:
        api_key = db.get(ApiKey, key_id)
        if not api_key or api_key.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
        return api_key

    def create(self, db: Session, *, user: User, label: str, mode: str, scopes: list[str]) -> tuple[ApiKey, str]:
        mode = self._validate_mode(mode)
        raw, prefix, last_four = self._mint_secret(mode)
        api_key = ApiKey(
            organization_id=user.organization_id,
            label=label,
            mode=mode,
            prefix=prefix,
            last_four=last_four,
            key_hash=hash_api_key(raw),
            scopes=self.validate_scopes(scopes),
            created_by_user_id=user.id,
        )
        db.add(api_key)
        db.commit()
        db.refresh(api_key)
        return api_key, raw

    def roll(self, db: Session, *, api_key: ApiKey) -> tuple[ApiKey, str]:
        """Replace the secret in place. The old secret stops working immediately."""
        raw, prefix, last_four = self._mint_secret(api_key.mode)
        api_key.prefix = prefix
        api_key.last_four = last_four
        api_key.key_hash = hash_api_key(raw)
        api_key.last_used_at = None
        api_key.revoked_at = None
        db.commit()
        db.refresh(api_key)
        return api_key, raw

    def revoke(self, db: Session, *, api_key: ApiKey) -> ApiKey:
        if api_key.revoked_at is None:
            api_key.revoked_at = datetime.now(timezone.utc)
            db.commit()
            db.refresh(api_key)
        return api_key

    def restore(self, db: Session, *, api_key: ApiKey) -> ApiKey:
        if api_key.revoked_at is not None:
            api_key.revoked_at = None
            db.commit()
            db.refresh(api_key)
        return api_key

    def set_scopes(self, db: Session, *, api_key: ApiKey, scopes: list[str]) -> ApiKey:
        api_key.scopes = self.validate_scopes(scopes)
        db.commit()
        db.refresh(api_key)
        return api_key

    def grant_scopes(self, db: Session, *, api_key: ApiKey, scopes: list[str]) -> ApiKey:
        merged = set(api_key.scopes or []) | set(self.validate_scopes(scopes))
        return self.set_scopes(db, api_key=api_key, scopes=sorted(merged))

    def revoke_scopes(self, db: Session, *, api_key: ApiKey, scopes: list[str]) -> ApiKey:
        remaining = set(api_key.scopes or []) - set(self.validate_scopes(scopes))
        return self.set_scopes(db, api_key=api_key, scopes=sorted(remaining))

    def authenticate(self, db: Session, *, raw_key: str) -> ApiKey:
        api_key = db.scalar(select(ApiKey).where(ApiKey.key_hash == hash_api_key(raw_key)))
        if not api_key:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
        if api_key.revoked_at is not None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key has been revoked")
        api_key.last_used_at = datetime.now(timezone.utc)
        # Every API-key authenticated request is one metered API call (BIL-11).
        # Checked before the request runs, so an exhausted plan gets a 402 with
        # the machine-readable body instead of silent overage.
        from app.models.plan import ENTITLEMENT_MAX_API_CALLS_PER_MONTH
        from app.services.entitlement_service import entitlement_service

        entitlement_service.check_entitlement(
            db, api_key.organization_id, ENTITLEMENT_MAX_API_CALLS_PER_MONTH, 1
        )
        entitlement_service.record_usage(
            db,
            organization_id=api_key.organization_id,
            event_type=UsageEventType.api_call,
            metadata={"api_key_id": api_key.id, "mode": api_key.mode},
        )
        db.commit()
        return api_key

    def usage(self, db: Session, *, organization_id: str) -> dict:
        keys = self.list_for_organization(db, organization_id=organization_id)
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        active = [key for key in keys if key.revoked_at is None]
        used_24h = [key for key in keys if (_as_aware_utc(key.last_used_at) or since) >= since and key.last_used_at]
        sessions = list(
            db.scalars(
                select(EmbedSession).where(EmbedSession.organization_id == organization_id)
            )
        )
        recent_sessions = [item for item in sessions if (_as_aware_utc(item.created_at) or since) >= since]
        durations = [
            (_as_aware_utc(item.consumed_at) - _as_aware_utc(item.created_at)).total_seconds()
            for item in recent_sessions
            if item.consumed_at
        ]
        return {
            "requests_24h": len(used_24h),
            "p95_latency_ms": 0,
            "error_rate_pct": 0.0,
            "error_count": 0,
            "active_key_count": len(active),
            "revoked_key_count": len(keys) - len(active),
            "embed_sessions_24h": len(recent_sessions),
            "embed_avg_seconds": round(sum(durations) / len(durations), 2) if durations else 0.0,
        }


api_key_service = ApiKeyService()
