'use client';

/**
 * `/login/forgot` — password reset request. No backend endpoint exists yet, so
 * this keeps the prototype's flash.
 * TODO: post to `POST /api/auth/password/forgot` once it exists.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { lbl, authInput, authPrimary as authPrimaryOf, linkBtn as linkBtnOf } from '@/lib/sf/ui';
import { AUTH_PATHS } from '@/lib/sf/routes';
import AuthLayout from './AuthLayout';

export default function ForgotForm() {
  const { s, set, flash, accent } = useSF();
  const router = useRouter();
  const A = accent();

  const authPrimary = authPrimaryOf(A);
  const linkBtn = linkBtnOf(A);

  const submitReset = () => {
    // TODO: `POST /api/auth/password/forgot` — no backend endpoint yet.
    flash('Reset link sent to ' + s.authEmail + ' · valid 30 minutes');
    router.push(AUTH_PATHS.signin);
  };

  return (
    <AuthLayout mode="forgot">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
        <label style={lbl}>Work email
          <input type="email" value={s.authEmail} onChange={(e) => set({ authEmail: e.target.value })} placeholder="you@company.com" style={authInput} />
        </label>
        <button type="button" onClick={submitReset} style={authPrimary}>Send reset link</button>
        <Link href={AUTH_PATHS.signin} style={Object.assign({}, linkBtn, { textDecoration: 'none' })}>← Back to sign in</Link>
      </div>
    </AuthLayout>
  );
}
