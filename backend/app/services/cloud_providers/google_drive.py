"""Google Drive adapter (Drive API v3).

Scope is ``drive.file``: the app can only ever see files it created itself, so
connecting SignFlow does not hand it the tenant's whole Drive. The consent
request asks for ``access_type=offline`` *and* ``prompt=consent`` because Google
issues a refresh token only on a fresh consent -- without the second parameter a
re-connect silently returns an access token alone and the integration dies an
hour later with nothing to refresh from.
"""

from __future__ import annotations

import base64
import json
import secrets
from urllib.parse import urlencode

from app.core.config import get_settings
from app.services.cloud_providers.base import (
    CloudAuthError,
    CloudProvider,
    OAuthTokens,
    expiry_from_seconds,
)

AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke"
FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files"
UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"
FOLDER_MIME = "application/vnd.google-apps.folder"
SCOPES = (
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/userinfo.email",
)


def _email_from_id_token(id_token: str | None) -> str | None:
    """Read the ``email`` claim out of Google's id_token.

    The token arrives over TLS straight from Google's token endpoint in
    response to a request carrying our client secret, so its payload is read
    without re-verifying the signature -- it is a label for the UI, never an
    authentication decision.
    """
    if not id_token or id_token.count(".") != 2:
        return None
    payload = id_token.split(".")[1]
    padding = "=" * (-len(payload) % 4)
    try:
        claims = json.loads(base64.urlsafe_b64decode(payload + padding))
    except Exception:
        return None
    email = claims.get("email")
    return email if isinstance(email, str) else None


def _escape(value: str) -> str:
    """Quote a literal for a Drive ``q`` expression."""
    return value.replace("\\", "\\\\").replace("'", "\\'")


class GoogleDriveProvider(CloudProvider):
    name = "google_drive"
    label = "Google Drive"
    detail = "Archive completed PDFs"

    def credentials(self) -> tuple[str | None, str | None]:
        settings = get_settings()
        return settings.google_drive_client_id, settings.google_drive_client_secret

    # -- OAuth ------------------------------------------------------------ #

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        client_id, _ = self.require_credentials()
        query = urlencode(
            {
                "client_id": client_id,
                "redirect_uri": redirect_uri,
                "response_type": "code",
                "scope": " ".join(SCOPES),
                "access_type": "offline",
                "prompt": "consent",
                "include_granted_scopes": "true",
                "state": state,
            }
        )
        return f"{AUTHORIZE_ENDPOINT}?{query}"

    def exchange_code(self, code: str, redirect_uri: str) -> OAuthTokens:
        client_id, client_secret = self.require_credentials()
        response = self.check(
            self.request(
                "POST",
                TOKEN_ENDPOINT,
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            ),
            "code exchange",
            auth_statuses=(400, 401, 403),
        )
        payload = response.json()
        return OAuthTokens(
            access_token=payload["access_token"],
            refresh_token=payload.get("refresh_token"),
            expires_at=expiry_from_seconds(payload.get("expires_in")),
            account_email=_email_from_id_token(payload.get("id_token")),
        )

    def refresh(self, refresh_token: str) -> OAuthTokens:
        client_id, client_secret = self.require_credentials()
        response = self.check(
            self.request(
                "POST",
                TOKEN_ENDPOINT,
                data={
                    "refresh_token": refresh_token,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "grant_type": "refresh_token",
                },
            ),
            "token refresh",
            auth_statuses=(400, 401, 403),
        )
        payload = response.json()
        access_token = payload.get("access_token")
        if not access_token:
            raise CloudAuthError("Google Drive token refresh returned no access token")
        return OAuthTokens(
            access_token=access_token,
            # A refresh response reuses the existing refresh token; the caller
            # keeps the one it already holds when this is None.
            refresh_token=payload.get("refresh_token"),
            expires_at=expiry_from_seconds(payload.get("expires_in")),
            account_email=_email_from_id_token(payload.get("id_token")),
        )

    def revoke(self, token: str) -> None:
        self.request("POST", REVOKE_ENDPOINT, data={"token": token})

    # -- storage ---------------------------------------------------------- #

    def upload(self, access_token: str, folder_path: str, filename: str, data: bytes) -> str:
        parent = self._resolve_folder(access_token, folder_path)
        boundary = f"signflow-{secrets.token_hex(16)}"
        metadata = json.dumps({"name": filename, "parents": [parent]}).encode()
        body = b"".join(
            [
                f"--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".encode(),
                metadata,
                f"\r\n--{boundary}\r\nContent-Type: application/pdf\r\n\r\n".encode(),
                data,
                f"\r\n--{boundary}--\r\n".encode(),
            ]
        )
        response = self.check(
            self.request(
                "POST",
                UPLOAD_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": f"multipart/related; boundary={boundary}",
                },
                content=body,
            ),
            "upload",
        )
        return str(response.json().get("id") or "")

    def _resolve_folder(self, access_token: str, folder_path: str) -> str:
        """Walk ``folder_path`` from My Drive, creating each missing segment."""
        parent = "root"
        for segment in [part for part in (folder_path or "").split("/") if part.strip()]:
            parent = self._find_or_create_folder(access_token, parent, segment.strip())
        return parent

    def _find_or_create_folder(self, access_token: str, parent: str, name: str) -> str:
        headers = {"Authorization": f"Bearer {access_token}"}
        query = urlencode(
            {
                "q": (
                    f"name = '{_escape(name)}' and mimeType = '{FOLDER_MIME}' "
                    f"and '{_escape(parent)}' in parents and trashed = false"
                ),
                "fields": "files(id,name)",
                "pageSize": "1",
                # ``drive.file`` only ever sees our own files, but a tenant may
                # still have put the destination folder on a shared drive.
                "supportsAllDrives": "true",
                "includeItemsFromAllDrives": "true",
            }
        )
        found = self.check(
            self.request("GET", f"{FILES_ENDPOINT}?{query}", headers=headers),
            "folder lookup",
        ).json()
        files = found.get("files") or []
        if files:
            return str(files[0]["id"])

        created = self.check(
            self.request(
                "POST",
                f"{FILES_ENDPOINT}?supportsAllDrives=true",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps(
                    {"name": name, "mimeType": FOLDER_MIME, "parents": [parent]}
                ).encode(),
            ),
            "folder creation",
        ).json()
        return str(created["id"])


google_drive_provider = GoogleDriveProvider()
