from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.models.enums import UserRole
from app.models.organization import Organization
from app.models.user import User
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse


class AuthService:
    def register(self, db: Session, payload: RegisterRequest) -> TokenResponse:
        existing = db.scalar(select(User).where(User.email == payload.email.lower()))
        if existing:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")

        organization = Organization(name=payload.organization_name)
        db.add(organization)
        db.flush()

        user = User(
            organization_id=organization.id,
            name=payload.name,
            email=payload.email.lower(),
            password_hash=hash_password(payload.password),
            role=UserRole.admin,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return TokenResponse(access_token=create_access_token(user.id), user=user)

    def login(self, db: Session, payload: LoginRequest) -> TokenResponse:
        user = db.scalar(select(User).where(User.email == payload.email.lower()))
        if not user or not verify_password(payload.password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
        return TokenResponse(access_token=create_access_token(user.id), user=user)


auth_service = AuthService()

