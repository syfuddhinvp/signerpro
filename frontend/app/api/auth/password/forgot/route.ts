/**
 * Request a password-reset email. `POST /api/auth/password/forgot` is
 * deliberately enumeration-safe upstream (it answers the same way for an
 * unknown address), so this route must not add any signal of its own — the
 * only distinct failure it surfaces is the IP/email rate limit.
 */
import { NextResponse } from 'next/server';
import { forwardPlain, readJson } from '@/lib/auth/handlers';

export async function POST(request: Request) {
  const body = await readJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!email || email.indexOf('@') < 1) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Enter the email address on your account.' },
      { status: 400 },
    );
  }
  return forwardPlain('/api/auth/password/forgot', { email });
}
