'use client';

import { useSF } from '@/lib/sf/state';
import Shell from '@/components/sf/Shell';
import Auth from '@/components/sf/Auth';
import Tour from '@/components/sf/Tour';
import Modals from '@/components/sf/Modals';
import AccountArea from '@/components/sf/AccountArea';

import Library from '@/components/sf/screens/Library';
import Builder from '@/components/sf/screens/Builder';
import Routing from '@/components/sf/screens/Routing';
import Signer from '@/components/sf/screens/Signer';
import Audit from '@/components/sf/screens/Audit';
import TenantHome from '@/components/sf/screens/TenantHome';
import PlatformHome from '@/components/sf/screens/PlatformHome';
import Billing from '@/components/sf/screens/Billing';
import Revenue from '@/components/sf/screens/Revenue';
import Invoices from '@/components/sf/screens/Invoices';
import Reports from '@/components/sf/screens/Reports';
import Contacts from '@/components/sf/screens/Contacts';
import ApiScreen from '@/components/sf/screens/ApiScreen';
import Sandbox from '@/components/sf/screens/Sandbox';
import Guides from '@/components/sf/screens/Guides';
import Support from '@/components/sf/screens/Support';
import Logs from '@/components/sf/screens/Logs';
import Platform from '@/components/sf/screens/Platform';

const SCREENS: Record<string, React.ComponentType> = {
  dashboard: Library,
  builder: Builder,
  routing: Routing,
  sign: Signer,
  audit: Audit,
  tenantHome: TenantHome,
  platformHome: PlatformHome,
  billing: Billing,
  revenue: Revenue,
  invoices: Invoices,
  reports: Reports,
  contacts: Contacts,
  api: ApiScreen,
  sandbox: Sandbox,
  guides: Guides,
  support: Support,
  logs: Logs,
  platform: Platform,
};

export default function Page() {
  const { s } = useSF();
  if (!s.authed) return <Auth />;
  const Screen = SCREENS[s.screen] ?? TenantHome;
  return (
    <>
      <Shell>
        <Screen />
      </Shell>
      <Modals />
      <AccountArea />
      <Tour />
    </>
  );
}
