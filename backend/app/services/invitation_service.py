from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.email import EmailMessage, email_service
from app.core.security import create_access_token, generate_signing_token, hash_password, hash_signing_token
from app.models.invitation import Invitation
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.user import User
from app.schemas.auth import TokenResponse
from app.services.entitlement_service import entitlement_service
from app.schemas.invitation import InvitationAcceptRequest, InvitationCreate, InvitationCreateResponse

INVITATION_TTL = timedelta(days=7)


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class InvitationService:
    def _link(self, raw_token: str) -> str:
        return f"{get_settings().app_base_url.rstrip('/')}/invite/{raw_token}"

    def create(self, db: Session, *, inviter: User, payload: InvitationCreate) -> InvitationCreateResponse:
        email = payload.email.lower()
        if db.scalar(select(User).where(User.email == email)):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")

        pending = db.scalar(
            select(Invitation).where(
                Invitation.organization_id == inviter.organization_id,
                Invitation.email == email,
                Invitation.accepted_at.is_(None),
            )
        )
        if pending and _as_aware_utc(pending.expires_at) > now_utc():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An invitation is already pending for this email")

        # Surface the seat limit before an invite is sent, not after the invitee tries to accept.
        entitlement_service.check_entitlement(db, inviter.organization_id, "max_users", amount=1)

        raw_token = generate_signing_token()
        invitation = Invitation(
            organization_id=inviter.organization_id,
            email=email,
            role=payload.role,
            token_hash=hash_signing_token(raw_token),
            invited_by_user_id=inviter.id,
            expires_at=now_utc() + INVITATION_TTL,
        )
        db.add(invitation)
        db.commit()
        db.refresh(invitation)

        link = self._link(raw_token)
        organization = db.get(Organization, inviter.organization_id)
        email_service.send(
            EmailMessage(
                to_email=email,
                subject=f"You have been invited to join {organization.name if organization else 'SignFlow CRM'}",
                body=(
                    f"Hello,\n\n"
                    f"{inviter.name} invited you to join "
                    f"\"{organization.name if organization else 'SignFlow CRM'}\" on SignFlow CRM "
                    f"as {invitation.role.value}.\n"
                    f"Accept your invitation here: {link}\n\n"
                    "This invitation is single-use and expires in 7 days."
                ),
            ),
            organization=organization,
        )
        return InvitationCreateResponse(invitation=invitation, invite_link=link)

    def list_pending(self, db: Session, *, organization_id: str) -> list[Invitation]:
        invitations = db.scalars(
            select(Invitation)
            .where(
                Invitation.organization_id == organization_id,
                Invitation.accepted_at.is_(None),
            )
            .order_by(Invitation.created_at.desc())
        )
        now = now_utc()
        return [invite for invite in invitations if _as_aware_utc(invite.expires_at) > now]

    def revoke(self, db: Session, *, invitation_id: str, organization_id: str) -> None:
        invitation = db.get(Invitation, invitation_id)
        if not invitation or invitation.organization_id != organization_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
        if invitation.accepted_at is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Invitation has already been accepted")
        db.delete(invitation)
        db.commit()

    def accept(self, db: Session, payload: InvitationAcceptRequest) -> TokenResponse:
        invitation = db.scalar(
            select(Invitation).where(Invitation.token_hash == hash_signing_token(payload.token))
        )
        if not invitation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
        if invitation.accepted_at is not None:
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invitation has already been used")
        if _as_aware_utc(invitation.expires_at) <= now_utc():
            raise HTTPException(status_code=status.HTTP_410_GONE, detail="Invitation has expired")
        if db.scalar(select(User).where(User.email == invitation.email)):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email is already registered")

        # Re-check on the path that actually consumes the seat: the plan may have
        # changed, or other invites may have been accepted, since this one was sent.
        entitlement_service.check_entitlement(db, invitation.organization_id, "max_users", amount=1)

        user = User(
            organization_id=invitation.organization_id,
            name=payload.name,
            email=invitation.email,
            password_hash=hash_password(payload.password),
            role=invitation.role,
            is_platform_admin=False,
        )
        db.add(user)
        invitation.accepted_at = now_utc()
        db.add(invitation)
        db.commit()
        db.refresh(user)
        return TokenResponse(access_token=create_access_token(user.id), user=user)


invitation_service = InvitationService()
