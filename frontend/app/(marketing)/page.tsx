/**
 * Entry point. Navigation is the URL now, so `/` only decides which root the
 * visitor belongs in — there is no client-side screen switchboard.
 *
 * A signed-in user goes straight to their workspace. A visitor with no session
 * used to be bounced to `/login`, which asked a stranger for a password before
 * telling them what the product was; they now get the marketing page, with
 * sign-in one click away in its nav.
 *
 * This lives inside the `(marketing)` route group rather than at `app/page.tsx`,
 * which is where it used to be. That move is load-bearing: the marketing layout
 * is what sets `data-surface="marketing"`, and every `mk-` utility resolves
 * against custom properties scoped to that attribute. Rendered from the app
 * root the page still built, still type-checked and still returned 200 — with
 * no header, no footer and not one of its styles applied.
 * `test/marketing-routes.test.ts` pins it here.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import MarketingPage from '@/components/sf/marketing/MarketingPage';

export const metadata: Metadata = {
  title: 'SignerPro — e-signature your team can actually run',
  description:
    'Send a contract, take the payment at the signature, and hand anyone a link that proves the document is real. No envelope quota, no per-signature fee.',
};

export default async function RootPage() {
  const session = await getSession();
  if (session) redirect('/overview');
  return <MarketingPage />;
}
