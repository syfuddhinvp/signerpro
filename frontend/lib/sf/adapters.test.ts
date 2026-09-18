/**
 * `lib/sf/adapters.ts` — the DTO → screen boundary.
 *
 * Two invariants are enforced here:
 *
 *  1. **Round-trip.** Library filters survive query → filters → query → params
 *     unchanged, and defaults are omitted from the URL so a shared link says
 *     what it filters and nothing more.
 *  2. **Honesty.** Fed a null/zero-filled DTO, every adapter must produce
 *     `—`, `0`, or a documented derivation. No string from the prototype seed
 *     data in `lib/sf/data.ts` may ever appear in adapter output — that is what
 *     turns "adapters.ts never fabricates a value" from a property of today's
 *     code into an enforced invariant.
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY,
  toCertificationViews,
  LIBRARY_FILTER_DEFAULTS,
  envelopeRef,
  formatCents,
  formatCentsK,
  formatCompact,
  formatCount,
  formatDate,
  formatDayMonth,
  formatMinutes,
  formatRelative,
  formatSeconds,
  formatSignedPct,
  initialsOf,
  libraryFiltersFromQuery,
  libraryFiltersToQuery,
  libStatusToApiStatus,
  toAttestations,
  toBalanceTiles,
  toAuditRows,
  toCertificateCard,
  toContact,
  toLibraryRow,
  toLogRow,
  toOverviewStats,
  toPlanPreviewPairs,
  toTemplateRow,
  toLibraryParams,
  toTemplateParams,
  EMPTY_ORG_OVERVIEW,
  type LibraryFilters,
  displayNameFromEmail,
  newBuilderRecipient,
  isLocalRecipientId,
  toRecipientSetItems,
} from './adapters';
import { DOCS, RECIPIENTS, TEMPLATES } from './data';

/* ── 1. library filter round-trip ───────────────────────────────────────── */

describe('library filters round-trip', () => {
  const fromSearch = (search: string) => {
    const params = new URLSearchParams(search);
    return libraryFiltersFromQuery(key => params.get(key));
  };

  it('fills in every default when the URL is bare', () => {
    expect(fromSearch('')).toEqual(LIBRARY_FILTER_DEFAULTS);
  });

  it('survives query → filters → query with nothing added or lost', () => {
    const search = '?folder=archive&status=draft&type=nda&time=30&owner=me&q=acme+renewal&sort=name';
    const filters = fromSearch(search);
    expect(filters).toEqual({
      folder: 'archive', status: 'draft', type: 'nda', time: '30', from: '', to: '',
      owner: 'me', q: 'acme renewal', sort: 'name',
    });
    // …and back to a URL that re-parses to the identical filters.
    const roundTripped = libraryFiltersToQuery(filters);
    expect(fromSearch(roundTripped)).toEqual(filters);
  });

  it('omits defaults from the URL, so a shared link filters only what it says', () => {
    expect(libraryFiltersToQuery(LIBRARY_FILTER_DEFAULTS)).toBe('');
    expect(libraryFiltersToQuery({ ...LIBRARY_FILTER_DEFAULTS, status: 'draft' })).toBe('?status=draft');
  });

  it('trims whitespace-only values back to their default', () => {
    const params = new URLSearchParams('?q=%20%20&status=%20');
    const filters = libraryFiltersFromQuery(key => params.get(key));
    expect(filters.q).toBe('');
    expect(filters.status).toBe('all');
    expect(libraryFiltersToQuery(filters)).toBe('');
  });

  it('maps filters onto API params, dropping every "all"', () => {
    const params = toLibraryParams(LIBRARY_FILTER_DEFAULTS, 12);
    expect(params).toEqual({ quick: 'all', limit: 12, offset: 0, sort: 'recent' });
    expect(params).not.toHaveProperty('status');
    expect(params).not.toHaveProperty('doc_type');
    expect(params).not.toHaveProperty('since_days');
    expect(params).not.toHaveProperty('owner');
    expect(params).not.toHaveProperty('q');
  });

  it('maps a fully-specified filter set onto the real query params', () => {
    const filters: LibraryFilters = {
      folder: 'archive', status: 'waiting', type: 'nda', time: '90', from: '', to: '',
      owner: 'team', q: ' msa ', sort: 'name',
    };
    expect(toLibraryParams(filters, 12, 24)).toEqual({
      quick: 'archived', limit: 12, offset: 24, status: 'sent',
      doc_type: 'nda', since_days: 90, owner: 'team', q: 'msa', sort: 'name',
    });
  });

  it('sends an inclusive date range instead of since_days when time is custom', () => {
    const filters: LibraryFilters = {
      ...LIBRARY_FILTER_DEFAULTS, time: 'custom', from: '2026-08-01', to: '2026-08-31',
    };
    const params = toLibraryParams(filters, 25);
    expect(params.updated_from).toBe('2026-08-01');
    expect(params.updated_to).toBe('2026-08-31');
    expect(params).not.toHaveProperty('since_days');
  });

  it('drops a half-typed date rather than sending it', () => {
    const filters: LibraryFilters = {
      ...LIBRARY_FILTER_DEFAULTS, time: 'custom', from: '2026-8', to: '2026-02-31',
    };
    const params = toLibraryParams(filters, 25);
    expect(params).not.toHaveProperty('updated_from');
    expect(params).not.toHaveProperty('updated_to');
  });

  it('treats an unknown folder as a real folder id, not a quick view', () => {
    const params = toLibraryParams({ ...LIBRARY_FILTER_DEFAULTS, folder: 'fld_9c2' }, 12);
    expect(params.quick).toBe('all');
    expect(params.folder_id).toBe('fld_9c2');
  });

  it('never sends a status the API does not define', () => {
    expect(libStatusToApiStatus('all')).toBeUndefined();
    expect(libStatusToApiStatus('made-up')).toBeUndefined();
    expect(libStatusToApiStatus('completed')).toBe('completed');
  });

  it('carries search and archive intent into the templates folder', () => {
    const params = toTemplateParams({ ...LIBRARY_FILTER_DEFAULTS, folder: 'archive', q: 'nda' }, 8);
    expect(params).toMatchObject({ limit: 8, offset: 0, q: 'nda', include_archived: true, sort: 'recent' });
  });
});

