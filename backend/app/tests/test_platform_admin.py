"""Platform tenant management, directory, flags, logs and ticket triage.

The authorization assertions are the point of this module: every platform
surface must reject a tenant administrator, and an internal ticket note must
never reach a tenant caller.
"""

from datetime import timedelta

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import hash_password
from app.main import app
from app.models.mixins import now_utc
from app.models.organization import Organization
from app.models.plan import Plan
from app.models.subscription import Subscription, SubscriptionStatus
from app.models.system_log import SystemLog
from app.models.user import User


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _register(client: TestClient, *, org: str, email: str, name: str = "Owner") -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": name, "email": email, "password": "strong-password"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _me(client: TestClient, headers: dict[str, str]) -> dict:
    return client.get("/api/auth/me", headers=headers).json()


def _promote(client: TestClient, headers: dict[str, str]) -> None:
    session, generator = _db()
    user = session.get(User, _me(client, headers)["id"])
    user.is_platform_admin = True
    session.add(user)
    session.commit()
    generator.close()


def _platform_and_tenant(client: TestClient) -> tuple[dict[str, str], dict[str, str], str]:
    """A platform admin plus an unrelated tenant admin, with the tenant's org id."""
    platform = _register(client, org="SignerPro", email="ops@signforge.com", name="Jordan Mehta")
    _promote(client, platform)
    tenant = _register(client, org="Acme Realty", email="priya@acme.io", name="Priya Rao")
    return platform, tenant, _me(client, tenant)["organization_id"]


# --- Authorization ---------------------------------------------------------


def test_every_platform_surface_rejects_a_tenant_admin(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)

    gets = [
        "/api/saas/tenants",
        f"/api/saas/tenants/{org_id}",
        f"/api/saas/tenants/{org_id}/flags",
        "/api/saas/directory",
        "/api/saas/roles",
        "/api/saas/overview",
        "/api/saas/flags",
        "/api/saas/security-posture",
        "/api/saas/compliance",
        "/api/saas/logs",
        "/api/saas/audit",
        "/api/support/agents",
        "/api/support/queue",
        "/api/support/queue/stats",
    ]
    for path in gets:
        assert client.get(path, headers=tenant).status_code == 403, path

    assert (
        client.post(
            f"/api/saas/tenants/{org_id}/suspend", json={"reason": "nope"}, headers=tenant
        ).status_code
        == 403
    )
    assert client.post(f"/api/saas/tenants/{org_id}/resume", headers=tenant).status_code == 403
    assert (
        client.post(
            f"/api/saas/tenants/{org_id}/impersonate",
            json={"justification": "curiosity"},
            headers=tenant,
        ).status_code
        == 403
    )
    assert client.delete("/api/saas/impersonation", headers=tenant).status_code == 403
    assert (
        client.patch("/api/saas/flags/api.bulk_send_v3", json={"enabled": True}, headers=tenant).status_code
        == 403
    )
    assert (
        client.patch("/api/saas/security-posture", json={"dlp": True}, headers=tenant).status_code == 403
    )
    assert (
        client.patch(
            f"/api/saas/directory/{_me(client, tenant)['id']}/role",
            json={"role": "super"},
            headers=tenant,
        ).status_code
        == 403
    )
    # And the same surfaces answer the platform admin.
    for path in gets:
        assert client.get(path, headers=platform).status_code == 200, path


def test_a_tenant_cannot_ask_for_cross_tenant_tickets(client: TestClient) -> None:
    _, tenant, _ = _platform_and_tenant(client)
    assert client.get("/api/support/tickets?scope=all", headers=tenant).status_code == 403


# --- Tenant listing, detail, suspension ------------------------------------


