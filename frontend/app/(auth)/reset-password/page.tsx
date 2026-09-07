import { Suspense } from 'react';
import type { Metadata } from 'next';
import ResetPasswordForm from '@/components/sf/auth/ResetPasswordForm';

export const metadata: Metadata = { title: 'Choose a new password · SignerPro', robots: { index: false } };

/** Landing page for the emailed link `{app_base_url}/reset-password?token=…`. */
export default function Page() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
