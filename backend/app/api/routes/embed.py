from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import OrgPrincipal, get_current_user, get_org_principal
from app.core.database import get_db
from app.models.user import User
from app.models.document import Document
from app.models.field import Field as FieldModel
from app.models.recipient import Recipient
from app.schemas.embed import (
    EmbedContextResponse,
    EmbedFrameAncestors,
    EmbedSessionCreate,
    EmbedSessionResponse,
)
from app.core.storage import storage
from app.services.embed_service import embed_service


router = APIRouter(prefix="/api/embed", tags=["embed"])


@router.post("/sessions", response_model=EmbedSessionResponse, status_code=201)
def create_embed_session(
    payload: EmbedSessionCreate,
    db: Session = Depends(get_db),
    principal: OrgPrincipal = Depends(get_org_principal),
) -> EmbedSessionResponse:
    """Mint a short-lived embed session. The signed URL is returned once."""
    if principal.api_key is not None and "documents:write" not in (principal.api_key.scopes or []):
        from fastapi import HTTPException, status

        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API key is missing required scope(s): documents:write",
        )
    session, raw_token = embed_service.create(db, organization_id=principal.organization_id, payload=payload)
    return embed_service.response(session, raw_token=raw_token)


@router.get("/sessions", response_model=list[EmbedSessionResponse])
def list_embed_sessions(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[EmbedSessionResponse]:
    return [embed_service.response(item) for item in embed_service.list_for_organization(db, organization_id=user.organization_id)]


@router.get("/sessions/{session_id}", response_model=EmbedSessionResponse)
def get_embed_session(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> EmbedSessionResponse:
    session = embed_service.get_for_organization(db, session_id=session_id, organization_id=user.organization_id)
    return embed_service.response(session)


@router.post("/sessions/{session_id}/revoke", response_model=EmbedSessionResponse)
def revoke_embed_session(session_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> EmbedSessionResponse:
    session = embed_service.get_for_organization(db, session_id=session_id, organization_id=user.organization_id)
    return embed_service.response(embed_service.revoke(db, session=session))


@router.get("/resolve", response_model=EmbedSessionResponse)
def resolve_embed_session(
    token: str = Query(min_length=10),
    origin: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> EmbedSessionResponse:
    """Exchange an embed token for its session. Origin-locked, single-use stamp."""
    session = embed_service.resolve(db, raw_token=token, origin=origin)
    return embed_service.response(session)


@router.get("/frame-ancestors", response_model=EmbedFrameAncestors)
def embed_frame_ancestors(
    token: str = Query(min_length=10),
    db: Session = Depends(get_db),
) -> EmbedFrameAncestors:
    """The tenant's framing allowlist for one token.

    The frontend middleware calls this on every /embed navigation to build a
    per-tenant ``Content-Security-Policy: frame-ancestors``, which is the only
    place framing can actually be enforced: ``allowed_origins`` names host
    applications, and a host application never sends us a request of its own.
    Unknown and expired tokens answer with an empty list rather than an error,
    so the page still renders its designed state — unframed.
    """
    return EmbedFrameAncestors(frame_ancestors=embed_service.frame_ancestors(db, raw_token=token))


@router.get("/context", response_model=EmbedContextResponse)
def embed_context(
    token: str = Query(min_length=10),
    db: Session = Depends(get_db),
) -> EmbedContextResponse:
    """The framed surface's own read, authorised by the embed token alone.

    Scoped to exactly what the session was minted for — its document, that
    document's fields and recipients — so the token buys no wider access to
    the organization than the session it names. Non-consuming: see
    ``EmbedService.context``.
    """
    session = embed_service.context(db, raw_token=token)
    document = db.get(Document, session.document_id) if session.document_id else None
    if document is not None and document.organization_id != session.organization_id:
        document = None
    fields: list[FieldModel] = []
    recipients: list[Recipient] = []
    if document is not None:
        fields = list(db.scalars(select(FieldModel).where(FieldModel.document_id == document.id)))
        recipients = list(
            db.scalars(
                select(Recipient)
                .where(Recipient.document_id == document.id)
                .order_by(Recipient.signing_order)
            )
        )
    return EmbedContextResponse(
        session=embed_service.response(session),
        frame_ancestors=embed_service.frame_ancestors(db, raw_token=token),
        document=document,
        fields=fields,
        recipients=recipients,
    )


@router.get("/pdf")
def embed_pdf(token: str = Query(min_length=10), db: Session = Depends(get_db)) -> FileResponse:
    """The session's document, authorised by the embed token alone.

    A stream, so it cannot ride on ``/context`` — and the framed page has no
    user session to authenticate with, exactly as the signing surface does not.
    The token is the credential and it only ever unlocks the one document the
    session was minted for.
    """
    session = embed_service.context(db, raw_token=token)
    document = db.get(Document, session.document_id) if session.document_id else None
    if not document or document.organization_id != session.organization_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF is not available")
    path = document.final_file_path or document.original_file_path
    if not path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF is not available")
    return FileResponse(storage.path(path), media_type="application/pdf", filename=f"{document.title}.pdf")
