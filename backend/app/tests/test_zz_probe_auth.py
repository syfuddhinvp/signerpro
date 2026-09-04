"""THROWAWAY probe suite - AUTH domain. Delete after the run."""
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from app.core.ratelimit import reset_rate_limits


def reg(client, *, org, email, pw="strong-password", name="Someone"):
    r = client.post("/api/auth/register", json={
        "organization_name": org, "name": name, "email": email, "password": pw})
    assert r.status_code == 201, r.text
    body = r.json()
    return body, {"Authorization": f"Bearer {body['access_token']}"}


@pytest.fixture()
def two_orgs(client):
    a, ha = reg(client, org="Org A", email="a@example.com")
    b, hb = reg(client, org="Org B", email="b@example.com")
    return a, ha, b, hb


def _db():
    from app.core.database import get_db
    from app.main import app
    gen = app.dependency_overrides[get_db]()
    return next(gen), gen


# --- 1. cross-org -----------------------------------------------------------

def test_probe_cross_org_api_key_read(client, two_orgs):
    a, ha, b, hb = two_orgs
    from app.services.entitlement_service import entitlement_service
    # bypass entitlement by creating the key directly in org A
    s, gen = _db()
    from app.models.user import User
    from app.services.api_key_service import api_key_service
    ua = s.query(User).filter(User.email == "a@example.com").one()
    key, secret = api_key_service.create(s, user=ua, label="k", mode="test", scopes=["documents:read"])
    kid = key.id
    gen.close()
    r = client.get(f"/api/api-keys/{kid}", headers=hb)
    assert r.status_code == 404, f"LEAK: org B read org A key: {r.status_code} {r.text}"


def test_probe_cross_org_team_read(client, two_orgs):
    a, ha, b, hb = two_orgs
    t = client.post("/api/teams", json={"name": "A team"}, headers=ha)
    assert t.status_code == 201, t.text
    tid = t.json()["id"]
    r = client.get(f"/api/teams/{tid}", headers=hb)
    assert r.status_code == 404, f"LEAK: {r.status_code} {r.text}"
    r2 = client.patch(f"/api/teams/{tid}", json={"name": "pwned"}, headers=hb)
    assert r2.status_code == 404, f"LEAK write: {r2.status_code} {r2.text}"
    r3 = client.delete(f"/api/teams/{tid}", headers=hb)
    assert r3.status_code == 404, f"LEAK delete: {r3.status_code} {r3.text}"


def test_probe_cross_org_member_role_change(client, two_orgs):
    a, ha, b, hb = two_orgs
    victim = a["user"]["id"]
    r = client.patch(f"/api/organizations/me/members/{victim}/role",
                     json={"role": "sender"}, headers=hb)
    assert r.status_code == 404, f"ESCALATION: {r.status_code} {r.text}"


def test_probe_cross_org_invitation_revoke(client, two_orgs):
    a, ha, b, hb = two_orgs
    inv = client.post("/api/invitations/", json={"email": "new@example.com"}, headers=ha)
    assert inv.status_code == 201, inv.text
    iid = inv.json()["invitation"]["id"]
    r = client.delete(f"/api/invitations/{iid}", headers=hb)
    assert r.status_code == 404, f"LEAK: {r.status_code} {r.text}"
    lst = client.get("/api/invitations/", headers=hb).json()
    assert all(i["id"] != iid for i in lst), "LEAK: org B lists org A invitations"


def test_probe_cross_org_team_member_add_foreign_user(client, two_orgs):
    a, ha, b, hb = two_orgs
    t = client.post("/api/teams", json={"name": "B team"}, headers=hb).json()
    r = client.post(f"/api/teams/{t['id']}/members",
                    json={"user_id": a["user"]["id"], "role": "member"}, headers=hb)
    assert r.status_code == 404, f"LEAK: added foreign user to team: {r.status_code} {r.text}"


