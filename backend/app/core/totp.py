"""RFC 6238 TOTP + recovery codes, standard library only.

Deliberately dependency-free: adding ``pyotp`` for ~40 lines of HMAC would be a
new supply-chain edge for a security-critical path. Every secret comparison here
goes through :func:`hmac.compare_digest` so a wrong code leaks no timing signal.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

DIGITS = 6
PERIOD = 30
# One step either side absorbs clock skew between the phone and the server.
DEFAULT_DRIFT_STEPS = 1

RECOVERY_CODE_COUNT = 10
_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_secret(length: int = 20) -> str:
    """A fresh base32 TOTP secret (no padding — authenticator apps dislike it)."""
    return base64.b32encode(secrets.token_bytes(length)).decode("ascii").rstrip("=")


def _decode_secret(secret: str) -> bytes:
    padded = secret.strip().replace(" ", "").upper()
    padded += "=" * (-len(padded) % 8)
    return base64.b32decode(padded, casefold=True)


def code_at(secret: str, counter: int) -> str:
    digest = hmac.new(_decode_secret(secret), struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10**DIGITS)).zfill(DIGITS)


def current_code(secret: str, *, at: float | None = None) -> str:
    return code_at(secret, int((at if at is not None else time.time()) // PERIOD))


def verify(secret: str, code: str, *, at: float | None = None, drift_steps: int = DEFAULT_DRIFT_STEPS) -> bool:
    """Constant-time TOTP check across a small drift window."""
    if not secret or not code:
        return False
    candidate = "".join(ch for ch in code if ch.isdigit())
    if len(candidate) != DIGITS:
        return False
    counter = int((at if at is not None else time.time()) // PERIOD)
    matched = False
    for step in range(-drift_steps, drift_steps + 1):
        # No early return: every step is evaluated so the loop cost is fixed.
        matched |= hmac.compare_digest(code_at(secret, counter + step), candidate)
    return matched


def provisioning_uri(secret: str, *, account_name: str, issuer: str) -> str:
    label = quote(f"{issuer}:{account_name}", safe="")
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1&digits={DIGITS}&period={PERIOD}"
    )


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    def group() -> str:
        return "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(5))

    return [f"{group()}-{group()}" for _ in range(count)]


def hash_recovery_code(code: str) -> str:
    return hashlib.sha256(normalize_recovery_code(code).encode("utf-8")).hexdigest()


def normalize_recovery_code(code: str) -> str:
    return "".join(ch for ch in code.upper() if ch.isalnum())


def consume_recovery_code(hashed: list[str] | None, code: str) -> tuple[bool, list[str]]:
    """Constant-time recovery-code check; returns (matched, remaining hashes)."""
    if not hashed or not code:
        return False, list(hashed or [])
    candidate = hash_recovery_code(code)
    remaining: list[str] = []
    matched = False
    for entry in hashed:
        if hmac.compare_digest(entry, candidate) and not matched:
            matched = True
            continue
        remaining.append(entry)
    return matched, remaining
