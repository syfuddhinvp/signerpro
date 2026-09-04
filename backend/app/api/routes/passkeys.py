"""WebAuthn passkey registration and management (AUTH-12).

The ceremonies are two-step by protocol: the server mints a challenge, the
browser has the authenticator sign it, the server verifies. Both halves are
here; the challenge itself is never accepted from the client.
"""

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.models.user import User
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


@router.delete("/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_passkey(
    passkey_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
) -> None:
    passkey_service.delete(db, user, passkey_id)
