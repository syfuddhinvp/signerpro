'use client';
/**
 * Owns the appearance for the whole document: reads the stored choice on
 * mount, keeps <html data-theme data-palette> in step with it, follows the OS
 * while the mode is `system`, and hands the choice to whoever wants to save it
 * (the authenticated app registers the account round-trip via `onPersist`).
 *
 * The provider is mounted in the root layout so the marketing site, the
 * signing surface and the app all answer to the same switch; only the
 * persistence differs by where you are.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyAppearance, DEFAULT_APPEARANCE, normalizeAppearance, paletteMeta, resolveMode,
  THEME_BOOT_SCRIPT, THEME_STORAGE_KEY,
  type Appearance, type PaletteId, type ThemeMode,
} from './themes';

export type ThemeContextValue = {
  appearance: Appearance;
  /** `light` or `dark` — what is actually painted right now. */
  resolved: 'light' | 'dark';
  /** The accent hex for this palette in the painted mode, for code that still
   *  needs a literal (alpha suffixes, canvas). */
  accentHex: string;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: PaletteId) => void;
  /** Replaces the whole appearance without persisting — used when the account's
   *  saved choice arrives and should win over what this browser remembered. */
  adopt: (a: Appearance) => void;
  /** Register the save path. Returns the unregister. */
  onPersist: (fn: (a: Appearance) => void) => () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStored(): Appearance | null {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    return raw ? normalizeAppearance(JSON.parse(raw)) : null;
  } catch { return null; }
}
function writeStored(a: Appearance): void {
  try { window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(a)); } catch { /* private mode */ }
}
function systemDark(): boolean {
  try { return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DARK_QUERY).matches; }
  catch { return false; }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  /* Server and first client render agree on the default; the boot script has
     already painted the stored choice on <html>, and the effect below aligns
     React state with it right after mount. */
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [prefersDark, setPrefersDark] = useState(false);
  const persist = useRef<Set<(a: Appearance) => void>>(new Set());

  useEffect(() => {
    setPrefersDark(systemDark());
    const stored = readStored();
    if (stored) setAppearance(stored);
    if (!window.matchMedia) return;
    const mq = window.matchMedia(DARK_QUERY);
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    applyAppearance(document.documentElement, appearance, prefersDark);
  }, [appearance, prefersDark]);

  const commit = useCallback((next: Appearance) => {
    setAppearance(next);
    writeStored(next);
    persist.current.forEach(fn => fn(next));
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolved = resolveMode(appearance.mode, prefersDark);
    const meta = paletteMeta(appearance.palette);
    return {
      appearance,
      resolved,
      accentHex: resolved === 'dark' ? meta.accentDark : meta.accent,
      setMode: mode => commit({ ...appearance, mode }),
      setPalette: palette => commit({ ...appearance, palette }),
      adopt: a => { const n = normalizeAppearance(a); setAppearance(n); writeStored(n); },
      onPersist: fn => { persist.current.add(fn); return () => { persist.current.delete(fn); }; },
    };
  }, [appearance, prefersDark, commit]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useTheme must be used inside ThemeProvider');
  return v;
}

/** For code that also renders in tests or trees without the provider. */
export function useOptionalTheme(): ThemeContextValue | null {
  return useContext(ThemeContext);
}

/** The no-flash boot script. Render it first thing inside <head>. */
export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />;
}
