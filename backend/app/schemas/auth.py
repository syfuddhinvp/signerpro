from datetime import datetime

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
    remember: bool = False


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
    organization_name: str | None = None
    avatar_url: str | None = None
    locale: str | None = None
    timezone: str | None = None
    status: str = "active"
    mfa_method: str | None = None
    mfa_enrolled: bool = False
    last_active_at: datetime | None = None


class AuthUserResponse(CurrentUserResponse):
    """The user payload embedded in a login/register response.

    Same shape as ``CurrentUserResponse`` so the frontend session layer can mint
    its cookie from the login body alone — no follow-up ``GET /api/auth/me``.
    """


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None
    expires_in: int | None = None
    user: AuthUserResponse
    mfa_required: bool = False


class MfaChallengeResponse(BaseModel):
    """Returned by login instead of a token when the account has MFA enrolled."""

    mfa_required: bool = True
    mfa_token: str
    delivery: str = "totp"
    masked_target: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str
    remember: bool = False


class MfaChallengeRequest(BaseModel):
    mfa_token: str


class MfaVerifyRequest(BaseModel):
    mfa_token: str
    code: str = Field(min_length=4, max_length=32)
    remember: bool = False


class MfaEnrollRequest(BaseModel):
    method: str = "totp"


class MfaEnrollResponse(BaseModel):
    method: str = "totp"
    secret: str
    otpauth_url: str
    recovery_codes: list[str]


class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=4, max_length=32)


class MfaDisableRequest(BaseModel):
    """Disabling active MFA requires a current code; a pending (unconfirmed)
    enrolment can be cleared without one."""

    code: str | None = Field(default=None, max_length=32)


class MfaStatusResponse(BaseModel):
    enrolled: bool
    method: str | None = None
    enrolled_at: datetime | None = None
    recovery_codes_remaining: int = 0


class MfaRecoveryCodesResponse(BaseModel):
    recovery_codes: list[str]


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str
    password: str = Field(min_length=8, max_length=128)


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    device: str | None = None
    browser: str | None = None
    os: str | None = None
    ip_address: str | None = None
    location: str | None = None
    last_seen_at: datetime
    created_at: datetime
    expires_at: datetime
    is_current: bool = False


class ProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=255)
    locale: str | None = Field(default=None, max_length=20)
    timezone: str | None = Field(default=None, max_length=60)
    avatar_url: str | None = Field(default=None, max_length=1024)
    signature_default: str | None = Field(default=None, max_length=120)
