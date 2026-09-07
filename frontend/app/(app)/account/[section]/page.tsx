/** Routed account area — the section comes from the URL. */
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import AccountArea from '@/components/sf/AccountArea';
import { ACCOUNT_AREA_SECTIONS, LEGACY_ACCOUNT_SECTIONS, type AccountAreaSection } from '@/lib/sf/routes';

type Params = { section: string };

export function generateStaticParams(): Params[] {
  return ACCOUNT_AREA_SECTIONS.map((section) => ({ section }));
}

function isSection(value: string): value is AccountAreaSection {
  return (ACCOUNT_AREA_SECTIONS as readonly string[]).includes(value);
}

const TITLES: Record<AccountAreaSection, string> = {
  profile: 'Profile', security: 'Security',
  notifications: 'Notifications & email',
  integrations: 'Integrations',
  organization: 'Organization & teams', audit: 'Account audit log',
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { section } = await params;
  if (!isSection(section)) return { title: 'Account · SignerPro' };
  return { title: `${TITLES[section]} · Account · SignerPro` };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { section } = await params;
  /* `/account/teams` and `/account/orgs` were separate sections; they are one
     now, and their URLs are in bookmarks and invitation emails. Redirect
     rather than 404. */
  const moved = LEGACY_ACCOUNT_SECTIONS[section];
  if (moved) redirect('/account/' + moved);
  if (!isSection(section)) notFound();
  return <AccountArea section={section} />;
}
