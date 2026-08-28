import type { Metadata } from 'next';
import Platform from '@/components/sf/screens/Platform';

export const metadata: Metadata = { title: 'Tenants · SignForge Platform' };

export default function Page() {
  return <Platform />;
}
