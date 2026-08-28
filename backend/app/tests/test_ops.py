"""Phase 3 production-operations seams: logging, storage, crypto, expiry."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import crypto
from app.core.logging import (
    REQUEST_ID_HEADER,
    JsonFormatter,
    RequestContextFilter,
    get_request_id,
    request_context,
)
from app.core.storage import LocalStorage, S3Storage, StoragePathError, normalize_key
from app.core.database import Base
from app.models.audit_log import AuditLog
from app.models.document import Document
from app.models.enums import DocumentStatus, RecipientStatus, WorkflowType
from app.models.organization import Organization
from app.models.recipient import Recipient
from app.models.signing_token import SigningToken
from app.models.user import User
from app.services.expiry_service import expiry_service


# --------------------------------------------------------------- logging
def test_json_formatter_emits_request_context() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "hello", None, None)
    record.custom_field = "abc"
    with request_context(request_id="req-1", organization_id="org-1"):
        RequestContextFilter().filter(record)
        payload = json.loads(formatter.format(record))
    assert payload["message"] == "hello"
    assert payload["level"] == "INFO"
    assert payload["request_id"] == "req-1"
    assert payload["organization_id"] == "org-1"
    assert payload["custom_field"] == "abc"


def test_request_context_is_reset() -> None:
    assert get_request_id() is None
    with request_context(request_id="req-2"):
        assert get_request_id() == "req-2"
    assert get_request_id() is None


def test_request_id_header_is_generated(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers.get(REQUEST_ID_HEADER)


def test_request_id_header_is_propagated(client: TestClient) -> None:
    response = client.get("/api/health", headers={REQUEST_ID_HEADER: "caller-supplied"})
    assert response.headers[REQUEST_ID_HEADER] == "caller-supplied"


# --------------------------------------------------------------- storage
@pytest.mark.parametrize(
    "evil",
    [
        "../../etc/passwd",
        "documents/../../etc/passwd",
        "/etc/passwd",
        "..",
        "a/../../b",
        "",
    ],
)
def test_storage_rejects_path_traversal(tmp_path, evil: str) -> None:
    store = LocalStorage(str(tmp_path))
    with pytest.raises(StoragePathError):
        store.path(evil)
    with pytest.raises(StoragePathError):
        store.write_bytes(evil, b"x")


def test_storage_round_trip_stays_inside_root(tmp_path) -> None:
    store = LocalStorage(str(tmp_path))
    key = store.write_bytes("documents/abc/file.pdf", b"pdf-bytes")
    assert key == "documents/abc/file.pdf"
    assert store.read_bytes(key) == b"pdf-bytes"
    assert store.path(key).is_relative_to(tmp_path.resolve())
    assert store.url_for(key) is None  # local disk has no signed URL
    with store.open_stream(key) as handle:
        assert handle.read() == b"pdf-bytes"


def test_normalize_key_collapses_redundant_segments() -> None:
    assert normalize_key("documents//./abc/file.pdf") == "documents/abc/file.pdf"


def test_s3_storage_encryption_and_presign_without_boto3() -> None:
    """S3Storage builds correct calls; boto3 stays an optional dependency."""

    calls: dict[str, dict] = {}

    class FakeClient:
        def put_object(self, **kwargs):
            calls["put"] = kwargs

        def get_object(self, **kwargs):
            calls["get"] = kwargs
            return {"Body": _Body(b"data")}

        def generate_presigned_url(self, operation, Params, ExpiresIn):  # noqa: N803
            calls["presign"] = {"operation": operation, "Params": Params, "ExpiresIn": ExpiresIn}
            return "https://signed.example/object"

    class _Body:
        def __init__(self, data: bytes) -> None:
            self._data = data

        def read(self) -> bytes:
            return self._data

    store = S3Storage(bucket="bucket", prefix="signflow", sse="AES256")
    store._client = FakeClient()

    store.write_bytes("documents/a.pdf", b"data")
    assert calls["put"]["Key"] == "signflow/documents/a.pdf"
    assert calls["put"]["ServerSideEncryption"] == "AES256"

    assert store.read_bytes("documents/a.pdf") == b"data"
    assert store.url_for("documents/a.pdf", filename="a.pdf") == "https://signed.example/object"
    assert calls["presign"]["ExpiresIn"] == 900

    with pytest.raises(StoragePathError):
        store.write_bytes("../escape.pdf", b"x")
    with pytest.raises(NotImplementedError):
        store.path("documents/a.pdf")


# ---------------------------------------------------------------- crypto
def test_encrypt_round_trip_and_versioned_prefix() -> None:
    ciphertext = crypto.encrypt("super-secret")
    assert ciphertext.startswith("enc:v1:")
    assert "super-secret" not in ciphertext
    assert crypto.decrypt(ciphertext) == "super-secret"


def test_encryption_is_non_deterministic() -> None:
    assert crypto.encrypt("same") != crypto.encrypt("same")


def test_legacy_plaintext_passes_through() -> None:
    """Rows written before encryption existed must not crash on read."""

    assert crypto.decrypt("plaintext-password") == "plaintext-password"
    assert crypto.is_encrypted("plaintext-password") is False


def test_tampered_ciphertext_is_rejected() -> None:
    ciphertext = crypto.encrypt("secret")
    tampered = ciphertext[:-4] + ("AAAA" if not ciphertext.endswith("AAAA") else "BBBB")
    with pytest.raises(Exception):
        crypto.decrypt(tampered)


def test_missing_key_fails_loudly_in_production(monkeypatch) -> None:
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "secret_encryption_key", None, raising=False)
    monkeypatch.setattr(settings, "environment", "production", raising=False)
    crypto.reset_keyring_cache()
    try:
        with pytest.raises(crypto.EncryptionKeyMissing):
            crypto.verify_encryption_configured()
    finally:
        crypto.reset_keyring_cache()


def test_missing_key_falls_back_in_test_environment() -> None:
    crypto.reset_keyring_cache()
    crypto.verify_encryption_configured()  # must not raise outside production
    assert crypto.decrypt(crypto.encrypt("ok")) == "ok"


# ---------------------------------------------------- encrypted column
@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def test_org_secrets_are_ciphertext_in_the_database(db_session) -> None:
    from sqlalchemy import text

    org = Organization(
        name="Acme",
        smtp_password="smtp-pw",
        twilio_auth_token="twilio-token",
        telnyx_api_key="telnyx-key",
    )
    db_session.add(org)
    db_session.commit()

    raw = db_session.execute(
        text("SELECT smtp_password, twilio_auth_token, telnyx_api_key FROM organizations WHERE id = :i"),
        {"i": org.id},
    ).one()
    for column in raw:
        assert column.startswith("enc:v1:")
    assert "smtp-pw" not in raw[0]

    db_session.expire_all()
    reloaded = db_session.get(Organization, org.id)
    assert reloaded.smtp_password == "smtp-pw"
    assert reloaded.twilio_auth_token == "twilio-token"
    assert reloaded.telnyx_api_key == "telnyx-key"


def test_existing_plaintext_rows_still_read(db_session) -> None:
    from sqlalchemy import text

    org = Organization(name="Legacy")
    db_session.add(org)
    db_session.commit()
    # Simulate a pre-encryption row.
    db_session.execute(
        text("UPDATE organizations SET smtp_password = 'legacy-plaintext' WHERE id = :i"),
        {"i": org.id},
    )
    db_session.commit()
    db_session.expire_all()

    reloaded = db_session.get(Organization, org.id)
    assert reloaded.smtp_password == "legacy-plaintext"

    # Rewriting the value upgrades it to ciphertext in place.
    reloaded.smtp_password = "rotated-plaintext"
    db_session.add(reloaded)
    db_session.commit()
    stored = db_session.execute(
        text("SELECT smtp_password FROM organizations WHERE id = :i"), {"i": org.id}
    ).scalar_one()
    assert stored.startswith("enc:v1:")


def test_organization_documents_cascade_is_not_destructive() -> None:
    cascade = str(Organization.documents.property.cascade)
    assert "delete" not in cascade
    assert "delete-orphan" not in cascade


# ---------------------------------------------------------------- expiry
def _seed_document(db, *, expires_at, status=DocumentStatus.sent):
    org = Organization(name="Expiring Org")
    db.add(org)
    db.flush()
    user = User(
        organization_id=org.id,
        name="Sender",
        email=f"sender-{org.id}@example.com",
        password_hash="x",
    )
    db.add(user)
    db.flush()
    document = Document(
        organization_id=org.id,
        sender_id=user.id,
        title="Agreement",
        workflow_type=WorkflowType.parallel,
        status=status,
        expires_at=expires_at,
    )
    db.add(document)
    db.flush()
    recipient = Recipient(
        document_id=document.id,
        name="Signer",
        email="signer@example.com",
        signing_order=1,
        status=RecipientStatus.sent,
    )
    db.add(recipient)
    db.flush()
    db.commit()
    return document, recipient


def test_expires_overdue_documents_and_recipients(db_session) -> None:
    past = datetime.now(timezone.utc) - timedelta(days=1)
    document, recipient = _seed_document(db_session, expires_at=past)

    report = expiry_service.run(db_session)

    assert report.documents_expired == 1
    assert report.recipients_expired == 1
    db_session.expire_all()
    assert db_session.get(Document, document.id).status == DocumentStatus.expired
    assert db_session.get(Recipient, recipient.id).status == RecipientStatus.expired
    events = [log.event_type for log in db_session.query(AuditLog).all()]
    assert events.count("document_expired") == 1


def test_expiry_is_idempotent(db_session) -> None:
    past = datetime.now(timezone.utc) - timedelta(days=1)
    _seed_document(db_session, expires_at=past)

    first = expiry_service.run(db_session)
    second = expiry_service.run(db_session)

    assert first.documents_expired == 1
    assert second.documents_expired == 0
    assert second.recipients_expired == 0
    assert db_session.query(AuditLog).filter(AuditLog.event_type == "document_expired").count() == 1


def test_future_and_terminal_documents_are_untouched(db_session) -> None:
    future = datetime.now(timezone.utc) + timedelta(days=5)
    _seed_document(db_session, expires_at=future)
    past = datetime.now(timezone.utc) - timedelta(days=1)
    completed, _ = _seed_document(db_session, expires_at=past, status=DocumentStatus.completed)

    report = expiry_service.run(db_session)

    assert report.documents_expired == 0
    db_session.expire_all()
    assert db_session.get(Document, completed.id).status == DocumentStatus.completed


def test_expires_overdue_signing_tokens(db_session) -> None:
    past = datetime.now(timezone.utc) - timedelta(days=1)
    document, recipient = _seed_document(db_session, expires_at=None)
    token = SigningToken(
        document_id=document.id,
        recipient_id=recipient.id,
        token_hash="a" * 64,
        expires_at=past,
    )
    live = SigningToken(
        document_id=document.id,
        recipient_id=recipient.id,
        token_hash="b" * 64,
        expires_at=datetime.now(timezone.utc) + timedelta(days=3),
    )
    db_session.add_all([token, live])
    db_session.commit()

    report = expiry_service.run(db_session)
    assert report.tokens_expired == 1
    db_session.expire_all()
    assert db_session.get(SigningToken, token.id).revoked_at is not None
    assert db_session.get(SigningToken, live.id).revoked_at is None
    assert db_session.query(AuditLog).filter(AuditLog.event_type == "token_expired").count() == 1

    # Re-running does not duplicate the audit event.
    assert expiry_service.run(db_session).tokens_expired == 0
    assert db_session.query(AuditLog).filter(AuditLog.event_type == "token_expired").count() == 1


def test_expiry_batches(db_session) -> None:
    past = datetime.now(timezone.utc) - timedelta(days=1)
    for _ in range(3):
        _seed_document(db_session, expires_at=past)

    report = expiry_service.run(db_session, batch_size=2)
    assert report.documents_expired == 2
    assert expiry_service.run(db_session, batch_size=2).documents_expired == 1
