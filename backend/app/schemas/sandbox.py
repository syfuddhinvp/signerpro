from pydantic import BaseModel, ConfigDict


class SandboxStatusResponse(BaseModel):
    """Which organization a request resolved to, and whether it is a sandbox."""

    model_config = ConfigDict(from_attributes=True)

    organization_id: str
    is_sandbox: bool
    #: Set only on a sandbox: the live organization it shadows.
    live_organization_id: str | None = None
    document_count: int
    contact_count: int
    #: Restates the guarantee in the response so a client does not have to
    #: infer it: outbound email, SMS and payment collection are suppressed.
    side_effects_suppressed: bool


class SandboxResetResponse(SandboxStatusResponse):
    deleted_documents: int
    deleted_contacts: int
