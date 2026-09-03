"""Structured JSON logging with request-scoped context.

Adoption is intentionally trivial::

    from app.core.logging import get_logger

    logger = get_logger(__name__)
    logger.info("email.sent", extra={"to": recipient.email})

Any record emitted anywhere in the process automatically picks up the
request id / organization id / user id bound by the ASGI middleware in
``app.main`` via :mod:`contextvars`.
"""

from __future__ import annotations

import anyio
import json
import logging
import sys
import threading
import time
import uuid
from hashlib import sha256
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Iterator

REQUEST_ID_HEADER = "X-Request-ID"

_request_id: ContextVar[str | None] = ContextVar("signflow_request_id", default=None)
_organization_id: ContextVar[str | None] = ContextVar("signflow_organization_id", default=None)
_user_id: ContextVar[str | None] = ContextVar("signflow_user_id", default=None)
#: Set for the duration of a request authenticated by a platform-admin
#: impersonation token. Everything that writes an evidentiary record consults
#: it so an impersonated action is never attributed to the tenant's own user.
_impersonation: ContextVar[dict | None] = ContextVar("signflow_impersonation", default=None)

# Attributes present on every stdlib LogRecord; anything else the caller put in
# ``extra=`` is merged into the JSON payload.
_RESERVED = set(
    logging.LogRecord("", 0, "", 0, "", None, None).__dict__
) | {"message", "asctime", "taskName"}


def new_request_id() -> str:
    return uuid.uuid4().hex


def get_request_id() -> str | None:
    return _request_id.get()


def get_organization_id() -> str | None:
    return _organization_id.get()


def bind_request_context(
    *,
    request_id: str | None = None,
    organization_id: str | None = None,
    user_id: str | None = None,
) -> list[tuple[ContextVar[str | None], Token]]:
    """Bind context values, returning tokens for :func:`reset_request_context`."""

    tokens: list[tuple[ContextVar[str | None], Token]] = []
    for var, value in (
        (_request_id, request_id),
        (_organization_id, organization_id),
        (_user_id, user_id),
    ):
        if value is not None:
            tokens.append((var, var.set(value)))
    return tokens


def reset_request_context(tokens: list[tuple[ContextVar[str | None], Token]]) -> None:
    for var, token in reversed(tokens):
        var.reset(token)


@contextmanager
def request_context(**values: str | None) -> Iterator[None]:
    tokens = bind_request_context(**values)
    try:
        yield
    finally:
        reset_request_context(tokens)


def context_snapshot() -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for key, var in (
        ("request_id", _request_id),
        ("organization_id", _organization_id),
        ("user_id", _user_id),
    ):
        value = var.get()
        if value:
            snapshot[key] = value
    return snapshot


class JsonFormatter(logging.Formatter):
    """Formats records as one JSON object per line."""

    def format(self, record: logging.LogRecord) -> str:  # noqa: A003
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(context_snapshot())
        for key, value in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class RequestContextFilter(logging.Filter):
    """Attaches request context to records for non-JSON handlers too."""

    def filter(self, record: logging.LogRecord) -> bool:
        for key, value in context_snapshot().items():
            if not hasattr(record, key):
                setattr(record, key, value)
        return True


_configured = False


def configure_logging(level: str | int | None = None, *, force: bool = False) -> None:
    """Install the JSON handler on the root logger. Idempotent."""

    global _configured
    if _configured and not force:
        return

    from app.core.config import get_settings

    settings = get_settings()
    resolved = level if level is not None else getattr(settings, "log_level", "INFO")
    if isinstance(resolved, str):
        resolved = logging.getLevelName(resolved.upper())
    if not isinstance(resolved, int):
        resolved = logging.INFO

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestContextFilter())

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(resolved)

    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers = []
        uvicorn_logger.propagate = True

    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def set_organization_id(organization_id: str | None) -> None:
    """Bind the tenant to the current request context.

    Call this once the authenticated user is known — e.g. at the end of
    ``app.api.deps.get_current_user``::

        set_organization_id(user.organization_id)
    """

    if organization_id:
        _organization_id.set(organization_id)


def set_user_id(user_id: str | None) -> None:
    if user_id:
        _user_id.set(user_id)


def set_impersonation(context: dict | None) -> None:
    """Record that this request is a platform admin acting as a tenant user."""
    _impersonation.set(context)


def get_impersonation() -> dict | None:
    """``{"admin_user_id", "admin_email", "session_id", "scopes"}`` or ``None``."""
    return _impersonation.get()


