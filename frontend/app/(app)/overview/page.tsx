import type { Metadata } from 'next';
import TenantHome from '@/components/sf/screens/TenantHome';

export const metadata: Metadata = { title: 'Overview · SignForge' };

export default function Page() {
  return <TenantHome />;
}
