import type { Metadata } from 'next';
import Contacts from '@/components/sf/screens/Contacts';

export const metadata: Metadata = { title: 'Contacts · SignForge' };

export default function Page() {
  return <Contacts />;
}
