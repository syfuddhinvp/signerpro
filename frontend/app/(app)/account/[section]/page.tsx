/** Routed account area — the section comes from the URL. */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import AccountArea from '@/components/sf/AccountArea';
import { ACCOUNT_SECTIONS, type AccountSection } from '@/lib/sf/routes';

type Params = { section: string };

export function generateStaticParams(): Params[] {
  return ACCOUNT_SECTIONS.map((section) => ({ section }));
}

function isSection(value: string): value is AccountSection {
  return (ACCOUNT_SECTIONS as readonly string[]).includes(value);
}

const TITLES: Record<AccountSection, string> = {
  profile: 'Profile', subscription: 'Subscription', security: 'Security',
  payment: 'Payment methods', notifications: 'Notifications', email: 'Email addresses',
  integrations: 'Integrations', cloud: 'Cloud storage', teams: 'Teams',
  orgs: 'Organizations', audit: 'Account audit log',
};

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { section } = await params;
  if (!isSection(section)) return { title: 'Account · SignForge' };
  return { title: `${TITLES[section]} · Account · SignForge` };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  return <AccountArea section={section} />;
}
