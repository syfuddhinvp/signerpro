"""Outbound webhook delivery.

Replaces the old simulated CRM integration. The platform emits *neutral* domain
events (``document.completed``, ``recipient.signed``, ...) and each customer
integration maps them onto its own vocabulary. Nothing CRM-shaped leaks into the
signing engine.

Delivery guarantees
-------------------
At-least-once. Every (event, endpoint) pair becomes a ``WebhookDelivery`` row in
the same transaction as the business change, so the retry state lives in the
database and survives a restart. Attempts are made *after* commit, off the
request path; anything that fails is retried with exponential backoff by
``process_due_retries()``, which a cron/scheduler (or a real job queue, later)
calls. Delivery never participates in the signing transaction, so a broken
customer endpoint can never prevent a document from completing.

Signature verification recipe (for customers)
---------------------------------------------
Each request carries::

    X-SignFlow-Timestamp: 1717171717            # unix seconds
    X-SignFlow-Signature: sha256=<hex digest>
    X-SignFlow-Event: document.completed
    X-SignFlow-Delivery: <delivery id>

Verify with the endpoint secret shown once at creation time::

    signed_payload = f"{timestamp}.{raw_body}"     # raw bytes, not re-serialised JSON
    expected = hmac.new(secret.encode(), signed_payload.encode(), hashlib.sha256).hexdigest()
    hmac.compare_digest(expected, received_signature.split("=", 1)[1])

Reject the request if ``abs(now - timestamp) > 300`` seconds (replay guard), and
always compare digests in constant time. Retries reuse the same
``X-SignFlow-Delivery`` id, so use it to deduplicate.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import secrets
import socket
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.parse import urlparse, urlunparse

import httpx
from sqlalchemy import event as sa_event, select
from sqlalchemy.orm import Session

from app.core.config import get_settings, is_production
from app.models.mixins import uuid_str
from app.models.webhook import WebhookDelivery, WebhookEndpoint
from app.services.audit_service import audit_service


# --------------------------------------------------------------------------- #
# Event catalogue
# --------------------------------------------------------------------------- #

EVENT_CATALOGUE: dict[str, str] = {
    # The lifecycle starts when the envelope exists, not when it goes out: an
    # integration that only hears about a document at `document.sent` cannot
    # mirror drafts, attach metadata while one is being prepared, or notice a
    # draft that was never sent.
    "document.created": "A document was created (still a draft, not yet sent).",
    "document.sent": "A document was sent out for signature.",
    "document.viewed": "A recipient opened the document for the first time.",
    "document.completed": "Every recipient has signed and the final PDF is sealed.",
    "document.declined": "A recipient declined to sign; the document is terminated.",
    "document.voided": "The sender voided the document.",
    "document.expired": "The document passed its expiry date without completing.",
    "recipient.signed": "An individual recipient finished signing their fields.",
    "recipient.declined": "An individual recipient declined to sign.",
    "recipient.reminded": "A reminder was sent to a pending recipient.",
    "webhook.test": "A synthetic event produced by the endpoint test button.",
}

EVENT_TYPES: list[str] = sorted(EVENT_CATALOGUE)

MAX_ATTEMPTS = 6
REQUEST_TIMEOUT_SECONDS = 10.0
BACKOFF_BASE_SECONDS = 30
BACKOFF_CAP_SECONDS = 6 * 60 * 60
SIGNATURE_HEADER = "X-SignFlow-Signature"
TIMESTAMP_HEADER = "X-SignFlow-Timestamp"

STATUS_PENDING = "pending"
STATUS_SUCCEEDED = "succeeded"
STATUS_FAILED = "failed"
STATUS_EXHAUSTED = "exhausted"


class WebhookUrlError(ValueError):
    """Raised when a customer-supplied endpoint URL is unsafe or malformed."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


# --------------------------------------------------------------------------- #
# Outbound safety (SSRF)
# --------------------------------------------------------------------------- #