def test_probe_cross_org_document_audit_log(client, two_orgs, pdf_bytes):
    a, ha, b, hb = two_orgs
    up = client.post("/api/documents", json={"title": "A doc"}, headers=ha)
    assert up.status_code in (200, 201), up.text
    did = up.json()["id"]
    for path in (f"/api/documents/{did}", f"/api/documents/{did}/audit-logs",
                 f"/api/documents/{did}/certificate/summary"):
        r = client.get(path, headers=hb)
        assert r.status_code == 404, f"LEAK {path}: {r.status_code} {r.text[:200]}"


# --- 2. privilege escalation ------------------------------------------------

def member_headers(client, ha):
    inv = client.post("/api/invitations/", json={"email": "member@example.com", "role": "sender"}, headers=ha)
    assert inv.status_code == 201, inv.text
    token = inv.json()["invite_link"].rsplit("/", 1)[-1]
    acc = client.post("/api/invitations/accept",
                      json={"token": token, "name": "Member", "password": "strong-password"})
    assert acc.status_code == 201, acc.text
    return acc.json(), {"Authorization": f"Bearer {acc.json()['access_token']}"}


def test_probe_member_cannot_use_admin_routes(client, two_orgs):
    a, ha, b, hb = two_orgs
    m, hm = member_headers(client, ha)
    checks = [
        ("get", "/api/organizations/me/members", None),
        ("patch", "/api/organizations/me", {"name": "hacked"}),
        ("post", "/api/invitations/", {"email": "x@example.com", "role": "admin"}),
        ("get", "/api/invitations/", None),
        ("post", "/api/teams", {"name": "t"}),
    ]
    fails = []
    for method, path, body in checks:
        r = getattr(client, method)(path, headers=hm, **({"json": body} if body else {}))
        if r.status_code != 403:
            fails.append(f"{method.upper()} {path} -> {r.status_code} {r.text[:120]}")
    assert not fails, "NON-ADMIN ALLOWED:\n" + "\n".join(fails)


def test_probe_self_promote_via_profile(client, two_orgs):
    a, ha, b, hb = two_orgs
    m, hm = member_headers(client, ha)
    r = client.patch("/api/me", json={"name": "Member2", "role": "admin",
                                      "is_platform_admin": True,
                                      "organization_id": b["user"]["organization_id"]}, headers=hm)
    assert r.status_code == 200, r.text
    me = client.get("/api/auth/me", headers=hm).json()
    assert me["role"] == "sender", f"ESCALATION: role now {me['role']}"
    assert me["is_platform_admin"] is False, "ESCALATION: platform admin granted"
    assert me["organization_id"] == a["user"]["organization_id"], "ESCALATION: org switched"


def test_probe_org_admin_cannot_reach_platform(client, two_orgs):
    a, ha, b, hb = two_orgs
    fails = []
    for path in ("/api/saas/tenants", "/api/saas/overview", "/api/saas/directory",
                 "/api/saas/metrics", "/api/saas/organizations", "/api/saas/users",
                 "/api/saas/logs", "/api/saas/audit", "/api/saas/roles"):
        r = client.get(path, headers=ha)
        if r.status_code != 403:
            fails.append(f"GET {path} -> {r.status_code} {r.text[:120]}")
    assert not fails, "TENANT ADMIN REACHED PLATFORM:\n" + "\n".join(fails)


# --- 3. tokens --------------------------------------------------------------

def test_probe_expired_token_rejected(client, two_orgs):
    a, ha, b, hb = two_orgs
    from app.core.config import get_settings
    claims = jwt.decode(a["access_token"], get_settings().jwt_secret, algorithms=["HS256"])
    claims["exp"] = datetime.now(timezone.utc) - timedelta(minutes=1)
    tok = jwt.encode(claims, get_settings().jwt_secret, algorithm="HS256")
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401, f"EXPIRED TOKEN ACCEPTED: {r.status_code}"


