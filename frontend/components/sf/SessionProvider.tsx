'use client';

import { createContext, useContext } from 'react';

/**
 * The authenticated identity, handed down from the server layout. The session
 * token itself stays in an httpOnly cookie and never reaches client JS — this
 * carries only what the UI needs to render (name, role, workspace access).
 */
export type ClientSession = {
  userId: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  organizationName: string;
  isPlatformAdmin: boolean;
  /** Set only while a platform admin is acting as this user. */
  impersonation: {
    adminName: string;
    adminEmail: string;
    /** ISO 8601. The banner counts down to it; middleware enforces it. */
    expiresAt: string | null;
  } | null;
};

const SessionContext = createContext<ClientSession | null>(null);

export function SessionProvider({ session, children }: { session: ClientSession; children: React.ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** Inside the (app) route group a session is guaranteed by the layout. */
export function useSession(): ClientSession {
  const v = useContext(SessionContext);
  if (!v) throw new Error('useSession must be used inside the authenticated app layout');
  return v;
}

/** Safe variant for components that also render outside the app shell. */
export function useOptionalSession(): ClientSession | null {
  return useContext(SessionContext);
}

/**
 * Sign out. The route handler revokes the backend session (and its refresh
 * token) before clearing the cookie; a failure here must still end the session
 * locally, so callers navigate away regardless.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', signal: AbortSignal.timeout(10_000) });
  } catch {
    /* the cookie clear is best-effort when the network is gone */
  }
}

// --- impersonation ---------------------------------------------------------

/**
 * Both calls go to `/api/auth/impersonate` rather than straight to the
 * backend's `/api/saas/...` endpoints, because the point of the exchange is the
 * *cookie*: only a route handler can write the httpOnly session, and without
 * that swap the impersonation token the backend mints is never used by
 * anything. See `app/api/auth/impersonate/route.ts`.
 */
export type ImpersonationOutcome =
  | { ok: true; next: string; warning?: string | null }
  | { ok: false; error: string };

async function callImpersonation(init: RequestInit): Promise<ImpersonationOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/auth/impersonate', {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: 'The request could not be sent. Check your connection and try again.' };
  }
  const payload = (await response.json().catch(() => null)) as
    | { ok?: boolean; next?: string; error?: string; warning?: string | null }
    | null;
  if (!response.ok || payload?.ok !== true) {
    return { ok: false, error: payload?.error ?? 'The session could not be changed.' };
  }
  return { ok: true, next: payload.next ?? '/overview', warning: payload.warning ?? null };
}

export function startImpersonation(body: {
  organizationId: string;
  justification: string;
  ttlSeconds: number;
  scopes: string[];
}): Promise<ImpersonationOutcome> {
  return callImpersonation({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function endImpersonation(): Promise<ImpersonationOutcome> {
  return callImpersonation({ method: 'DELETE' });
}
