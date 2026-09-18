/**
 * The tenant record page's sections.
 *
 * Deliberately *not* in `TenantRecord.tsx`: that file is `'use client'`, and a
 * value imported from a client module into a server component arrives as a
 * client reference, not the value — `TENANT_RECORD_TABS.some(...)` threw
 * "is not a function" at request time while every unit test, which imports the
 * real module, passed. Anything both sides read lives here.
 */

/** `[?tab= value, label]`, in the order the strip renders them. */
export const TENANT_RECORD_TABS: Array<[string, string]> = [
  ['overview', 'Overview'],
  ['users', 'Users'],
  ['documents', 'Documents'],
  ['billing', 'Billing'],
  ['payments', 'Signer payments'],
  ['developer', 'API & webhooks'],
  ['activity', 'Activity'],
];

/** The requested tab, or `overview` for anything unrecognised. */
export function tenantRecordTab(requested: string | undefined): string {
  return TENANT_RECORD_TABS.some(([key]) => key === requested) ? String(requested) : 'overview';
}
