import type { Metadata } from 'next';
import Signer from '@/components/sf/screens/Signer';

export const metadata: Metadata = { title: 'Signer view · SignForge' };

export default function Page() {
  return <Signer />;
}