/* ── 2. adapters never fabricate ────────────────────────────────────────── */

/**
 * Every string the prototype seeded a screen with. If one of these turns up in
 * adapter output, a screen is showing the demo's data as the tenant's own.
 */
const SEED_STRINGS: string[] = [
  ...DOCS.flatMap(d => [d.id, d.title, d.updated]),
  ...RECIPIENTS.flatMap(r => [r.name, r.email]),
  ...TEMPLATES.flatMap(t => [t.title, t.owner, t.updated]),
  'Acme Corporation', 'Northwind Analytics', 'priya@acme.io', 'acme.io',
  'INV-2026-0841', 'SF-4471', '4.1M of 10M', '100% uptime',
].filter(s => typeof s === 'string' && s.length > 3);

function assertNoSeedData(label: string, value: unknown): void {
  const text = JSON.stringify(value) ?? '';
  for (const seed of SEED_STRINGS) {
    if (text.includes(seed)) {
      throw new Error(`${label} fabricated seed data from lib/sf/data.ts: "${seed}" in ${text}`);
    }
  }
}

/** Every leaf string in an adapter's output. */
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}

describe('adapters degrade to em-dash / zero, never to invented values', () => {
  it('formatters return the em-dash for absent input', () => {
    for (const fn of [formatDate, formatRelative, formatDayMonth, formatMinutes]) {
      expect(fn(null as never)).toBe(EMPTY);
      expect(fn(undefined as never)).toBe(EMPTY);
    }
    expect(formatDate('not-a-date')).toBe(EMPTY);
    expect(formatRelative('not-a-date')).toBe(EMPTY);
  });

  it('numeric formatters return zeroes, not placeholders', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCentsK(0)).toBe('$0.0k');
    expect(formatCompact(0)).toBe('0');
    expect(formatCompact(null)).toBe('0');
    expect(formatSeconds(null)).toBe('0s');
    expect(formatSignedPct(0)).toBe('0.0%');
  });

  it('envelope refs are derived from the real id, never minted', () => {
    expect(envelopeRef('9c2e4f61-77aa-4b1e-9f10-0c1a2b3c4d5e')).toBe('ENV-9C2E4F61');
    // Same id in, same ref out — the library row and the certificate must agree.
    expect(envelopeRef('9c2e4f61-77aa-4b1e-9f10-0c1a2b3c4d5e'))
      .toBe(envelopeRef('9c2e4f61-77aa-4b1e-9f10-0c1a2b3c4d5e'));
    expect(initialsOf('')).toBe('');
  });

  it('a null-filled document list item produces an empty row', () => {
    const row = toLibraryRow({
      id: '00000000-0000-0000-0000-000000000000',
      title: '',
      status: 'draft',
      page_count: null,
      recipients_completed: null,
      recipients_total: null,
      updated_at: null,
      owner_name: null,
      is_favorite: null,
    } as never);
    expect(row).toMatchObject({
      title: '', pages: 0, signed: 0, total: 0, updated: EMPTY, ownerName: EMPTY, isFavorite: false, to: [],
    });
    assertNoSeedData('toLibraryRow', row);
  });

  it('a null-filled template produces an empty row', () => {
    const row = toTemplateRow({
      id: '11111111-1111-1111-1111-111111111111',
      title: '', use_count: null, field_count: null, updated_at: null, owner_name: null,
    } as never);
    expect(row).toMatchObject({ uses: 0, fields: 0, updated: EMPTY, owner: EMPTY });
    assertNoSeedData('toTemplateRow', row);
  });

  it('a bare contact keeps its own (empty) identity', () => {
    const contact = toContact({
      id: 'ct_0', name: '', email: '', company: null, title: null, phone: null,
      default_role: 'sign', group: '', source: 'manual', tags: [], envelope_count: 0, last_signed_at: null,
    } as never);
    expect(contact.envelopes).toBe(0);
    expect(contact.lastSigned).toBe(EMPTY);
    assertNoSeedData('toContact', contact);
  });

  it('a log row with no HTTP context shows em-dashes, not zeroes it invented', () => {
    const row = toLogRow({
      id: 'log_1', occurred_at: null, level: 'info', source: 'signing',
      message: '', status_code: null, latency_ms: null, payload: null,
    } as never);
    expect(row).toMatchObject({ ts: EMPTY, code: EMPTY, latency: EMPTY, payload: '{}' });
    assertNoSeedData('toLogRow', row);
  });

  it('an empty audit trail produces no rows, and a bare entry no invented meta', () => {
    expect(toAuditRows([])).toEqual([]);
    const [row] = toAuditRows([{
      id: 'a1', event_type: 'document_viewed', event_message: null, created_at: null,
      ip_address: null, user_agent: null, log_metadata: null, checksum: '', recipient_id: null,
      user_id: null, kind: '',
    } as never]);
    expect(row).toMatchObject({ action: 'Document viewed', actor: 'system', time: EMPTY, meta: EMPTY, kind: 'neutral' });
    assertNoSeedData('toAuditRows', row);
  });

  it('an unsealed certificate says so instead of showing a hash', () => {
    const card = toCertificateCard({
      envelope_id: '22222222-2222-2222-2222-222222222222',
      final_sha256: null, original_sha256: null, sealed_at: null,
      signers_completed: 0, signers_total: 0,
      hash_algorithm: 'SHA-256', time_source: '', certificate_authority: '',
    } as never, 'draft', 'Draft');
    expect(card.documentHash).toBe('sha256 pending · no PDF sealed yet');
    expect(card.issued).toBe('not sealed yet');
    expect(card.rows.find(r => r.k === 'Sealed at')?.v).toBe(EMPTY);
    expect(card.rows.find(r => r.k === 'Signers')?.v).toBe('0 of 0 completed');
    // No DigiCert, no RFC 3161 — the design's claims are not the API's.
    expect(JSON.stringify(card)).not.toMatch(/DigiCert|RFC 3161/);
    assertNoSeedData('toCertificateCard', card);
  });

  it('attestations come from real recipients only', () => {
    expect(toAttestations([], [])).toEqual([]);
    assertNoSeedData('toAttestations', toAttestations([], []));
  });

  it('an empty overview renders zeroes with honest metas, not a healthy workspace', () => {
    const tiles = toOverviewStats(EMPTY_ORG_OVERVIEW);
    expect(tiles.map(t => t.value)).toEqual(['0', '0', '0', '0%']);
    expect(tiles[0].meta).toBe('nothing waiting on you');
    expect(tiles.every(t => t.pct === 0)).toBe(true);
    assertNoSeedData('toOverviewStats', tiles);
  });

  it('no adapter output contains any prototype seed string', () => {
    const outputs: [string, unknown][] = [
      ['toLibraryRow', toLibraryRow({ id: 'a', title: 't', status: 'draft' } as never)],
      ['toTemplateRow', toTemplateRow({ id: 'b', title: 't' } as never)],
      ['toOverviewStats', toOverviewStats(EMPTY_ORG_OVERVIEW)],
      ['toAuditRows', toAuditRows([])],
      ['toLogRow', toLogRow({ id: 'c', level: 'info', source: 'api', message: 'm' } as never)],
    ];
    for (const [label, value] of outputs) {
      assertNoSeedData(label, value);
      // and nothing that looks like a fabricated envelope reference
      for (const leaf of leaves(value)) expect(leaf).not.toMatch(/ENV-2291/);
    }
  });
});

