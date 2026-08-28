import type { Metadata } from 'next';
import ApiScreen from '@/components/sf/screens/ApiScreen';

export const metadata: Metadata = { title: 'Developer · SignForge Platform' };

export default function Page() {
  return <ApiScreen />;
}
