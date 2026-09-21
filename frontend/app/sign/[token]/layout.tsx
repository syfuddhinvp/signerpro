/**
 * Public signing chrome. Deliberately *not* the app shell: a recipient has no
 * account, no workspace and no navigation — just the envelope, a brand mark and
 * the security note. No session is read here, so this layout renders for an
 * expired link exactly as it does for a live one.
 *
 * The brand mark is the *sender's* (ORG-7), not SignerPro's, because this is
 * the one screen in the product whose reader has no relationship with us: a
 * recipient who was told by their agent to expect a document from Acme should
 * see Acme. It is fetched here rather than taken from the signing session
 * because this chrome also wraps the OTP gate, the consent gate and every
 * token-problem state — screens that render before, or instead of, a session.
 *
 * `GET /api/sign/{token}/branding` answers 200-with-nothing for a bad token, so
 * a guessed link cannot be told from a real one by the header, and an outage
 * simply falls back to SignerPro's own mark.
 */

import type { Metadata } from 'next';
import { apiFetchPublic } from '@/lib/api/client';
import { SF_FONT } from '@/lib/sf/fallback';
import { brandInitials } from './states';
import type { SignerBranding } from './types';

export const metadata: Metadata = { title: 'Sign · SignerPro' };

const ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' } as const;

export default async function SignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await apiFetchPublic<SignerBranding>(
    `/api/sign/${encodeURIComponent(token)}/branding`,
  );
  /* The endpoint answers 200-with-every-field-null for an unbranded tenant and
     for a bad token alike — so "did the call succeed" is not the question.
     Whether there is anything to show is. */
  const payload: SignerBranding | null = result.ok ? result.data : null;
  const brand: SignerBranding | null =
    payload && (payload.organization_name || payload.logo_url || payload.primary_color)
      ? payload
      : null;

  const name = brand?.organization_name ?? 'SignerPro';
  const mark = brand?.primary_color ?? 'hsl(var(--color-accent-solid))';
  const markText = brand?.primary_text_color ?? '#fff';
  const align = ALIGN[brand?.logo_position ?? 'left'];

  /* A fixed viewport height, not a minimum: the signing surface below is a
     sticky toolbar over its own scroll box, and it sizes itself to the space
     this layout gives it. With `minHeight` that space was unbounded, so the
     *window* scrolled instead — and anything the surface pins to its own
     bottom edge, the next-field guide included, sat below the fold. */
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'hsl(var(--color-bg-muted))', fontFamily: SF_FONT, color: 'hsl(var(--color-fg-default))' }}>
      <header style={{ flex: '0 0 auto', background: 'hsl(var(--color-bg-surface))', borderBottom: '1px solid hsl(var(--color-border-subtle))', padding: '11px 18px', display: 'flex', alignItems: 'center', gap: '11px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', flex: 1, minWidth: 0, justifyContent: align }}>
          {brand?.logo_url ? (
            <img
              src={brand.logo_url}
              alt={name}
              style={{ maxHeight: '30px', maxWidth: '170px', objectFit: 'contain' }}
            />
          ) : (
            <>
              <span style={{ width: '28px', height: '28px', borderRadius: '9px', background: mark, color: markText, display: 'grid', placeItems: 'center', fontSize: '.71875rem', fontWeight: 700, letterSpacing: '-.5px', flex: '0 0 28px' }}>
                {brand ? brandInitials(name) : 'SF'}
              </span>
              <span style={{ fontSize: '.84375rem', fontWeight: 700, letterSpacing: '-.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            </>
          )}
        </div>
        {/* Stays whatever the brand is: the guarantee is ours, not the
            sender's, and a recipient checking whether a link is trustworthy is
            entitled to see who is actually sealing the document. */}
        <span style={{ marginLeft: 'auto', fontSize: '.6875rem', color: 'hsl(var(--color-fg-muted))', fontFamily: 'var(--font-sans)', flex: '0 0 auto' }}>
          {brand ? 'Sent via SignerPro · ' : ''}Secure signing session · SHA-256 sealed · tamper-evident audit trail
        </span>
      </header>
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>{children}</main>
    </div>
  );
}
