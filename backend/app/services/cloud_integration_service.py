"""OAuth grants for the cloud-storage connectors.

Three jobs, and nothing else:

*Consent.* ``begin_authorization`` mints a signed, ten-minute ``state`` and
hands back the provider's consent URL. The state is a scoped JWT -- the same
``create_scoped_token`` the MFA challenge uses -- carrying the organization,
the user and the provider. There is no state table: the token *is* the state,
it cannot be forged without ``JWT_SECRET``, and it expires on its own.

*Callback.* ``complete_authorization`` verifies the state, refuses it when it
was minted for another organization or another provider (cross-org replay: a
state handed to an attacker is useless in anyone else's session), exchanges the
code and stores the grant encrypted.

*Token lifecycle.* ``access_token_for`` refreshes transparently when the stored
access token is at or past its expiry. A refresh that fails with
``CloudAuthError`` means the grant is gone for good, so the integration is
latched ``needs_reauth`` with a ``last_error`` instead of being retried
forever.

Tokens never leave this module: ``IntegrationResponse`` carries the remote
account's email and nothing else.
"""

from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import urlencode, urlparse

import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_scoped_token, decode_token
from app.models.integration import Integration
from app.models.user import User
from app.schemas.account import AuthorizeResponse, IntegrationResponse, OAuthCallbackRequest
from app.services.cloud_providers import PROVIDERS, CloudProvider, get_provider
from app.services.cloud_providers.base import (
    CloudAuthError,
    CloudProviderError,
    CloudProviderNotConfigured,
    OAuthTokens,
)

#: ``purpose`` claim pinned on the OAuth state token, so an access token (or an
#: MFA challenge) can never be presented as one.
STATE_PURPOSE = "cloud_oauth_state"
STATE_TTL_SECONDS = 600


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


