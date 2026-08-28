import type { Metadata } from 'next';
import Invoices from '@/components/sf/screens/Invoices';

export const metadata: Metadata = { title: 'Invoices · SignForge Platform' };

export default function Page() {
  return <Invoices />;
}
