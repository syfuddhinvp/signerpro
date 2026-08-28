import { Suspense } from 'react';
import type { Metadata } from 'next';
import SignUpForm from '@/components/sf/auth/SignUpForm';

export const metadata: Metadata = { title: 'Create account · SignForge' };

export default function Page() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}
