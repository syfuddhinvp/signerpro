import type { Metadata } from 'next';
import Logs from '@/components/sf/screens/Logs';

export const metadata: Metadata = { title: 'Logs · SignForge Platform' };

export default function Page() {
  return <Logs />;
}