# ---------------------------------------------------------------------------
# system_logs persistence (ACT-1)
#
# ``GET /api/logs`` (tenant) and ``GET /api/saas/logs`` (platform) read the
# ``system_logs`` table; the middleware is its writer. Three rules keep it
# honest and cheap:
#
# 1. Volume: only requests that changed something (POST/PUT/PATCH/DELETE) or
#    failed (>=400) are persisted. Read traffic is already on stdout and would
#    otherwise add a write to every GET.
# 2. Secrecy: nothing but method, redacted path and status is stored. Query
#    strings, headers and bodies are never touched, so tokens, passwords and
#    MFA codes cannot reach the table. Path segments that *are* secrets (the
#    signing link, invitation and embed tokens) are redacted by prefix.
# 3. Safety: every failure is swallowed. A log row is never worth a 500.
# ---------------------------------------------------------------------------

#: Path prefixes whose next segment is a bearer secret, not an id.
_SECRET_PATH_PREFIXES = ("/api/sign/", "/api/invitations/", "/api/embed/sessions/")

#: Paths never persisted: the health probe and the log readers themselves.
_UNLOGGED_PATHS = ("/api/health", "/api/logs", "/api/saas/logs")

_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def redact_path(path: str) -> str:
    """Replace secret path segments with ``<token>``."""

    for prefix in _SECRET_PATH_PREFIXES:
        if path.startswith(prefix):
            rest = path[len(prefix):].split("/")
            rest[0] = "<token>"
            return prefix + "/".join(rest)
    return path


def log_source_for(path: str) -> str:
    """Map a path onto a ``system_logs.source`` bucket."""

    if path.startswith("/api/webhooks"):
        return "webhook"
    if path.startswith("/api/sign"):
        return "signing"
    if path.startswith("/api/auth"):
        return "auth"
    if path.startswith("/api/billing") or path.startswith("/api/invoices"):
        return "billing"
    if path.startswith("/api/saas"):
        return "admin"
    return "api"


def should_persist_request(method: str, path: str, status_code: int) -> bool:
    if any(path == unlogged or path.startswith(unlogged + "/") for unlogged in _UNLOGGED_PATHS):
        return False
    return method.upper() in _MUTATING_METHODS or status_code >= 400


#: Cache of ``user_id -> (email, organization_id)`` for request-log attribution.
#: Every persisted mutating request used to pay a ``db.get(User, ...)`` -- two
#: of them while impersonating -- on top of the insert, tripling the query cost
#: of the audit-of-record write and the connection pressure with it. Neither
#: field is volatile: ``organization_id`` never changes for a user, and an
#: email change going 30 seconds stale in a log row's attribution is harmless.
_IDENTITY_TTL_SECONDS = 30.0
_identity_cache: dict[str, tuple[float, tuple[str | None, str | None]]] = {}
_identity_lock = threading.Lock()


def _identity(db, user_id: str | None) -> tuple[str | None, str | None]:
    """``(email, organization_id)`` for a user id, memoised briefly."""
    if not user_id:
        return (None, None)
    now = time.monotonic()
    with _identity_lock:
        cached = _identity_cache.get(user_id)
        if cached is not None and cached[0] > now:
            return cached[1]

    from app.models.user import User

    user = db.get(User, user_id)
    value = (user.email, user.organization_id) if user is not None else (None, None)
    with _identity_lock:
        if len(_identity_cache) > 4096:  # unbounded growth is a leak, not a cache
            _identity_cache.clear()
        _identity_cache[user_id] = (now + _IDENTITY_TTL_SECONDS, value)
    return value


def reset_identity_cache() -> None:
    """Test hook: forget every memoised identity."""
    with _identity_lock:
        _identity_cache.clear()


def persist_request_log(
    *,
    method: str,
    path: str,
    status_code: int,
    duration_ms: float,
    request_id: str,
    client_ip: str | None,
    user_id: str | None,
    impersonating_admin_id: str | None = None,
) -> None:
    """Append one ``system_logs`` row. Never raises.

    The tenant is resolved from the bearer token's subject rather than from a
    context variable: FastAPI runs sync endpoints in a worker thread, so
    anything the dependencies bind there is invisible here. That lookup is
    memoised (see ``_identity``), leaving one INSERT on the persisted path.

    Called from a worker thread, never from the event loop -- this does
    blocking database I/O, and the ASGI middleware is async.
    """

    try:
        from app.core.database import background_session
        from app.services import platform_service

        safe_path = redact_path(path)
        level = "error" if status_code >= 500 else "warn" if status_code >= 400 else "info"
        with background_session() as db:
            actor_email, actor_org = _identity(db, user_id)
            impersonator_email, _ = _identity(db, impersonating_admin_id)
            payload = {"method": method, "path": safe_path, "duration_ms": duration_ms}
            if impersonator_email is not None:
                payload["impersonated_by"] = impersonator_email
                payload["impersonated_user"] = actor_email or user_id
            platform_service.record_system_log(
                db,
                message=f"{method} {safe_path} -> {status_code}",
                source=log_source_for(path),
                level=level,
                organization_id=actor_org,
                actor_email=impersonator_email or actor_email,
                status_code=status_code,
                latency_ms=int(duration_ms),
                request_id=request_id,
                ip_address=client_ip,
                payload=payload,
            )
            db.commit()
    except Exception:  # pragma: no cover - logging must never break a request
        logging.getLogger("signflow.request").debug("system_log.write_failed", exc_info=True)


