import { NextResponse } from 'next/server';
import { forwardAuth, readJson, safeNext } from '@/lib/auth/handlers';

export async function POST(request: Request) {
  const body = await readJson(request);
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Enter your email address and password.' },
      { status: 400 },
    );
  }

  // "Remember this device" is transmitted now: it lengthens the backend
  // session row (30d vs 12h) and the cookie in step with it.
  const remember = body?.remember === true;
  return forwardAuth('/api/auth/login', { email, password, remember }, safeNext(body?.next), { remember });
}
