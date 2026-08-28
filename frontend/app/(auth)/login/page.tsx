import { Suspense } from 'react';
import type { Metadata } from 'next';
import SignInForm from '@/components/sf/auth/SignInForm';

export const metadata: Metadata = { title: 'Sign in · SignForge' };

export default function Page() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
