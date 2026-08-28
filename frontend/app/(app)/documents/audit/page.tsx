import type { Metadata } from 'next';
import Audit from '@/components/sf/screens/Audit';

export const metadata: Metadata = { title: 'Audit trail · SignForge' };

export default function Page() {
  return <Audit />;
}
