/**
 * What a role is allowed to see.
 *
 * There are two tenant roles (`admin` and `sender`, per the backend's
 * `UserRole`), and until now the navigation offered both of them everything:
 * a sender saw Reports, Developer and the whole billing/organization half of
 * the account area, and clicking any of them reached a screen the API then
 * refused. A sender's job is to send documents, so their world is Home,
 * Documents, Contacts and the personal half of their account.
 *
 * The policy lives here, on its own, because three different layers need the
 * same answer and must not disagree: `middleware.ts` (edge — so this module
 * stays free of `next/headers` and of anything server-only), the navigation
 * model that builds the sidebar, and the account area that lists its sections.
 * Hiding a row is not access control on its own; the path check below is what
 * actually keeps a sender out of a typed-in URL.
 */
import type { AreaKey } from '@/lib/sf/routes';

export const SENDER_ROLE = 'sender';

/** Tenant roles other than `sender` (today: `admin`) get the full tree. */
export function isSender(role: string | null | undefined): boolean {
  return (role ?? '').trim().toLowerCase() === SENDER_ROLE;
}

/** The areas a sender may enter. Everything else is admin-only.
 *  Support is deliberately absent from the *sidebar* but still reachable:
 *  `/support` stays open below, because the help menu offers it to everyone
 *  and a sender who cannot raise a ticket has nowhere to go when stuck. */
const SENDER_AREAS: readonly AreaKey[] = ['home', 'documents', 'contacts', 'account'];

/** The account sections that are about the person rather than the organization. */
const SENDER_ACCOUNT_SECTIONS: readonly string[] = [
  'profile', 'security', 'notifications',
];

export function areaAllowed(area: AreaKey, role: string | null | undefined): boolean {
  return !isSender(role) || SENDER_AREAS.includes(area);
}

export function accountSectionAllowed(section: string, role: string | null | undefined): boolean {
  return !isSender(role) || SENDER_ACCOUNT_SECTIONS.includes(section);
}

/* The URL prefixes that belong to the areas and account sections a sender may
   not enter. `/platform` is not listed: it has its own guard, which fails
   closed on an unverified cookie. */
const SENDER_BLOCKED_PREFIXES = [
  '/reports', '/developer',
  '/account/billing',
  '/account/integrations', '/account/organization', '/account/audit',
];

/**
 * May this role load this path? Prefix-matched so `/developer/logs` and
 * `/account/billing?tab=…` are covered by their area's entry.
 */
export function pathAllowed(pathname: string, role: string | null | undefined): boolean {
  if (!isSender(role)) return true;
  return !SENDER_BLOCKED_PREFIXES.some(p => pathname === p || pathname.startsWith(p + '/'));
}