describe('recipients typed by email alone', () => {
  it('derives the display name the API requires from the address', () => {
    expect(displayNameFromEmail('sarah.mitchell@acme.io')).toBe('Sarah Mitchell');
    expect(displayNameFromEmail('dev_patel+signforge@acme.io')).toBe('Dev Patel Signforge');
    expect(displayNameFromEmail('OPS@acme.io')).toBe('Ops');
    // Digit-only fragments are noise, not names.
    expect(displayNameFromEmail('sarah.2@acme.io')).toBe('Sarah');
    // Nothing usable in the local part: show the address rather than a blank.
    expect(displayNameFromEmail('123@acme.io')).toBe('123@acme.io');
    expect(displayNameFromEmail('')).toBe('Recipient');
  });

  it('mints a local row the full replace will create, not update', () => {
    const created = newBuilderRecipient('', 'sarah@acme.io', []);
    expect(isLocalRecipientId(created.id)).toBe(true);
    expect(created.email).toBe('sarah@acme.io');
    expect(created.name).toBe('Sarah');
    expect(created.order).toBe(1);
    expect(created.role).toBe('sign');
    // A typed name always wins over the derived one.
    expect(newBuilderRecipient('Dr. S. Mitchell', 'sarah@acme.io', []).name).toBe('Dr. S. Mitchell');
    // Email is normalised — the API lower-cases it and rejects duplicates.
    expect(newBuilderRecipient('', ' SARAH@Acme.IO ', []).email).toBe('sarah@acme.io');
  });

  it('sends no id for a local row, and the real id for a known one', () => {
    const local = newBuilderRecipient('', 'new@acme.io', []);
    const known = { ...local, id: 'r1', email: 'known@acme.io' };
    const items = toRecipientSetItems([known, local], id => id === 'r1');
    expect(items[0].id).toBe('r1');
    expect(items[1].id).toBeUndefined();
    expect(items.map(i => i.signing_order)).toEqual([1, 2]);
  });
});

