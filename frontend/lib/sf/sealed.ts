/**
 * What a completed envelope still allows.
 *
 * Once every signer has finished, the envelope is evidence: its fields are
 * locked server-side, `final.pdf` is written and hashed, and the audit chain is
 * closed. The authoring screens were still reachable though — Prepare would
 * happily let a sender drag fields around a sealed contract and the autosave
 * would then be refused by the API, which is a confusing way to learn that the
 * document is finished. A sealed envelope has one screen: its audit trail.
 */

/** Statuses after which nothing about the envelope may be authored again. */
const SEALED_STATUSES = new Set(['completed', 'voided', 'declined', 'expired']);

export function isSealedStatus(status: string | null | undefined): boolean {
  return SEALED_STATUSES.has(String(status ?? '').toLowerCase());
}

/**
 * Statuses in which the envelope may still be authored. Mirrors the backend's
 * `document_service.EDITABLE_STATUSES` — once an envelope is sent, the API
 * refuses field, recipient and routing edits, so the authoring screens and the
 * header's envelope actions have nothing left to offer.
 */
const EDITABLE_STATUSES = new Set(['draft', 'prepared']);

/** True once the envelope is out for signature or past it. An unknown status
 *  is treated as still editable: hiding the actions on a status we failed to
 *  read would be a worse guess than letting the API answer. */
export function isLockedStatus(status: string | null | undefined): boolean {
  const s = String(status ?? '').toLowerCase();
  return s !== '' && !EDITABLE_STATUSES.has(s);
}
