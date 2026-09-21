import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './ThemeProvider';
import { THEME_STORAGE_KEY } from './themes';

function Probe() {
  const t = useTheme();
  return (
    <div>
      <span data-testid="mode">{t.appearance.mode}</span>
      <span data-testid="palette">{t.appearance.palette}</span>
      <span data-testid="resolved">{t.resolved}</span>
      <span data-testid="accent">{t.accentHex}</span>
      <button onClick={() => t.setMode('dark')}>dark</button>
      <button onClick={() => t.setPalette('emerald')}>emerald</button>
      <button onClick={() => t.adopt({ mode: 'light', palette: 'rose' })}>adopt</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-palette');
});

describe('ThemeProvider', () => {
  it('starts from the default and paints <html>', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('mode').textContent).toBe('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-palette')).toBe('indigo');
  });

  it('restores the browser copy on mount', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ mode: 'dark', palette: 'ocean' }));
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-palette')).toBe('ocean');
    expect(screen.getByTestId('accent').textContent).toBe('#0ea5e9');
  });

  it('a change paints, stores and notifies the persist hook', () => {
    const saved: unknown[] = [];
    function Saver() { const { onPersist } = useTheme(); onPersist(a => saved.push(a)); return null; }
    render(<ThemeProvider><Probe /><Saver /></ThemeProvider>);
    act(() => { fireEvent.click(screen.getByText('dark')); });
    act(() => { fireEvent.click(screen.getByText('emerald')); });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-palette')).toBe('emerald');
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual({ mode: 'dark', palette: 'emerald' });
    expect(saved.at(-1)).toEqual({ mode: 'dark', palette: 'emerald' });
    expect(screen.getByTestId('accent').textContent).toBe('#10b981');
  });

  it('adopt replaces without persisting — the account already holds it', () => {
    const persist = vi.fn();
    function Saver() { const { onPersist } = useTheme(); onPersist(persist); return null; }
    render(<ThemeProvider><Probe /><Saver /></ThemeProvider>);
    act(() => { fireEvent.click(screen.getByText('adopt')); });
    expect(screen.getByTestId('palette').textContent).toBe('rose');
    expect(persist).not.toHaveBeenCalled();
    expect(JSON.parse(window.localStorage.getItem(THEME_STORAGE_KEY)!).palette).toBe('rose');
  });
});
