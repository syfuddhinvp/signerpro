/**
 * The public signing session, mirroring `backend/app/schemas/signer.py`.
 *
 * These live beside the route rather than in `lib/api/types.ts` because the
 * signing endpoints are token-authenticated, not session-authenticated: they
 * are the only part of the API the data layer does not (yet) model. Field names
 * are snake_case, exactly as the API returns them.
 */

import type { FieldResponse, RecipientStatus } from '@/lib/api/types';

export type PublicDocument = {
  title: string;
  status: string;
  workflow_type: 'sequential' | 'parallel';
  page_count: number;
};

export type PublicRecipient = {
  name: string;
  email: string;
  role_name: string | null;
  /** Typed role: sign | approve | copy | inperson. `role_name` is the free-text
   *  label the sender typed and must never be tested against these values. */
  role: 'sign' | 'approve' | 'copy' | 'inperson';
  status: RecipientStatus;
};

/** `backend/app/schemas/signer.py:FieldPlacementResponse` — geometry only. */
export type FieldPlacement = {
  id: string;
  type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SigningSessionResponse = {
  document: PublicDocument;
  recipient: PublicRecipient;
  current_recipient_id: string;
  fields: FieldResponse[];
  /**
   * Other recipients' placements, redacted to geometry only
   * (`FieldPlacementResponse`) — the signing surface needs to know a region of
   * the page is spoken for without learning whose it is or what it says.
   */
  other_field_placements: FieldPlacement[];
  read_only: boolean;
  expires_at: string;
  pdf_url: string;
  required_total: number;
  required_completed: number;
  otp_required: boolean;
  consent_required: boolean;
  document_id: string;
  assigned_field_ids: string[];
  consent_accepted: boolean;
  consent_accepted_at: string | null;
  consent_version: string;
  can_decline: boolean;
  can_reassign: boolean;
};

export type CompletionResponse = {
  document_status: string;
  recipient_status: string;
  final_pdf_url: string | null;
};

export type ReassignResponse = {
  recipient_id: string;
  previous_email: string;
  new_email: string;
  signing_url: string;
};

/** What went wrong with the link, in the vocabulary the UI renders a state for. */
export type TokenProblem =
  | 'invalid'      // 404 — no such token
  | 'revoked'      // 403 — superseded by a reminder or resend
  | 'expired'      // 410 — past `expires_at`
  | 'unavailable'  // 410 — envelope voided / expired / declined
  | 'waiting'      // 403 — sequential routing has not reached this recipient
  | 'throttled'    // 429 — signing-session rate limit
  | 'unreachable'; // network / 5xx

/** Map an `ApiError` onto a `TokenProblem`. The messages come from
 *  `token_service.get_valid_token` and `signing_service.load_session`. */
export function tokenProblemFor(status: number, message: string): TokenProblem {
  const text = (message || '').toLowerCase();
  if (status === 404) return 'invalid';
  if (status === 403) return text.includes('revoked') ? 'revoked' : 'waiting';
  if (status === 410) return text.includes('expired') && text.includes('link') ? 'expired' : 'unavailable';
  if (status === 429) return 'throttled';
  return 'unreachable';
}
