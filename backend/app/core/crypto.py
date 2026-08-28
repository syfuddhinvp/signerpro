"""Authenticated symmetric encryption for secrets at rest.

Ciphertexts are versioned so keys can be rotated::

    enc:v1:<base64url(nonce || aes-gcm ciphertext+tag)>

Anything that does *not* carry the ``enc:`` prefix is treated as a legacy
plaintext value and passed through untouched, so a database written before
encryption was introduced keeps working and is transparently upgraded the
next time the row is written.
"""

from __future__ import annotations

import base64
import logging
import os
from functools import lru_cache

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator

logger = logging.getLogger(__name__)

PREFIX = "enc:"
CURRENT_VERSION = "v1"
_NONCE_BYTES = 12
_INFO = b"signflow-secret-encryption"


class EncryptionKeyMissing(RuntimeError):
    """Raised when no encryption key is configured in a production environment."""


def _derive_key(secret: str, version: str) -> bytes:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.hkdf import HKDF

    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=f"signflow-{version}".encode(),
        info=_INFO,
    )
    return hkdf.derive(secret.encode())


def _configured_secrets() -> dict[str, str]:
    """Map of key-version -> raw secret.

    ``SECRET_ENCRYPTION_KEY`` supplies the current version. Retired keys may be
    supplied as ``SECRET_ENCRYPTION_KEYS_OLD`` in ``version:secret`` form,
    comma-separated, so ciphertexts written by them still decrypt during a
    rotation.
    """

    from app.core.config import get_settings

    settings = get_settings()
    secrets: dict[str, str] = {}

    old = getattr(settings, "secret_encryption_keys_old", None)
    if old:
        for entry in old.split(","):
            entry = entry.strip()
            if not entry or ":" not in entry:
                continue
            version, _, value = entry.partition(":")
            secrets[version.strip()] = value.strip()

    current = getattr(settings, "secret_encryption_key", None)
    if not current:
        environment = (getattr(settings, "environment", "development") or "").lower()
        if environment == "production":
            raise EncryptionKeyMissing(
                "SECRET_ENCRYPTION_KEY must be set in production: tenant gateway "
                "secrets cannot be encrypted at rest without it."
            )
        # Development / test: derive a deterministic fallback so the app and the
        # existing test-suite run without extra configuration.
        current = f"insecure-dev-fallback::{settings.jwt_secret}"
        logger.warning(
            "secret_encryption.key_missing",
            extra={"environment": environment, "action": "using-development-fallback"},
        )

    secrets[CURRENT_VERSION] = current
    return secrets


@lru_cache
def _keyring() -> dict[str, bytes]:
    return {version: _derive_key(secret, version) for version, secret in _configured_secrets().items()}


def reset_keyring_cache() -> None:
    """Forget derived keys (tests / after a config reload)."""

    _keyring.cache_clear()


def verify_encryption_configured() -> None:
    """Startup check: raises in production when no key is configured."""

    _keyring()


def is_encrypted(value: str) -> bool:
    return isinstance(value, str) and value.startswith(PREFIX)


def encrypt(plaintext: str) -> str:
    if plaintext is None:
        return plaintext
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = _keyring()[CURRENT_VERSION]
    nonce = os.urandom(_NONCE_BYTES)
    blob = nonce + AESGCM(key).encrypt(nonce, plaintext.encode(), CURRENT_VERSION.encode())
    return f"{PREFIX}{CURRENT_VERSION}:{base64.urlsafe_b64encode(blob).decode()}"


def decrypt(value: str) -> str:
    """Decrypt a versioned ciphertext; pass legacy plaintext straight through."""

    if not is_encrypted(value):
        return value
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    try:
        _, version, payload = value.split(":", 2)
        key = _keyring()[version]
        blob = base64.urlsafe_b64decode(payload.encode())
        nonce, ciphertext = blob[:_NONCE_BYTES], blob[_NONCE_BYTES:]
        return AESGCM(key).decrypt(nonce, ciphertext, version.encode()).decode()
    except KeyError:
        logger.error("secret_encryption.unknown_key_version", extra={"value_prefix": value[:12]})
        raise
    except Exception:
        logger.exception("secret_encryption.decrypt_failed")
        raise


class EncryptedString(TypeDecorator):
    """Transparent at-rest encryption for a string column.

    Swapping a column's type to this changes nothing for callers: the ORM
    hands back plaintext, and the database stores ciphertext.
    """

    impl = String
    cache_ok = True

    def __init__(self, length: int | None = None, **kwargs) -> None:
        # Ciphertext is longer than plaintext; widen the underlying column.
        super().__init__(length=None if length is None else max(length * 3, length + 120), **kwargs)

    def process_bind_param(self, value, dialect):  # noqa: D102
        if value is None:
            return None
        if is_encrypted(value):
            return value
        return encrypt(str(value))

    def process_result_value(self, value, dialect):  # noqa: D102
        if value is None:
            return None
        try:
            return decrypt(value)
        except Exception:
            # Never take the whole request down because one column will not
            # decrypt (e.g. a key that has been rotated out).
            return None
