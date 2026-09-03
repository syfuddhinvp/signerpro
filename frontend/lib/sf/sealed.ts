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
