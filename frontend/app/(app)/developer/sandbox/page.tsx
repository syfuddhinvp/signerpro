import type { Metadata } from 'next';
import Sandbox from '@/components/sf/screens/Sandbox';

export const metadata: Metadata = { title: 'API sandbox · SignForge' };

export default function Page() {
  return <Sandbox />;
}
