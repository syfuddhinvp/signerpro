/**
 * Dropdowns flip up when the window has no room below them.
 *
 * A row menu is anchored to its row, so the last rows of a long list opened
 * theirs straight into the bottom edge of the window — the items were rendered
 * and unreachable. The trigger's position decides the side, and the side it
 * lands on decides how tall the menu may get.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMenuPlacement } from './menuPlacement';

/** The trigger's box is placed wherever the case wants it in the window.
 *  jsdom lays nothing out, so the rect is stubbed on the node as it attaches —
 *  a callback ref, because that runs before the hook's own measurement. */
function Harness({ top, height = 28, onDismiss }: { top: number; height?: number; onDismiss?: () => void }) {
  const { anchorRef, menuStyle } = useMenuPlacement(true, { onDismiss });
  const attach = (node: HTMLDivElement | null) => {
    if (node) {
      node.getBoundingClientRect = () => ({
        top, bottom: top + height, left: 0, right: 40, width: 40, height,
        x: 0, y: top, toJSON: () => ({}),
      }) as DOMRect;
    }
    anchorRef.current = node;
  };
  return (
    <>
      <button type="button">elsewhere</button>
      <div ref={attach} style={{ position: 'relative' }}>
        <button type="button">trigger</button>
        <div role="menu" data-testid="menu" style={{ position: 'absolute', ...menuStyle }}>
          <button type="button">item</button>
        </div>
      </div>
    </>
  );
}

const style = () => screen.getByTestId('menu').style;

afterEach(cleanup);

describe('useMenuPlacement', () => {
  const original = window.innerHeight;
  afterEach(() => { Object.defineProperty(window, 'innerHeight', { value: original, configurable: true }); });
  const windowHeight = (px: number) => Object.defineProperty(window, 'innerHeight', { value: px, configurable: true });

  it('opens downwards with room to spare, and never sets both edges', () => {
    windowHeight(800);
    render(<Harness top={100} />);
    expect(style().top).toBe('calc(100% + 4px)');
    expect(style().bottom).toBe('');
    expect(style().maxHeight).toBe('320px');
  });

  it('flips up for a trigger near the bottom of the window', () => {
    windowHeight(800);
    render(<Harness top={740} />);
    expect(style().bottom).toBe('calc(100% + 4px)');
    expect(style().top).toBe('');
  });

  it('caps the menu to the room the chosen side actually has', () => {
    windowHeight(800);
    // 560px of window below the trigger, less the offset and the edge gutter.
    render(<Harness top={212} />);
    expect(style().top).toBe('calc(100% + 4px)');
    expect(style().maxHeight).toBe('320px');

    cleanup();
    render(<Harness top={640} />);
    // Flipped: 640 above, minus the gutter, still under the 320 preference.
    expect(style().bottom).toBe('calc(100% + 4px)');
    expect(style().maxHeight).toBe('320px');
  });

  it('stays down when neither side is roomy but down is the better half', () => {
    windowHeight(300);
    render(<Harness top={80} />);
    expect(style().top).toBe('calc(100% + 4px)');
    // Scrolls rather than running off: 300 - 108 - 4 - 12 = 176.
    expect(style().maxHeight).toBe('176px');
  });

  it('re-measures when the window changes size under an open menu', () => {
    windowHeight(800);
    const { rerender } = render(<Harness top={500} />);
    expect(style().top).toBe('calc(100% + 4px)');

    // The same row, in a window short enough that below is no longer usable.
    windowHeight(600);
    window.dispatchEvent(new Event('resize'));
    rerender(<Harness top={500} />);
    expect(style().bottom).toBe('calc(100% + 4px)');
    expect(style().top).toBe('');
  });

  it('closes on a click outside, and leaves clicks within it alone', () => {
    windowHeight(800);
    const onDismiss = vi.fn();
    render(<Harness top={100} onDismiss={onDismiss} />);

    // The trigger and the menu are both inside the anchor: the trigger keeps
    // toggling, and picking an item is not "outside".
    fireEvent.mouseDown(screen.getByRole('button', { name: 'trigger' }));
    fireEvent.mouseDown(screen.getByRole('button', { name: 'item' }));
    expect(onDismiss).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    windowHeight(800);
    const onDismiss = vi.fn();
    render(<Harness top={100} onDismiss={onDismiss} />);
    fireEvent.keyDown(document, { key: 'a' });
    expect(onDismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('follows a scroll inside the list behind it', () => {
    windowHeight(800);
    const spy = vi.spyOn(window, 'addEventListener');
    render(<Harness top={100} />);
    // Capture phase, because an inner scroller's scroll event does not bubble.
    expect(spy.mock.calls.some(([type, , opts]) => type === 'scroll' && opts === true)).toBe(true);
    spy.mockRestore();
  });
});