def test_probe_alg_none_and_wrong_secret(client, two_orgs):
    a, ha, b, hb = two_orgs
    from app.core.config import get_settings
    claims = jwt.decode(a["access_token"], get_settings().jwt_secret, algorithms=["HS256"])
    claims["exp"] = int(time.time()) + 3600
    none_tok = jwt.encode(claims, key="", algorithm="none")
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {none_tok}"})
    assert r.status_code == 401, f"alg=none ACCEPTED: {r.text}"
    bad = jwt.encode(claims, "totally-wrong-secret-aaaaaaaaaaaaaaaaaaa", algorithm="HS256")
    r2 = client.get("/api/auth/me", headers={"Authorization": f"Bearer {bad}"})
    assert r2.status_code == 401, f"forged sig ACCEPTED: {r2.text}"


def test_probe_token_after_logout_dead(client, two_orgs):
    a, ha, b, hb = two_orgs
    assert client.post("/api/auth/logout", headers=ha).status_code == 204
    r = client.get("/api/auth/me", headers=ha)
    assert r.status_code == 401, f"TOKEN LIVES AFTER LOGOUT: {r.status_code}"


def test_probe_refresh_replay(client, two_orgs):
    a, ha, b, hb = two_orgs
    rt = a["refresh_token"]
    first = client.post("/api/auth/refresh", json={"refresh_token": rt})
    assert first.status_code == 200, first.text
    # replay the spent token beyond the grace window
    from app.models.user_session import UserSession
    from app.core.security import hash_opaque_token
    s, gen = _db()
    row = s.query(UserSession).filter(UserSession.refresh_token_hash == hash_opaque_token(rt)).one()
    row.rotated_at = datetime.now(timezone.utc) - timedelta(hours=1)
    row.revoked_at = row.rotated_at
    s.commit(); gen.close()
    replay = client.post("/api/auth/refresh", json={"refresh_token": rt})
    assert replay.status_code == 401, f"REFRESH REPLAY ACCEPTED: {replay.status_code}"
    # and the chain must be dead
    after = client.post("/api/auth/refresh", json={"refresh_token": first.json()["refresh_token"]})
    assert after.status_code == 401, f"CHAIN NOT KILLED after replay: {after.status_code}"


def test_probe_password_change_kills_other_sessions(client, two_orgs):
    a, ha, b, hb = two_orgs
    other = client.post("/api/auth/login", json={"email": "a@example.com", "password": "strong-password"})
    assert other.status_code == 200, other.text
    ho = {"Authorization": f"Bearer {other.json()['access_token']}"}
    ch = client.patch("/api/auth/password",
                      json={"current_password": "strong-password", "password": "new-strong-password"},
                      headers=ha)
    assert ch.status_code == 204, ch.text
    r = client.get("/api/auth/me", headers=ho)
    assert r.status_code == 401, f"STOLEN SESSION SURVIVES PASSWORD CHANGE: {r.status_code}"


def test_probe_deactivated_user_token_dead(client, two_orgs):
    a, ha, b, hb = two_orgs
    from app.models.user import User
    s, gen = _db()
    u = s.query(User).filter(User.email == "a@example.com").one()
    u.status = "deprovisioned"; s.commit(); gen.close()
    r = client.get("/api/auth/me", headers=ha)
    assert r.status_code == 403, f"DEACTIVATED USER STILL AUTHENTICATED: {r.status_code}"


# --- 4. API keys ------------------------------------------------------------

def enable_api(client, headers):
    """Put the org on a plan that includes api_access."""
    from app.tests.conftest import upgrade_plan
    upgrade_plan(client, headers, "business")
    return "business"


def _make_key(client, headers, email, scopes=("documents:read",)):
    s, gen = _db()
    from app.models.user import User
    from app.services.api_key_service import api_key_service
    u = s.query(User).filter(User.email == email).one()
    key, secret = api_key_service.create(s, user=u, label="k", mode="test", scopes=list(scopes))
    kid = key.id
    gen.close()
    return kid, secret


