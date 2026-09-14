'use client';
/**
 * The standing "you are not yourself" bar, and the only way back out.
 *
 * It is mounted by the app layout rather than by the platform console, because
 * an impersonating admin is no longer a platform admin: the cookie says tenant
 * user, so `/platform` bounces to `/overview` for the duration. A banner on the
 * console alone would therefore never be seen — and there would be no exit.
 *
 * Fixed to the bottom on purpose: it must not depend on any screen leaving room
 * for it, and it has to stay on screen on every route.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { btn } from '@/lib/sf/ui';
import { endImpersonation, useSession } from '@/components/sf/SessionProvider';

const bar: CSSProperties = {
  position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 70,
  background: '#7c2d12', color: '#fff7ed',
  padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  gap: '14px', flexWrap: 'wrap',
  boxShadow: '0 -6px 18px rgba(15,23,42,.18)',
};

const chip: CSSProperties = {
  padding: '3px 8px', borderRadius: '6px', background: '#f59e0b', color: '#3b1d00',
  fontSize: '.65625rem', fontWeight: 700, letterSpacing: '.06em',
  fontFamily: 'var(--font-sans)', whiteSpace: 'nowrap',
};

/** `expires_at` is in the future, which `formatRelative` does not express. */
function remaining(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (Number.isNaN(seconds)) return 'unknown';
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return `${seconds}s left`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m left`;
}

export default function ImpersonationBanner() {
  const session = useSession();
  const impersonation = session.impersonation;
  const router = useRouter();
  const { flash } = useSF();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  /* The countdown has to advance on its own: the token expires server-side
     whether or not anything re-renders, and a banner frozen at "15 min left"
     is exactly the lie this bar exists to prevent. */
  useEffect(() => {
    if (!impersonation?.expiresAt) return;
    const timer = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(timer);
  }, [impersonation?.expiresAt]);

  if (!impersonation) return null;

  const expired = impersonation.expiresAt
    ? new Date(impersonation.expiresAt).getTime() <= Date.now()
    : false;

  const stop = () => {
    setBusy(true);
    void endImpersonation().then(result => {
      setBusy(false);
      if (!result.ok) { flash(result.error); return; }
      if (result.warning) flash(result.warning);
      /* A full navigation, not `router.push`: the cookie just changed
         identity, and middleware has to re-read it before anything renders. */
      window.location.assign(result.next);
    });
  };

  return (
    <div role="status" style={bar}>
      <span style={chip}>IMPERSONATING</span>
      <span style={{ fontSize: '.78125rem', lineHeight: 1.5 }}>
        Acting as <strong>{session.email}</strong> in {session.organizationName || 'this tenant'}
        {' · '}started by {impersonation.adminEmail || impersonation.adminName}
        {impersonation.expiresAt ? ` · ${remaining(impersonation.expiresAt)}` : ''}
      </span>
      {expired ? (
        <span style={{ fontSize: '.71875rem', color: '#fed7aa' }}>
          The session has expired — the next page load returns you to your own account.
        </span>
      ) : null}
      <button type="button" onClick={stop} disabled={busy} style={btn('#fff', '#7c2d12', '#fff')}>
        {busy ? 'Ending…' : 'End impersonation'}
      </button>
      <button
        type="button"
        onClick={() => router.refresh()}
        style={btn('transparent', '#fff7ed', '#c2410c')}
      >
        Refresh view
      </button>
    </div>
  );
}
