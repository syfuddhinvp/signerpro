'use client';

/**
 * Hand-off of an MFA challenge from `/login` to `/login/verify`.
 *
 * The challenge token is a short-lived (5 minute) bearer credential for the
 * second factor, so it is kept in `sessionStorage` rather than the URL: query
 * strings land in history, in `Referer` and in server logs.
 */

const KEY = 'sf.mfa.challenge';

export type MfaChallenge = {
  mfaToken: string;
  delivery: string;
  maskedTarget: string;
  email: string;
  remember: boolean;
  next?: string;
};

export function storeChallenge(challenge: MfaChallenge): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(challenge));
  } catch {
    /* private mode / storage disabled — the verify screen will send them back */
  }
}

export function readChallenge(): MfaChallenge | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MfaChallenge;
    return typeof parsed?.mfaToken === 'string' && parsed.mfaToken ? parsed : null;
  } catch {
    return null;
  }
}

export function clearChallenge(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