def test_probe_revoked_api_key_dead(client, two_orgs):
    a, ha, b, hb = two_orgs
    enable_api(client, ha)
    kid, secret = _make_key(client, ha, "a@example.com")
    ok = client.get("/api/v1/documents", headers={"X-API-Key": secret})
    assert ok.status_code == 200, f"baseline failed: {ok.status_code} {ok.text[:200]}"
    rv = client.post(f"/api/api-keys/{kid}/revoke", headers=ha)
    assert rv.status_code == 200, rv.text
    r = client.get("/api/v1/documents", headers={"X-API-Key": secret})
    assert r.status_code == 401, f"REVOKED KEY STILL WORKS: {r.status_code} {r.text[:200]}"


def test_probe_rolled_key_old_secret_dead(client, two_orgs):
    a, ha, b, hb = two_orgs
    enable_api(client, ha)
    kid, secret = _make_key(client, ha, "a@example.com")
    s, gen = _db()
    from app.models.api_key import ApiKey
    from app.services.api_key_service import api_key_service
    k = s.get(ApiKey, kid)
    _, new_secret = api_key_service.roll(s, api_key=k)
    gen.close()
    r = client.get("/api/v1/documents", headers={"X-API-Key": secret})
    assert r.status_code == 401, f"OLD SECRET AFTER ROLL STILL WORKS: {r.status_code}"


def test_probe_roll_does_not_unrevoke(client, two_orgs):
    a, ha, b, hb = two_orgs
    kid, secret = _make_key(client, ha, "a@example.com")
    assert client.post(f"/api/api-keys/{kid}/revoke", headers=ha).status_code == 200
    s, gen = _db()
    from app.models.api_key import ApiKey
    from app.services.api_key_service import api_key_service
    k = s.get(ApiKey, kid)
    k2, new_secret = api_key_service.roll(s, api_key=k)
    revoked_after = k2.revoked_at
    gen.close()
    assert revoked_after is not None, "ROLLING A REVOKED KEY SILENTLY REACTIVATES IT"


def test_probe_api_key_scope_enforced(client, two_orgs):
    """A documents:read-only key must not reach users:read or audit:read."""
    a, ha, b, hb = two_orgs
    enable_api(client, ha)
    kid, secret = _make_key(client, ha, "a@example.com", scopes=["documents:read"])
    fails = []
    for path in ("/api/v1/users",):
        r = client.get(path, headers={"X-API-Key": secret})
        if r.status_code != 403:
            fails.append(f"GET {path} -> {r.status_code} {r.text[:150]}")
    assert not fails, "SCOPE NOT ENFORCED:\n" + "\n".join(fails)


def test_probe_api_key_cannot_reach_platform_or_admin(client, two_orgs):
    a, ha, b, hb = two_orgs
    enable_api(client, ha)
    kid, secret = _make_key(client, ha, "a@example.com", scopes=[s for s, _ in __import__("app.models.api_key", fromlist=["x"]).API_KEY_SCOPES])
    fails = []
    for path in ("/api/saas/tenants", "/api/saas/metrics", "/api/organizations/me/members",
                 "/api/api-keys", "/api/invitations/"):
        r = client.get(path, headers={"X-API-Key": secret})
        if r.status_code not in (401, 403, 404):
            fails.append(f"GET {path} -> {r.status_code} {r.text[:150]}")
    assert not fails, "API KEY REACHED PRIVILEGED SURFACE:\n" + "\n".join(fails)


def test_probe_api_key_cross_org_documents(client, two_orgs, pdf_bytes):
    a, ha, b, hb = two_orgs
    enable_api(client, ha); enable_api(client, hb)
    up = client.post("/api/documents", json={"title": "A secret doc"}, headers=ha)
    assert up.status_code == 201, up.text
    did = up.json()["id"]
    kid, secret = _make_key(client, hb, "b@example.com")
    lst = client.get("/api/v1/documents", headers={"X-API-Key": secret})
    assert lst.status_code == 200, lst.text
    body = lst.text
    assert did not in body, f"LEAK: org B key sees org A document: {body[:400]}"
    one = client.get(f"/api/v1/documents/{did}", headers={"X-API-Key": secret})
    assert one.status_code == 404, f"LEAK: {one.status_code} {one.text[:200]}"


# --- 5. rate limiting -------------------------------------------------------

