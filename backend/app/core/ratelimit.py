"""Swappable rate-limiting abstraction.

An in-memory fixed-window counter backend is used by default. A Redis backend can
be dropped in later by implementing :class:`RateLimitBackend` and assigning it to
the module level ``backend`` (see ``app.core.storage`` / ``app.core.email`` for the
same singleton pattern).

Call sites depend on :class:`RateLimiter` instances, never on the backend, so
swapping the backend requires no route changes.
"""

import threading
import time
from dataclasses import dataclass
from typing import Callable, Protocol

from fastapi import HTTPException, Request, status


# --- Configurable limits (module level to avoid touching shared config.py) ----

LOGIN_IP_LIMIT = 20
LOGIN_IP_WINDOW = 300  # 5 minutes

LOGIN_EMAIL_LIMIT = 10
LOGIN_EMAIL_WINDOW = 300

OTP_SEND_LIMIT = 5
OTP_SEND_WINDOW = 600  # 10 minutes per signing token

OTP_VERIFY_LIMIT = 10
OTP_VERIFY_WINDOW = 600

SIGNING_SESSION_IP_LIMIT = 120
SIGNING_SESSION_IP_WINDOW = 60

# OTP lockout policy (consumed by signing_service)
OTP_MAX_ATTEMPTS = 5
OTP_LOCKOUT_SECONDS = 900  # 15 minutes


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: int


class RateLimitBackend(Protocol):
    def hit(self, key: str, *, limit: int, window_seconds: int) -> RateLimitResult:
        ...

    def reset(self, key: str | None = None) -> None:
        ...


class InMemoryRateLimitBackend:
    """Fixed-window counters kept in-process. Single-node only."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._windows: dict[str, tuple[float, int]] = {}

    def hit(self, key: str, *, limit: int, window_seconds: int) -> RateLimitResult:
        now = time.monotonic()
        with self._lock:
            window_start, count = self._windows.get(key, (now, 0))
            if now - window_start >= window_seconds:
                window_start, count = now, 0
            count += 1
            self._windows[key] = (window_start, count)
            retry_after = max(1, int(window_seconds - (now - window_start)))
            if count > limit:
                return RateLimitResult(allowed=False, remaining=0, retry_after=retry_after)
            return RateLimitResult(allowed=True, remaining=limit - count, retry_after=retry_after)

    def reset(self, key: str | None = None) -> None:
        with self._lock:
            if key is None:
                self._windows.clear()
            else:
                self._windows.pop(key, None)


backend: RateLimitBackend = InMemoryRateLimitBackend()


def reset_rate_limits(key: str | None = None) -> None:
    """Test hook: clear all counters (or one key)."""
    backend.reset(key)


def client_ip(request: Request) -> str:
    """Mirrors ``app.api.deps.request_ip`` semantics (respects x-forwarded-for)."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


def path_param_key(name: str) -> Callable[[Request], str]:
    def _key(request: Request) -> str:
        return str(request.path_params.get(name, "unknown"))

    return _key


class RateLimiter:
    """A reusable, dependency-injectable limiter keyed by a caller-supplied function."""

    def __init__(
        self,
        *,
        name: str,
        limit: int,
        window_seconds: int,
        key_func: Callable[[Request], str] = client_ip,
        detail: str = "Too many requests. Please try again later.",
    ) -> None:
        self.name = name
        self.limit = limit
        self.window_seconds = window_seconds
        self.key_func = key_func
        self.detail = detail

    def _bucket(self, key: str) -> str:
        return f"{self.name}:{key}"

    def check(self, key: str) -> None:
        """Consume one unit for an arbitrary key (e.g. an email inside a service)."""
        result = backend.hit(self._bucket(key), limit=self.limit, window_seconds=self.window_seconds)
        if not result.allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=self.detail,
                headers={"Retry-After": str(result.retry_after)},
            )

    def __call__(self, request: Request) -> None:
        self.check(self.key_func(request))


login_ip_limiter = RateLimiter(
    name="login_ip",
    limit=LOGIN_IP_LIMIT,
    window_seconds=LOGIN_IP_WINDOW,
    detail="Too many login attempts from this address. Please try again later.",
)

login_email_limiter = RateLimiter(
    name="login_email",
    limit=LOGIN_EMAIL_LIMIT,
    window_seconds=LOGIN_EMAIL_WINDOW,
    detail="Too many login attempts for this account. Please try again later.",
)

otp_send_limiter = RateLimiter(
    name="otp_send",
    limit=OTP_SEND_LIMIT,
    window_seconds=OTP_SEND_WINDOW,
    key_func=path_param_key("token"),
    detail="Too many verification codes requested. Please wait before requesting another.",
)

otp_verify_limiter = RateLimiter(
    name="otp_verify",
    limit=OTP_VERIFY_LIMIT,
    window_seconds=OTP_VERIFY_WINDOW,
    key_func=path_param_key("token"),
    detail="Too many verification attempts. Please wait before trying again.",
)

signing_session_limiter = RateLimiter(
    name="signing_session",
    limit=SIGNING_SESSION_IP_LIMIT,
    window_seconds=SIGNING_SESSION_IP_WINDOW,
    detail="Too many signing link requests. Please try again later.",
)
