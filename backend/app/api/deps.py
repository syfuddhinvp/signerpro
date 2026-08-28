from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logging import set_organization_id, set_user_id
from app.core.security import decode_access_token
from app.models.enums import UserRole
from app.models.user import User


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    try:
        payload = decode_access_token(token)
        user_id = payload.get("sub")
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token") from exc
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    # The request middleware cannot know the tenant; stamp it so every log record
    # emitted downstream carries it.
    set_user_id(user.id)
    set_organization_id(user.organization_id)
    return user


def request_ip(request: Request) -> str | None:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    return request.client.host if request.client else None


def request_user_agent(request: Request) -> str | None:
    return request.headers.get("user-agent")



def require_platform_admin(current_user: User = Depends(get_current_user)) -> User:
    """Enforce that the current user is a SignFlow platform administrator."""
    if not current_user.is_platform_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: Requires SaaS Super Admin permissions.",
        )
    return current_user


def require_org_admin(current_user: User = Depends(get_current_user)) -> User:
    """Enforce that the current user administers their own organization."""
    if current_user.role != UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage organization configurations",
        )
    return current_user
