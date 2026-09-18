from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core import email_layout
from app.core.email import EmailMessage, email_service
from app.core.security import create_access_token, generate_signing_token, hash_password, hash_signing_token
from app.models.invitation import Invitation
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.user import User
from app.schemas.auth import TokenResponse
from app.schemas.invitation import InvitationAcceptRequest, InvitationCreate, InvitationCreateResponse
from app.services.billing_service import billing_service

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

        # Surface the seat limit before an invite is sent, not after the
        # invitee tries to accept -- and distinguish "buy a seat" from
        # "change plan", which are different problems with different fixes.
        billing_service.check_seat_capacity(db, organization_id=inviter.organization_id, amount=1)

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
        workspace = organization.name if organization else "SignFlow CRM"
        html = email_layout.shell(
            email_layout.eyebrow("Team invitation")
            + email_layout.heading(f"Join {workspace} on SignerPro")
            + email_layout.paragraph(
                f"{inviter.name} invited you to join their workspace."
            )
            + email_layout.details(
                [
                    ("Workspace", workspace),
                    ("Your role", invitation.role.value.replace("_", " ").title()),
                    ("Invited by", inviter.name),
                ]
            )
            + email_layout.button("Accept invitation", link)
            + email_layout.fallback_link(link)
            + email_layout.note(
                "This invitation is single-use and expires in 7 days."
            ),
            brand=email_layout.Brand(name=workspace),
            preheader=f"{inviter.name} invited you to {workspace}.",
        )
        email_service.send(
            EmailMessage(
                to_email=email,
                subject=f"You have been invited to join {workspace}",
                body=(
                    f"Hello,\n\n"
                    f"{inviter.name} invited you to join "
                    f"\"{workspace}\" on SignFlow CRM "
                    f"as {invitation.role.value}.\n"
                    f"Accept your invitation here: {link}\n\n"
                    "This invitation is single-use and expires in 7 days."
                ),
                html=html,
                category="member_invite",
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

    def accept(self, db: Session, payload: InvitationAcceptRequest, *, request=None) -> TokenResponse:
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
        billing_service.check_seat_capacity(db, organization_id=invitation.organization_id, amount=1)

        # An invitation carries a password just like registration does. If the
        # org has since turned SSO enforcement on, accepting it must not mint a
        # password-authenticated account any more than /auth/login would --
        # otherwise "enforce SSO" would only apply to people who were already
        # members, not to whoever accepts a pending invite afterward. A brand
        # new user is never a platform admin, so there is no break-glass case
        # to exempt here.
        from app.services.sso_service import sso_service

        if sso_service.is_enforced(db, invitation.organization_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This workspace requires single sign-on; ask an admin for the workspace's SSO login link",
            )

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
        from app.services.platform_service import record_platform_audit

        record_platform_audit(
            db,
            action="invitation.accepted",
            organization_id=invitation.organization_id,
            detail=f"Invitation redeemed by {invitation.email} as {invitation.role}",
        )
        db.commit()
        db.refresh(user)
        # Issue a real session rather than a bare access token. A token minted
        # without a `sid` has no UserSession row behind it, so it carries no
        # refresh token and -- more to the point -- cannot be revoked: "sign
        # out all devices" and an admin force-logout both silently skip it for
        # the life of the token. Someone who joined by invitation was exactly
        # as revocable as a ghost.
        from app.services.auth_service import auth_service

        return auth_service.issue_session_for(db, user, request=request)


invitation_service = InvitationService()
