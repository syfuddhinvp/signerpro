import { NextResponse } from 'next/server';
import { forwardAuth, readJson, safeNext } from '@/lib/auth/handlers';

export async function POST(request: Request) {
  const body = await readJson(request);
  const organizationName = typeof body?.organizationName === 'string'
    ? body.organizationName.trim()
    : typeof body?.organization_name === 'string' ? body.organization_name.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const missing = !organizationName || !name || !email || !password;
  if (missing) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Organization, name, email and password are all required.' },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Choose a password of at least 8 characters.' },
      { status: 400 },
    );
  }

  return forwardAuth(
    '/api/auth/register',
    { organization_name: organizationName, name, email, password },
    safeNext(body?.next),
  );
}
