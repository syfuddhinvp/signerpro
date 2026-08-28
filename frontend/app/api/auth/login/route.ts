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

  return forwardAuth('/api/auth/login', { email, password }, safeNext(body?.next));
}
