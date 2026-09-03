/**
 * A sealed envelope has one screen.
 *
 * Prepare, Workflow and Signer view used to stay reachable after completion:
 * the sender could drag fields around a contract the API had already locked and
 * only learn it was finished when the autosave was refused.
 */
import { describe, it, expect } from 'vitest';
import { isSealedStatus } from './sealed';
import { sidebarGroups, type NavContext } from './navigation';

const ctx = (sealed: boolean): NavContext => ({
  workspace: 'tenant', area: 'documents', screen: 'audit', section: '', folder: 'documents',
  documentId: 'doc-1', accountSection: '', documentSealed: sealed,
  counts: { quick: null, folders: null, invoices: null, logs: null, tickets: null },
  folders: [],
});

describe('isSealedStatus', () => {
  it('covers every status after which authoring is refused', () => {
    for (const status of ['completed', 'voided', 'declined', 'expired', 'COMPLETED']) {
      expect(isSealedStatus(status)).toBe(true);
    }
  });

  it('leaves a live envelope alone', () => {
    for (const status of ['draft', 'sent', 'viewed', 'partially_completed', '', null, undefined]) {
      expect(isSealedStatus(status)).toBe(false);
    }
  });
});

describe('the envelope sidebar', () => {
  it('offers all four stages while the envelope is live', () => {
    const rows = sidebarGroups(ctx(false))[0].rows.map(r => r.label);
    expect(rows).toEqual(['Prepare', 'Workflow', 'Signer view', 'Audit trail']);
  });

  it('offers only the audit trail once it is sealed', () => {
    const rows = sidebarGroups(ctx(true))[0].rows.map(r => r.label);
    expect(rows).toEqual(['Audit trail']);
  });
});
