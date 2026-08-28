import type { Metadata } from 'next';
import Routing from '@/components/sf/screens/Routing';

export const metadata: Metadata = { title: 'Signing workflow · SignForge' };

export default function Page() {
  return <Routing />;
}
