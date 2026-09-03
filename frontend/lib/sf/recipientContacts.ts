'use client';

/**
 * The contact side of adding a recipient.
 *
 * Two rules the sender should never have to think about:
 *
 *  1. Typing an address once is enough — whoever is put on an envelope is kept
 *     in the tenant's address book, so the next envelope offers them as a
 *     suggestion instead of asking for the address again.
 *  2. Nothing here may block the envelope. A failed contact write is reported
 *     as "not saved to contacts", never as a failed recipient add: the
 *     recipient is already persisted by the time these run.
 */

import { apiCall } from '@/lib/api/browser';
import { contacts as contactsApi } from '@/lib/api/resources';
import type { ContactResponse } from '@/lib/api/types';

/** What happened to the address book, for the toast the caller shows. */
export type RememberResult = 'created' | 'existing' | 'failed';

/**
 * Save a recipient into the tenant's contacts. A 409 means the address is
 * already there, which is a success from the sender's point of view.
 */
export async function rememberContact(name: string, email: string): Promise<RememberResult> {
  const result = await contactsApi.create(apiCall, {
    name,
    email,
    source: 'manual',
    default_role: 'sign',
  });
  if (result.ok) return 'created';
  return result.status === 409 ? 'existing' : 'failed';
}

/** One suggestion row: what the picker shows and what it fills in. */
export type ContactSuggestion = { id: string; name: string; email: string };

/**
 * Contacts matching what has been typed so far.
 *
 * The query goes to the API rather than being filtered in the browser: the
 * address book can be far larger than one page, and `GET /api/contacts` already
 * searches name, email and company. An empty query returns the first page, so
 * focusing the field with nothing typed still suggests recent contacts.
 */
export async function searchContacts(query: string, limit = 8): Promise<ContactSuggestion[]> {
  const trimmed = query.trim();
  const result = await contactsApi.list(apiCall, trimmed ? { q: trimmed, limit } : { limit });
  if (!result.ok) return [];
  return result.data.items.map((c: ContactResponse) => ({ id: c.id, name: c.name, email: c.email }));
}
