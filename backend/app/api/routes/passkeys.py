"""WebAuthn passkey registration and management (AUTH-12).

The ceremonies are two-step by protocol: the server mints a challenge, the
browser has the authenticator sign it, the server verifies. Both halves are
here; the challenge itself is never accepted from the client.
"""

from fastapi import APIRouter, Depends, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.ratelimit import login_email_limiter, login_ip_limiter
from app.models.user import User
from app.schemas.auth import MfaChallengeResponse, TokenResponse
from app.services.passkey_service import passkey_service

router = APIRouter(prefix="/api/auth/passkeys", tags=["auth"])


class PasskeyResponse(BaseModel):
    id: str
    label: str | None
    created_at: str
    last_used_at: str | None


class RegistrationRequest(BaseModel):
    credential: dict
    label: str | None = None


class AuthenticationRequest(BaseModel):
    credential: dict


class LoginBeginRequest(BaseModel):
    email: str


class LoginFinishRequest(BaseModel):
    email: str
    credential: dict


def _response(passkey) -> PasskeyResponse:
    return PasskeyResponse(
        id=passkey.id,
        label=passkey.label,
        created_at=passkey.created_at.isoformat(),
        last_used_at=passkey.last_used_at.isoformat() if passkey.last_used_at else None,
    )


@router.get("", response_model=list[PasskeyResponse])
def list_passkeys(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> list[PasskeyResponse]:
    return [_response(row) for row in passkey_service.list_for_user(db, user)]


@router.post("/register/begin")
def begin_registration(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    return passkey_service.begin_registration(db, user)


@router.post("/register/finish", response_model=PasskeyResponse, status_code=201)
def finish_registration(
    payload: RegistrationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PasskeyResponse:
    return _response(passkey_service.finish_registration(db, user, payload.credential, payload.label))


@router.post("/authenticate/begin")
def begin_authentication(
    db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    return passkey_service.begin_authentication(db, user)


@router.post("/authenticate/finish", response_model=PasskeyResponse)
def finish_authentication(
    payload: AuthenticationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PasskeyResponse:
    return _response(passkey_service.finish_authentication(db, user, payload.credential))


# -- sign-in ------------------------------------------------------------------
#
# Unlike everything above, these two take no session: they are how a session is
# obtained. They are declared before the `/{passkey_id}` route only for
# readability -- the literal prefixes cannot collide with it.


@router.post("/login/begin", dependencies=[Depends(login_ip_limiter)])
def begin_login(payload: LoginBeginRequest, db: Session = Depends(get_db)) -> dict:
    # Throttled exactly like the password path: this endpoint is public and
    # answers about any address, so it is the natural place to grind.
    login_email_limiter.check(payload.email.strip().lower())
    return passkey_service.begin_login(db, email=payload.email)


@router.post(
    "/login/finish",
    response_model=TokenResponse | MfaChallengeResponse,
    dependencies=[Depends(login_ip_limiter)],
)
def finish_login(
    payload: LoginFinishRequest, request: Request, db: Session = Depends(get_db)
) -> TokenResponse | MfaChallengeResponse:
    return passkey_service.finish_login(
        db, email=payload.email, credential=payload.credential, request=request
    )


@router.delete("/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_passkey(
    passkey_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> None:
    passkey_service.delete(db, user, passkey_id)