class CloudIntegrationService:
    # ------------------------------------------------------------------ #
    # Lookup helpers
    # ------------------------------------------------------------------ #
    def require_provider(self, provider: str) -> CloudProvider:
        adapter = get_provider(provider)
        if adapter is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Unknown integration provider"
            )
        return adapter

    def get_row(self, db: Session, *, organization_id: str, provider: str) -> Integration | None:
        return db.scalar(
            select(Integration).where(
                Integration.organization_id == organization_id,
                Integration.provider == provider,
            )
        )

    def serialize(self, provider: CloudProvider, row: Integration | None) -> IntegrationResponse:
        """The public shape. Deliberately token-free."""
        return IntegrationResponse(
            provider=provider.name,
            label=(row.label if row and row.label else provider.label),
            detail=(row.detail if row and row.detail else provider.detail),
            connected=bool(row and row.connected),
            connected_at=row.connected_at if row else None,
            configured=provider.configured(),
            account_email=row.account_email if row else None,
            needs_reauth=bool(row and row.needs_reauth),
            last_error=row.last_error if row else None,
        )

    def list_integrations(self, db: Session, *, user: User) -> list[IntegrationResponse]:
        rows = {
            row.provider: row
            for row in db.scalars(
                select(Integration).where(Integration.organization_id == user.organization_id)
            ).all()
        }
        # Providers outside the registry (retired connectors still sitting in
        # an older organization's rows) are not offered and not reported.
        return [
            self.serialize(provider, rows.get(name)) for name, provider in PROVIDERS.items()
        ]

    def is_connected(self, db: Session, *, organization_id: str, provider: str) -> bool:
        row = self.get_row(db, organization_id=organization_id, provider=provider)
        return bool(row and row.connected and not row.needs_reauth)

    # ------------------------------------------------------------------ #
    # Consent
    # ------------------------------------------------------------------ #
    def begin_authorization(self, db: Session, *, user: User, provider: str) -> AuthorizeResponse:
        adapter = self.require_provider(provider)
        if not adapter.configured():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{adapter.label} is not configured on this deployment",
            )
        state = create_scoped_token(
            user.id,
            purpose=STATE_PURPOSE,
            expires_in_seconds=STATE_TTL_SECONDS,
            org=user.organization_id,
            provider=adapter.name,
        )
        return AuthorizeResponse(
            authorization_url=adapter.authorize_url(state, self.redirect_uri(adapter.name)),
            state=state,
        )

    def redirect_uri(self, provider: str) -> str:
        """The callback URL, carrying the provider as a query parameter.

        The callback endpoint is per-provider but the redirect URL is fixed, so
        without this the page that receives the grant would have to remember
        which provider it started -- which breaks when the user finishes
        consent in another tab or has storage blocked. Providers allow extra
        query parameters as long as the *registered* URI matches, and the exact
        same string must be sent on both the authorize and the token-exchange
        call or the exchange is rejected -- hence one function for both.

        It is a convenience for the client and nothing more: the provider that
        is actually trusted is the one inside the signed state, checked against
        the ``{provider}`` in the callback path.
        """
        base = get_settings().cloud_oauth_redirect_url
        separator = "&" if urlparse(base).query else "?"
        return f"{base}{separator}{urlencode({'provider': provider})}"

    def _verify_state(self, state: str, *, user: User, provider: str) -> None:
        try:
            claims = decode_token(state, expected_purpose=STATE_PURPOSE)
        except jwt.PyJWTError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Authorization state is invalid or has expired",
            ) from exc
        # Bind the state to the session presenting it. Without all three checks
        # a state leaked out of one tenant's browser could attach that tenant's
        # Drive to another organization's integration row.
        if (
            claims.get("org") != user.organization_id
            or claims.get("sub") != user.id
            or claims.get("provider") != provider
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Authorization state does not match this session",
            )

    def complete_authorization(
        self, db: Session, *, user: User, provider: str, payload: OAuthCallbackRequest
    ) -> IntegrationResponse:
        adapter = self.require_provider(provider)
        self._verify_state(payload.state, user=user, provider=provider)
        try:
            # Byte-identical to the URI the consent request carried.
            tokens = adapter.exchange_code(payload.code, self.redirect_uri(adapter.name))
        except CloudProviderNotConfigured as exc:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
        except CloudProviderError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not complete the connection with the provider",
            ) from exc

        row = self.get_row(db, organization_id=user.organization_id, provider=provider)
        if row is None:
            row = Integration(
                organization_id=user.organization_id,
                provider=adapter.name,
                label=adapter.label,
                detail=adapter.detail,
            )
            db.add(row)
        self._store_tokens(row, tokens)
        row.connected = True
        row.connected_at = _now()
        row.needs_reauth = False
        row.last_error = None
        db.commit()
        db.refresh(row)
        return self.serialize(adapter, row)

    def _store_tokens(self, row: Integration, tokens: OAuthTokens) -> None:
        row.access_token = tokens.access_token
        # A refresh grant reuses the refresh token it was given, so a response
        # without one must not wipe the only credential that can renew.
        if tokens.refresh_token:
            row.refresh_token = tokens.refresh_token
        row.token_expires_at = tokens.expires_at
        if tokens.account_email:
            row.account_email = tokens.account_email

    # ------------------------------------------------------------------ #
    # Disconnect
    # ------------------------------------------------------------------ #
    def disconnect(self, db: Session, *, user: User, provider: str) -> None:
        adapter = self.require_provider(provider)
        row = self.get_row(db, organization_id=user.organization_id, provider=provider)
        if row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Integration not found"
            )
        token = row.refresh_token or row.access_token
        if token:
            # Best effort: a provider that will not take the revocation must
            # not leave the tenant stuck with a row they cannot clear.
            try:
                adapter.revoke(token)
            except Exception:
                pass
        row.connected = False
        row.connected_at = None
        row.credentials = None
        row.access_token = None
        row.refresh_token = None
        row.token_expires_at = None
        row.account_email = None
        row.needs_reauth = False
        row.last_error = None
        db.commit()

    # ------------------------------------------------------------------ #
    # Token lifecycle
    # ------------------------------------------------------------------ #
    def access_token_for(self, db: Session, row: Integration) -> str:
        """A usable access token, refreshed in place when it has expired.

        Raises ``CloudAuthError`` when there is no live grant behind the row --
        the caller (an export attempt) turns that into a permanent failure.
        """
        adapter = get_provider(row.provider)
        if adapter is None:
            raise CloudAuthError(f"No adapter for provider {row.provider!r}")
        if row.needs_reauth or not row.connected:
            raise CloudAuthError(f"{adapter.label} needs to be reconnected")

        expires_at = _aware(row.token_expires_at)
        if row.access_token and (expires_at is None or expires_at > _now()):
            return row.access_token

        if not row.refresh_token:
            self.mark_needs_reauth(db, row, "The stored access token expired and there is nothing to refresh it with.")
            raise CloudAuthError(f"{adapter.label} access token expired with no refresh token")

        try:
            tokens = adapter.refresh(row.refresh_token)
        except CloudAuthError as exc:
            self.mark_needs_reauth(db, row, str(exc))
            raise
        self._store_tokens(row, tokens)
        row.needs_reauth = False
        row.last_error = None
        db.flush()
        return row.access_token or tokens.access_token

    def mark_needs_reauth(self, db: Session, row: Integration, message: str) -> None:
        """Latch the grant as dead. The tenant must consent again."""
        row.needs_reauth = True
        row.last_error = message[:1000]
        row.access_token = None
        row.token_expires_at = None
        db.flush()


cloud_integration_service = CloudIntegrationService()
