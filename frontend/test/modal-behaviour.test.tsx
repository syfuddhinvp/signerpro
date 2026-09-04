/**
 * The behaviour `role="dialog" aria-modal="true"` promises (audit A-1).
 *
 * The four overlays on the public signing route declared both attributes and
 * delivered none of it: no focus move, no tab trap, no Escape, no focus
 * return, no inert background. That is the unauthenticated, legally operative
 * screen — the one place where a keyboard or screen-reader user losing the
 * dialog has contractual consequences.
 *
 * These cover the shared implementation every dialog in the app now uses.
 */

import React, { useCallback, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useModalBehaviour } from '@/components/sf/useModalBehaviour';

function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => { setOpen(false); onClose(); }, [onClose]);
  const ref = useModalBehaviour<HTMLDivElement>(open, close);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Adopt signature</button>
      <p data-testid="background">the document behind the dialog</p>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label="Adopt your signature" ref={ref} tabIndex={-1}>
          <button type="button">Draw</button>
          <input aria-label="Full name" />
          <button type="button" onClick={close}>Cancel</button>
        </div>
      ) : null}
    </div>
  );
}

const openDialog = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Adopt signature' }));
  return screen.getByRole('dialog');
};

describe('modal behaviour on the signing ceremony dialogs', () => {
  it('moves focus into the dialog on open', async () => {
    render(<Harness />);
    await openDialog();
    expect(screen.getByRole('button', { name: 'Draw' })).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await openDialog();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wraps Tab from the last control back to the first', async () => {
    render(<Harness />);
    const dialog = await openDialog();
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Draw' })).toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('wraps Shift+Tab from the first control back to the last', async () => {
    render(<Harness />);
    await openDialog();
    screen.getByRole('button', { name: 'Draw' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('pulls focus back when it has escaped to the page behind', async () => {
    render(<Harness />);
    // Captured before opening: once the dialog is up this button is
    // aria-hidden, so it is no longer reachable by role.
    const behind = screen.getByRole('button', { name: 'Adopt signature' });
    await openDialog();
    // Simulates focus landing outside the dialog — the exact failure the
    // signing route had, where Tab walked straight out into the document.
    behind.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('hides the background from assistive tech, and restores it on close', async () => {
    render(<Harness />);
    await openDialog();
    expect(screen.getByTestId('background')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('background')).not.toHaveAttribute('aria-hidden');
  });

  it('returns focus to whatever opened it', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Adopt signature' });
    await openDialog();
    // (same reason as above: `opener` is captured before it goes aria-hidden)
    expect(opener).not.toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(opener).toHaveFocus();
  });

  it('does nothing at all while closed', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('background')).not.toHaveAttribute('aria-hidden');
  });
});
