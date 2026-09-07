import type { Metadata } from 'next';
import MfaForm from '@/components/sf/auth/MfaForm';

export const metadata: Metadata = { title: 'Verify identity · SignerPro' };

export default function Page() {
  return <MfaForm />;
}
