from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe

import jwt
from passlib.context import CryptContext

from app.core.config import get_settings


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
JWT_ALGORITHM = "HS256"

#: The ``purpose`` claim carried by a full access token. Every other token this
#: module mints carries a different purpose (``mfa`` today; signing / embed
#: tomorrow) and must therefore be rejected by the bearer-auth dependency.
ACCESS_TOKEN_PURPOSE = "access"

#: The ``purpose`` claim carried by a platform-admin impersonation token. It is
#: deliberately *accepted* as a bearer credential (support staff need the real
#: tenant surface) but is resolved through a different, far narrower path in
#: ``app.api.deps`` — see ``authorize_impersonation``.
IMPERSONATION_TOKEN_PURPOSE = "impersonation"

# Re-exported so callers catch one exception type without importing the JWT
# library themselves (this used to be ``jose.JWTError``).
JWTError = jwt.PyJWTError

#: A bcrypt hash of a value nobody can present, used to equalise login timing
#: for unknown accounts. Computed lazily so import stays cheap.
_DUMMY_PASSWORD_HASH: str | None = None


def dummy_password_hash() -> str:
    """A real bcrypt hash to verify against when the account does not exist.

    Without this, ``login`` skips bcrypt entirely for an unknown address and
    answers ~80x faster, which enumerates registered accounts.
    """
    global _DUMMY_PASSWORD_HASH
    if _DUMMY_PASSWORD_HASH is None:
        _DUMMY_PASSWORD_HASH = pwd_context.hash("signforge-timing-equaliser")
    return _DUMMY_PASSWORD_HASH


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except ValueError:
        # Malformed / empty stored hash: still a failure, never a crash.
        return False


def create_access_token(subject: str, *, session_id: str | None = None, **claims) -> str:
    """Mint an access token.

    ``session_id`` is carried as ``sid`` so ``GET /api/auth/sessions`` can flag
    which device row belongs to the calling token, and so logout can revoke
    exactly that row. Older tokens without ``sid`` keep working.
    """
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expires_minutes)
    payload: dict = {"sub": subject, "exp": expires_at, "purpose": ACCESS_TOKEN_PURPOSE}
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


def decode_token(token: str, *, expected_purpose: str | None = None) -> dict:
    """Decode and verify a token, optionally pinning its ``purpose`` claim.

    ``exp`` is verified by PyJWT itself. When ``expected_purpose`` is given, a
    token minted for another purpose (the MFA challenge, and any future
    signing / embed scoped token) is rejected here rather than silently
    accepted as a bearer credential.

    Legacy tokens that carry no ``purpose`` at all are treated as access
    tokens, so invitation and impersonation tokens keep working.
    """
    settings = get_settings()
    claims = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    if expected_purpose is not None:
        purpose = claims.get("purpose", ACCESS_TOKEN_PURPOSE)
        if purpose != expected_purpose:
            raise jwt.InvalidTokenError(f"token purpose {purpose!r} is not {expected_purpose!r}")
    return claims


def decode_access_token(token: str) -> dict:
    """Backwards-compatible alias: decodes without pinning a purpose.

    Anything that authenticates a caller must use
    ``decode_token(..., expected_purpose=ACCESS_TOKEN_PURPOSE)`` instead.
    """
    return decode_token(token)


def generate_signing_token() -> str:
    return token_urlsafe(48)


def hash_signing_token(raw_token: str) -> str:
    return sha256(raw_token.encode("utf-8")).hexdigest()

