'use client';

/**
 * The landing after a cloud storage provider redirects the browser back from
 * its consent screen.
 *
 * The redirect proves nothing on its own — the `code` still has to be
 * exchanged for tokens by the backend, which holds the client secret. So this
 * page does exactly one thing: hand `code` and `state` to the callback
 * endpoint, then put the sender back on the integrations panel with the
 * outcome said out loud. It never claims a connection the exchange did not
 * make, and a denial on the provider's side is reported as a denial rather
 * than as a failure of ours.
 *
 * Returning is a client-side navigation, so the toast raised here is still
 * standing when the integrations panel paints.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { apiCall } from '@/lib/api/browser';
import { account as accountApi } from '@/lib/api/resources';
import { takeOauthProvider } from '@/lib/sf/cloudOauth';
import { SF_FONT } from '@/lib/sf/fallback';

const PANEL = {
  margin: '26px 28px', background: 'hsl(var(--color-bg-surface))', border: '1px solid hsl(var(--color-border-subtle))', borderRadius: '16px',
  padding: '20px', display: 'flex', flexDirection: 'column' as const, gap: '8px',
  fontFamily: SF_FONT, maxWidth: '420px',
};

export default function IntegrationsCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const { flash } = useSF();

  const code = params.get('code');
  const state = params.get('state');
  const denied = params.get('error');
  /* The backend appends `provider` to the redirect_uri it registers with the
     consent screen, so the answer normally comes back in the URL itself. The
     per-tab handoff record is only the fallback for a redirect that predates
     that (or a provider that strips unknown params). */
  const declaredProvider = params.get('provider');
  const deniedDetail = params.get('error_description');

  /* What the page says while the exchange is in flight. It is replaced by a
     navigation in every branch, so it is only ever read for a moment — but a
     moment of blankness on a page reached by redirect reads as a dead end. */
  const [status, setStatus] = useState('Finishing the connection…');

  /* Effects run twice in development, and an authorization code may be spent
     exactly once. */
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const back = (message: string) => {
      setStatus(message);
      flash(message);
      router.replace('/account/integrations');
    };

    if (denied) {
      back('Connection cancelled · ' + (deniedDetail || denied));
      return;
    }
    if (!code || !state) {
      back('That connection link is incomplete · start again from Integrations');
      return;
    }

    /* Consumed even when the url already named the provider, so a tab that
       starts several grants does not leave records behind. */
    const remembered = takeOauthProvider(state);
    const provider = declaredProvider || remembered;
    if (!provider) {
      /* Neither the URL nor the per-tab handoff record named a connector. The
         signed `state` knows, but only the backend can read it, and the
         endpoint is per-provider — so there is nothing to ask. Guessing which
         connector to complete would be worse than saying so. */
      back('Could not tell which connector that was · start again from Integrations');
      return;
    }

    void accountApi.completeIntegrationOauth(apiCall, provider, { code, state }).then(res => {
      if (!res.ok) {
        back('Could not finish connecting · ' + res.error.message);
        return;
      }
      const account = res.data.account_email ? ' as ' + res.data.account_email : '';
      back(res.data.label + ' connected' + account);
    });
  }, [code, state, denied, deniedDetail, declaredProvider, flash, router]);

  return (
    <div style={PANEL} role="status" aria-live="polite">
      <span style={{ fontSize: '.84375rem', fontWeight: 600 }}>Cloud storage</span>
      <span style={{ fontSize: '.75rem', color: 'hsl(var(--color-fg-muted))', lineHeight: 1.6 }}>{status}</span>
    </div>
  );
}
