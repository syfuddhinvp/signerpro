import type { Metadata } from 'next';
import Logs from '@/components/sf/screens/Logs';

export const metadata: Metadata = { title: 'API logs · SignForge' };

export default function Page() {
  return <Logs />;
}
