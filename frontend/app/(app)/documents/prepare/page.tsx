import type { Metadata } from 'next';
import Builder from '@/components/sf/screens/Builder';

export const metadata: Metadata = { title: 'Prepare document · SignForge' };

export default function Page() {
  return <Builder />;
}
