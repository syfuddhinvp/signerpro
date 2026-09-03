"""Swappable rate-limiting abstraction.

Two backends implement :class:`RateLimitBackend`: in-memory fixed-window counters
(the default, and what the test suite and single-node development use), and Redis
(shared across replicas). ``RATE_LIMIT_BACKEND=redis`` with ``REDIS_URL`` selects
the latter.

**Why the Redis backend matters.** In-process counters are per-replica, so every
limit here silently multiplies by the replica count. That is not merely a scaling
wart: login, OTP send and password reset are all throttled through this module,
so three replicas mean three times as many password guesses per window. It is an
authentication-strength regression.

Call sites depend on :class:`RateLimiter` instances, never on the backend, so
swapping the backend requires no route changes.
"""

import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, Protocol

from fastapi import HTTPException, Request, status

from app.core.config import get_settings

logger = logging.getLogger("signflow.ratelimit")


# --- Configurable limits (module level to avoid touching shared config.py) ----

LOGIN_IP_LIMIT = 20
LOGIN_IP_WINDOW = 300  # 5 minutes

LOGIN_EMAIL_LIMIT = 10
LOGIN_EMAIL_WINDOW = 300

# Token refresh gets its own bucket, deliberately separate from login. It is not
# a credential-guessing surface -- the caller must already hold a valid,
# unrevoked refresh token -- and one ordinary browsing session legitimately
# rotates many times (the access token lives 15 minutes, and concurrent
# navigations race). Sharing login's 20/5min bucket meant normal browsing could
# exhaust the login budget and lock the user out of signing in at all.
TOKEN_REFRESH_IP_LIMIT = 60
TOKEN_REFRESH_IP_WINDOW = 300

OTP_SEND_LIMIT = 5
OTP_SEND_WINDOW = 600  # 10 minutes per signing token

OTP_VERIFY_LIMIT = 10
OTP_VERIFY_WINDOW = 600

PASSWORD_FORGOT_LIMIT = 5
PASSWORD_FORGOT_WINDOW = 900  # 15 minutes

PASSWORD_RESET_LIMIT = 10
PASSWORD_RESET_WINDOW = 900

MFA_VERIFY_LIMIT = 10
MFA_VERIFY_WINDOW = 300

# Public API (/api/v1). Keyed by API key id, so one tenant's key can never
# saturate the database on behalf of everyone. The monthly call quota is a
# billing control, not a throttle: it does not stop 100k requests in a minute.
PUBLIC_API_LIMIT = 600
PUBLIC_API_WINDOW = 60

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


class RedisRateLimitBackend:
    """Fixed-window counters in Redis, shared by every replica.

    One round trip per hit: ``INCR`` and, only when the counter is newly
    created, ``EXPIRE``. Doing both in a pipeline keeps them in a single
    request; the window is fixed rather than sliding, matching the in-memory
    backend's semantics exactly so the two are interchangeable.

    **Fail-open on Redis errors.** A Redis outage must not lock every user out
    of the product. The failure is logged loudly, and the blast radius is a
    temporary loss of throttling -- strictly better than a total outage, and
    the alternative (fail-closed) turns a cache blip into a full denial of
    service against your own users.
    """

    def __init__(self, url: str, *, namespace: str = "ratelimit") -> None:
        import redis  # imported lazily: only needed when this backend is selected

        self._redis = redis.Redis.from_url(url, decode_responses=True)
        self._namespace = namespace

    def _key(self, key: str) -> str:
        return f"{self._namespace}:{key}"

    def hit(self, key: str, *, limit: int, window_seconds: int) -> RateLimitResult:
        redis_key = self._key(key)
        try:
            pipeline = self._redis.pipeline()
            pipeline.incr(redis_key)
            pipeline.ttl(redis_key)
            count, ttl = pipeline.execute()
            if ttl is None or ttl < 0:
                # Counter had no expiry (first hit of a window, or a key that
                # somehow lost its TTL) -- set one so the window can close.
                self._redis.expire(redis_key, window_seconds)
                ttl = window_seconds
        except Exception:  # noqa: BLE001 - see the fail-open note above
            logger.error("ratelimit.redis_unavailable", exc_info=True)
            return RateLimitResult(allowed=True, remaining=limit, retry_after=1)

        retry_after = max(1, int(ttl))
        if count > limit:
            return RateLimitResult(allowed=False, remaining=0, retry_after=retry_after)
        return RateLimitResult(allowed=True, remaining=limit - int(count), retry_after=retry_after)

    def reset(self, key: str | None = None) -> None:
        try:
            if key is None:
                cursor = 0
                while True:
                    cursor, keys = self._redis.scan(cursor, match=f"{self._namespace}:*", count=500)
                    if keys:
                        self._redis.delete(*keys)
                    if cursor == 0:
                        break
            else:
                self._redis.delete(self._key(key))
        except Exception:  # noqa: BLE001
            logger.error("ratelimit.redis_unavailable", exc_info=True)


def build_backend() -> RateLimitBackend:
    """Select a backend from configuration, defaulting to in-memory.

    Defaulting to in-memory keeps the test suite and single-node development
    completely unaffected; a misconfigured Redis selection degrades to
    in-memory with a warning rather than refusing to boot.
    """
    settings = get_settings()
    choice = (settings.rate_limit_backend or "memory").strip().lower()
    if choice == "redis":
        if not settings.redis_url:
            logger.error("ratelimit.redis_url_missing")
        else:
            try:
                return RedisRateLimitBackend(settings.redis_url)
            except Exception:  # noqa: BLE001 - ImportError or a bad URL
                logger.error("ratelimit.redis_init_failed", exc_info=True)
    elif choice != "memory":
        logger.warning("ratelimit.unknown_backend", extra={"backend": choice})
    return InMemoryRateLimitBackend()


backend: RateLimitBackend = build_backend()


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

token_refresh_limiter = RateLimiter(
    name="token_refresh",
    limit=TOKEN_REFRESH_IP_LIMIT,
    window_seconds=TOKEN_REFRESH_IP_WINDOW,
    detail="Too many session refreshes from this address. Please try again later.",
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

password_forgot_limiter = RateLimiter(
    name="password_forgot",
    limit=PASSWORD_FORGOT_LIMIT,
    window_seconds=PASSWORD_FORGOT_WINDOW,
    detail="Too many password reset requests. Please try again later.",
)

password_forgot_email_limiter = RateLimiter(
    name="password_forgot_email",
    limit=PASSWORD_FORGOT_LIMIT,
    window_seconds=PASSWORD_FORGOT_WINDOW,
    detail="Too many password reset requests for this account. Please try again later.",
)

password_reset_limiter = RateLimiter(
    name="password_reset",
    limit=PASSWORD_RESET_LIMIT,
    window_seconds=PASSWORD_RESET_WINDOW,
    detail="Too many password reset attempts. Please try again later.",
)

mfa_verify_limiter = RateLimiter(
    name="mfa_verify",
    limit=MFA_VERIFY_LIMIT,
    window_seconds=MFA_VERIFY_WINDOW,
    detail="Too many verification attempts. Please try again later.",
)


public_api_limiter = RateLimiter(
    name="public_api",
    limit=PUBLIC_API_LIMIT,
    window_seconds=PUBLIC_API_WINDOW,
    detail="API rate limit exceeded for this key. Please slow down.",
)
