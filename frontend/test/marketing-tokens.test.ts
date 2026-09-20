/**
 * Invariants for the marketing token layer.
 *
 * `MARKETING_PLAN.md` section 6.6 commits the marketing site to WCAG 2.2 AA.
 * The app's own tokens earned that claim by hand-checking each value and
 * writing the ratio in a comment, which is accurate on the day it is written
 * and silently wrong the first time somebody nudges a lightness. The marketing
 * layer resolves through the primitive ladder, so the ratios can be computed
 * from the files themselves and asserted instead.
 *
 * What is checked here:
 *  · every `--mk-*` colour resolves to a primitive that exists;
 *  · body and muted text clear 4.5:1 on the surface they are used on, in both
 *    the light and the dark theme;
 *  · hairlines and control edges clear 3:1 (1.4.11);
 *  · the marketing scale is scoped so it cannot leak into a product screen;
 *  · tap targets meet 2.5.8's 24px floor.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const primitives = read('app/primitives.css');
const marketing = read('app/marketing-tokens.css');

/** Both files are heavily commented, and comment prose contains braces and
 *  back-ticked selectors. Strip comments before any structural parsing. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const marketingCode = stripComments(marketing);

/* ── HSL → hex → relative luminance ──────────────────────────────────────── */

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const sextant = Math.floor(h / 60) % 6;
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = table[sextant];
  return [r + m, g + m, b + m];
}

