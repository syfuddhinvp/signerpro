/**
 * Accessibility invariants for the style layer.
 *
 * Two product-wide WCAG failures were found in the audit and fixed in
 * `app/globals.css` / `app/tokens.css` / `lib/sf/ui.ts`. Both are one-line
 * regressions waiting to happen, so they are pinned here:
 *
 *  · 2.4.7 Focus Visible — 23 inline `outline: 'none'` declarations with no
 *    replacement. The fix is a `:focus-visible` ring in `globals.css`; because
 *    inline styles win on specificity it *must* stay `!important`.
 *  · 1.4.3 / 1.4.11 Contrast — `#94a3b8` on white is 2.6:1 and was used for
 *    stat metas, table secondary text and timestamps.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import * as ui from '@/lib/sf/ui';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', rel), 'utf8');
const globals = read('app/globals.css');
const tokens = read('app/tokens.css');

/**
 * The token layer is three files since the marketing site was built: raw
 * ladders in `primitives.css`, the application's semantic names in
 * `tokens.css`, and the marketing scale in `marketing-tokens.css`. Tailwind
 * reads all three, so "is this property defined?" has to be asked of the whole
 * layer rather than of `tokens.css` alone.
 */
const tokenLayer = [
  read('app/primitives.css'),
  tokens,
  read('app/marketing-tokens.css'),
].join('\n');
const uiSource = read('lib/sf/ui.ts');

/* ── contrast maths (WCAG 2.1 relative luminance) ────────────────────────── */

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = '#ffffff';

describe('focus visibility (WCAG 2.4.7)', () => {
  it('globals.css defines a :focus-visible ring', () => {
    expect(globals).toMatch(/:focus-visible/);
    expect(globals).toMatch(/outline:\s*2px solid/);
  });

  it('the ring is !important — inline styles would otherwise win', () => {
    const rule = globals.slice(globals.indexOf(':focus-visible'));
    expect(rule).toMatch(/outline:[^;]*!important/);
  });

  it('covers every control type the app sets outline:none on', () => {
    const selector = globals.slice(0, globals.indexOf('{', globals.indexOf(':focus-visible')));
    for (const control of ['input', 'select', 'textarea', 'button', 'a[href]', '[tabindex]']) {
      expect(selector, `no focus ring for ${control}`).toContain(control);
    }
  });

  it('pointer focus is still quiet — the ring is scoped to :focus-visible', () => {
    expect(globals).toMatch(/:focus:not\(:focus-visible\)/);
  });

  it('the ring colour is a token, not a literal', () => {
    expect(globals).toMatch(/outline:\s*2px solid hsl\(var\(--color-focus-ring\)\)/);
    expect(tokens).toMatch(/--color-focus-ring:/);
  });

  it('honours prefers-reduced-motion', () => {
    expect(globals).toMatch(/prefers-reduced-motion/);
  });
});

