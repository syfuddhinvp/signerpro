import type { Metadata } from 'next';
import Guides from '@/components/sf/screens/Guides';

export const metadata: Metadata = { title: 'Developer guides · SignerPro' };

export default function Page() {
  return <Guides />;
}
