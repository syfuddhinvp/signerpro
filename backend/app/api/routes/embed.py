from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy.orm import Session

from app.api.deps import OrgPrincipal, get_current_user, get_org_principal
from app.core.database import get_db
from app.models.user import User
from app.schemas.embed import EmbedSessionCreate, EmbedSessionResponse
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
