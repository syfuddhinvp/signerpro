"""Shared shape of a cloud-storage provider adapter.

Every provider speaks the same five verbs -- ``authorize_url``,
``exchange_code``, ``refresh``, ``revoke``, ``upload`` -- so the services above
never learn what a Dropbox path or a Drive folder id is.

All outbound HTTP goes through one seam, ``CloudProvider.transport``, exactly
as ``webhook_service`` does: tests swap it for a scripted fake and the suite
never touches the network.

Failure vocabulary
------------------
``CloudAuthError`` means *the grant is gone* -- the tenant revoked access, the
refresh token expired, the app was uninstalled. It is permanent, so callers
flag the integration ``needs_reauth`` and stop retrying. Everything else
(``CloudProviderError``: timeouts, 5xx, rate limits) is transient and earns a
backoff.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx

REQUEST_TIMEOUT_SECONDS = 30.0


class CloudProviderError(RuntimeError):
    """A transient provider failure: worth retrying."""


class CloudAuthError(CloudProviderError):
    """The grant no longer exists. Retrying cannot help; re-consent is needed."""


class CloudProviderNotConfigured(CloudProviderError):
    """The deployment has no client id/secret for this provider."""


@dataclass(frozen=True)
class HttpResponse:
    status_code: int
    body: bytes
    headers: dict[str, str]

    @property
    def text(self) -> str:
        return self.body.decode("utf-8", "replace")

    def json(self) -> Any:
        try:
            return json.loads(self.body or b"{}")
        except ValueError as exc:  # pragma: no cover - defensive
            raise CloudProviderError(f"Provider returned non-JSON: {self.text[:200]}") from exc

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300


@dataclass
class OAuthTokens:
    """What a provider hands back from an authorization-code or refresh grant."""

    access_token: str
    refresh_token: str | None = None
    expires_at: datetime | None = None
    account_email: str | None = None


#: ``(method, url, headers, data, content) -> HttpResponse``. ``data`` is a
#: form body when given; ``content`` is raw bytes.
Transport = Callable[..., HttpResponse]


def _http_transport(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    data: dict[str, str] | None = None,
    content: bytes | None = None,
) -> HttpResponse:
    with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS, follow_redirects=False) as client:
        response = client.request(method, url, headers=headers, data=data, content=content)
    return HttpResponse(
        status_code=response.status_code,
        body=response.content or b"",
        headers={key.lower(): value for key, value in response.headers.items()},
    )


def expiry_from_seconds(expires_in: Any) -> datetime | None:
    try:
        seconds = int(expires_in)
    except (TypeError, ValueError):
        return None
    # A minute of slack: a token that expires while the upload is in flight is
    # indistinguishable from one that was already dead.
    return datetime.now(timezone.utc) + timedelta(seconds=max(seconds - 60, 0))


class CloudProvider:
    """Base adapter. Subclasses fill in the provider-specific HTTP."""

    #: Stable identifier used in URLs, rows and the integration catalogue.
    name: str = ""
    label: str = ""
    detail: str = ""

    #: Overridable seam. Tests replace this; production uses httpx.
    transport: Transport = staticmethod(_http_transport)

    # -- configuration ---------------------------------------------------- #

    def credentials(self) -> tuple[str | None, str | None]:
        raise NotImplementedError

    def configured(self) -> bool:
        client_id, client_secret = self.credentials()
        return bool(client_id and client_secret)

    def require_credentials(self) -> tuple[str, str]:
        client_id, client_secret = self.credentials()
        if not client_id or not client_secret:
            raise CloudProviderNotConfigured(f"{self.label} is not configured on this deployment")
        return client_id, client_secret

    # -- OAuth ------------------------------------------------------------ #

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        raise NotImplementedError

    def exchange_code(self, code: str, redirect_uri: str) -> OAuthTokens:
        raise NotImplementedError

    def refresh(self, refresh_token: str) -> OAuthTokens:
        raise NotImplementedError

    def revoke(self, token: str) -> None:
        raise NotImplementedError

    # -- storage ---------------------------------------------------------- #

    def upload(self, access_token: str, folder_path: str, filename: str, data: bytes) -> str:
        """Store ``data`` under ``folder_path`` and return the remote file id."""
        raise NotImplementedError

    # -- helpers ---------------------------------------------------------- #

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str] | None = None,
        data: dict[str, str] | None = None,
        content: bytes | None = None,
    ) -> HttpResponse:
        """One HTTP round trip, with network errors mapped to transient failures."""
        try:
            return type(self).transport(method, url, headers=headers, data=data, content=content)
        except CloudProviderError:
            raise
        except Exception as exc:  # timeout, DNS, TLS, ...
            raise CloudProviderError(f"{type(exc).__name__}: {exc}") from exc

    def check(
        self,
        response: HttpResponse,
        action: str,
        *,
        auth_statuses: tuple[int, ...] = (401,),
    ) -> HttpResponse:
        """Raise the right flavour of error for a non-2xx response.

        ``auth_statuses`` is widened to include 400 on the token endpoints,
        where every provider here reports a dead refresh token as a 400
        ``invalid_grant`` rather than a 401. It stays narrow on upload calls,
        where a 400 usually means a bad path -- a tenant misconfiguration that
        must not be mistaken for a revoked grant.
        """
        if response.ok:
            return response
        message = f"{self.label} {action} failed (HTTP {response.status_code}): {response.text[:300]}"
        if response.status_code in auth_statuses:
            raise CloudAuthError(message)
        raise CloudProviderError(message)