def _is_blocked_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def validate_endpoint_url(url: str, *, allow_insecure: bool | None = None) -> str:
    """Validate a customer-supplied webhook URL.

    HTTPS-only outside development/test, and private / loopback / link-local /
    reserved destinations are refused so a customer cannot point the platform at
    internal infrastructure (SSRF).
    """
    settings = get_settings()
    if allow_insecure is None:
        # ``is_production`` fails *closed*: anything that is not explicitly a
        # development/test environment is production, so a misconfigured
        # ENVIRONMENT string cannot re-enable the bypass.
        allow_insecure = not is_production(settings.environment)

    parsed = urlparse(url.strip())
    if parsed.scheme not in {"http", "https"}:
        raise WebhookUrlError("Webhook URL must use http or https")
    if parsed.scheme == "http" and not allow_insecure:
        raise WebhookUrlError("Webhook URL must use https")
    if not parsed.hostname:
        raise WebhookUrlError("Webhook URL must include a host")

    host = parsed.hostname
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if _is_blocked_ip(literal) and not allow_insecure:
            raise WebhookUrlError("Webhook URL resolves to a blocked address range")
        return url.strip()

    if host.lower() in {"localhost"} or host.lower().endswith(".localhost") or host.lower().endswith(".internal"):
        if not allow_insecure:
            raise WebhookUrlError("Webhook URL resolves to a blocked address range")
        return url.strip()

    if not allow_insecure:
        try:
            infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
        except socket.gaierror as exc:
            raise WebhookUrlError("Webhook URL host could not be resolved") from exc
        for info in infos:
            try:
                resolved = ipaddress.ip_address(info[4][0])
            except ValueError:
                continue
            if _is_blocked_ip(resolved):
                raise WebhookUrlError("Webhook URL resolves to a blocked address range")
    return url.strip()


def generate_secret() -> str:
    return "whsec_" + secrets.token_urlsafe(32)


# --------------------------------------------------------------------------- #
# Signing
# --------------------------------------------------------------------------- #

def sign_payload(secret: str, timestamp: int, body: bytes) -> str:
    signed = f"{timestamp}.".encode() + body
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def serialize(payload: dict[str, Any]) -> bytes:
    """Canonical body bytes. The signature covers exactly these bytes."""
    return json.dumps(payload, separators=(",", ":"), sort_keys=True, default=str).encode()


# --------------------------------------------------------------------------- #
# Transport (overridable in tests)
# --------------------------------------------------------------------------- #

Transport = Callable[[str, bytes, dict[str, str]], tuple[int, str]]


def resolve_and_pin(url: str) -> tuple[str, dict[str, str]]:
    """Re-validate ``url`` *at delivery time* and pin it to a checked address.

    Validation at endpoint-creation time is TOCTOU-vulnerable: a host that
    resolves to a public address when the endpoint is registered can resolve to
    ``169.254.169.254`` when the delivery (or any of its retries) actually
    fires. Re-resolving here closes the window, and connecting to the literal
    address we just checked closes the second one — otherwise the socket layer
    would resolve the name a *third* time and could get a different answer.

    Returns ``(url_to_request, extra_headers)``. The Host header and the TLS
    SNI name keep the original hostname, so virtual hosting and certificate
    validation still work.
    """
    parsed = urlparse(url)
    host = parsed.hostname or ""
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        # An IP literal cannot be rebound; validate it and use it as-is.
        if _is_blocked_ip(ipaddress.ip_address(host)):
            raise WebhookUrlError("Webhook URL resolves to a blocked address range")
        return url, {}

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise WebhookUrlError("Webhook URL host could not be resolved") from exc

    chosen: str | None = None
    for info in infos:
        address = info[4][0]
        try:
            candidate = ipaddress.ip_address(address)
        except ValueError:
            continue
        if _is_blocked_ip(candidate):
            # One blocked answer condemns the name: a rebinding attacker only
            # needs the *pinned* address to be internal, so refusing outright
            # is the only safe reading of a mixed answer.
            raise WebhookUrlError("Webhook URL resolves to a blocked address range")
        if chosen is None:
            chosen = address

    if chosen is None:
        raise WebhookUrlError("Webhook URL host could not be resolved")

    literal = f"[{chosen}]" if ":" in chosen else chosen
    netloc = f"{literal}:{parsed.port}" if parsed.port else literal
    pinned = urlunparse(parsed._replace(netloc=netloc))
    return pinned, {"Host": parsed.netloc}


