"""Cloud-storage provider registry.

The registry is also the integration catalogue: a provider appears in
``GET /api/integrations`` because it has an adapter here, not because a tuple
somewhere lists its name.
"""

from __future__ import annotations

from app.services.cloud_providers.base import (
    CloudAuthError,
    CloudProvider,
    CloudProviderError,
    CloudProviderNotConfigured,
    HttpResponse,
    OAuthTokens,
)
from app.services.cloud_providers.dropbox import DropboxProvider, dropbox_provider
from app.services.cloud_providers.google_drive import GoogleDriveProvider, google_drive_provider

PROVIDERS: dict[str, CloudProvider] = {
    google_drive_provider.name: google_drive_provider,
    dropbox_provider.name: dropbox_provider,
}

PROVIDER_NAMES: tuple[str, ...] = tuple(PROVIDERS)


def get_provider(name: str) -> CloudProvider | None:
    return PROVIDERS.get(name)


__all__ = [
    "CloudAuthError",
    "CloudProvider",
    "CloudProviderError",
    "CloudProviderNotConfigured",
    "DropboxProvider",
    "GoogleDriveProvider",
    "HttpResponse",
    "OAuthTokens",
    "PROVIDERS",
    "PROVIDER_NAMES",
    "dropbox_provider",
    "get_provider",
    "google_drive_provider",
]
