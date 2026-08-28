from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.database import get_db
from app.core.ratelimit import login_email_limiter, login_ip_limiter
from app.models.user import User
from app.schemas.auth import CurrentUserResponse, LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.auth_service import auth_service


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    return auth_service.register(db, payload)


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(login_ip_limiter)])
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    login_email_limiter.check(payload.email.strip().lower())
    return auth_service.login(db, payload)


@router.get("/me", response_model=CurrentUserResponse)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user

