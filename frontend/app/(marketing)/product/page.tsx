/**
 * `/product` — the marketing page at a stable URL.
 *
 * `/` shows the same page to a visitor with no session, but a signed-in user
 * lands on `/overview` there, so links into marketing (emails, the footer of a
 * signing page) point here instead of at a route whose answer depends on who
 * is asking.
 */
import type { Metadata } from 'next';
import MarketingPage from '@/components/sf/marketing/MarketingPage';

export const metadata: Metadata = {
  title: 'SignerPro — e-signature your team can actually run',
  description:
    'Prepare a document, route it to the people who have to sign it, collect payment at signature, and keep an audit trail you can hand to a lawyer.',
};

export default function Page() {
  return <MarketingPage />;
}
