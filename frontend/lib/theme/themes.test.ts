import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyAppearance, DEFAULT_APPEARANCE, normalizeAppearance, PALETTES, PALETTE_IDS, resolveMode, THEME_BOOT_SCRIPT, THEME_STORAGE_KEY,
} from './themes';

describe('normalizeAppearance', () => {
  it('fills each half independently from the default', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({ mode: 'dark' })).toEqual({ mode: 'dark', palette: 'indigo' });
    expect(normalizeAppearance({ mode: 'sepia', palette: 'rose' })).toEqual({ mode: 'system', palette: 'rose' });
    expect(normalizeAppearance('dark')).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('resolveMode', () => {
  it('asks the OS only for system', () => {
    expect(resolveMode('system', true)).toBe('dark');
    expect(resolveMode('system', false)).toBe('light');
    expect(resolveMode('light', true)).toBe('light');
    expect(resolveMode('dark', false)).toBe('dark');
  });
});

describe('applyAppearance', () => {
  it('writes the two attributes the stylesheets key on', () => {
    const root = document.createElement('html');
    applyAppearance(root, { mode: 'dark', palette: 'ocean' }, false);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-palette')).toBe('ocean');
    expect(root.style.colorScheme).toBe('dark');
  });
});

describe('the boot script', () => {
  const run = (stored: string | null, prefersDark: boolean) => {
    const root = document.createElement('html');
    const localStorage = { getItem: () => stored };
    const matchMedia = () => ({ matches: prefersDark });
    new Function('document', 'localStorage', 'window', THEME_BOOT_SCRIPT)({ documentElement: root }, localStorage, { matchMedia });
    return root;
  };

  it('paints the stored choice before hydration', () => {
    const root = run(JSON.stringify({ mode: 'dark', palette: 'rose' }), false);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-palette')).toBe('rose');
  });

  it('follows the OS with nothing stored, and survives garbage', () => {
    expect(run(null, true).getAttribute('data-theme')).toBe('dark');
    expect(run(null, false).getAttribute('data-theme')).toBe('light');
    const root = run('{not json', true);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.getAttribute('data-palette')).toBe('indigo');
    expect(run(JSON.stringify({ palette: 'neon' }), false).getAttribute('data-palette')).toBe('indigo');
  });

  it('reads the same storage key the provider writes', () => {
    expect(THEME_BOOT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });
});

describe('palettes.css agrees with the registry', () => {
  const css = readFileSync(resolve(__dirname, '../../app/palettes.css'), 'utf8');
  const tokens = readFileSync(resolve(__dirname, '../../app/tokens.css'), 'utf8');

  it('declares every non-default palette in light and dark', () => {
    for (const id of PALETTE_IDS) {
      if (id === DEFAULT_APPEARANCE.palette) continue;
      expect(css, `${id} light`).toContain(`:root[data-palette='${id}'] {`);
      expect(css, `${id} dark`).toContain(`:root[data-palette='${id}'][data-theme='dark'] {`);
    }
  });

  it('the registry hex matches the accent-solid token for each palette', () => {
    const toHex = (h: number, s: number, l: number) => {
      const sat = s / 100, lig = l / 100, a = sat * Math.min(lig, 1 - lig);
      const k = (n: number) => (n + h / 30) % 12;
      const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      const c = (x: number) => Math.round(x * 255);
      return [c(f(0)), c(f(8)), c(f(4))];
    };
    const near = (a: number[], hex: string) => {
      const b = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
      return a.every((v, i) => Math.abs(v - b[i]) <= 3);
    };
    const solidIn = (block: string) => {
      const m = /--color-accent-solid:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/.exec(block);
      if (!m) throw new Error('no accent-solid');
      return toHex(Number(m[1]), Number(m[2]), Number(m[3]));
    };
    const block = (src: string, selector: string) => {
      const start = src.indexOf(selector);
      return src.slice(start, src.indexOf('}', start));
    };
    for (const p of PALETTES) {
      const light = p.id === 'indigo' ? block(tokens, ':root {') : block(css, `:root[data-palette='${p.id}'] {`);
      const dark = p.id === 'indigo' ? block(tokens, ":root[data-theme='dark'] {") : block(css, `:root[data-palette='${p.id}'][data-theme='dark'] {`);
      expect(near(solidIn(light), p.accent), `${p.id} light ${p.accent}`).toBe(true);
      expect(near(solidIn(dark), p.accentDark), `${p.id} dark ${p.accentDark}`).toBe(true);
    }
  });
});