def test_tenant_rows_carry_seats_plan_status_and_mrr(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)

    session, generator = _db()
    plan = Plan(
        code="business",
        name="Business",
        price_cents=2800,
        seat_price_cents=2800,
        is_seat_based=True,
        entitlements={},
    )
    session.add(plan)
    org = session.get(Organization, org_id)
    org.seats_licensed = 10
    org.region = "us-east-1"
    session.flush()
    session.add(
        Subscription(organization_id=org_id, plan_id=plan.id, status=SubscriptionStatus.active)
    )
    session.commit()
    generator.close()

    page = client.get("/api/saas/tenants?q=acme", headers=platform)
    assert page.status_code == 200
    body = page.json()
    assert body["total"] == 1
    row = body["items"][0]
    assert row["slug"] is None or isinstance(row["slug"], str)
    assert row["plan_name"] == "Business"
    assert row["seats_licensed"] == 10
    assert row["seats_activated"] == 1
    assert row["mrr_cents"] == 28000
    assert row["status"] == "active"
    assert row["owner_email"] == "priya@acme.io"
    assert row["region"] == "us-east-1"

    # The legacy path returns the same rows.
    legacy = client.get("/api/saas/organizations", headers=platform).json()
    assert any(item["id"] == org_id and item["mrr_cents"] == 28000 for item in legacy)


def test_suspension_records_reason_audit_and_zeroes_mrr(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)

    suspended = client.post(
        f"/api/saas/tenants/{org_id}/suspend",
        json={"reason": "non-payment · dunning step 4"},
        headers=platform,
    )
    assert suspended.status_code == 200, suspended.text
    body = suspended.json()
    assert body["status"] == "suspended"
    assert body["suspended_at"] is not None
    assert body["suspension_reason"] == "non-payment · dunning step 4"
    assert body["mrr_cents"] == 0

    # Suspended tenants are reachable through the status filter.
    filtered = client.get("/api/saas/tenants?status=suspended", headers=platform).json()
    assert [row["id"] for row in filtered["items"]] == [org_id]
    assert client.get("/api/saas/tenants?status=active", headers=platform).json()["items"] == [] or all(
        row["id"] != org_id
        for row in client.get("/api/saas/tenants?status=active", headers=platform).json()["items"]
    )

    audit = client.get("/api/saas/audit", headers=platform).json()
    actions = [entry["action"] for entry in audit["items"]]
    assert "tenant.suspended" in actions
    entry = next(item for item in audit["items"] if item["action"] == "tenant.suspended")
    assert entry["actor_email"] == "ops@signforge.com"
    assert entry["detail"] == "non-payment · dunning step 4"

    logs = client.get("/api/saas/logs?level=warn", headers=platform).json()
    assert any("suspended" in row["message"] for row in logs["items"])

    resumed = client.post(f"/api/saas/tenants/{org_id}/resume", headers=platform)
    assert resumed.json()["suspended_at"] is None
    assert resumed.json()["suspension_reason"] is None
    assert "tenant.reinstated" in [
        entry["action"] for entry in client.get("/api/saas/audit", headers=platform).json()["items"]
    ]


def test_tenant_detail_and_unknown_tenant(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)
    detail = client.get(f"/api/saas/tenants/{org_id}", headers=platform).json()
    assert detail["id"] == org_id
    assert [admin["email"] for admin in detail["admins"]] == ["priya@acme.io"]
    assert detail["flag_overrides"] == []
    assert client.get("/api/saas/tenants/does-not-exist", headers=platform).status_code == 404