def _http_transport(url: str, body: bytes, headers: dict[str, str]) -> tuple[int, str]:
    request_url, extra_headers = url, {}
    sni: str | None = None
    if is_production(get_settings().environment):
        parsed = urlparse(url)
        sni = parsed.hostname
        request_url, extra_headers = resolve_and_pin(url)
    response = httpx.post(
        request_url,
        content=body,
        headers={**headers, **extra_headers},
        timeout=REQUEST_TIMEOUT_SECONDS,
        follow_redirects=False,
        extensions={"sni_hostname": sni} if extra_headers and sni else {},
    )
    return response.status_code, (response.text or "")[:500]


class WebhookService:
    #: Overridable seam. Tests replace this; production uses httpx.
    transport: Transport = staticmethod(_http_transport)
    #: When True, deliveries run inline after commit instead of in a thread.
    synchronous: bool = False

    # ------------------------------------------------------------------ #
    # Emission
    # ------------------------------------------------------------------ #
    def emit(
        self,
        db: Session,
        *,
        organization_id: str,
        event_type: str,
        data: dict[str, Any],
        document_id: str | None = None,
        dispatch: bool = True,
        only_endpoint_id: str | None = None,
    ) -> list[WebhookDelivery]:
        """Queue an event for every subscribed active endpoint of an org.

        Rows are written into the caller's session (same transaction as the
        business change). Actual HTTP happens after that transaction commits.
        Never raises: a webhook problem must not break the signing flow.
        """
        try:
            endpoints = list(
                db.execute(
                    select(WebhookEndpoint).where(
                        WebhookEndpoint.organization_id == organization_id,
                        WebhookEndpoint.is_active.is_(True),
                    )
                ).scalars()
            )
        except Exception:  # pragma: no cover - defensive
            return []

        event_id = uuid_str()
        created_at = _now()
        deliveries: list[WebhookDelivery] = []
        for endpoint in endpoints:
            if only_endpoint_id and endpoint.id != only_endpoint_id:
                continue
            if not endpoint.subscribes_to(event_type):
                continue
            payload = {
                "id": event_id,
                "type": event_type,
                "created_at": created_at.isoformat(),
                "organization_id": organization_id,
                "data": data,
            }
            delivery = WebhookDelivery(
                id=uuid_str(),
                endpoint_id=endpoint.id,
                event_id=event_id,
                event_type=event_type,
                document_id=document_id,
                payload=payload,
                attempt=0,
                status=STATUS_PENDING,
                next_retry_at=created_at,
            )
            db.add(delivery)
            deliveries.append(delivery)

        if deliveries and dispatch:
            self._dispatch_after_commit(db, [d for d in deliveries])
        return deliveries

    # ------------------------------------------------------------------ #
    # Dispatch scheduling
    # ------------------------------------------------------------------ #
    def _dispatch_after_commit(self, db: Session, deliveries: list[WebhookDelivery]) -> None:
        """Queue delivery ids to be attempted once the caller's transaction commits."""
        pending: list[str] = db.info.setdefault("_webhook_pending", [])
        pending.extend(d.id for d in deliveries)

        if db.info.get("_webhook_listener"):
            return
        db.info["_webhook_listener"] = True
        bind = db.get_bind()

        def _after_commit(session: Session) -> None:
            ids = list(session.info.get("_webhook_pending") or [])
            session.info["_webhook_pending"] = []
            if not ids:
                return
            if self.synchronous:
                self.deliver_ids(bind, ids)
            else:
                threading.Thread(target=self.deliver_ids, args=(bind, ids), daemon=True).start()

        def _after_rollback(session: Session) -> None:
            session.info["_webhook_pending"] = []

        sa_event.listen(db, "after_commit", _after_commit)
        sa_event.listen(db, "after_rollback", _after_rollback)

    def deliver_ids(self, bind: Any, delivery_ids: list[str]) -> None:
        """Open an independent session and attempt the given deliveries."""
        try:
            with Session(bind=bind, expire_on_commit=False) as session:
                for delivery_id in delivery_ids:
                    delivery = session.get(WebhookDelivery, delivery_id)
                    if delivery is None:
                        continue
                    self.attempt_delivery(session, delivery)
                    session.commit()
        except Exception:  # pragma: no cover - never propagate into the caller
            pass

    # ------------------------------------------------------------------ #
    # A single attempt
    # ------------------------------------------------------------------ #
    def attempt_delivery(self, db: Session, delivery: WebhookDelivery) -> WebhookDelivery:
        endpoint = delivery.endpoint or db.get(WebhookEndpoint, delivery.endpoint_id)
        if endpoint is None:
            delivery.status = STATUS_EXHAUSTED
            delivery.error = "Endpoint no longer exists"
            return delivery

        body = serialize(delivery.payload or {})
        timestamp = int(_now().timestamp())
        headers = {
            "Content-Type": "application/json",
            "User-Agent": "SignFlow-Webhooks/1.0",
            TIMESTAMP_HEADER: str(timestamp),
            SIGNATURE_HEADER: sign_payload(endpoint.secret, timestamp, body),
            "X-SignFlow-Event": delivery.event_type,
            "X-SignFlow-Delivery": delivery.id,
            "X-SignFlow-Attempt": str(delivery.attempt + 1),
        }

        delivery.attempt += 1
        delivery.next_retry_at = None
        try:
            status_code, text = self.transport(endpoint.url, body, headers)
            delivery.status_code = status_code
            if 200 <= status_code < 300:
                delivery.status = STATUS_SUCCEEDED
                delivery.error = None
                delivery.delivered_at = _now()
                self._audit(db, delivery, "webhook_delivery_succeeded", f"Webhook {delivery.event_type} delivered to {endpoint.url}.")
                return delivery
            delivery.error = f"HTTP {status_code}: {text}"
        except Exception as exc:  # network error, timeout, DNS, ...
            delivery.status_code = None
            delivery.error = f"{type(exc).__name__}: {exc}"[:1000]

        if delivery.attempt >= MAX_ATTEMPTS:
            delivery.status = STATUS_EXHAUSTED
            self._audit(db, delivery, "webhook_delivery_exhausted", f"Webhook {delivery.event_type} to {endpoint.url} gave up after {delivery.attempt} attempts: {delivery.error}")
        else:
            delivery.status = STATUS_FAILED
            delivery.next_retry_at = _now() + timedelta(seconds=self.backoff_seconds(delivery.attempt))
            self._audit(db, delivery, "webhook_delivery_failed", f"Webhook {delivery.event_type} to {endpoint.url} failed (attempt {delivery.attempt}): {delivery.error}")
        return delivery

    def backoff_seconds(self, attempt: int) -> int:
        return min(BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)), BACKOFF_CAP_SECONDS)

    def _audit(self, db: Session, delivery: WebhookDelivery, event_type: str, message: str) -> None:
        """Real audit trail for real webhook activity (document-scoped only)."""
        if not delivery.document_id:
            return
        try:
            audit_service.log(
                db,
                document_id=delivery.document_id,
                event_type=event_type,
                event_message=message,
                metadata={
                    "delivery_id": delivery.id,
                    "endpoint_id": delivery.endpoint_id,
                    "event": delivery.event_type,
                    "attempt": delivery.attempt,
                    "status_code": delivery.status_code,
                },
            )
        except Exception:  # pragma: no cover
            pass

    # ------------------------------------------------------------------ #
    # Retry driver (cron / scheduler entrypoint)
    # ------------------------------------------------------------------ #
    def process_due_retries(self, db: Session, *, limit: int = 100, now: datetime | None = None) -> int:
        """Attempt every delivery whose backoff window has elapsed.

        Safe to call from a cron job, a scheduler, or later a real job queue —
        all the state it needs is in ``webhook_deliveries``.
        """
        moment = now or _now()
        candidates = list(
            db.execute(
                select(WebhookDelivery)
                .where(WebhookDelivery.status.in_([STATUS_PENDING, STATUS_FAILED]))
                .order_by(WebhookDelivery.created_at)
                .limit(limit)
            ).scalars()
        )
        processed = 0
        for delivery in candidates:
            due = _aware(delivery.next_retry_at)
            if due is not None and due > moment:
                continue
            self.attempt_delivery(db, delivery)
            processed += 1
        if processed:
            db.commit()
        return processed

    def replay(self, db: Session, delivery: WebhookDelivery) -> WebhookDelivery:
        """Manual replay: reset the attempt counter and try again immediately."""
        delivery.attempt = 0
        delivery.status = STATUS_PENDING
        delivery.error = None
        delivery.status_code = None
        delivery.delivered_at = None
        delivery.next_retry_at = None
        self.attempt_delivery(db, delivery)
        db.commit()
        return delivery


webhook_service = WebhookService()
