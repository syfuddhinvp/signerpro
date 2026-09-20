import { NextResponse } from 'next/server';
import { forwardAuth, readJson, safeNext } from '@/lib/auth/handlers';

/**
 * Second half of a passkey sign-in. The signed assertion is verified by the
 * backend, which returns the same token payload the password path does — so
 * the session cookie, MFA challenge and redirect all behave identically.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const credential = body?.credential;
  if (!email || !credential || typeof credential !== 'object') {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'That passkey could not be verified.' },
      { status: 400 },
    );
  }
  return forwardAuth('/api/auth/passkeys/login/finish', { email, credential }, safeNext(body?.next));
}
