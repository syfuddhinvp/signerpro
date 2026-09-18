"""The per-tenant record page (`GET /api/saas/tenants/{id}/profile`).

Two things matter here beyond "the endpoint returns data": it is platform-only
like every other tenant surface, and it reports *this* tenant's rows only. A
record page that leaks a neighbouring tenant's envelopes or credentials is
worse than no record page, so both are asserted against a second organization
whose data is deliberately shaped to collide.
"""

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.main import app
from app.models.api_key import ApiKey
from app.models.document import Document
from app.models.invoice import Invoice, InvoiceStatus
from app.models.user import User


def _db():
    generator = app.dependency_overrides[get_db]()
    return next(generator), generator


def _register(client: TestClient, *, org: str, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/register",
        json={"organization_name": org, "name": "Owner", "email": email, "password": "strong-password"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _me(client: TestClient, headers: dict[str, str]) -> dict:
    return client.get("/api/auth/me", headers=headers).json()


def _seed(session, *, org_id: str, user_id: str, label: str) -> None:
    session.add(Document(organization_id=org_id, sender_id=user_id, title=f"{label} NDA"))
    session.add(
        ApiKey(
            organization_id=org_id,
            label=f"{label} key",
            mode="live",
            prefix="sk_live_",
            last_four="ab12",
            key_hash=f"hash-{label}",
            scopes=["documents:read"],
            created_by_user_id=user_id,
        )
    )
    session.add(
        Invoice(
            organization_id=org_id,
            number=f"INV-{label}",
            status=InvoiceStatus.open,
            total_cents=12_000,
            amount_paid_cents=5_000,
        )
    )


def test_profile_reports_one_tenants_users_documents_keys_and_money(client: TestClient) -> None:
    platform = _register(client, org="SignerPro", email="ops@signerpro.io")
    tenant = _register(client, org="Acme Realty", email="priya@acme.io")
    other = _register(client, org="Globex", email="hank@globex.io")
    org_id = _me(client, tenant)["organization_id"]
    other_org_id = _me(client, other)["organization_id"]

    session, generator = _db()
    admin = session.get(User, _me(client, platform)["id"])
    admin.is_platform_admin = True
    session.add(admin)
    _seed(session, org_id=org_id, user_id=_me(client, tenant)["id"], label="acme")
    _seed(session, org_id=other_org_id, user_id=_me(client, other)["id"], label="globex")
    session.commit()
    generator.close()

    response = client.get(f"/api/saas/tenants/{org_id}/profile", headers=platform)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["tenant"]["id"] == org_id
    assert [u["email"] for u in body["users"]] == ["priya@acme.io"]
    assert [d["title"] for d in body["recent_documents"]] == ["acme NDA"]
    assert [k["label"] for k in body["api_keys"]] == ["acme key"]
    assert [i["number"] for i in body["invoices"]] == ["INV-acme"]

    assert body["counts"]["documents"] == 1
    assert body["counts"]["active_api_keys"] == 1
    assert body["documents_by_status"] == {"draft": 1}

    # Outstanding is derived from what was invoiced and what was paid, not read
    # from a column that nothing keeps in step with either.
    assert body["invoiced_cents"] == 12_000
    assert body["invoice_paid_cents"] == 5_000
    assert body["invoice_outstanding_cents"] == 7_000

    # The secret itself is never in the payload — only the mask the console
    # renders.
    assert "hash-acme" not in response.text
    assert body["api_keys"][0]["masked"].startswith("sk_live_")


def test_profile_rejects_a_tenant_admin(client: TestClient) -> None:
    tenant = _register(client, org="Acme Realty", email="priya@acme.io")
    org_id = _me(client, tenant)["organization_id"]
    assert client.get(f"/api/saas/tenants/{org_id}/profile", headers=tenant).status_code == 403


def test_profile_404s_for_an_unknown_tenant(client: TestClient) -> None:
    platform = _register(client, org="SignerPro", email="ops@signerpro.io")
    session, generator = _db()
    admin = session.get(User, _me(client, platform)["id"])
    admin.is_platform_admin = True
    session.add(admin)
    session.commit()
    generator.close()
    assert client.get("/api/saas/tenants/nope/profile", headers=platform).status_code == 404
