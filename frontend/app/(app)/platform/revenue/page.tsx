import type { Metadata } from 'next';
import Revenue from '@/components/sf/screens/Revenue';

export const metadata: Metadata = { title: 'Revenue · SignForge Platform' };

export default function Page() {
  return <Revenue />;
}
