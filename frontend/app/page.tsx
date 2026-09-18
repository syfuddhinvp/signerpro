/**
 * Entry point. Navigation is the URL now, so `/` only decides which root the
 * visitor belongs in — there is no client-side screen switchboard.
 *
 * A signed-in user goes straight to their workspace. A visitor with no session
 * used to be bounced to `/login`, which asked a stranger for a password before
 * telling them what the product was; they now get the marketing page, with
 * sign-in one click away in its nav.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import MarketingPage from '@/components/sf/marketing/MarketingPage';

export const metadata: Metadata = {
  title: 'SignerPro — e-signature your team can actually run',
  description:
    'Prepare a document, route it to the people who have to sign it, collect payment at signature, and keep an audit trail you can hand to a lawyer.',
};

export default async function RootPage() {
  const session = await getSession();
  if (session) redirect('/overview');
  return <MarketingPage />;
}
