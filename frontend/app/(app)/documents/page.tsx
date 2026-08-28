import type { Metadata } from 'next';
import Library from '@/components/sf/screens/Library';

export const metadata: Metadata = { title: 'Documents · SignForge' };

export default function Page() {
  return <Library />;
}