class RequestLoggingMiddleware:
    """Pure-ASGI middleware: request id propagation + access logging.

    Implemented as raw ASGI (not ``BaseHTTPMiddleware``) so it adds no task
    group around the request and cannot interfere with streaming responses.
    """

    def __init__(self, app, *, logger_name: str = "signflow.request") -> None:
        self.app = app
        self.logger = logging.getLogger(logger_name)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        request_id = headers.get(REQUEST_ID_HEADER.lower()) or new_request_id()
        user_id, impersonating_admin_id, raw_token = _principal_from_authorization(
            headers.get("authorization")
        )

        tokens = bind_request_context(request_id=request_id, user_id=user_id)
        # Bound *here*, not in the auth dependency: FastAPI runs sync
        # dependencies and sync endpoints in separate worker threads, each with
        # its own copy of this context, so anything the dependency binds is
        # invisible to the endpoint. The claim alone is not authorization - the
        # session row is still re-checked per request in ``app.api.deps`` - it
        # is only the attribution marker. It is cleared for every other request
        # so a recycled context cannot leak one caller's marker into the next.
        impersonation_context = (
            {
                "admin_user_id": impersonating_admin_id,
                "token_hash": sha256(raw_token.encode("utf-8")).hexdigest(),
            }
            if impersonating_admin_id and raw_token
            else None
        )
        tokens.append((_impersonation, _impersonation.set(impersonation_context)))
        # Explicitly clear the tenant for this request: get_current_user sets it
        # without a token, and a recycled task context must not let one request
        # inherit the previous caller's organization.
        tokens.append((_organization_id, _organization_id.set(None)))
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                raw_headers = list(message.get("headers", []))
                raw_headers.append((REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1")))
                message = {**message, "headers": raw_headers}
            await send(message)

        async def persist(status_code: int, duration_ms: float) -> None:
            """Write the ``system_logs`` row from a worker thread.

            ``persist_request_log`` does blocking database I/O, and this is an
            async ASGI callable -- calling it inline stalled the whole event
            loop, and therefore every other in-flight request, for the duration
            of an INSERT plus COMMIT. It still runs before the request task
            completes, so ordering (and every test that reads the row back on
            the next request) is unchanged.
            """
            await anyio.to_thread.run_sync(_persist_sync, status_code, duration_ms)

        def _persist_sync(status_code: int, duration_ms: float) -> None:
            persist_request_log(
                method=(scope.get("method") or "GET"),
                path=scope.get("path") or "",
                status_code=status_code,
                duration_ms=duration_ms,
                request_id=request_id,
                client_ip=(scope.get("client") or [None])[0],
                user_id=user_id,
                impersonating_admin_id=impersonating_admin_id,
            )

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            self.logger.exception(
                "request.failed",
                extra={
                    "http_method": scope.get("method"),
                    "http_path": scope.get("path"),
                    "duration_ms": duration_ms,
                },
            )
            await persist(500, duration_ms)
            raise
        else:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            status = status_holder["status"]
            self.logger.log(
                logging.WARNING if status >= 500 else logging.INFO,
                "request.completed",
                extra={
                    "http_method": scope.get("method"),
                    "http_path": scope.get("path"),
                    "http_status": status,
                    "duration_ms": duration_ms,
                    "client_ip": (scope.get("client") or [None])[0],
                },
            )
            if should_persist_request(scope.get("method") or "GET", scope.get("path") or "", status):
                await persist(status, duration_ms)
        finally:
            reset_request_context(tokens)


def _principal_from_authorization(
    authorization: str | None,
) -> tuple[str | None, str | None, str | None]:
    """Best-effort ``(subject, impersonating_admin_id, raw_token)``; never raises.

    The second element is the ``imp`` claim of an impersonation token. Without
    it the request log records the *tenant's* user as the actor for everything
    a support engineer does while impersonating them.
    """

    if not authorization or not authorization.lower().startswith("bearer "):
        return None, None, None
    try:
        from app.core.security import decode_access_token

        raw = authorization.split(" ", 1)[1].strip()
        claims = decode_access_token(raw)
        return claims.get("sub"), claims.get("imp"), raw
    except Exception:
        return None, None, None


def _user_id_from_authorization(authorization: str | None) -> str | None:
    return _principal_from_authorization(authorization)[0]
