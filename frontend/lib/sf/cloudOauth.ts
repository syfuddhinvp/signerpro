/**
 * Which provider an in-flight OAuth grant belongs to.
 *
 * The redirect the provider sends the browser back to is one fixed url
 * (`/account/integrations/callback`) and carries only `code` and `state` — it
 * does not name the provider, and the callback endpoint is per-provider. So
 * the browser has to remember what it started, keyed by the `state` the
 * backend minted, which is the one value both ends of the round trip share.
 *
 * `sessionStorage` is the right shelf for it: it is scoped to the tab that
 * began the grant, it survives the full page load the provider forces, and it
 * is gone when the tab is. Every access is guarded — a browser with storage
 * blocked must still be able to render the page, it simply cannot finish a
 * grant, and the callback says so rather than guessing a provider.
 */

const PREFIX = 'signerpro.cloud-oauth.';

/** Remember the provider before handing the browser to the grant screen. */
export function rememberOauthProvider(state: string, provider: string): void {
  if (!state) return;
  try {
    window.sessionStorage.setItem(PREFIX + state, provider);
  } catch {
    /* Private mode or a blocked origin. The callback will ask them to retry. */
  }
}

/** The provider that started this `state`, or `null` if it is not known. */
export function takeOauthProvider(state: string): string | null {
  if (!state) return null;
  try {
    const provider = window.sessionStorage.getItem(PREFIX + state);
    /* One grant per state: consuming it stops a reload of the callback url
       from replaying an authorization code that has already been spent. */
    if (provider) window.sessionStorage.removeItem(PREFIX + state);
    return provider;
  } catch {
    return null;
  }
}
