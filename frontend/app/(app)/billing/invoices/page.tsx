import type { Metadata } from 'next';
import Invoices from '@/components/sf/screens/Invoices';

export const metadata: Metadata = { title: 'Invoices · SignForge' };

export default function Page() {
  return <Invoices />;
}
