/**
 * Start and end a platform-admin impersonation session.
 *
 * The backend already mints a proper impersonation credential
 * (`POST /api/saas/tenants/{id}/impersonate`), but that token is only worth
 * something once it is *installed* as the session: every browser call goes
 * through `/api/proxy`, which attaches the bearer token out of the httpOnly
 * `sf_session` cookie. Client JS cannot write that cookie, which is why the
 * exchange has to happen in a route handler — calling the backend endpoint
 * from the browser mints a session nothing then acts under.
 *
 * `POST` swaps the cookie to the tenant identity, parking the admin's own
 * session inside it; `DELETE` ends the backend session and puts the admin back.
 * Under `/api/auth` (public to middleware) like the other session-writing
 * routes, so both guard themselves below.
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  SESSION_COOKIE,
  accessTokenStale,
  adminEnvelope,
  backendUrl,
  decodeSession,
  encodeEnvelope,
  sessionCookieOptions,
  impersonationCookie,
  type SessionEnvelope,
  type SessionUser,
} from '@/lib/auth/cookie';
import { AUTH_TIMEOUT_MS, clearSessionCookie, readJson } from '@/lib/auth/handlers';
import { refreshSession } from '@/lib/auth/refresh';
import { allowUnverifiedPrivilege, verifyAccessToken } from '@/lib/auth/verify';

/** Where an admin lands in the tenant, and where they come back to. */
const TENANT_LANDING = '/overview';
const PLATFORM_LANDING = '/platform';

const SCOPES = ['read', 'write'] as const;

type ImpersonationStarted = {
  id: string;
  access_token: string;
  organization_id: string;
  organization_name: string;
  impersonated_user_id: string;
  impersonated_user_email: string;
  impersonated_user_name: string;
  impersonated_user_role: string;
  justification: string;
  scopes: string[];
  expires_at: string;
};

function fail(code: string, error: string, status: number) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

/** The raw cookie, which carries the tokens `getSession` deliberately hides. */
async function readEnvelope(): Promise<SessionEnvelope | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

/**
 * Impersonation is a platform-admin power, so it is gated on a cookie whose
 * signature actually checked out — `is_platform_admin` is read from the cookie
 * body, and an unverifiable envelope must never be able to claim it.
 */
async function requireAdmin(
  envelope: SessionEnvelope | null,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  if (!envelope) {
    return { ok: false, response: fail('expired', 'Your session has expired.', 401) };
  }
  if (envelope.u.is_platform_admin !== true) {
    return { ok: false, response: fail('forbidden', 'This account is not a platform administrator.', 403) };
  }
  const outcome = await verifyAccessToken(envelope.t);
  if (outcome === 'invalid') {
    return { ok: false, response: fail('expired', 'Your session has expired.', 401) };
  }
  if (outcome === 'unverified' && !allowUnverifiedPrivilege()) {
    return {
      ok: false,
      response: fail('unverified', 'This deployment cannot verify the session cookie.', 403),
    };
  }
  return { ok: true };
}

function requestedScopes(value: unknown): string[] | null {
  if (value === undefined || value === null) return ['read'];
  if (!Array.isArray(value)) return null;
  const scopes = value.map(entry => String(entry).trim().toLowerCase()).filter(Boolean);
  if (!scopes.length) return ['read'];
  if (scopes.some(scope => !SCOPES.includes(scope as (typeof SCOPES)[number]))) return null;
  return [...new Set(scopes)];
}

