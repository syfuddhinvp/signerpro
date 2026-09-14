"""IP allowlist enforcement on the platform admin console (ipAllow).

An empty list, or a disabled posture row, must never lock every admin out --
those two "off" states are asserted alongside the two "on" states so a future
change can't silently invert the safety default.
"""

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.core.security import hash_password
from app.main import app
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


def _platform_admin(client: TestClient) -> dict[str, str]:
    headers = _register(client, org="SignerPro", email="ops@signforge.com", name="Jordan Mehta")
    _promote(client, headers)
    return headers


def _client_from(host: str) -> TestClient:
    """A TestClient hitting the same app, but presenting a chosen peer IP."""
    return TestClient(app, client=(host, 51000))


def test_empty_allowlist_never_locks_everyone_out(client: TestClient) -> None:
    admin = _platform_admin(client)
    assert client.patch("/api/saas/security-posture", json={"ipAllow": True}, headers=admin).status_code == 200

    # No CIDR configured: any address, including one that looks nothing like
    # a private admin network, must still be let through.
    outsider = _client_from("203.0.113.9")
    assert outsider.get("/api/saas/security-posture", headers=admin).status_code == 200


def test_disabled_posture_does_not_enforce(client: TestClient) -> None:
    admin = _platform_admin(client)
    assert (
        client.post("/api/saas/ip-allowlist", json={"cidr": "10.0.0.0/24"}, headers=admin).status_code
        == 201
    )
    # ipAllow is left disabled (the default): an out-of-range caller still passes.
    outsider = _client_from("203.0.113.9")
    assert outsider.get("/api/saas/security-posture", headers=admin).status_code == 200


def test_in_range_caller_is_allowed(client: TestClient) -> None:
    admin = _platform_admin(client)
    client.post("/api/saas/ip-allowlist", json={"cidr": "10.0.0.0/24"}, headers=admin)
    client.patch("/api/saas/security-posture", json={"ipAllow": True}, headers=admin)

    insider = _client_from("10.0.0.42")
    assert insider.get("/api/saas/security-posture", headers=admin).status_code == 200


def test_out_of_range_caller_is_rejected(client: TestClient) -> None:
    admin = _platform_admin(client)
    client.post("/api/saas/ip-allowlist", json={"cidr": "10.0.0.0/24"}, headers=admin)
    client.patch("/api/saas/security-posture", json={"ipAllow": True}, headers=admin)

    outsider = _client_from("203.0.113.9")
    response = outsider.get("/api/saas/security-posture", headers=admin)
    assert response.status_code == 403


def test_ipv6_ranges_are_enforced(client: TestClient) -> None:
    admin = _platform_admin(client)
    client.post("/api/saas/ip-allowlist", json={"cidr": "2001:db8::/32"}, headers=admin)
    client.patch("/api/saas/security-posture", json={"ipAllow": True}, headers=admin)

    insider = _client_from("2001:db8::1")
    assert insider.get("/api/saas/security-posture", headers=admin).status_code == 200

    outsider = _client_from("2001:dead::1")
    assert outsider.get("/api/saas/security-posture", headers=admin).status_code == 403


def test_ip_allowlist_crud_round_trip(client: TestClient) -> None:
    admin = _platform_admin(client)
    created = client.post(
        "/api/saas/ip-allowlist", json={"cidr": "192.168.1.0/24", "label": "office"}, headers=admin
    )
    assert created.status_code == 201, created.text
    entry_id = created.json()["id"]

    listed = client.get("/api/saas/ip-allowlist", headers=admin)
    assert listed.status_code == 200
    assert any(row["id"] == entry_id for row in listed.json())

    # Duplicate and invalid CIDRs are rejected up front, not silently ignored.
    assert (
        client.post("/api/saas/ip-allowlist", json={"cidr": "192.168.1.0/24"}, headers=admin).status_code
        == 400
    )
    assert (
        client.post("/api/saas/ip-allowlist", json={"cidr": "not-a-cidr"}, headers=admin).status_code == 400
    )

    assert client.delete(f"/api/saas/ip-allowlist/{entry_id}", headers=admin).status_code == 204
    listed_after = client.get("/api/saas/ip-allowlist", headers=admin).json()
    assert all(row["id"] != entry_id for row in listed_after)


def test_ip_allowlist_endpoints_are_platform_admin_only(client: TestClient) -> None:
    admin = _platform_admin(client)
    tenant = _register(client, org="Acme Realty", email="priya@acme.io", name="Priya Rao")

    assert client.get("/api/saas/ip-allowlist", headers=tenant).status_code == 403
    assert (
        client.post("/api/saas/ip-allowlist", json={"cidr": "10.0.0.0/24"}, headers=tenant).status_code
        == 403
    )
