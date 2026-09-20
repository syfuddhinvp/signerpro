/**
 * The two alternatives to a password on the sign-in card.
 *
 * What is worth pinning here is that neither can quietly do nothing. Both
 * buttons were dead UI for a long time, so these tests assert that pressing
 * them reaches the right endpoint, and that the passkey path ends where the
 * password path ends — a redirect, or the MFA verify screen.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { renderWithSF } from '@/test/utils';
import { router, resetNavigation } from '@/test/navigation';
import { readChallenge, clearChallenge } from '@/lib/auth/mfa-challenge';
import { AUTH_PATHS } from '@/lib/sf/routes';
import AuthAlternatives from './AuthAlternatives';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A stand-in for the object `navigator.credentials.get()` resolves with. */
const ASSERTION = {
  id: 'cred-1',
  type: 'public-key',
  getClientExtensionResults: () => ({}),
  rawId: new Uint8Array([1, 2, 3]).buffer,
  response: {
    clientDataJSON: new Uint8Array([4]).buffer,
    authenticatorData: new Uint8Array([5]).buffer,
    signature: new Uint8Array([6]).buffer,
    userHandle: null,
  },
};

const OPTIONS = { challenge: 'Y2hhbGxlbmdl', rpId: 'localhost', allowCredentials: [] };

function stubAuthenticator(assertion: unknown = ASSERTION) {
  vi.stubGlobal('PublicKeyCredential', function () {} as unknown);
  vi.stubGlobal('navigator', {
    ...window.navigator,
    credentials: { get: vi.fn().mockResolvedValue(assertion) },
  });
}

beforeEach(() => { resetNavigation(); clearChallenge(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('single sign-on', () => {
  it('sends the browser to the workspace SSO route', async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    // A full navigation, not a fetch — jsdom cannot perform one, so the
    // assignment itself is what the test observes.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { search: '', get href() { return ''; }, set href(value: string) { assign(value); } },
    });

    renderWithSF(<AuthAlternatives />);
    await user.click(screen.getByRole('button', { name: /continue with sso/i }));
    await user.type(screen.getByLabelText(/workspace/i), 'Acme');
    await user.click(screen.getByRole('button', { name: /identity provider/i }));

    expect(assign).toHaveBeenCalledWith('/api/auth/sso/login/acme');
  });

  it('refuses an empty workspace rather than navigating', async () => {
    const user = userEvent.setup();
    renderWithSF(<AuthAlternatives />);
    await user.click(screen.getByRole('button', { name: /continue with sso/i }));
    await user.click(screen.getByRole('button', { name: /identity provider/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/workspace name/i);
  });
});

describe('passkey sign-in', () => {
  it('runs the ceremony and lands on the app', async () => {
    stubAuthenticator();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, options: OPTIONS }))
      .mockResolvedValueOnce(json(200, { ok: true, user: {}, next: '/documents' }));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithSF(<AuthAlternatives />);
    await user.click(screen.getByRole('button', { name: /continue with passkey/i }));
    await user.type(screen.getByLabelText(/work email/i), 'priya@example.test');
    await user.click(screen.getByRole('button', { name: /use your passkey/i }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/documents'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/passkey/begin');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/passkey/finish');
  });

  it('carries an MFA challenge to the verify screen', async () => {
    stubAuthenticator();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, options: OPTIONS }))
      .mockResolvedValueOnce(json(200, {
        ok: true, mfaRequired: true, mfaToken: 'challenge-token', delivery: 'totp', maskedTarget: '',
      })));

    const user = userEvent.setup();
    renderWithSF(<AuthAlternatives />);
    await user.click(screen.getByRole('button', { name: /continue with passkey/i }));
    await user.type(screen.getByLabelText(/work email/i), 'priya@example.test');
    await user.click(screen.getByRole('button', { name: /use your passkey/i }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(AUTH_PATHS.mfa));
    expect(readChallenge()?.mfaToken).toBe('challenge-token');
  });

  it('says so when the authenticator is declined, and mints nothing', async () => {
    stubAuthenticator(null);
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { ok: true, options: OPTIONS }));
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderWithSF(<AuthAlternatives />);
    await user.click(screen.getByRole('button', { name: /continue with passkey/i }));
    await user.type(screen.getByLabelText(/work email/i), 'priya@example.test');
    await user.click(screen.getByRole('button', { name: /use your passkey/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no passkey was used/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('surfaces the server refusal verbatim', async () => {
    stubAuthenticator();
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(json(200, { ok: true, options: OPTIONS }))
      .mockResolvedValueOnce(json(403, {
        ok: false, code: 'forbidden', error: 'This workspace requires single sign-on',
      })));

    const user = userEvent.setup();
    renderWithSF(<AuthAlternatives />);
    await user.click(screen.getByRole('button', { name: /continue with passkey/i }));
    await user.type(screen.getByLabelText(/work email/i), 'priya@example.test');
    await user.click(screen.getByRole('button', { name: /use your passkey/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/requires single sign-on/i);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
