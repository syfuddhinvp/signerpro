'use client';

/**
 * The strip above a framed surface.
 *
 * The in-app simulation of this bar lives in `Shell.tsx` (`s.embedSession`);
 * this is the real one, and it carries the same three facts — whose session,
 * which host record, which contacts — because an integrator debugging a frame
 * needs the session id visible, and a user needs to know the panel in their
 * CRM is SignerPro.
 *
 * A client component only for `postMessage`: `return_url` is the host's page,
 * and navigating the *iframe* there would leave the host's own chrome wrapped
 * around it. So the frame asks its parent to do the navigating and only falls
 * back to a top-level navigation when it is not framed at all.
 */

import type { CSSProperties, ReactNode } from 'react';
import type { EmbedLanding } from './types';
import Icon from '@/components/sf/Icon';

const LANDING_LABEL: Record<EmbedLanding, string> = {
  builder: 'Preparation',
  routing: 'Routing',
  signing: 'Signing',
};

export default function EmbedFrame({
  title, landing, sessionId, externalId, returnUrl, contacts, expiresAt, children,
}: {
  title: string;
  landing: EmbedLanding;
  sessionId: string;
  externalId: string | null;
  returnUrl: string | null;
  contacts: string[];
  expiresAt: string;
  children: ReactNode;
}) {
  const barStyle: CSSProperties = {
    flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '12px', padding: '9px 18px',
    background: '#eef2ff', borderBottom: '1px solid #c7d2fe', flexWrap: 'wrap',
  };
  const chipStyle: CSSProperties = {
    padding: '4px 9px', borderRadius: '7px', background: '#4f46e5', color: '#fff',
    fontSize: '.625rem', fontWeight: 700, letterSpacing: '.06em', flex: '0 0 auto',
  };
  const contactChipStyle: CSSProperties = {
    padding: '4px 9px', borderRadius: '99px', background: '#fff', border: '1px solid #c7d2fe',
    fontSize: '.65625rem', color: '#3730a3', whiteSpace: 'nowrap', flex: '0 0 auto',
  };
  const returnStyle: CSSProperties = {
    marginLeft: 'auto', padding: '6px 12px', borderRadius: '8px', border: '1px solid #c7d2fe',
    background: '#fff', color: '#3730a3', fontSize: '.71875rem', fontWeight: 600, cursor: 'pointer', flex: '0 0 auto',
    display: 'inline-flex', alignItems: 'center', gap: '6px',
  };

  const meta = [
    'session ' + sessionId,
    externalId ? 'external_id ' + externalId : null,
    'expires ' + new Date(expiresAt).toLocaleTimeString(),
  ].filter(Boolean).join(' · ');

  const goBack = () => {
    if (!returnUrl) return;
    // Framed: hand the navigation to the host, which owns the surrounding page.
    // Targeted at the return URL's own origin — never '*', which would post the
    // session id to whatever page happens to be framing us.
    if (window.parent !== window) {
      let target: string;
      try { target = new URL(returnUrl).origin; } catch { return; }
      window.parent.postMessage({ type: 'signerpro:return', sessionId, returnUrl }, target);
      return;
    }
    window.location.href = returnUrl;
  };

  return (
    <>
      <div style={barStyle}>
        <span style={chipStyle}>{LANDING_LABEL[landing].toUpperCase()}</span>
        <span style={{ fontSize: '.8125rem', fontWeight: 600 }}>{title}</span>
        <span style={{ fontSize: '.65625rem', color: '#4338ca' }}>{meta}</span>
        {contacts.map(name => <span key={name} style={contactChipStyle}>{name}</span>)}
        {returnUrl ? <button type="button" style={returnStyle} onClick={goBack}><Icon name="arrowLeft" size={12} />Return to host</button> : null}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </>
  );
}