describe('plan change preview rows tell the truth about when and what', () => {
  const base = {
    current_plan_code: 'business',
    current_plan_name: 'Business',
    target_plan_code: 'team',
    target_plan_name: 'Team',
    cycle: 'monthly',
    currency: 'USD',
    seats_licensed: 3,
    current_amount_cents: 9000,
    target_amount_cents: 3600,
    proration_cents: -2700,
    remaining_fraction: 0.5,
    effective_at: '2026-10-14T00:00:00Z',
    next_invoice_total_cents: 3600,
    next_invoice_at: '2026-10-14T00:00:00Z',
    is_downgrade: true,
    direction: 'downgrade' as const,
    effective_mode: 'period_end' as const,
    scheduled: true,
    amount_due_cents: 0,
    wallet_balance_cents: 0,
    wallet_applied_cents: 0,
    charge_cents: 0,
    wallet_credit_cents: 0,
    blockers: [],
    warnings: [],
    allowed: true,
  };

  it('a scheduled change leads with the date and charges nothing', () => {
    const rows = Object.fromEntries(toPlanPreviewPairs(base));
    expect(rows['Starts']).toBe(formatDate('2026-10-14T00:00:00Z'));
    // Not "Prorated today $0.00", which is true and tells the user nothing.
    expect(rows['Due today']).toContain('you keep Business until then');
    expect(rows['Prorated today']).toBeUndefined();
  });

  it('an immediate downgrade names the credit rather than a refund', () => {
    const rows = Object.fromEntries(
      toPlanPreviewPairs({
        ...base,
        scheduled: false,
        effective_mode: 'immediately',
        wallet_credit_cents: 2700,
      }),
    );
    expect(rows['Credited to balance']).toBe(formatCents(2700));
  });

  it('balance spent on an upgrade is shown separately from the card', () => {
    const rows = Object.fromEntries(
      toPlanPreviewPairs({
        ...base,
        direction: 'upgrade',
        is_downgrade: false,
        scheduled: false,
        effective_mode: 'immediately',
        amount_due_cents: 5000,
        wallet_balance_cents: 2000,
        wallet_applied_cents: 2000,
        charge_cents: 3000,
      }),
    );
    expect(rows['Account balance']).toBe('−' + formatCents(2000));
    expect(rows['Charged today']).toBe(formatCents(3000));
  });
});

