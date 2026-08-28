import type { Metadata } from 'next';
import Guides from '@/components/sf/screens/Guides';

export const metadata: Metadata = { title: 'Developer guides · SignForge' };

export default function Page() {
  return <Guides />;
}
