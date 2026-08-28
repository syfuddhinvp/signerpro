from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import UserRole


class RegisterRequest(BaseModel):
    organization_name: str = Field(min_length=2, max_length=255)
    name: str = Field(min_length=2, max_length=255)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str
    name: str
    email: EmailStr
    role: UserRole


class CurrentUserResponse(UserResponse):
    """The caller's own account.

    ``is_platform_admin`` lives here and NOT on the shared ``UserResponse``:
    the tenant-facing member listing reuses that schema, and it must not reveal
    which colleagues hold cross-tenant platform access.
    """

    is_platform_admin: bool = False


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