def test_probe_login_ratelimit_xff_bypass(client, two_orgs):
    reset_rate_limits()
    codes = []
    for i in range(40):
        r = client.post("/api/auth/login",
                        json={"email": "a@example.com", "password": "wrong-password"},
                        headers={"X-Forwarded-For": f"10.0.{i//256}.{i%256}"})
        codes.append(r.status_code)
    assert 429 in codes, f"RATE LIMIT BYPASSED by rotating X-Forwarded-For: codes={sorted(set(codes))}"


def test_probe_login_ratelimit_same_ip(client, two_orgs):
    reset_rate_limits()
    codes = [client.post("/api/auth/login",
                         json={"email": "a@example.com", "password": "wrong-password"}).status_code
             for _ in range(30)]
    assert 429 in codes, f"NO RATE LIMIT ON LOGIN: {sorted(set(codes))}"


def test_probe_forgot_password_ratelimit_xff_bypass(client, two_orgs):
    reset_rate_limits()
    codes = []
    for i in range(20):
        r = client.post("/api/auth/password/forgot", json={"email": f"victim{i}@example.com"},
                        headers={"X-Forwarded-For": f"10.1.{i}.5"})
        codes.append(r.status_code)
    assert 429 in codes, f"FORGOT-PASSWORD FLOOD UNTHROTTLED across IPs: {sorted(set(codes))}"


# --- 6. audit ---------------------------------------------------------------

def _audit_rows(email="a@example.com"):
    s, gen = _db()
    from app.models.audit_log import AuditLog
    rows = [(r.event_type, r.description) for r in s.query(AuditLog).all()]
    gen.close()
    return rows


def test_probe_audit_covers_sensitive_auth_actions(client, two_orgs):
    a, ha, b, hb = two_orgs
    client.patch("/api/auth/password", json={"current_password": "strong-password",
                                             "password": "new-strong-password"}, headers=ha)
    client.post("/api/auth/login", json={"email": "a@example.com", "password": "wrong-password"})
    m, hm = member_headers(client, ha)
    client.patch(f"/api/organizations/me/members/{m['user']['id']}/role",
                 json={"role": "admin"}, headers=ha)
    kid, secret = _make_key(client, ha, "a@example.com")
    client.post(f"/api/api-keys/{kid}/revoke", headers=ha)
    rows = _audit_rows()
    types = {t for t, _ in rows}
    missing = [e for e in ("password_changed", "login_failed", "member_role_changed",
                           "api_key_created", "api_key_revoked", "invitation_created",
                           "invitation_accepted")
               if e not in types]
    # Fall back: is any of it recoverable from the system_logs request trail?
    logs = client.get("/api/logs?source=all&limit=200", headers=ha)
    trail = logs.text if logs.status_code == 200 else f"<{logs.status_code}>"
    assert not missing, (
        f"NO SEMANTIC AUDIT ENTRY FOR: {missing}; audit_logs types = {sorted(types)}.\n"
        f"/api/logs trail status={logs.status_code}; contains password path: "
        f"{'/api/auth/password' in trail}; contains role path: {'role' in trail}")


def test_probe_account_audit_feed_is_scoped(client, two_orgs):
    a, ha, b, hb = two_orgs
    ra = client.get("/api/me/audit-trail", headers=ha)
    rb = client.get("/api/me/audit-trail", headers=hb)
    assert ra.status_code == 200 and rb.status_code == 200, (ra.text, rb.text)
    ids_a = {e.get("id") for e in ra.json().get("entries", [])}
    ids_b = {e.get("id") for e in rb.json().get("entries", [])}
    assert not (ids_a & ids_b), f"AUDIT FEED LEAKS ACROSS ORGS: {ids_a & ids_b}"


