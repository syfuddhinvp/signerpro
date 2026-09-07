import type { Metadata } from 'next';
import ForgotForm from '@/components/sf/auth/ForgotForm';

export const metadata: Metadata = { title: 'Reset password · SignerPro' };

export default function Page() {
  return <ForgotForm />;
}
