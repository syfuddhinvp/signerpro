/**
 * The row overflow menu: where it opens, and what closes it.
 *
 * It is anchored to its row, so on the last rows of a long list it used to open
 * straight into the bottom edge of the window — rendered and unreachable. And
 * once open it stayed open over whatever the user reached for next.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import { DialogProvider } from '@/components/sf/DialogProvider';
import { resetNavigation } from '@/test/navigation';
import Library, { type LibraryProps } from './Library';
import type { LibraryRow } from '@/lib/sf/adapters';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

vi.mock('@/components/sf/SessionProvider', () => ({
  useOptionalSession: () => ({
    userId: 'u1', name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin',
    organizationId: 'o1', organizationName: 'Northwind', isPlatformAdmin: false, impersonation: null,
  }),
  default: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@/lib/api/browser', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/browser')>('@/lib/api/browser');
  return { ...actual, apiCall: vi.fn(async () => ({ ok: true, status: 200, data: {} })) };
});

const row = (id: string, documentId: string): LibraryRow => ({
  id, title: 'Loan options ' + id, pages: 2, status: 'draft', rawStatus: 'draft', signed: 0, total: 1,
  updated: '1 hour ago', to: [], documentId, ownerName: 'Ada Lovelace', isFavorite: false,
});

function mount(rows: LibraryRow[]) {
  cleanup();
  const defaults: LibraryProps = {
    rows, total: rows.length, templates: [], templateTotal: 0, folderOptions: [], counts: {},
    initialFilters: {} as LibraryProps['initialFilters'],
  };
  return render(
    <SFProvider><DialogProvider><Library {...defaults} /></DialogProvider></SFProvider>,
  );
}

/** The window is 800 tall; each row's trigger is placed where the case wants. */
function placeTriggers(tops: number[]) {
  screen.getAllByLabelText('More actions').forEach((button, i) => {
    const wrapper = button.parentElement as HTMLElement;
    const top = tops[i] ?? 0;
    wrapper.getBoundingClientRect = () => ({
      top, bottom: top + 28, left: 0, right: 28, width: 28, height: 28, x: 0, y: top, toJSON: () => ({}),
    }) as DOMRect;
  });
}

const openMenu = (index: number) => fireEvent.click(screen.getAllByLabelText('More actions')[index]);
const menuStyle = () => screen.getByRole('menu').style;

beforeEach(() => {
  cleanup();
  resetNavigation();
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

describe('Library · row overflow menu', () => {
  it('drops down from a row with room below it', () => {
    mount([row('ENV-1', 'doc-1'), row('ENV-2', 'doc-2')]);
    placeTriggers([120, 740]);
    openMenu(0);
    expect(menuStyle().top).toBe('calc(100% + 4px)');
    expect(menuStyle().bottom).toBe('');
  });

  it('opens upwards from the last row, where the window ends', () => {
    mount([row('ENV-1', 'doc-1'), row('ENV-2', 'doc-2')]);
    placeTriggers([120, 740]);
    openMenu(1);
    expect(menuStyle().bottom).toBe('calc(100% + 4px)');
    expect(menuStyle().top).toBe('');
  });

  it('closes when the next click lands outside it', () => {
    mount([row('ENV-1', 'doc-1')]);
    placeTriggers([120]);
    openMenu(0);
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.mouseDown(screen.getByText('Loan options ENV-1'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes on Escape', () => {
    mount([row('ENV-1', 'doc-1')]);
    placeTriggers([120]);
    openMenu(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('still toggles from its own trigger', () => {
    mount([row('ENV-1', 'doc-1')]);
    placeTriggers([120]);
    openMenu(0);
    openMenu(0);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