describe('toBalanceTiles', () => {
  const base = {
    currency: 'USD', available_cents: 41255, pending_cents: 9800,
    pending_settles_at: null, next_payout_cents: 40000, next_payout_at: null,
    payout_destination: 'stripe', disputes_cents: 0, dispute_count: 0,
    dispute_rate_pct: null as number | null,
    source: 'provider' as 'provider' | 'ledger',
    other_currencies: [] as string[],
  };

  const metaOf = (tiles: { label: string; meta: string }[], label: string) =>
    tiles.find(t => t.label === label)!.meta;

  it('an unknown dispute rate reads as unknown, not as zero', () => {
    /* `0.0% rate` would claim we checked and found none. We did not check. */
    expect(metaOf(toBalanceTiles(base), 'DISPUTES')).toBe('0 open · rate n/a');
  });

  it('a known dispute rate is still shown', () => {
    expect(metaOf(toBalanceTiles({ ...base, dispute_count: 2, dispute_rate_pct: 1.5 }), 'DISPUTES'))
      .toBe('2 open · 1.5% rate');
  });

  it('a ledger-derived balance says it is an estimate', () => {
    expect(metaOf(toBalanceTiles({ ...base, source: 'ledger' }), 'AVAILABLE'))
      .toBe('usd · estimated from charges');
  });

  it('a provider balance does not call itself an estimate', () => {
    expect(metaOf(toBalanceTiles(base), 'AVAILABLE')).toBe('usd · available to pay out');
  });

  it('currencies excluded from the figures are named rather than dropped', () => {
    expect(metaOf(toBalanceTiles({ ...base, other_currencies: ['EUR', 'GBP'] }), 'AVAILABLE'))
      .toBe('usd · plus eur, gbp');
  });

  it('pending money with no settlement date is still in transit', () => {
    expect(metaOf(toBalanceTiles(base), 'PENDING')).toBe('in transit');
    expect(metaOf(toBalanceTiles({ ...base, pending_cents: 0 }), 'PENDING')).toBe('nothing in transit');
  });
});


describe('toCertificationViews', () => {
  const api = {
    certifications: [],
    last_key_rotation_at: null,
    rotation_interval_days: 90,
    key_rotation_implemented: false,
    disclaimer: '',
  };
  const row = {
    id: 'c1', name: 'SOC 2 Type II', status: 'certified', effective_status: 'certified',
    expired: false, auditor: 'Acme LLP', assessed_on: '2026-01-15', expires_on: '2027-01-15',
    evidence_url: 'https://acme.example/soc2.pdf', notes: null, updated_at: null,
  };

  it('shows the evidence behind a current attestation', () => {
    const [view] = toCertificationViews({ ...api, certifications: [row] });
    expect(view.label).toBe('SOC 2 Type II');
    expect(view.evidence).toBe('Acme LLP · assessed 2026-01-15 · expires 2027-01-15');
  });

  it('says so when a certified record has no report behind it', () => {
    const [view] = toCertificationViews({
      ...api,
      certifications: [{ ...row, auditor: null, assessed_on: null, expires_on: null, evidence_url: null }],
    });
    expect(view.evidence).toBe('no report linked');
  });

  it('a lapsed attestation reads as expired, not as certified', () => {
    const [view] = toCertificationViews({
      ...api,
      certifications: [{ ...row, effective_status: 'expired', expired: true, expires_on: '2021-01-15' }],
    });
    expect(view.label).toBe('SOC 2 Type II (expired)');
    expect(view.evidence).toContain('expired 2021-01-15');
    // The stored value is untouched — the editor still opens on what the
    // operator recorded, so it can be corrected rather than guessed at.
    expect(view.status).toBe('certified');
  });

  it('an unassessed record claims nothing', () => {
    const [view] = toCertificationViews({
      ...api,
      certifications: [{ ...row, status: 'not_assessed', effective_status: 'not_assessed', auditor: null, assessed_on: null, expires_on: null, evidence_url: null }],
    });
    expect(view.label).toBe('SOC 2 Type II (not assessed)');
    expect(view.evidence).toBe('No evidence recorded.');
  });
});