def test_probe_system_logs_tenant_scoped(client, two_orgs):
    a, ha, b, hb = two_orgs
    client.get("/api/auth/me", headers=ha)
    ra = client.get("/api/logs", headers=ha)
    rb = client.get("/api/logs", headers=hb)
    assert ra.status_code == 200 and rb.status_code == 200, (ra.text[:200], rb.text[:200])
    ids_a = {r["id"] for r in ra.json()["items"]}
    ids_b = {r["id"] for r in rb.json()["items"]}
    assert not (ids_a & ids_b), f"SYSTEM LOG LEAKS ACROSS ORGS: {list(ids_a & ids_b)[:5]}"


def test_probe_suspended_org_blocks_access(client, two_orgs):
    a, ha, b, hb = two_orgs
    from app.models.organization import Organization
    from datetime import datetime, timezone
    s, gen = _db()
    org = s.get(Organization, a["user"]["organization_id"])
    org.suspended_at = datetime.now(timezone.utc)
    s.commit(); gen.close()
    r = client.get("/api/auth/me", headers=ha)
    assert r.status_code == 403, f"SUSPENDED ORG STILL SERVED: {r.status_code}"


def test_probe_mfa_challenge_token_is_not_a_bearer(client, two_orgs):
    from app.core.security import create_scoped_token
    a, ha, b, hb = two_orgs
    tok = create_scoped_token(a["user"]["id"], purpose="mfa", expires_in_seconds=600)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401, f"MFA CHALLENGE TOKEN ACCEPTED AS BEARER: {r.status_code}"


def test_probe_revoke_foreign_session(client, two_orgs):
    a, ha, b, hb = two_orgs
    sess_b = client.get("/api/auth/sessions", headers=hb).json()
    sid = sess_b[0]["id"]
    r = client.delete(f"/api/auth/sessions/{sid}", headers=ha)
    assert r.status_code in (403, 404), f"CROSS-USER SESSION REVOKE: {r.status_code}"
    assert client.get("/api/auth/me", headers=hb).status_code == 200, "org B session was killed by org A"


def test_probe_invitation_token_single_use(client, two_orgs):
    a, ha, b, hb = two_orgs
    inv = client.post("/api/invitations/", json={"email": "dup@example.com"}, headers=ha).json()
    token = inv["invite_link"].rsplit("/", 1)[-1]
    first = client.post("/api/invitations/accept",
                        json={"token": token, "name": "Dup", "password": "strong-password"})
    assert first.status_code == 201, first.text
    second = client.post("/api/invitations/accept",
                         json={"token": token, "name": "Dup2", "password": "strong-password"})
    assert second.status_code in (409, 410), f"INVITATION REPLAYED: {second.status_code} {second.text[:150]}"


def test_probe_expired_invitation_rejected(client, two_orgs):
    from datetime import datetime, timedelta, timezone
    a, ha, b, hb = two_orgs
    inv = client.post("/api/invitations/", json={"email": "old@example.com"}, headers=ha).json()
    token = inv["invite_link"].rsplit("/", 1)[-1]
    from app.models.invitation import Invitation
    s, gen = _db()
    row = s.get(Invitation, inv["invitation"]["id"])
    row.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    s.commit(); gen.close()
    r = client.post("/api/invitations/accept",
                    json={"token": token, "name": "Old", "password": "strong-password"})
    assert r.status_code == 410, f"EXPIRED INVITATION ACCEPTED: {r.status_code}"


def test_probe_invitation_token_has_no_revocable_session(client, two_orgs):
    """A token minted by invitation acceptance carries no sid, so 'sign out
    all devices' and admin-forced logout cannot revoke it."""
    a, ha, b, hb = two_orgs
    m, hm = member_headers(client, ha)
    assert client.get("/api/auth/me", headers=hm).status_code == 200
    # member revokes every other session, then we check the invite token still lives
    client.delete("/api/auth/sessions", headers=hm)
    sessions = client.get("/api/auth/sessions", headers=hm)
    import jwt as _jwt
    from app.core.config import get_settings
    claims = _jwt.decode(m["access_token"], get_settings().jwt_secret, algorithms=["HS256"])
    assert claims.get("sid"), (
        "INVITATION TOKEN HAS NO sid: it cannot be revoked by logout or "
        f"session revocation until it expires. claims={claims}")
