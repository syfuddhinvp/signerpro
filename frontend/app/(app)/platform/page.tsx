import type { Metadata } from 'next';
import PlatformHome from '@/components/sf/screens/PlatformHome';

export const metadata: Metadata = { title: 'Platform · SignForge' };

export default function Page() {
  return <PlatformHome />;
}
