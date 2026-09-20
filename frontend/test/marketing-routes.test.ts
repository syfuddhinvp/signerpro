/**
 * Every marketing page must actually be reachable without a session.
 *
 * `middleware.ts` denies by default, which is correct for e-signature software
 * and wrong-by-omission for a public site: when the marketing tree grew from
 * one page to thirty, the new routes type-checked, built and rendered, and then
 * answered a 307 to `/login` in production. Nothing in the type system or the
 * build can catch that, because the route file and the allowlist never refer to
 * each other.
 *
 * This walks the real directory and asserts the allowlist covers it, so the
 * failure mode is a failing test at the moment the page is added.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MARKETING_PUBLIC_PREFIXES } from '@/lib/marketing/routes';

const ROOT = resolve(__dirname, '..');
const MARKETING = resolve(ROOT, 'app/(marketing)');

/** Top-level route segments under `app/(marketing)/`. */
function marketingSegments(): string[] {
  return readdirSync(MARKETING)
    .filter(entry => statSync(join(MARKETING, entry)).isDirectory())
    // Route groups and private folders are not URL segments.
    .filter(entry => !entry.startsWith('(') && !entry.startsWith('_'));
}

/** Every `page.tsx` under the marketing tree, as a route path with params intact. */
function marketingPages(dir = MARKETING, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = entry.startsWith('(') ? prefix : `${prefix}/${entry}`;
      out.push(...marketingPages(full, segment));
    } else if (entry === 'page.tsx') {
      out.push(prefix || '/');
    }
  }
  return out;
}

describe('the marketing tree is public', () => {
  const allowed = MARKETING_PUBLIC_PREFIXES as readonly string[];

  it('finds the marketing routes on disk', () => {
    expect(existsSync(MARKETING)).toBe(true);
    expect(marketingSegments().length).toBeGreaterThan(5);
  });

  it('every top-level marketing segment is in the public allowlist', () => {
    const uncovered = marketingSegments().filter(segment => !allowed.includes(`/${segment}`));
    expect(
      uncovered,
      `these marketing routes would redirect to /login. Add them to ` +
        `lib/marketing/routes.ts: ${uncovered.map(s => `/${s}`).join(', ')}`,
    ).toEqual([]);
  });

  it('every marketing page matches a public prefix', () => {
    const blocked = marketingPages().filter(
      path => path !== '/' && !allowed.some(prefix => path === prefix || path.startsWith(`${prefix}/`)),
    );
    expect(blocked, `not reachable without a session: ${blocked.join(', ')}`).toEqual([]);
  });

  it('the allowlist has no entry without a route, so it cannot drift', () => {
    const segments = new Set(marketingSegments().map(segment => `/${segment}`));
    // `/legal` is listed ahead of the terms and privacy pages the footer links
    // to; everything else must exist.
    const orphans = allowed.filter(prefix => !segments.has(prefix) && prefix !== '/legal');
    expect(orphans, `allowlisted but no such route: ${orphans.join(', ')}`).toEqual([]);
  });

  /**
   * `/` must be rendered by the marketing group, not by `app/page.tsx`. Only
   * the group's layout sets `data-surface="marketing"`, and without it every
   * `mk-` utility on the home page resolves to nothing: the page builds, type
   * checks and returns 200 completely unstyled, which is exactly what happened.
   */
  it('the home page is inside the marketing group', () => {
    expect(
      existsSync(join(MARKETING, 'page.tsx')),
      'app/(marketing)/page.tsx is missing, so / renders without the marketing layout',
    ).toBe(true);
    expect(
      existsSync(resolve(ROOT, 'app/page.tsx')),
      'app/page.tsx would win the / route and render outside the marketing layout',
    ).toBe(false);
  });

  it('the marketing layout is what publishes the token scale', () => {
    const layout = readFileSync(join(MARKETING, 'layout.tsx'), 'utf8');
    expect(layout).toContain('data-surface="marketing"');
  });

  it('no prefix is broad enough to expose the application', () => {
    const appSegments = readdirSync(resolve(ROOT, 'app/(app)')).filter(entry =>
      statSync(join(ROOT, 'app/(app)', entry)).isDirectory(),
    );
    for (const prefix of allowed) {
      for (const segment of appSegments) {
        expect(
          `/${segment}` === prefix,
          `${prefix} would make the signed-in route /${segment} public`,
        ).toBe(false);
      }
    }
  });
});
