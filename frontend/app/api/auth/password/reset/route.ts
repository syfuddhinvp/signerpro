/**
 * Redeem a password-reset token. The backend answers with a full session, so
 * this mints the `sf_session` cookie exactly like login does and the user lands
 * signed in.
 */
import { NextResponse } from 'next/server';
import { forwardAuth, readJson, safeNext } from '@/lib/auth/handlers';

export async function POST(request: Request) {
  const body = await readJson(request);
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!token) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'This reset link is missing its token.' },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Choose a password of at least 8 characters.' },
      { status: 400 },
    );
  }

  return forwardAuth('/api/auth/password/reset', { token, password }, safeNext(body?.next));
}
