from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe

from jose import jwt
from passlib.context import CryptContext

from app.core.config import get_settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def create_access_token(subject: str, *, session_id: str | None = None, **claims) -> str:
    """Mint an access token.

    ``session_id`` is carried as ``sid`` so ``GET /api/auth/sessions`` can flag
    which device row belongs to the calling token, and so logout can revoke
    exactly that row. Older tokens without ``sid`` keep working.
    """
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expires_minutes)
    payload: dict = {"sub": subject, "exp": expires_at}
    if session_id:
        payload["sid"] = session_id
    payload.update(claims)
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def create_scoped_token(subject: str, *, purpose: str, expires_in_seconds: int, **claims) -> str:
    """A short-lived, single-purpose token (e.g. the MFA login challenge)."""
    settings = get_settings()
    payload: dict = {
        "sub": subject,
        "purpose": purpose,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds),
    }
    payload.update(claims)
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def generate_refresh_token() -> str:
    return token_urlsafe(48)


def hash_opaque_token(raw_token: str) -> str:
    """SHA-256 of a bearer-style opaque token (refresh / password-reset)."""
    return sha256(raw_token.encode("utf-8")).hexdigest()


def decode_access_token(token: str) -> dict:
    settings = get_settings()
    return jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])


def generate_signing_token() -> str:
    return token_urlsafe(48)


def hash_signing_token(raw_token: str) -> str:
    return sha256(raw_token.encode("utf-8")).hexdigest()

