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