export async function POST(request: Request) {
  const envelope = await readEnvelope();
  const guard = await requireAdmin(envelope);
  if (!guard.ok) return guard.response;
  const admin = envelope as SessionEnvelope;

  // Nesting would overwrite the parked admin with a tenant identity, and the
  // way back would be gone. End the current session first.
  if (admin.imp) {
    return fail('conflict', 'Already impersonating — end that session first.', 409);
  }

  const body = await readJson(request);
  const organizationId = typeof body?.organizationId === 'string' ? body.organizationId.trim() : '';
  const justification = typeof body?.justification === 'string' ? body.justification.trim() : '';
  const ttlSeconds = Number(body?.ttlSeconds ?? 900);
  const scopes = requestedScopes(body?.scopes);

  if (!organizationId) return fail('bad_request', 'A tenant is required.', 400);
  if (justification.length < 5) {
    return fail('bad_request', 'A justification of at least 5 characters is required.', 400);
  }
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) {
    return fail('bad_request', 'The session lifetime must be between 1 minute and 1 hour.', 400);
  }
  if (!scopes) return fail('bad_request', `Scopes must be drawn from: ${SCOPES.join(', ')}.`, 400);

  let upstream: Response;
  try {
    upstream = await fetch(
      `${backendUrl()}/api/saas/tenants/${encodeURIComponent(organizationId)}/impersonate`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.t}` },
        body: JSON.stringify({ justification, ttl_seconds: ttlSeconds, scopes }),
        cache: 'no-store',
        signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
      },
    );
  } catch {
    return fail('unavailable', 'The SignerPro API is unreachable.', 503);
  }

  const payload = (await upstream.json().catch(() => null)) as
    | (ImpersonationStarted & { detail?: unknown })
    | null;

  if (!upstream.ok) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : null;
    if (upstream.status === 401) return fail('expired', 'Your session has expired.', 401);
    if (upstream.status === 403) return fail('forbidden', detail ?? 'Impersonation was refused.', 403);
    if (upstream.status === 404) return fail('not_found', detail ?? 'That tenant no longer exists.', 404);
    if (upstream.status === 409) {
      return fail('conflict', detail ?? 'That tenant has no user to impersonate.', 409);
    }
    if (upstream.status === 400 || upstream.status === 422) {
      return fail('bad_request', detail ?? 'Please check the details you entered.', 400);
    }
    return fail('backend_error', detail ?? 'The SignerPro API returned an unexpected error.', 502);
  }

  if (typeof payload?.access_token !== 'string' || typeof payload.impersonated_user_id !== 'string') {
    return fail('backend_error', 'The SignerPro API returned an incomplete session.', 502);
  }

  const impersonated: SessionUser = {
    id: payload.impersonated_user_id,
    organization_id: payload.organization_id,
    organization_name: payload.organization_name,
    name: payload.impersonated_user_name || payload.impersonated_user_email,
    email: payload.impersonated_user_email,
    role: payload.impersonated_user_role || 'sender',
    // The tenant identity is never a platform admin — the backend refuses such
    // a token outright — so the /platform guard closes for the duration.
    is_platform_admin: false,
  };

  const response = NextResponse.json({
    ok: true,
    next: TENANT_LANDING,
    session: {
      id: payload.id,
      organizationName: payload.organization_name,
      email: payload.impersonated_user_email,
      scopes: payload.scopes ?? scopes,
      expiresAt: payload.expires_at,
    },
  });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: impersonationCookie(payload.access_token, impersonated, admin),
    ...sessionCookieOptions(admin.rm),
  });
  return response;
}

export async function DELETE() {
  const envelope = await readEnvelope();
  if (!envelope) return fail('expired', 'Your session has expired.', 401);
  if (!envelope.imp) return fail('conflict', 'This session is not impersonating anyone.', 409);

  let admin = adminEnvelope(envelope) as SessionEnvelope;

  /* An impersonation session may outlive the admin's own 15-minute access
     token, and `DELETE /api/saas/impersonation` needs *platform admin* — the
     impersonation token would be refused. Rotate the parked session first so
     the call is made as the admin who actually started it. */
  if (accessTokenStale(admin.t) && admin.r) {
    const refreshed = await refreshSession(admin);
    if (refreshed.ok) {
      admin = { t: refreshed.token, u: refreshed.user };
      if (refreshed.remember) admin.rm = true;
      const reread = decodeSession(refreshed.cookieValue);
      if (reread?.r) admin.r = reread.r;
    } else if (refreshed.reason === 'expired') {
      // The admin session is genuinely over. Drop the cookie rather than
      // leaving the browser holding a tenant identity.
      return clearSessionCookie(fail('expired', 'Your platform session has expired.', 401));
    }
  }

  let endedSessions: number | null = null;
  let warning: string | null = null;
  try {
    const upstream = await fetch(`${backendUrl()}/api/saas/impersonation`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${admin.t}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
    if (upstream.ok) {
      const payload = (await upstream.json().catch(() => null)) as { ended_sessions?: unknown } | null;
      endedSessions = typeof payload?.ended_sessions === 'number' ? payload.ended_sessions : null;
    } else {
      warning = 'The session was closed here, but the API did not confirm it.';
    }
  } catch {
    warning = 'The session was closed here, but the API is unreachable.';
  }

  /* The cookie goes back regardless. A failed revoke leaves a token that dies
     at its own `exp`; refusing to restore would strand an administrator inside
     a tenant, which is strictly worse. The warning says which happened. */
  const response = NextResponse.json({ ok: true, next: PLATFORM_LANDING, endedSessions, warning });
  response.cookies.set({
    name: SESSION_COOKIE,
    value: encodeEnvelope(admin),
    ...sessionCookieOptions(admin.rm),
  });
  return response;
}
