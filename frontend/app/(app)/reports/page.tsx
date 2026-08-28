import type { Metadata } from 'next';
import Reports from '@/components/sf/screens/Reports';

export const metadata: Metadata = { title: 'Reports · SignForge' };

export default function Page() {
  return <Reports />;
}
