/**
 * Choosing which part of an image becomes a page.
 *
 * The frame is the part worth pinning: locked to the document's page shape,
 * whatever the sender selects lands on the sheet with no white margin and
 * nothing trimmed, which is only true if the box's *pixel* proportions track
 * the page — the crop is stored in fractions of the image, so a square box on
 * a wide photo is not a square area.
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SFProvider } from '@/lib/sf/state';
import ImageCropDialog, { cropToParam, isWholeImage } from './ImageCropDialog';
import type { CropRect } from './ImageCropDialog';

const file = new File(['x'], 'photo.png', { type: 'image/png' });
/** US Letter, portrait — the shape of the document being added to. */
const LETTER = 612 / 792;

const mount = (onDone: (crop: CropRect | null) => void, pageAspect: number | null = LETTER) => {
  cleanup();
  return render(<SFProvider><ImageCropDialog file={file} pageAspect={pageAspect} onDone={onDone} /></SFProvider>);
};

/** jsdom never loads the object URL, so the image reports its own size the
 *  way a real one would once decoded. */
const imageIs = (width: number, height: number) => {
  const image = document.querySelector('img')!;
  Object.defineProperty(image, 'naturalWidth', { value: width, configurable: true });
  Object.defineProperty(image, 'naturalHeight', { value: height, configurable: true });
  fireEvent.load(image);
};

const box = () => screen.getByRole('group', { name: /selected area/i });
/** The selection as fractions, read off the style the box is drawn with. */
const rect = () => {
  const style = box().style;
  return {
    x: parseFloat(style.left) / 100, y: parseFloat(style.top) / 100,
    width: parseFloat(style.width) / 100, height: parseFloat(style.height) / 100,
  };
};

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

describe('the frame', () => {
  it('starts on the page shape and cuts the box to it', () => {
    mount(vi.fn());
    // A landscape photo: the biggest portrait box inside it is full height.
    imageIs(2000, 1000);

    const selection = rect();
    expect(selection.height).toBeCloseTo(1, 3);
    // The box's shape in *pixels* is the page's, not its shape in fractions.
    expect((selection.width * 2000) / (selection.height * 1000)).toBeCloseTo(LETTER, 3);
    // Centred on the image, so it is a starting point rather than a corner.
    expect(selection.x).toBeCloseTo((1 - selection.width) / 2, 3);
  });

  it('keeps that shape while the box is resized', () => {
    mount(vi.fn());
    imageIs(2000, 1000);
    fireEvent.keyDown(box(), { key: 'ArrowLeft', shiftKey: true });

    const selection = rect();
    expect((selection.width * 2000) / (selection.height * 1000)).toBeCloseTo(LETTER, 3);
    expect(selection.width).toBeLessThan(1);
  });

  it('lets the sender out of it, and back into it', () => {
    mount(vi.fn());
    imageIs(2000, 1000);

    fireEvent.click(screen.getByRole('radio', { name: 'Custom' }));
    expect(screen.getByRole('radio', { name: 'Custom' }).getAttribute('aria-checked')).toBe('true');
    // Unlocking keeps the selection the sender already made — it just stops
    // holding the shape, so a resize now answers only to the drag.
    const before = rect();
    fireEvent.keyDown(box(), { key: 'ArrowUp', shiftKey: true });
    const free = rect();
    expect(free.width).toBeCloseTo(before.width, 5);
    expect(free.height).toBeLessThan(before.height);
    expect((free.width * 2000) / (free.height * 1000)).not.toBeCloseTo(LETTER, 2);

    fireEvent.click(screen.getByRole('radio', { name: 'Page shape' }));
    const selection = rect();
    expect((selection.width * 2000) / (selection.height * 1000)).toBeCloseTo(LETTER, 3);
  });

  it('is not offered when there is no page to match', () => {
    mount(vi.fn(), null);
    expect(screen.queryByRole('radiogroup', { name: /frame/i })).toBeNull();
    expect(screen.getByRole('button', { name: /whole image/i })).toBeTruthy();
  });
});

describe('what the dialog hands back', () => {
  it('resolves with the selection, and with null on every dismissal', async () => {
    const onDone = vi.fn();
    mount(onDone, null);
    fireEvent.keyDown(box(), { key: 'ArrowRight', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: /add this area/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toMatchObject({ x: 0, y: 0 });

    for (const dismiss of [
      () => fireEvent.click(screen.getByRole('button', { name: /cancel/i })),
      () => fireEvent.keyDown(window, { key: 'Escape' }),
      () => fireEvent.click(screen.getByRole('dialog')),
    ]) {
      onDone.mockClear();
      mount(onDone, null);
      dismiss();
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    }
  });

  it('never leaves the image', () => {
    mount(vi.fn(), null);
    // Pushed hard against an edge, the box stops rather than running off it.
    for (let press = 0; press < 40; press++) fireEvent.keyDown(box(), { key: 'ArrowLeft' });
    expect(rect().x).toBeCloseTo(0, 5);
    for (let press = 0; press < 40; press++) fireEvent.keyDown(box(), { key: 'ArrowDown', shiftKey: true });
    const selection = rect();
    expect(selection.y + selection.height).toBeLessThanOrEqual(1.0001);
  });

  it('says how much of the image is being kept', () => {
    mount(vi.fn(), null);
    fireEvent.keyDown(box(), { key: 'ArrowLeft', shiftKey: true });
    expect(screen.getByText(/keeping 95% × 100% of the image/i)).toBeTruthy();
  });

  it('releases the preview it made of the file', () => {
    const { unmount } = mount(vi.fn(), null);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
  });
});

describe('the crop as the API takes it', () => {
  it('is x,y,width,height, rounded to something a URL can carry', () => {
    expect(cropToParam({ x: 0.123456789, y: 0, width: 0.5, height: 1 })).toBe('0.1235,0,0.5,1');
  });

  it('recognises an untouched box, which is not a crop at all', () => {
    expect(isWholeImage({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isWholeImage({ x: 0, y: 0, width: 0.5, height: 1 })).toBe(false);
    expect(isWholeImage({ x: 0.2, y: 0, width: 0.8, height: 1 })).toBe(false);
  });
});