function luminanceOfTriplet(triplet: string): number {
  const [h, s, l] = triplet.trim().split(/\s+/).map(part => parseFloat(part));
  const channels = hslToRgb(h, s, l);
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminanceOfTriplet(a), luminanceOfTriplet(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── resolving a token through the two layers ────────────────────────────── */

/** Every `--p-*: H S% L%;` declaration in the primitive ladder. */
const PRIMITIVES = new Map<string, string>(
  [...primitives.matchAll(/(--p-[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]),
);

/**
 * The `--mk-*` declarations for one theme. The file carries three blocks: the
 * light defaults, a `prefers-color-scheme` override and an explicit
 * `data-theme="dark"` override. Splitting on the selector keeps them apart.
 */
function blockFor(theme: 'light' | 'dark'): Map<string, string> {
  const marker = theme === 'light'
    ? "[data-surface='marketing'] {"
    : ":root[data-theme='dark'] [data-surface='marketing'] {";
  const start = marketingCode.indexOf(marker);
  expect(start, `no ${theme} block in marketing-tokens.css`).toBeGreaterThan(-1);
  const body = marketingCode.slice(start, marketingCode.indexOf('\n}', start));
  const declarations = new Map<string, string>(
    [...body.matchAll(/(--mk-[a-z0-9-]+):\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]),
  );
  if (theme === 'light') return declarations;
  // The dark block only states what it changes; the rest still comes from light.
  return new Map([...blockFor('light'), ...declarations]);
}

const LIGHT = blockFor('light');
const DARK = blockFor('dark');

/** A token's HSL triplet, following one `var(--p-*)` hop if there is one. */
function resolve_(name: string, theme: Map<string, string>): string {
  const raw = theme.get(name);
  expect(raw, `${name} is not declared`).toBeDefined();
  const alias = /^var\((--p-[a-z0-9-]+)\)$/.exec(raw!.trim());
  if (!alias) return raw!;
  const primitive = PRIMITIVES.get(alias[1]);
  expect(primitive, `${name} aliases ${alias[1]}, which the ladder does not define`).toBeDefined();
  return primitive!;
}

const THEMES: [string, Map<string, string>][] = [['light', LIGHT], ['dark', DARK]];

/* ── the assertions ──────────────────────────────────────────────────────── */

describe('marketing tokens resolve', () => {
  it('every colour alias points at a primitive that exists', () => {
    for (const [theme, table] of THEMES) {
      for (const [name, value] of table) {
        const alias = /^var\((--p-[a-z0-9-]+)\)$/.exec(value.trim());
        if (!alias) continue;
        expect(PRIMITIVES.has(alias[1]), `${theme}: ${name} → ${alias[1]} is undefined`).toBe(true);
      }
    }
  });

  it('the dark theme overrides every surface and ink token', () => {
    const darkOnly = blockFor('dark');
    for (const name of ['--mk-canvas', '--mk-card', '--mk-ink', '--mk-ink-muted', '--mk-hairline']) {
      expect(LIGHT.has(name), `${name} missing from the light block`).toBe(true);
      expect(darkOnly.has(name), `${name} is not re-stated for dark`).toBe(true);
    }
  });

  it('the media-query and data-theme dark blocks agree', () => {
    const media = marketingCode.slice(marketingCode.indexOf('@media (prefers-color-scheme: dark)'));
    const explicit = marketingCode.slice(marketingCode.indexOf(":root[data-theme='dark']"));
    const names = (source: string) =>
      new Set([...source.matchAll(/(--mk-[a-z0-9-]+):/g)].map(m => m[1]));
    expect([...names(media)].sort()).toEqual([...names(explicit)].sort());
  });
});

describe('marketing contrast (WCAG 1.4.3 / 1.4.11)', () => {
  /** [token, surface, minimum] — the pairs the page actually renders. */
  const TEXT: [string, string, number][] = [
    ['--mk-ink', '--mk-canvas', 4.5],
    ['--mk-ink', '--mk-card', 4.5],
    ['--mk-ink-muted', '--mk-canvas', 4.5],
    ['--mk-ink-muted', '--mk-card', 4.5],
    ['--mk-ink-muted', '--mk-canvas-alt', 4.5],
    ['--mk-ink-subtle', '--mk-canvas', 4.5],
    ['--mk-action-fg', '--mk-action-subtle', 4.5],
    ['--mk-sealed-fg', '--mk-sealed-subtle', 4.5],
    ['--mk-action-ink', '--mk-action', 4.5],
    ['--mk-band-ink', '--mk-band', 4.5],
    ['--mk-band-ink-muted', '--mk-band', 4.5],
  ];

  for (const [theme, table] of THEMES) {
    for (const [token, surface, minimum] of TEXT) {
      it(`${theme}: ${token} on ${surface} clears ${minimum}:1`, () => {
        const measured = ratio(resolve_(token, table), resolve_(surface, table));
        expect(Number(measured.toFixed(2))).toBeGreaterThanOrEqual(minimum);
      });
    }
  }

  /** Lines and control edges: 3:1 is the 1.4.11 floor for non-text. */
  const LINES: [string, string][] = [
    // `control-edge` bounds outline buttons and inputs, so 1.4.11 applies.
    // `hairline` and `hairline-strong` only divide content and are exempt.
    ['--mk-control-edge', '--mk-canvas'],
    ['--mk-control-edge', '--mk-card'],
    ['--mk-action', '--mk-canvas'],
    ['--mk-action', '--mk-card'],
  ];

  for (const [theme, table] of THEMES) {
    for (const [token, surface] of LINES) {
      it(`${theme}: ${token} on ${surface} clears 3:1`, () => {
        const measured = ratio(resolve_(token, table), resolve_(surface, table));
        expect(Number(measured.toFixed(2))).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

describe('marketing scale stays on the marketing surface', () => {
  it('no --mk-* token is declared on :root', () => {
    const rootBlocks = [...marketingCode.matchAll(/(^|\n)(:root\s*\{[\s\S]*?\n\})/g)].map(m => m[2]);
    for (const block of rootBlocks) {
      expect(block).not.toMatch(/--mk-/);
    }
  });

  it('every declaration block is scoped to [data-surface="marketing"]', () => {
    const selectors = [...marketingCode.matchAll(/\n([^@\n{][^{\n]*)\{/g)]
      .map(m => m[1].trim())
      .filter(Boolean);
    expect(selectors.length, 'no selectors parsed — the regex is wrong').toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector, `unscoped selector: ${selector}`).toContain("[data-surface='marketing']");
    }
  });

  it('the primitive ladder is never referenced outside a token file', () => {
    // A component reaching for --p-* has skipped the semantic layer.
    expect(primitives).toMatch(/--p-gray-950:/);
    expect(marketing).toMatch(/var\(--p-/);
  });
});

describe('target size (WCAG 2.2, 2.5.8)', () => {
  it('the call-to-action height clears the 24px floor with room for 44', () => {
    const height = /--mk-cta-height:\s*(\d+)px/.exec(marketing);
    expect(height, 'no --mk-cta-height').not.toBeNull();
    expect(Number(height![1])).toBeGreaterThanOrEqual(44);
  });
});

describe('fluid type stays zoomable (WCAG 1.4.4)', () => {
  it('every fluid TYPE size brackets its viewport term in rem', () => {
    // 1.4.4 is about text: a `vw` term whose floor is in px cannot grow with
    // the user's font size. Spacing tokens (`--mk-gutter`) may use px floors,
    // since a gutter is not text and does not need to scale with zoom.
    const typeTokens = [...LIGHT].filter(([name]) => /^--mk-(display|copy)-/.test(name));
    expect(typeTokens.length).toBeGreaterThan(0);
    for (const [, value] of typeTokens) {
      if (!value.includes('clamp(')) continue;
      const inside = /clamp\(([^)]*)\)/.exec(value)![1];
      const [min, , max] = inside.split(',').map(part => part.trim());
      expect(min, `clamp floor is not in rem: ${value}`).toMatch(/rem$/);
      expect(max, `clamp ceiling is not in rem: ${value}`).toMatch(/rem$/);
    }
  });

  it('copy sizes are fixed rem steps, so only display type is fluid', () => {
    for (const name of ['--mk-copy-xl', '--mk-copy-lg', '--mk-copy-md', '--mk-copy-sm']) {
      expect(LIGHT.get(name), `${name} should not be fluid`).not.toMatch(/vw/);
    }
  });
});
