"""The request-logging middleware is the writer behind ``system_logs`` (ACT-1).

Three properties matter and are asserted here: the rows appear on GET /api/logs
scoped to the caller's tenant, secrets never reach the table, and a broken
writer never breaks the request.
"""

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from app.core import logging as core_logging
from app.core.logging import REQUEST_ID_HEADER, log_source_for, redact_path, should_persist_request


def register(client: TestClient, *, org: str, name: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == status.HTTP_201_CREATED, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_mutating_requests_are_persisted_and_tenant_scoped(client: TestClient) -> None:
    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")

    created = client.post("/api/documents", headers=headers, json={"title": "Deal"})
    assert created.status_code == 201
    request_id = created.headers[REQUEST_ID_HEADER]

    page = client.get("/api/logs", headers=headers).json()
    row = next(item for item in page["items"] if item["request_id"] == request_id)
    assert row["message"] == "POST /api/documents -> 201"
    assert row["source"] == "api"
    assert row["level"] == "info"
    assert row["status_code"] == 201
    assert row["latency_ms"] is not None
    assert row["payload"]["path"] == "/api/documents"
    assert row["actor_email"] == "ada@acme.com"

    # Reads are not persisted: the log reader itself must not fill the table.
    before = client.get("/api/logs", headers=headers).json()["total"]
    client.get("/api/documents", headers=headers)
    client.get("/api/logs", headers=headers)
    assert client.get("/api/logs", headers=headers).json()["total"] == before

    # A failure is persisted at warn/error level...
    client.patch("/api/organizations/me", headers=headers, json={"slug": "Nope Nope"})
    levels = {item["level"] for item in client.get("/api/logs", headers=headers).json()["items"]}
    assert "warn" in levels

    # ...and never leaks into another tenant.
    other = register(client, org="Globex", name="Gil", email="gil@globex.com")
    assert client.get("/api/logs", headers=other).json()["total"] == 0


def test_signing_tokens_are_never_written_to_the_log_table(client: TestClient) -> None:
    """A signing link is a bearer secret that happens to live in the path."""
    # The endpoint 404s on an unknown token, which is exactly the failure path
    # that must still be logged -- with the token redacted.
    response = client.post("/api/sign/super-secret-token/consent", json={"accepted": True})
    assert response.status_code in (404, 422)

    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    platform = client.get("/api/saas/logs", headers=headers)
    # Tenant admins cannot read the platform stream; assert on the writer's
    # pure helpers instead, which is what produced the row.
    assert platform.status_code == 403
    assert redact_path("/api/sign/super-secret-token/consent") == "/api/sign/<token>/consent"
    assert redact_path("/api/invitations/abc123/accept") == "/api/invitations/<token>/accept"
    assert redact_path("/api/documents/42") == "/api/documents/42"


@pytest.mark.parametrize(
    "path,expected",
    [
        ("/api/webhooks/endpoints", "webhook"),
        ("/api/sign/x/consent", "signing"),
        ("/api/auth/login", "auth"),
        ("/api/billing/subscription", "billing"),
        ("/api/saas/tenants", "admin"),
        ("/api/documents", "api"),
    ],
)
def test_source_classification(path: str, expected: str) -> None:
    assert log_source_for(path) == expected


def test_persistence_policy_is_cheap() -> None:
    # Mutations and failures only; the health probe and log readers never.
    assert should_persist_request("POST", "/api/documents", 201)
    assert should_persist_request("GET", "/api/documents", 500)
    assert not should_persist_request("GET", "/api/documents", 200)
    assert not should_persist_request("GET", "/api/health", 200)
    assert not should_persist_request("POST", "/api/logs", 200)
    assert not should_persist_request("GET", "/api/saas/logs/abc", 500)


def test_a_broken_log_writer_never_breaks_the_request(client: TestClient, monkeypatch) -> None:
    def boom(*args, **kwargs):
        raise RuntimeError("database on fire")

    monkeypatch.setattr(core_logging, "background_session", boom, raising=False)
    monkeypatch.setattr("app.core.database.background_session", boom)

    headers = register(client, org="Acme", name="Ada", email="ada@acme.com")
    created = client.post("/api/documents", headers=headers, json={"title": "Deal"})
    assert created.status_code == 201
