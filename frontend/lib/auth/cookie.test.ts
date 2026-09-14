/**
 * `lib/auth/cookie.ts` — the session envelope, and the impersonation swap.
 *
 * Protects the bug this feature shipped with: the backend minted a perfectly
 * good impersonation token and the frontend never installed it, so clicking
 * "Impersonate" showed a banner while every request still carried the admin's
 * own bearer token. The cookie *is* the mechanism — every call reads its
 * token — so these pin (a) the token actually landing in the live slot, (b) the
 * admin's way back travelling with it, and (c) a spent session restoring the
 * admin instead of reading as a dead cookie.
 */

import { describe, it, expect } from 'vitest';
import {
  adminEnvelope,
  decodeSession,
  encodeSession,
  expireImpersonation,
  impersonationCookie,
  isImpersonating,
  type SessionUser,
} from './cookie';

const ADMIN: SessionUser = {
  id: 'usr_admin', organization_id: 'org_platform', organization_name: 'SignerPro',
  name: 'Jordan Mehta', email: 'jordan@signerpro.test', role: 'admin', is_platform_admin: true,
};

const TENANT: SessionUser = {
  id: 'usr_owner', organization_id: 'org_e2e', organization_name: 'E2E Co',
  name: 'Robin Ray', email: 'owner@e2e.test', role: 'admin', is_platform_admin: false,
};

/** An unsigned HS256-shaped JWT with the given `exp`, which is all these read. */
function tokenExpiring(secondsFromNow: number): string {
  const b64 = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const exp = Math.floor(Date.now() / 1000) + secondsFromNow;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'usr_owner', exp })}.sig`;
}

describe('the impersonation swap', () => {
  const adminCookie = encodeSession('admin.token.sig', ADMIN, {
    refreshToken: 'refresh-abc',
    remember: true,
  });
  const admin = decodeSession(adminCookie)!;

  it('puts the impersonation token in the slot the proxy actually reads', () => {
    const envelope = decodeSession(impersonationCookie('imp.token.sig', TENANT, admin))!;
    // `t` is what `/api/proxy` sends as the bearer token. If the admin's token
    // is still here, nothing has been impersonated.
    expect(envelope.t).toBe('imp.token.sig');
    expect(envelope.u.email).toBe('owner@e2e.test');
    expect(envelope.u.is_platform_admin).toBe(false);
  });

  it('parks the admin so there is a way back', () => {
    const envelope = decodeSession(impersonationCookie('imp.token.sig', TENANT, admin))!;
    expect(isImpersonating(envelope)).toBe(true);

    const restored = adminEnvelope(envelope)!;
    expect(restored.t).toBe('admin.token.sig');
    expect(restored.u.email).toBe('jordan@signerpro.test');
    expect(restored.r).toBe('refresh-abc');
    expect(restored.rm).toBe(true);
    expect(isImpersonating(restored)).toBe(false);
  });

  it('never exposes the admin refresh token to the impersonated session', () => {
    const envelope = decodeSession(impersonationCookie('imp.token.sig', TENANT, admin))!;
    // A refresh here would revoke the admin's own session (the backend rotates)
    // and hand the replacement to the tenant identity.
    expect(envelope.r).toBeUndefined();
  });

  it('keeps the cookie lifetime the admin signed in with', () => {
    const envelope = decodeSession(impersonationCookie('imp.token.sig', TENANT, admin))!;
    expect(envelope.rm).toBe(true);
  });

  it('refuses a cookie whose way back is malformed', () => {
    const forged = btoa(JSON.stringify({ t: 'imp.token.sig', u: TENANT, imp: { t: 'x' } }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Ignoring the broken stash would strand an admin inside a tenant.
    expect(decodeSession(forged)).toBeNull();
  });
});

describe('a spent impersonation session', () => {
  const admin = decodeSession(encodeSession('admin.token.sig', ADMIN, { refreshToken: 'r' }))!;

  it('hands the cookie back to the admin rather than dying', () => {
    const spent = impersonationCookie(tokenExpiring(-1), TENANT, admin);
    const restored = decodeSession(expireImpersonation(spent)!)!;
    // Without this an expiring support visit logs the admin out entirely,
    // because an impersonation token has no refresh token to rotate.
    expect(restored.t).toBe('admin.token.sig');
    expect(restored.u.is_platform_admin).toBe(true);
    expect(isImpersonating(restored)).toBe(false);
  });

  it('restores on the refresh skew, not only after the token is dead', () => {
    expect(expireImpersonation(impersonationCookie(tokenExpiring(10), TENANT, admin))).not.toBeNull();
  });

  it('leaves a live session and an ordinary session alone', () => {
    expect(expireImpersonation(impersonationCookie(tokenExpiring(600), TENANT, admin))).toBeNull();
    expect(expireImpersonation(encodeSession(tokenExpiring(-1), ADMIN))).toBeNull();
    expect(expireImpersonation(undefined)).toBeNull();
  });
});
