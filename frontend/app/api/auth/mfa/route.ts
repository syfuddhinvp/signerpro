/**
 * Exchange an MFA challenge for a real session. The challenge token comes from
 * a login that returned `mfa_required`; the code is the user's TOTP or a
 * single-use recovery code. On success this mints the same httpOnly cookie the
 * login handler does.
 */
import { forwardAuth, readJson, safeNext } from '@/lib/auth/handlers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await readJson(request);
  const mfaToken = body?.mfaToken ?? body?.mfa_token;
  const code = body?.code;

  if (typeof mfaToken !== 'string' || typeof code !== 'string' || !code.trim()) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Enter the 6-digit code from your authenticator.' },
      { status: 400 },
    );
  }

  return forwardAuth(
    '/api/auth/mfa/verify',
    { mfa_token: mfaToken, code: code.trim(), remember: body?.remember === true },
    safeNext(body?.next),
  );
}
