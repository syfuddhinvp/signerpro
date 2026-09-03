from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import current_session_id, get_current_user
from app.core.database import get_db
from app.core.ratelimit import (
    login_email_limiter,
    login_ip_limiter,
    mfa_verify_limiter,
    password_forgot_email_limiter,
    password_forgot_limiter,
    password_reset_limiter,
    token_refresh_limiter,
)
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    CurrentUserResponse,
    ForgotPasswordRequest,
    LoginRequest,
    MfaChallengeRequest,
    MfaChallengeResponse,
    MfaCodeRequest,
    MfaDisableRequest,
    MfaEnrollRequest,
    MfaEnrollResponse,
    MfaRecoveryCodesRequest,
    MfaRecoveryCodesResponse,
    MfaStatusResponse,
    MfaVerifyRequest,
    ProfileUpdateRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionResponse,
    TokenResponse,
)
from app.services.auth_service import auth_service


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(payload: RegisterRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    return auth_service.register(db, payload, request=request)


@router.post(
    "/login",
    response_model=TokenResponse | MfaChallengeResponse,
    dependencies=[Depends(login_ip_limiter)],
)
def login(
    payload: LoginRequest, request: Request, db: Session = Depends(get_db)
) -> TokenResponse | MfaChallengeResponse:
    login_email_limiter.check(payload.email.strip().lower())
    return auth_service.login(db, payload, request=request)


@router.post("/refresh", response_model=TokenResponse, dependencies=[Depends(token_refresh_limiter)])
def refresh(payload: RefreshRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    return auth_service.refresh(
        db, refresh_token=payload.refresh_token, remember=payload.remember, request=request
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    session_id: str | None = Depends(current_session_id),
) -> Response:
    auth_service.logout(db, user=user, session_id=session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=CurrentUserResponse)
def me(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> CurrentUserResponse:
    return auth_service.current_user_payload(db, current_user)


@router.patch("/me", response_model=CurrentUserResponse)
def update_me(
    payload: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> CurrentUserResponse:
    return auth_service.update_profile(db, user=current_user, payload=payload)


# --- MFA ---------------------------------------------------------------------


@router.post("/mfa/challenge", response_model=MfaChallengeResponse)
def mfa_challenge(payload: MfaChallengeRequest, db: Session = Depends(get_db)) -> MfaChallengeResponse:
    return auth_service.mfa_challenge_info(db, mfa_token=payload.mfa_token)


@router.post("/mfa/verify", response_model=TokenResponse, dependencies=[Depends(mfa_verify_limiter)])
def mfa_verify(payload: MfaVerifyRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    return auth_service.mfa_verify_login(
        db, mfa_token=payload.mfa_token, code=payload.code, remember=payload.remember, request=request
    )


@router.get("/mfa", response_model=MfaStatusResponse)
def mfa_status(current_user: User = Depends(get_current_user)) -> MfaStatusResponse:
    return auth_service.mfa_status(current_user)


@router.post("/mfa/enroll", response_model=MfaEnrollResponse)
def mfa_enroll(
    payload: MfaEnrollRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MfaEnrollResponse:
    return auth_service.mfa_enroll(db, user=current_user, method=payload.method)


@router.post(
    "/mfa/enroll/confirm",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(mfa_verify_limiter)],
)
def mfa_enroll_confirm(
    payload: MfaCodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    auth_service.mfa_confirm(db, user=current_user, code=payload.code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/mfa/disable",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(mfa_verify_limiter)],
)
def mfa_disable(
    payload: MfaDisableRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    auth_service.mfa_disable(db, user=current_user, code=payload.code, password=payload.password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/mfa/recovery-codes",
    response_model=MfaRecoveryCodesResponse,
    dependencies=[Depends(mfa_verify_limiter)],
)
def mfa_recovery_codes(
    payload: MfaRecoveryCodesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MfaRecoveryCodesResponse:
    return auth_service.mfa_regenerate_recovery_codes(
        db, user=current_user, code=payload.code, password=payload.password
    )


# --- passwords ---------------------------------------------------------------


@router.post(
    "/password/forgot",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(password_forgot_limiter)],
)
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)) -> Response:
    # 204 regardless of whether the address exists — no account enumeration.
    password_forgot_email_limiter.check(payload.email.strip().lower())
    auth_service.forgot_password(db, payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/reset", response_model=TokenResponse, dependencies=[Depends(password_reset_limiter)])
def reset_password(payload: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    return auth_service.reset_password(db, payload, request=request)


@router.patch("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    auth_service.change_password(db, user=current_user, payload=payload)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# --- sessions / devices ------------------------------------------------------


@router.get("/sessions", response_model=list[SessionResponse])
def list_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    session_id: str | None = Depends(current_session_id),
) -> list[SessionResponse]:
    return auth_service.list_sessions(db, user=current_user, current_session_id=session_id)


@router.delete("/sessions", status_code=status.HTTP_204_NO_CONTENT)
def revoke_other_sessions(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    session_id: str | None = Depends(current_session_id),
) -> Response:
    auth_service.revoke_other_sessions(db, user=current_user, current_session_id=session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    auth_service.revoke_session(db, user=current_user, session_id=session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
