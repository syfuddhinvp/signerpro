import type { Metadata } from 'next';
import Billing from '@/components/sf/screens/Billing';

export const metadata: Metadata = { title: 'Billing · SignForge' };

export default function Page() {
  return <Billing />;
}
