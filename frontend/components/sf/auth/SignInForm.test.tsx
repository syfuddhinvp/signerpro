/**
 * `/login` — the highest-traffic screen in the product.
 *
 * Protects the audit's finding that an MFA-enabled account could not sign in:
 * the login response's `mfaToken` must be carried to the verify screen, and the
 * navigation must be to a real path. It also pins the failure copy: a 401 and
 * an unreachable backend must each say something specific, in `role="alert"`,
 * rather than failing silently.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithSF } from '@/test/utils';
import { router, resetNavigation, setSearchParams } from '@/test/navigation';
import { readChallenge, clearChallenge } from '@/lib/auth/mfa-challenge';
import { AUTH_PATHS } from '@/lib/sf/routes';
import SignInForm from './SignInForm';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function signIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/work email/i), 'priya@example.test');
  await user.type(screen.getByLabelText(/^password$/i), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  resetNavigation();
  clearChallenge();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('MFA challenge routing', () => {
  it('carries the challenge token to the verify screen', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, {
      ok: true, mfaRequired: true, mfaToken: 'mfa_tok_abc123', delivery: 'totp', maskedTarget: 'p•••@example.test',
    }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    await signIn(user);

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    // The bug this catches was `router.replace(undefined)` — a dead end.
    const [target] = router.replace.mock.calls[0];
    expect(target).toBe(AUTH_PATHS.mfa);
    expect(target).toMatch(/^\//);

    const challenge = readChallenge();
    expect(challenge?.mfaToken).toBe('mfa_tok_abc123');
    expect(challenge?.email).toBe('priya@example.test');
  });

  it('keeps ?next= across the second factor', async () => {
    setSearchParams('next=%2Faccount%2Finvoices');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, {
      ok: true, mfaRequired: true, mfaToken: 'mfa_tok_next',
    })));
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    await signIn(user);

    await waitFor(() => expect(readChallenge()?.next).toBe('/account/invoices'));
  });

  it('does not mint a challenge on an ordinary sign-in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { ok: true, next: '/overview' })));
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    await signIn(user);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/overview'));
    expect(readChallenge()).toBeNull();
  });
});

describe('failure paths', () => {
  it('renders the 401 copy in role="alert" and does not navigate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      json(401, { ok: false, code: 'invalid_credentials' }),
    ));
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    await signIn(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Incorrect email or password.');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('renders an explicit "cannot reach the API" alert when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    await signIn(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cannot reach the signforge api/i);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('distinguishes rate-limiting from a wrong password', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(429, { ok: false, code: 'rate_limited' })));
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    await signIn(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('does not spend a request on an address the field itself rejects', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    const email = screen.getByLabelText(/work email/i) as HTMLInputElement;
    await user.type(email, 'not-an-email');
    await user.type(screen.getByLabelText(/^password$/i), 'x');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // `type="email"` + `required` on a real <form>: the browser blocks the
    // submit, so no credentials leave the page. (The component's own
    // `indexOf('@') < 1` guard backs this up for programmatic submits.)
    expect(email.checkValidity()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('form semantics', () => {
  it('submits on Enter — it is a real <form>, so password managers see a submit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, next: '/overview' }));
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderWithSF(<SignInForm />);

    await user.type(screen.getByLabelText(/work email/i), 'priya@example.test');
    await user.type(screen.getByLabelText(/^password$/i), 'correct horse battery{Enter}');

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.anything()));
  });

  it('ships no prefilled identity — the email field starts empty', () => {
    renderWithSF(<SignInForm />);
    expect(screen.getByLabelText(/work email/i)).toHaveValue('');
  });
});