def test_creating_a_tenant_provisions_an_invited_owner(client: TestClient) -> None:
    platform, _, _ = _platform_and_tenant(client)
    created = client.post(
        "/api/saas/tenants",
        json={
            "name": "Northwind Legal",
            "region": "eu-central-1",
            "seats_licensed": 12,
            "owner_email": "dana@northwind-legal.com",
            "owner_name": "Dana Whitfield",
        },
        headers=platform,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["slug"] == "northwind-legal"
    assert body["owner_email"] == "dana@northwind-legal.com"
    assert body["seats_licensed"] == 12
    # An invited owner is not an activated seat.
    assert body["seats_activated"] == 0

    duplicate = client.post(
        "/api/saas/tenants",
        json={"name": "Dupe", "owner_email": "dana@northwind-legal.com", "owner_name": "D"},
        headers=platform,
    )
    assert duplicate.status_code == 409


# --- Impersonation ---------------------------------------------------------


def test_impersonation_issues_a_scoped_token_and_is_recorded(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)

    started = client.post(
        f"/api/saas/tenants/{org_id}/impersonate",
        json={"justification": "incident #INC-4471", "ttl_seconds": 600},
        headers=platform,
    )
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["impersonated_user_email"] == "priya@acme.io"
    assert body["organization_id"] == org_id
    assert body["scopes"] == ["read"]

    # The token authenticates as the tenant user, not as the platform admin.
    impersonated = {"Authorization": f"Bearer {body['access_token']}"}
    me = _me(client, impersonated)
    assert me["email"] == "priya@acme.io"
    assert me["is_platform_admin"] is False
    assert client.get("/api/saas/tenants", headers=impersonated).status_code == 403

    audit = client.get("/api/saas/audit", headers=platform).json()["items"]
    assert "impersonation.started" in [entry["action"] for entry in audit]

    ended = client.delete("/api/saas/impersonation", headers=platform)
    assert ended.status_code == 200
    assert ended.json()["ended_sessions"] == 1
    assert "impersonation.ended" in [
        entry["action"] for entry in client.get("/api/saas/audit", headers=platform).json()["items"]
    ]
    # Idempotent: nothing left to end.
    assert client.delete("/api/saas/impersonation", headers=platform).json()["ended_sessions"] == 0


# --- Directory & roles -----------------------------------------------------


def test_directory_reports_role_and_mfa_and_assigns_roles(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)

    session, generator = _db()
    sender = User(
        organization_id=org_id,
        name="Morgan Bell",
        email="m.bell@acme.io",
        password_hash=hash_password("strong-password"),
        role="sender",
    )
    session.add(sender)
    owner = session.get(User, _me(client, tenant)["id"])
    owner.mfa_method = "totp"
    owner.mfa_enrolled_at = now_utc()
    session.add(owner)
    session.commit()
    sender_id = sender.id
    generator.close()

    page = client.get(f"/api/saas/directory?organization_id={org_id}", headers=platform).json()
    assert page["total"] == 2
    by_email = {item["email"]: item for item in page["items"]}
    assert by_email["priya@acme.io"]["role_key"] == "orgadmin"
    assert by_email["priya@acme.io"]["mfa_enabled"] is True
    assert by_email["priya@acme.io"]["organization_name"] == "Acme Realty"
    assert by_email["m.bell@acme.io"]["role_key"] == "sender"
    assert by_email["m.bell@acme.io"]["mfa_enabled"] is False

    assert client.get("/api/saas/directory?mfa=true", headers=platform).json()["total"] == 1
    assert client.get("/api/saas/directory?role=super", headers=platform).json()["total"] == 1
    assert client.get("/api/saas/directory?q=bell", headers=platform).json()["total"] == 1

    promoted = client.patch(
        f"/api/saas/directory/{sender_id}/role", json={"role": "super"}, headers=platform
    )
    assert promoted.status_code == 200
    assert promoted.json()["role_key"] == "super"
    assert promoted.json()["is_platform_admin"] is True

    # The tenant must keep an administrator: with the promoted user demoted
    # again, the owner is the last one standing.
    assert (
        client.patch(
            f"/api/saas/directory/{sender_id}/role", json={"role": "sender"}, headers=platform
        ).status_code
        == 200
    )
    demote_owner = client.patch(
        f"/api/saas/directory/{_me(client, tenant)['id']}/role",
        json={"role": "sender"},
        headers=platform,
    )
    assert demote_owner.status_code == 409

    assert (
        client.patch(
            f"/api/saas/directory/{sender_id}/role", json={"role": "wizard"}, headers=platform
        ).status_code
        == 400
    )
    assert client.get("/api/saas/directory?role=super", headers=platform).json()["total"] == 1
    assert "user.role_assigned" in [
        entry["action"] for entry in client.get("/api/saas/audit", headers=platform).json()["items"]
    ]


def test_permission_matrix_is_server_owned(client: TestClient) -> None:
    platform, _, _ = _platform_and_tenant(client)
    matrix = client.get("/api/saas/roles", headers=platform).json()
    assert matrix["columns"] == ["super", "orgadmin", "sender", "viewer"]
    assert len(matrix["column_labels"]) == 4
    assert all(len(row["allowed"]) == 4 for row in matrix["permissions"])
    manage = next(row for row in matrix["permissions"] if row["label"].startswith("Manage tenants"))
    assert manage["allowed"] == [True, False, False, False]


def test_platform_overview_counts_tenants_and_seats(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)
    client.post(
        f"/api/saas/tenants/{org_id}/suspend", json={"reason": "audit"}, headers=platform
    )
    overview = client.get("/api/saas/overview", headers=platform).json()
    assert overview["tenants"]["total"] == 2
    assert overview["tenants"]["suspended"] == 1
    assert overview["seats"]["activated"] == 2
    assert len(overview["mrr_series"]) == 12
    assert overview["health"]


# --- Feature flags, security posture, compliance ---------------------------


def test_flags_resolve_per_tenant_with_overrides(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)

    flags = client.get("/api/saas/flags", headers=platform).json()
    keys = {flag["key"] for flag in flags}
    assert "api.bulk_send_v3" in keys
    canary = next(flag for flag in flags if flag["key"] == "signing.ai_clause_summary")
    assert canary["environment"] == "canary"

    # A tenant sees only the resolved map.
    resolved = client.get("/api/flags", headers=tenant).json()
    assert resolved["signing.passkey_reuse"] is True
    assert resolved["api.bulk_send_v3"] in (True, False)

    updated = client.patch(
        "/api/saas/flags/api.bulk_send_v3",
        json={"enabled": True, "rollout_pct": 100},
        headers=platform,
    )
    assert updated.status_code == 200
    assert updated.json()["enabled"] is True
    assert updated.json()["rollout_pct"] == 100
    assert updated.json()["updated_by"] == "ops@signforge.com"
    assert client.get("/api/flags", headers=tenant).json()["api.bulk_send_v3"] is True
    assert "flag.changed" in [
        entry["action"] for entry in client.get("/api/saas/audit", headers=platform).json()["items"]
    ]

    # A per-tenant override wins over the global state.
    override = client.put(
        f"/api/saas/tenants/{org_id}/flags",
        json={"key": "api.bulk_send_v3", "enabled": False},
        headers=platform,
    )
    assert override.status_code == 200
    assert override.json() == [
        {"flag_id": override.json()[0]["flag_id"], "key": "api.bulk_send_v3", "enabled": False}
    ]
    assert client.get("/api/flags", headers=tenant).json()["api.bulk_send_v3"] is False

    cleared = client.put(
        f"/api/saas/tenants/{org_id}/flags",
        json={"key": "api.bulk_send_v3", "enabled": None},
        headers=platform,
    )
    assert cleared.json() == []
    assert client.get("/api/flags", headers=tenant).json()["api.bulk_send_v3"] is True

    assert (
        client.patch("/api/saas/flags/nope.nope", json={"enabled": True}, headers=platform).status_code
        == 404
    )


def test_flag_override_list_replacement(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)
    client.get("/api/saas/flags", headers=platform)

    put = client.put(
        "/api/saas/flags/api.bulk_send_v3/overrides",
        json={"organization_ids": [org_id]},
        headers=platform,
    )
    assert put.status_code == 200
    assert put.json() == {"key": "api.bulk_send_v3", "organization_ids": [org_id]}
    assert client.get("/api/saas/flags/api.bulk_send_v3/overrides", headers=platform).json()[
        "organization_ids"
    ] == [org_id]

    assert (
        client.put(
            "/api/saas/flags/api.bulk_send_v3/overrides",
            json={"organization_ids": ["ghost"]},
            headers=platform,
        ).status_code
        == 400
    )
    assert client.put(
        "/api/saas/flags/api.bulk_send_v3/overrides",
        json={"organization_ids": []},
        headers=platform,
    ).json()["organization_ids"] == []


def test_security_posture_and_compliance(client: TestClient) -> None:
    platform, _, _ = _platform_and_tenant(client)
    posture = client.get("/api/saas/security-posture", headers=platform).json()
    assert [row["key"] for row in posture][:2] == ["sso", "scim"]
    assert next(row for row in posture if row["key"] == "dlp")["enabled"] is False

    updated = client.patch(
        "/api/saas/security-posture",
        json={"dlp": True, "ipAllow": True, "residency": True},
        headers=platform,
    ).json()
    assert next(row for row in updated if row["key"] == "dlp")["enabled"] is True
    assert next(row for row in updated if row["key"] == "ipAllow")["enabled"] is True
    assert "security_posture.changed" in [
        entry["action"] for entry in client.get("/api/saas/audit", headers=platform).json()["items"]
    ]

    # Toggling stores intent; ``enforced`` must track whether code actually
    # refuses a request, never merely what the operator switched on. The
    # original version of this test asserted only ``enabled``, which is what
    # let the console present six unimplemented controls as live switches.
    rows = {row["key"]: row for row in updated}

    # Backed by real enforcement: deps.require_platform_admin (ipAllow),
    # document_service (dlp), auth_service/sso_service (sso), scim_service.
    for key in ("sso", "scim", "ipAllow", "dlp"):
        assert rows[key]["implemented"] is True, key
    assert rows["ipAllow"]["enforced"] is True
    assert rows["dlp"]["enforced"] is True
    # Implemented but switched off is still not enforced.
    assert rows["sso"]["enabled"] is False and rows["sso"]["enforced"] is False

    # Nothing enforces these, and no application code can: residency is a
    # property of where the deployment stores data, key rotation needs an HSM.
    # Switching residency on above must NOT make it report as enforced.
    for key in ("residency", "keyRotation"):
        assert rows[key]["implemented"] is False, key
        assert rows[key]["enforced"] is False, key
    assert rows["residency"]["enabled"] is True and rows["residency"]["enforced"] is False

    # The audit trail still says so for the unimplemented control.
    detail = [
        entry["detail"]
        for entry in client.get("/api/saas/audit", headers=platform).json()["items"]
        if entry["action"] == "security_posture.changed"
    ][0]
    assert "residency=on (not enforced: unimplemented)" in detail
    assert "dlp=on (not enforced" not in detail

    compliance = client.get("/api/saas/compliance", headers=platform).json()
    assert compliance["rotation_interval_days"] == 90
    # This test used to assert SOC 2 Type II and HIPAA were ``certified``. The
    # platform cannot substantiate a certification, and the value could be
    # shown to a customer as evidence of an audit that never happened.
    names = {row["name"]: row["status"] for row in compliance["certifications"]}
    assert set(names.values()) == {"not_assessed"}
    assert compliance["key_rotation_implemented"] is False
    assert compliance["last_key_rotation_at"] is None


def test_certification_record_requires_its_evidence(client: TestClient) -> None:
    platform, _, _ = _platform_and_tenant(client)
    rows = client.get("/api/saas/compliance", headers=platform).json()["certifications"]
    soc2 = next(row for row in rows if row["name"] == "SOC 2 Type II")
    url = f"/api/saas/compliance/certifications/{soc2['id']}"

    # "In process" is a claim about the operator's own work, so it stands alone.
    in_process = client.patch(url, json={"status": "in_process"}, headers=platform)
    assert in_process.status_code == 200
    assert in_process.json()["effective_status"] == "in_process"

    # "Certified" is the one a customer would read as proof of an audit, so it
    # cannot be recorded without the report behind it.
    bare = client.patch(url, json={"status": "certified"}, headers=platform)
    assert bare.status_code == 400
    for field in ("auditor", "assessed_on", "evidence_url"):
        assert field in bare.json()["detail"]

    assert client.patch(url, json={"status": "audited"}, headers=platform).status_code == 400
    assert client.patch(
        url,
        json={"status": "certified", "auditor": "Acme LLP", "assessed_on": "2026-01-15", "evidence_url": "acme.example/report"},
        headers=platform,
    ).status_code == 400
    assert client.patch(
        url,
        json={"assessed_on": "2026-01-15", "expires_on": "2025-01-15"},
        headers=platform,
    ).status_code == 400

    certified = client.patch(
        url,
        json={
            "status": "certified",
            "auditor": "Acme LLP",
            "assessed_on": "2026-01-15",
            "expires_on": "2027-01-15",
            "evidence_url": "https://acme.example/soc2.pdf",
        },
        headers=platform,
    )
    assert certified.status_code == 200
    body = certified.json()
    assert body["effective_status"] == "certified" and body["expired"] is False

    # A lapsed attestation stops reading as current on its own: nobody has to
    # remember to come back and downgrade the row.
    lapsed = client.patch(
        url, json={"assessed_on": "2020-01-15", "expires_on": "2021-01-15"}, headers=platform
    ).json()
    assert lapsed["status"] == "certified"
    assert lapsed["effective_status"] == "expired" and lapsed["expired"] is True

    assert client.patch(
        "/api/saas/compliance/certifications/nope", json={"status": "in_process"}, headers=platform
    ).status_code == 404

    audit = client.get("/api/saas/audit", headers=platform).json()["items"]
    entry = next(row for row in audit if row["action"] == "certification.updated")
    assert "SOC 2 Type II" in entry["detail"]


def test_certification_update_is_platform_only(client: TestClient) -> None:
    platform, tenant, _ = _platform_and_tenant(client)
    rows = client.get("/api/saas/compliance", headers=platform).json()["certifications"]
    url = f"/api/saas/compliance/certifications/{rows[0]['id']}"
    assert client.patch(url, json={"status": "in_process"}, headers=tenant).status_code in (401, 403)


# --- Logs ------------------------------------------------------------------


def _seed_logs(org_id: str) -> None:
    session, generator = _db()
    session.add_all(
        [
            SystemLog(
                organization_id=org_id,
                level="info",
                source="api",
                message="POST /v1/envelopes 201 — envelope created",
                status_code=201,
                latency_ms=88,
                request_id="req_8f2c41ab",
                payload={"envelope": {"fields": 9}},
            ),
            SystemLog(
                organization_id=org_id,
                level="error",
                source="webhook",
                message="invoice.payment_failed delivery failed",
                status_code=502,
                occurred_at=now_utc() - timedelta(days=2),
            ),
            SystemLog(
                organization_id=None,
                level="warn",
                source="admin",
                message="platform-only maintenance window",
            ),
        ]
    )
    session.commit()
    generator.close()


def test_tenant_logs_are_scoped_and_filterable(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)
    _seed_logs(org_id)

    page = client.get("/api/logs", headers=tenant).json()
    assert page["total"] == 2
    assert page["sources"] == ["api", "webhook", "auth", "billing", "signing", "admin"]
    assert page["levels"] == ["info", "warn", "error"]
    # The payload the drawer expands is returned as structured JSON.
    api_row = next(row for row in page["items"] if row["source"] == "api")
    assert api_row["payload"] == {"envelope": {"fields": 9}}
    assert api_row["status_code"] == 201 and api_row["latency_ms"] == 88
    # Platform-only rows never reach a tenant.
    assert all("maintenance" not in row["message"] for row in page["items"])

    assert client.get("/api/logs?level=error", headers=tenant).json()["total"] == 1
    assert client.get("/api/logs?source=api", headers=tenant).json()["total"] == 1
    assert client.get("/api/logs?q=envelope", headers=tenant).json()["total"] == 1
    assert client.get("/api/logs?since_days=1", headers=tenant).json()["total"] == 1

    # A second tenant sees none of them.
    other = _register(client, org="Vertex", email="sofia@vertex.dev")
    assert client.get("/api/logs", headers=other).json()["total"] == 0

    platform_page = client.get("/api/saas/logs", headers=platform).json()
    # The middleware also persists the mutating requests this test itself made
    # (registrations, promotions), so assert on the seeded rows rather than a
    # total that grows with the fixture.
    assert platform_page["total"] >= 3
    seeded = {row["message"] for row in platform_page["items"]}
    assert "platform-only maintenance window" in seeded
    assert "invoice.payment_failed delivery failed" in seeded
    assert any(row["organization_name"] == "Acme Realty" for row in platform_page["items"])
    assert client.get(f"/api/saas/logs?organization_id={org_id}", headers=platform).json()["total"] == 2

    log_id = next(
        row["id"] for row in platform_page["items"] if row["message"] == "platform-only maintenance window"
    )
    detail = client.get(f"/api/saas/logs/{log_id}", headers=platform)
    assert detail.status_code == 200
    assert detail.json()["id"] == log_id
    assert client.get("/api/saas/logs/ghost", headers=platform).status_code == 404
    # And the detail drawer is platform-only.
    assert client.get(f"/api/saas/logs/{log_id}", headers=tenant).status_code == 403


# --- Support tickets -------------------------------------------------------


def _ticket(client: TestClient, headers: dict[str, str], **kwargs) -> dict:
    payload = {"subject": "Signer cannot open link", "body": "Ada reports a 410."}
    payload.update(kwargs)
    response = client.post("/api/support/tickets", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_internal_notes_never_reach_a_tenant(client: TestClient) -> None:
    platform, tenant, _ = _platform_and_tenant(client)
    ticket = _ticket(client, tenant)

    # A tenant cannot write one either.
    refused = client.post(
        f"/api/support/tickets/{ticket['id']}/reply",
        json={"body": "secret", "internal": True},
        headers=tenant,
    )
    assert refused.status_code == 403

    noted = client.post(
        f"/api/support/tickets/{ticket['id']}/reply",
        json={"body": "Escalating to signing team, customer at risk.", "internal": True},
        headers=platform,
    )
    assert noted.status_code == 200
    assert len(noted.json()["messages"]) == 2
    assert noted.json()["messages"][-1]["is_internal"] is True
    # An internal note does not move the thread.
    assert noted.json()["status"] == "open"

    tenant_view = client.get(f"/api/support/tickets/{ticket['id']}", headers=tenant).json()
    assert len(tenant_view["messages"]) == 1
    assert tenant_view["message_count"] == 1
    assert all(message["is_internal"] is False for message in tenant_view["messages"])
    assert "Escalating" not in str(tenant_view)

    listed = client.get("/api/support/tickets", headers=tenant).json()
    assert listed[0]["message_count"] == 1


def test_ticket_transitions_assignment_and_sla(client: TestClient) -> None:
    platform, tenant, _ = _platform_and_tenant(client)
    document = client.post("/api/documents", json={"title": "MSA"}, headers=tenant).json()
    ticket = _ticket(
        client,
        tenant,
        priority="high",
        document_id=document["id"],
        tags=["signing", "urgent-customer"],
    )
    assert ticket["document_id"] == document["id"]
    assert ticket["document_title"] == "MSA"
    assert ticket["tags"] == ["signing", "urgent-customer"]
    assert ticket["requester_email"] == "priya@acme.io"
    assert ticket["sla_due_at"] is not None
    assert ticket["sla_label"].endswith("left")
    assert ticket["sla_breached"] is False

    # Priority, assignee and pending are triage decisions: platform only.
    assert (
        client.patch(
            f"/api/support/tickets/{ticket['id']}", json={"priority": "urgent"}, headers=tenant
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/support/tickets/{ticket['id']}",
            json={"assignee_user_id": _me(client, platform)["id"]},
            headers=tenant,
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/support/tickets/{ticket['id']}", json={"status": "pending"}, headers=tenant
        ).status_code
        == 403
    )

    triaged = client.patch(
        f"/api/support/tickets/{ticket['id']}",
        json={
            "priority": "urgent",
            "assignee_user_id": _me(client, platform)["id"],
            "tags": ["signing"],
            "status": "pending",
        },
        headers=platform,
    )
    assert triaged.status_code == 200, triaged.text
    body = triaged.json()
    assert body["priority"] == "urgent"
    assert body["status"] == "pending"
    assert body["assignee_name"] == "Jordan Mehta"
    assert body["tags"] == ["signing"]
    # The urgent SLA is one hour from when the ticket was raised.
    assert body["sla_label"].startswith("59m") or body["sla_label"].startswith("1h")

    # An assignee must be a platform agent.
    assert (
        client.patch(
            f"/api/support/tickets/{ticket['id']}",
            json={"assignee_user_id": _me(client, tenant)["id"]},
            headers=platform,
        ).status_code
        == 400
    )
    assert (
        client.patch(
            f"/api/support/tickets/{ticket['id']}", json={"status": "unheard-of"}, headers=platform
        ).status_code
        == 400
    )

    escalated = client.post(f"/api/support/tickets/{ticket['id']}/escalate", headers=tenant)
    assert escalated.status_code == 200
    assert escalated.json()["status"] == "escalated"
    assert escalated.json()["priority"] == "urgent"

    resolved = client.patch(
        f"/api/support/tickets/{ticket['id']}", json={"status": "resolved"}, headers=platform
    ).json()
    assert resolved["resolved_at"] is not None
    assert resolved["sla_label"] in {"Met", "Breached"}
    assert (
        client.post(f"/api/support/tickets/{ticket['id']}/escalate", headers=platform).status_code == 409
    )

    # A tenant reply reopens the thread.
    reopened = client.post(
        f"/api/support/tickets/{ticket['id']}/reply", json={"body": "Still broken."}, headers=tenant
    ).json()
    assert reopened["status"] == "open"
    assert reopened["resolved_at"] is None


def test_ticket_filters_counts_and_stats(client: TestClient) -> None:
    platform, tenant, org_id = _platform_and_tenant(client)
    first = _ticket(client, tenant, subject="Webhook retries")
    second = _ticket(client, tenant, subject="Billing question", priority="low")
    client.post(f"/api/support/tickets/{second['id']}/escalate", headers=tenant)
    client.patch(f"/api/support/tickets/{first['id']}", json={"status": "resolved"}, headers=platform)

    page = client.get("/api/support/tickets/page", headers=tenant).json()
    assert page["total"] == 2
    assert page["counts"] == {"all": 2, "open": 0, "pending": 0, "escalated": 1, "resolved": 1}
    assert client.get("/api/support/tickets/page?status=escalated", headers=tenant).json()["total"] == 1
    assert client.get("/api/support/tickets/page?status=open", headers=tenant).json()["total"] == 1
    assert client.get("/api/support/tickets?q=billing", headers=tenant).json()[0]["id"] == second["id"]
    assert client.get("/api/support/tickets?priority=urgent", headers=tenant).json()[0]["id"] == second["id"]

    stats = client.get("/api/support/stats", headers=tenant).json()
    assert stats["open_count"] == 1
    assert stats["escalated_count"] == 1
    assert stats["resolved_90d"] == 1
    assert stats["sla_target_minutes"] == 60

    queue_stats = client.get("/api/support/queue/stats", headers=platform).json()
    assert queue_stats["open_count"] == 1
    assert queue_stats["breaching_soon_count"] == 1  # the escalated ticket is due in an hour

    # A tenant's own list never includes another tenant's ticket.
    other = _register(client, org="Vertex", email="sofia@vertex.dev")
    _ticket(client, other, subject="Vertex only")
    assert len(client.get("/api/support/tickets", headers=tenant).json()) == 2
    assert len(client.get("/api/support/tickets?scope=all", headers=platform).json()) == 3
    assert len(client.get("/api/support/queue", headers=platform).json()) == 3


def test_agents_and_quick_replies_differ_by_caller(client: TestClient) -> None:
    platform, tenant, _ = _platform_and_tenant(client)
    agents = client.get("/api/support/agents", headers=platform).json()
    assert [agent["email"] for agent in agents] == ["ops@signforge.com"]

    tenant_replies = client.get("/api/support/quick-replies", headers=tenant).json()
    platform_replies = client.get("/api/support/quick-replies", headers=platform).json()
    assert {reply["label"] for reply in tenant_replies} != {
        reply["label"] for reply in platform_replies
    }
    assert all({"label", "body"} <= set(reply) for reply in tenant_replies + platform_replies)


def test_health_has_one_derivation_shared_by_both_screens(client: TestClient) -> None:
    """GET /api/saas/health and the overview tile came from two independent
    derivations, which is why they disagreed. They now share one."""
    platform, _tenant, _org_id = _platform_and_tenant(client)

    components = client.get("/api/saas/health", headers=platform).json()
    overview = client.get("/api/saas/overview", headers=platform).json()

    assert [(row["component"], row["detail"], row["tone"]) for row in components] == [
        (row["component"], row["detail"], row["tone"]) for row in overview["health"]
    ]
    assert {row["component"] for row in components} == {
        "API",
        "Signing",
        "Tenants",
        "Webhook delivery",
        "Payment provider",
        "Collections",
    }
    assert all(row["tone"] in {"good", "warn", "bad"} for row in components)


def test_posture_detail_column_holds_the_shipped_copy() -> None:
    """The seeded detail strings were longer than the varchar(255) they were
    stored in, so on Postgres ensure_security_posture raised and rolled the
    whole seed back — SQLite (which ignores the cap) hid it from these tests,
    and the console showed "Security posture unavailable"."""
    from app.models.platform_setting import SecurityPosture
    from app.services.platform_service import SECURITY_POSTURE_DEFAULTS

    column_length = SecurityPosture.__table__.c.detail.type.length
    longest = max(len(spec["detail"]) for spec in SECURITY_POSTURE_DEFAULTS)
    assert column_length is None or column_length >= longest
