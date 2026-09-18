/**
 * A sealed envelope has one screen.
 *
 * Prepare, Workflow and Signer view used to stay reachable after completion:
 * the sender could drag fields around a contract the API had already locked and
 * only learn it was finished when the autosave was refused.
 */
import { describe, it, expect } from 'vitest';
import { isLockedStatus, isSealedStatus } from './sealed';
import { sidebarGroups, type NavContext } from './navigation';

const ctx = (sealed: boolean, locked = sealed): NavContext => ({
  workspace: 'tenant', area: 'documents', screen: 'audit', role: 'admin', section: '', folder: 'documents',
  documentId: 'doc-1', accountSection: '', documentSealed: sealed, documentLocked: locked,
  counts: { quick: null, folders: null, invoices: null, logs: null, tickets: null, notifications: null },
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

describe('isLockedStatus', () => {
  it('locks everything the API refuses to author — sent onwards', () => {
    for (const status of ['sent', 'viewed', 'partially_completed', 'completed', 'voided', 'declined', 'expired', 'SENT']) {
      expect(isLockedStatus(status)).toBe(true);
    }
  });

  it('leaves the two editable statuses alone', () => {
    for (const status of ['draft', 'prepared', 'PREPARED']) {
      expect(isLockedStatus(status)).toBe(false);
    }
  });

  it('treats an unknown status as still editable', () => {
    for (const status of ['', null, undefined]) {
      expect(isLockedStatus(status)).toBe(false);
    }
  });
});

describe('the envelope sidebar', () => {
  it('offers all four stages while the envelope is live', () => {
    const rows = sidebarGroups(ctx(false))[0].rows.map(r => r.label);
    expect(rows).toEqual(['Prepare', 'Workflow', 'Signer view', 'Audit trail']);
  });

  it('drops the authoring stages once it is out for signature', () => {
    const rows = sidebarGroups(ctx(false, true))[0].rows.map(r => r.label);
    expect(rows).toEqual(['Signer view', 'Audit trail']);
  });

  it('offers only the audit trail once it is sealed', () => {
    const rows = sidebarGroups(ctx(true))[0].rows.map(r => r.label);
    expect(rows).toEqual(['Audit trail']);
  });
});
