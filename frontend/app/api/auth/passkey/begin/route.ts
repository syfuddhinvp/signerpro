import { NextResponse } from 'next/server';
import { forwardJson, readJson } from '@/lib/auth/handlers';

/**
 * First half of a passkey sign-in: hand the browser the challenge the backend
 * minted. The options are passed through untouched — they are base64url on the
 * wire and `navigator.credentials.get()` is the only thing that gets to
 * interpret them.
 */
export async function POST(request: Request) {
  const body = await readJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!email) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Enter your email address first.' },
      { status: 400 },
    );
  }
  return forwardJson('/api/auth/passkeys/login/begin', { email });
}
