/**
 * The theme system's vocabulary, shared by the boot script, the provider,
 * the account panel and the backend round-trip.
 *
 * A theme is two independent choices:
 *
 *  · `mode`    — light, dark, or follow the operating system. It becomes
 *                `data-theme="light|dark"` on <html>, which is what
 *                `app/tokens.css` and Tailwind's `darkMode` selector key on.
 *  · `palette` — the accent family. It becomes `data-palette="…"` on <html>,
 *                and `app/palettes.css` re-points the `--color-accent-*`
 *                tokens under that attribute.
 *
 * Everything here must stay free of React and of the DOM at module load: the
 * no-flash boot script in `ThemeProvider.tsx` is generated from these values.
 */

export const THEME_MODES = ['system', 'light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const PALETTE_IDS = ['indigo', 'ocean', 'emerald', 'rose', 'amber', 'graphite'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];

export type Appearance = { mode: ThemeMode; palette: PaletteId };

export const DEFAULT_APPEARANCE: Appearance = { mode: 'system', palette: 'indigo' };

/** Where the choice lives in the browser so the boot script can paint it
 *  before hydration. The account is the source of truth once it has loaded. */
export const THEME_STORAGE_KEY = 'sf.theme';

export type PaletteMeta = {
  id: PaletteId;
  label: string;
  /** The accent as a hex, for the places that still need one: alpha suffixes
   *  (`A + '14'`), canvas drawing, and `SFProvider.accent()`. Must match the
   *  `--color-accent-solid` value `app/palettes.css` sets for the palette. */
  accent: string;
  /** The dark-mode accent, lifted for contrast on dark surfaces. */
  accentDark: string;
};

export const PALETTES: readonly PaletteMeta[] = [
  { id: 'indigo',   label: 'Indigo',   accent: '#4f46e5', accentDark: '#6366f1' },
  { id: 'ocean',    label: 'Ocean',    accent: '#0369a1', accentDark: '#0ea5e9' },
  { id: 'emerald',  label: 'Emerald',  accent: '#047857', accentDark: '#10b981' },
  { id: 'rose',     label: 'Rose',     accent: '#be123c', accentDark: '#f43f5e' },
  { id: 'amber',    label: 'Amber',    accent: '#b45309', accentDark: '#f59e0b' },
  { id: 'graphite', label: 'Graphite', accent: '#1e293b', accentDark: '#a1aec2' },
];

export const MODE_LABELS: Record<ThemeMode, string> = {
  system: 'Match system',
  light: 'Light',
  dark: 'Dark',
};

export function isThemeMode(v: unknown): v is ThemeMode {
  return typeof v === 'string' && (THEME_MODES as readonly string[]).indexOf(v) > -1;
}
export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === 'string' && (PALETTE_IDS as readonly string[]).indexOf(v) > -1;
}

/** Accepts anything (storage, the API, a stale build) and answers a valid
 *  appearance, filling each half independently from the default. */
export function normalizeAppearance(raw: unknown): Appearance {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    mode: isThemeMode(o.mode) ? o.mode : DEFAULT_APPEARANCE.mode,
    palette: isPaletteId(o.palette) ? o.palette : DEFAULT_APPEARANCE.palette,
  };
}

export function paletteMeta(id: PaletteId): PaletteMeta {
  return PALETTES.find(p => p.id === id) ?? PALETTES[0];
}

/** The mode actually painted, once `system` has been asked of the OS. */
export function resolveMode(mode: ThemeMode, systemPrefersDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : mode;
}

/** Writes the two attributes the stylesheets key on. Shared by the provider
 *  and (in spirit) by the boot script, which inlines the same two lines. */
export function applyAppearance(root: HTMLElement, a: Appearance, systemPrefersDark: boolean): void {
  root.setAttribute('data-theme', resolveMode(a.mode, systemPrefersDark));
  root.setAttribute('data-palette', a.palette);
  root.style.colorScheme = resolveMode(a.mode, systemPrefersDark);
}

/**
 * Runs inline in <head> before the first paint, so a dark-mode user never
 * sees a light flash. It only reads storage: the account's saved choice is
 * mirrored there by the provider the moment it is known. Kept tiny and
 * dependency-free on purpose — it is a string, not a module.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_STORAGE_KEY)};var d=${JSON.stringify(DEFAULT_APPEARANCE)};var m=${JSON.stringify(THEME_MODES)};var p=${JSON.stringify(PALETTE_IDS)};var s=null;try{s=JSON.parse(localStorage.getItem(k)||'null')}catch(e){}var a=s&&typeof s==='object'?s:{};var mode=m.indexOf(a.mode)>-1?a.mode:d.mode;var pal=p.indexOf(a.palette)>-1?a.palette:d.palette;var dark=mode==='dark'||(mode==='system'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);var r=document.documentElement;r.setAttribute('data-theme',dark?'dark':'light');r.setAttribute('data-palette',pal);r.style.colorScheme=dark?'dark':'light'}catch(e){}})();`;
