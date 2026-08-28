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

import json
import logging
import sys
import uuid
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Iterator

REQUEST_ID_HEADER = "X-Request-ID"

_request_id: ContextVar[str | None] = ContextVar("signflow_request_id", default=None)
_organization_id: ContextVar[str | None] = ContextVar("signflow_organization_id", default=None)
_user_id: ContextVar[str | None] = ContextVar("signflow_user_id", default=None)

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

        import time

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        request_id = headers.get(REQUEST_ID_HEADER.lower()) or new_request_id()
        user_id = _user_id_from_authorization(headers.get("authorization"))

        tokens = bind_request_context(request_id=request_id, user_id=user_id)
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                raw_headers = list(message.get("headers", []))
                raw_headers.append((REQUEST_ID_HEADER.encode("latin-1"), request_id.encode("latin-1")))
                message = {**message, "headers": raw_headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            self.logger.exception(
                "request.failed",
                extra={
                    "http_method": scope.get("method"),
                    "http_path": scope.get("path"),
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
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
        finally:
            reset_request_context(tokens)


def _user_id_from_authorization(authorization: str | None) -> str | None:
    """Best-effort user id from a bearer token; never raises."""

    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        from app.core.security import decode_access_token

        return decode_access_token(authorization.split(" ", 1)[1].strip()).get("sub")
    except Exception:
        return None
