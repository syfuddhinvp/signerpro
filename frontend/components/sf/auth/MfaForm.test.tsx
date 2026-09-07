/**
 * `/login/verify` — the second factor.
 *
 * Protects the audit's finding that the code was never exchanged (the screen
 * flashed a toast and went nowhere). Every assertion here is about the network
 * call actually happening, carrying the challenge token, and each failure mode
 * being told apart: a wrong code keeps you on the screen, an expired challenge
 * sends you back to sign in, rate-limiting says so.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithSF } from '@/test/utils';
import { router, resetNavigation } from '@/test/navigation';
import { storeChallenge, readChallenge, clearChallenge } from '@/lib/auth/mfa-challenge';
import { AUTH_PATHS } from '@/lib/sf/routes';
import MfaForm from './MfaForm';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  resetNavigation();
  clearChallenge();
  storeChallenge({
    mfaToken: 'mfa_tok_abc123', delivery: 'totp', maskedTarget: 'p•••@example.test',
    email: 'priya@example.test', remember: true, next: '/account/billing',
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

async function enterCode(code = '123456') {
  const user = userEvent.setup();
  renderWithSF(<MfaForm />);
  const input = await screen.findByLabelText(/verification code/i);
  await user.type(input, code);
  await user.click(screen.getByRole('button', { name: /verify & sign in/i }));
  return user;
}

describe('code exchange', () => {
  it('actually calls the verify endpoint with the challenge token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, next: '/account/billing' }));
    vi.stubGlobal('fetch', fetchMock);

    await enterCode();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/auth/mfa');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toMatchObject({
      mfaToken: 'mfa_tok_abc123', code: '123456', remember: true, next: '/account/billing',
    });
    // The session exists now, so the challenge must not linger in sessionStorage.
    await waitFor(() => expect(readChallenge()).toBeNull());
    expect(router.replace).toHaveBeenCalledWith('/account/billing');
  });

  it('sends a recovery code on the same endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, next: '/overview' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithSF(<MfaForm />);

    await user.click(await screen.findByRole('button', { name: /use recovery code/i }));
    await user.type(screen.getByLabelText(/recovery code/i), 'abcd-efgh-ijkl');
    await user.click(screen.getByRole('button', { name: /verify & sign in/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).code).toBe('abcd-efgh-ijkl');
  });

  it('refuses to spend a request on a short code', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await enterCode('123');

    expect(await screen.findByRole('alert')).toHaveTextContent(/6-digit code/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('failure modes are told apart', () => {
  it('a wrong code keeps you on the screen and clears the field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(401, { ok: false, code: 'invalid_credentials', error: 'Invalid verification code.' }),
    ));

    await enterCode();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid verification code.');
    expect(router.replace).not.toHaveBeenCalled();
    // The challenge is still valid — you get another attempt.
    expect(readChallenge()?.mfaToken).toBe('mfa_tok_abc123');
    await waitFor(() => expect(screen.getByLabelText(/verification code/i)).toHaveValue(''));
  });

  it('an expired challenge drops it and returns to sign in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(401, { ok: false, error: 'The verification session has expired.' }),
    ));

    await enterCode();

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(AUTH_PATHS.signin));
    expect(readChallenge()).toBeNull();
  });

  it('rate-limiting says so instead of reading as a wrong code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(429, { ok: false, code: 'rate_limited' })));

    await enterCode();

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
    expect(readChallenge()?.mfaToken).toBe('mfa_tok_abc123');
  });

  it('an unreachable backend says so, and does not claim a bad code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    await enterCode();

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach the signerpro api/i);
  });
});

describe('direct visits', () => {
  it('sends you back to sign in when there is no challenge to verify', async () => {
    clearChallenge();
    vi.stubGlobal('fetch', vi.fn());
    renderWithSF(<MfaForm />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(AUTH_PATHS.signin));
  });
});
