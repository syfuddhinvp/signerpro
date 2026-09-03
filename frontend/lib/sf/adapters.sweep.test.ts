/**
 * Null-safety sweep over every adapter.
 *
 * Screens render from `adapters.ts` on the server, so an adapter that throws
 * on a blank or partial DTO is a 500, not a blank cell. This calls every
 * exported adapter with the emptiest input its signature accepts and asserts
 * two things: it does not throw, and it does not invent a value — no string
 * from the prototype's seed data may appear in the result.
 */

import { describe, it, expect } from 'vitest';
import * as adapters from './adapters';
import { DOCS, RECIPIENTS, TEMPLATES } from './data';

const SEED = [
  ...DOCS.map(d => d.id),
  ...DOCS.map(d => d.title),
  ...RECIPIENTS.map(r => r.name),
  ...RECIPIENTS.map(r => r.email),
  ...TEMPLATES.map(t => t.title),
  'Acme Corporation', 'Northwind Analytics', 'priya@acme.io',
].filter(value => typeof value === 'string' && value.length > 3);

/**
 * Argument shapes an adapter might take, emptiest first. The first set that
 * does not throw is the one the adapter accepts; if none do, the adapter is
 * not empty-input safe and the test says which.
 */
const CANDIDATES: unknown[][] = [
  [],
  // A DTO with only its identity — the shape a freshly-created row has.
  [{ id: '' }],
  [{ id: '' }, '', ''],
  [{ id: '', stats: {}, series: [], attention: [], spend_lines: [], team: [], range: '90d' }],
  // A reader function (the URL-query adapters take one).
  [() => ''],
  [() => '', () => ''],
  // Two-collection adapters (label lists, tile builders).
  ['', []],
  ['', [], []],
  [[], [], []],
  [{ envelope_id: '' }, '', ''],
  [{ id: '', envelope_id: '' }, [], []],
  [[]],
  [{}],
  [null],
  [[], []],
  [{}, {}],
  [{}, '', ''],
  [[], {}],
  ['', ''],
  [''],
  [0],
  [{}, 0],
  [[], 0],
];

const SKIP = new Set([
  // Not adapters: constants and type-only exports carry no behaviour.
  'EMPTY', 'LIBRARY_FILTER_DEFAULTS', 'LIBRARY_QUERY_KEYS', 'EMPTY_ORG_OVERVIEW',
]);

/**
 * Adapters whose contract is a *complete* API response — they read numeric
 * fields directly (`.toFixed`, `.toLocaleString`) rather than defaulting them.
 * Every caller passes `res.data` from an `ok` result, so a partial payload
 * cannot reach them; they are asserted with full DTOs below instead.
 */
const NEEDS_COMPLETE_DTO: Record<string, unknown[]> = {
  toPlanPreviewPairs: [{
    target_plan_name: '', target_amount_cents: 0, seats_licensed: 0,
    proration_cents: 0, next_invoice_total_cents: 0,
  }],
  toPlatformStats: [{
    tenants: { total: 0, trial: 0, suspended: 0, active: 0 },
    seats: { provisioned: 0, activated: 0 },
    envelopes_30d: 0, mrr_cents: 0, incidents_90d: 0, uptime_pct: 0,
  }],
  certificationLabel: [{ name: '', status: '' }],
  toBalanceTiles: [{
    currency: '', available_cents: 0, pending_cents: 0, pending_settles_at: null,
    next_payout_cents: 0, next_payout_at: null, payout_destination: '',
    disputes_cents: 0, dispute_count: 0, dispute_rate_pct: 0,
  }],
  toChurnRows: [{
    gross_logo_churn_pct: 0, net_revenue_retention_pct: 0,
    involuntary_churn_pct: 0, trial_conversion_pct: 0,
  }],
};

const FUNCTIONS = Object.entries(adapters)
  .filter(([name, value]) => typeof value === 'function' && !SKIP.has(name)) as [string, (...args: unknown[]) => unknown][];

describe('every adapter survives an empty DTO', () => {
  it('the sweep actually covers the module', () => {
    expect(FUNCTIONS.length).toBeGreaterThan(80);
  });

  it.each(FUNCTIONS)('%s', (name, fn) => {
    const complete = NEEDS_COMPLETE_DTO[name];
    const candidates = complete ? [complete, ...CANDIDATES] : CANDIDATES;
    const failures: string[] = [];
    let result: unknown;
    let accepted = false;
    for (const args of candidates) {
      try {
        result = fn(...args);
        accepted = true;
        break;
      } catch (error) {
        failures.push(`${JSON.stringify(args)} → ${(error as Error).message}`);
      }
    }
    expect(accepted, `${name} threw on every empty input:\n  ${failures.join('\n  ')}`).toBe(true);

    const text = JSON.stringify(result ?? null) ?? '';
    for (const seed of SEED) {
      expect(text, `${name} returned prototype seed data "${seed}"`).not.toContain(seed);
    }
  });
});
