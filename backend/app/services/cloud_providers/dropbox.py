"""Dropbox adapter (API v2).

``token_access_type=offline`` is what makes Dropbox issue a refresh token at
all: without it the grant is a four-hour access token and nothing to renew it
with. Uploads use ``mode=add`` with ``autorename=true`` so re-exporting a
document can never overwrite a file a human put there, and Dropbox creates
missing parent folders itself -- there is no folder-resolution dance.
"""

from __future__ import annotations

import base64
import json
from urllib.parse import urlencode

from app.core.config import get_settings
from app.services.cloud_providers.base import (
    CloudAuthError,
    CloudProvider,
    OAuthTokens,
    expiry_from_seconds,
)

AUTHORIZE_ENDPOINT = "https://www.dropbox.com/oauth2/authorize"
TOKEN_ENDPOINT = "https://api.dropboxapi.com/oauth2/token"
REVOKE_ENDPOINT = "https://api.dropboxapi.com/2/auth/token/revoke"
ACCOUNT_ENDPOINT = "https://api.dropboxapi.com/2/users/get_current_account"
UPLOAD_ENDPOINT = "https://content.dropboxapi.com/2/files/upload"


def _normalize_path(folder_path: str, filename: str) -> str:
    """Dropbox paths are absolute, use ``/`` and never end in one."""
    folder = "/".join(part.strip() for part in (folder_path or "").split("/") if part.strip())
    return f"/{folder}/{filename}" if folder else f"/{filename}"


class DropboxProvider(CloudProvider):
    name = "dropbox"
    label = "Dropbox"
    detail = "Archive completed PDFs"

    def credentials(self) -> tuple[str | None, str | None]:
        settings = get_settings()
        return settings.dropbox_app_key, settings.dropbox_app_secret

    # -- OAuth ------------------------------------------------------------ #

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        client_id, _ = self.require_credentials()
        query = urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "token_access_type": "offline",
                "state": state,
            }
        )
        return f"{AUTHORIZE_ENDPOINT}?{query}"

    def exchange_code(self, code: str, redirect_uri: str) -> OAuthTokens:
        payload = self._token_grant(
            {"code": code, "grant_type": "authorization_code", "redirect_uri": redirect_uri},
            "code exchange",
        )
        access_token = payload["access_token"]
        return OAuthTokens(
            access_token=access_token,
            refresh_token=payload.get("refresh_token"),
            expires_at=expiry_from_seconds(payload.get("expires_in")),
            account_email=self._account_email(access_token),
        )

    def refresh(self, refresh_token: str) -> OAuthTokens:
        payload = self._token_grant(
            {"refresh_token": refresh_token, "grant_type": "refresh_token"}, "token refresh"
        )
        access_token = payload.get("access_token")
        if not access_token:
            raise CloudAuthError("Dropbox token refresh returned no access token")
        return OAuthTokens(
            access_token=access_token,
            refresh_token=payload.get("refresh_token"),
            expires_at=expiry_from_seconds(payload.get("expires_in")),
        )

    def revoke(self, token: str) -> None:
        self.request("POST", REVOKE_ENDPOINT, headers={"Authorization": f"Bearer {token}"})

    def _token_grant(self, form: dict[str, str], action: str) -> dict:
        client_id, client_secret = self.require_credentials()
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        response = self.check(
            self.request(
                "POST",
                TOKEN_ENDPOINT,
                headers={"Authorization": f"Basic {basic}"},
                data=form,
            ),
            action,
            auth_statuses=(400, 401, 403),
        )
        return response.json()

    def _account_email(self, access_token: str) -> str | None:
        """Best effort: a missing label must not fail a working connection."""
        try:
            response = self.request(
                "POST", ACCOUNT_ENDPOINT, headers={"Authorization": f"Bearer {access_token}"}
            )
            if response.ok:
                email = response.json().get("email")
                return email if isinstance(email, str) else None
        except Exception:
            pass
        return None

    # -- storage ---------------------------------------------------------- #

    def upload(self, access_token: str, folder_path: str, filename: str, data: bytes) -> str:
        arg = {
            "path": _normalize_path(folder_path, filename),
            "mode": "add",
            "autorename": True,
            "mute": True,
            "strict_conflict": False,
        }
        response = self.check(
            self.request(
                "POST",
                UPLOAD_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/octet-stream",
                    # Must be ASCII: Dropbox reads the argument out of a header.
                    "Dropbox-API-Arg": json.dumps(arg, ensure_ascii=True),
                },
                content=data,
            ),
            "upload",
        )
        return str(response.json().get("id") or "")


dropbox_provider = DropboxProvider()