describe('contrast (WCAG 1.4.3 / 1.4.11)', () => {
  it('the exported text tokens clear 4.5:1 on white', () => {
    for (const token of [ui.TEXT_DEFAULT, ui.TEXT_MUTED, ui.TEXT_SUBTLE]) {
      expect(contrast(token, WHITE)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('line and control tokens clear 3:1 on white', () => {
    expect(contrast(ui.BORDER_STRONG, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it('ui.ts uses no #94a3b8 — 2.6:1, the audit\'s most-repeated failure', () => {
    // Comments may name the colour; no style object may use it.
    const code = uiSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
    expect(code).not.toContain('#94a3b8');
    expect(code).not.toContain('#a5b0c0');
  });

  it('every text colour ui.ts sets is readable on the surface it sits on', () => {
    // Colours ui.ts uses for text on a white/near-white card.
    const textColours = ['#0f172a', '#64748b', '#475569', '#334155'];
    for (const colour of textColours) {
      expect(contrast(colour, WHITE), `${colour} on white`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the off state of a toggle is distinguishable from its track background', () => {
    const off = ui.switchStyle(false).background as string;
    expect(contrast(off, WHITE)).toBeGreaterThanOrEqual(3);
  });

  it('the contrast helper itself is right', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrast('#94a3b8', '#ffffff')).toBeLessThan(3); // the value we removed
  });
});

/* ── the failing literals are gone from screen source ─────────────────────
 * `#94a3b8` (2.6:1) and `#cbd5e1` (1.5:1) were inline in 126 places across
 * screens the token work did not originally reach. They are replaced by
 * `TEXT_MUTED` / `BORDER_STRONG` on light surfaces and `TEXT_MUTED_ON_DARK` /
 * `TEXT_ON_DARK` on the app's `#0f172a` panels. Nothing may reintroduce them:
 * a single re-pasted style object is the whole regression.
 */
const ROOT = resolve(__dirname, '..');
const SOURCE_DIRS = ['app', 'components', 'lib'];
const BANNED = ['#94a3b8', '#cbd5e1', '#a5b0c0'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

/** Strip block and line comments — naming a colour in prose is allowed. */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the failing colour literals are gone from screen source', () => {
  const offenders: string[] = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(resolve(ROOT, dir))) {
      const code = stripComments(readFileSync(file, 'utf8'));
      for (const literal of BANNED) {
        if (code.includes(literal)) offenders.push(`${file.slice(ROOT.length + 1)} → ${literal}`);
      }
    }
  }

  it('no source file uses a hard-coded failing colour', () => {
    expect(
      offenders,
      'use TEXT_MUTED / TEXT_SUBTLE / BORDER_STRONG (light surfaces) or ' +
      'TEXT_MUTED_ON_DARK / TEXT_ON_DARK (#0f172a panels) from lib/sf/ui.ts',
    ).toEqual([]);
  });
});

describe('dark-panel text tokens (WCAG 1.4.3)', () => {
  /* The app's dark rails, banners, log table and auth hero. The light-surface
     tokens would be unreadable on these, so they get their own measured pair. */
  const DARK_PANEL = '#0f172a';
  const DARK_CHIP = '#111c33';

  it('clear 4.5:1 on both dark surfaces the app paints', () => {
    for (const token of [ui.TEXT_MUTED_ON_DARK, ui.TEXT_ON_DARK]) {
      expect(contrast(token, DARK_PANEL), `${token} on ${DARK_PANEL}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token, DARK_CHIP), `${token} on ${DARK_CHIP}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('are not reused on white, where they would fail', () => {
    // Guards against someone "simplifying" to one muted token for both themes.
    expect(contrast(ui.TEXT_MUTED_ON_DARK, WHITE)).toBeLessThan(4.5);
  });
});

describe('the design-token layer actually loads', () => {
  it('globals.css imports every token file and the Tailwind layers', () => {
    expect(globals).toMatch(/@import\s+'\.\/primitives\.css'/);
    expect(globals).toMatch(/@import\s+'\.\/tokens\.css'/);
    expect(globals).toMatch(/@import\s+'\.\/marketing-tokens\.css'/);
    expect(globals).toMatch(/@tailwind utilities/);
  });

  it('primitives are imported before the semantic layers that alias them', () => {
    const order = ['primitives.css', 'tokens.css', 'marketing-tokens.css'].map(name =>
      globals.indexOf(name),
    );
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it('the token layer defines every custom property tailwind.config.ts references', () => {
    const config = read('tailwind.config.ts');
    const referenced = new Set(
      Array.from(config.matchAll(/var\(--([a-z0-9-]+)\)/g), m => m[1])
        .concat(Array.from(config.matchAll(/hsl\("([a-z0-9-]+)"\)/g), m => m[1]))
        .concat(Array.from(config.matchAll(/hsl\(([a-z0-9-]+)\)/g), m => m[1]))
        .concat(Array.from(config.matchAll(/mkColor\("([a-z0-9-]+)"\)/g), m => `mk-${m[1]}`)),
    );
    // `hsl("color-fg-muted")` is the helper's shorthand for `--color-fg-muted`,
    // and `mkColor("canvas")` for `--mk-canvas`.
    const missing = Array.from(referenced).filter(name => !tokenLayer.includes(`--${name}:`));
    expect(missing, `the token layer is missing: ${missing.join(', ')}`).toEqual([]);
  });
});
