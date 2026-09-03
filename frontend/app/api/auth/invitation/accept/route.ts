/**
 * Redeem an organization invitation. `POST /api/invitations/accept` creates the
 * member account and answers with a session, so the new member lands signed in.
 * Distinct upstream states — 404 unknown token, 410 expired/used, 409 email
 * already registered — are preserved as distinct codes for the invite screen.
 */
import { NextResponse } from 'next/server';
import { forwardAuth, readJson } from '@/lib/auth/handlers';

export async function POST(request: Request) {
  const body = await readJson(request);
  const token = typeof body?.token === 'string' ? body.token : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!token) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'This invitation link is missing its token.' },
      { status: 400 },
    );
  }
  if (name.length < 2) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Enter your full name.' },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { ok: false, code: 'bad_request', error: 'Choose a password of at least 8 characters.' },
      { status: 400 },
    );
  }

  return forwardAuth('/api/invitations/accept', { token, name, password }, '/overview');
}
