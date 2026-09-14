/**
 * `GET /api/embed/context`, mirroring `backend/app/schemas/embed.py`.
 *
 * Beside the route rather than in `lib/api/types.ts` for the same reason the
 * signing types are: these endpoints are token-authenticated, not
 * session-authenticated, so the shared data layer does not model them.
 */

import type { DocumentResponse, FieldResponse, RecipientResponse } from '@/lib/api/types';

export const LANDINGS = ['builder', 'routing', 'signing'] as const;
export type EmbedLanding = (typeof LANDINGS)[number];

/** One entry of `EmbedSession.contact_ids` — either a resolved recipient or a
 *  free-form contact the host injected when minting the session. */
export type EmbedContact = {
  recipient_id?: string;
  id?: string;
  name?: string;
  email?: string;
  role?: string;
};

export type EmbedSessionResponse = {
  id: string;
  url: string;
  landing: EmbedLanding;
  document_id: string | null;
  external_id: string | null;
  return_url: string | null;
  allowed_origins: string[];
  contacts: EmbedContact[];
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
  expired: boolean;
};

export type EmbedContextResponse = {
  session: EmbedSessionResponse;
  frame_ancestors: string[];
  document: DocumentResponse | null;
  fields: FieldResponse[];
  recipients: RecipientResponse[];
};
