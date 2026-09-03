/**
 * The tour has to point at real elements, on the right screen. Its steps used to carry pixel
 * rectangles copied from a 1440px prototype, so the ring landed on empty space
 * on every other viewport; these tests pin the replacement — the spotlight is
 * measured from the DOM node the step names, and the card is placed next to it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

vi.mock('next/navigation', async () => (await import('@/test/navigation')).navigationMock());

import { resetNavigation, router, setPathname } from '@/test/navigation';
import { SFProvider, useSF } from '@/lib/sf/state';
import Tour from '@/components/sf/Tour';
import { TOUR } from '@/lib/sf/data';

/** jsdom lays nothing out, so targets get an explicit box to be measured from. */
function box(el: HTMLElement, r: { left: number; top: number; width: number; height: number }) {
  el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
}

function Harness({ step }: { step: number }) {
  const { set } = useSF();
  return <button onClick={() => set({ tourStep: step })}>start</button>;
}

function mount(step: number, pathname = '/overview') {
  setPathname(pathname);
  const areas = document.createElement('nav');
  areas.setAttribute('data-tour', 'areas');
  box(areas, { left: 0, top: 0, width: 252, height: 800 });
  const screenRoot = document.createElement('section');
  screenRoot.setAttribute('data-screen-label', 'Tenant overview');
  box(screenRoot, { left: 312, top: 60, width: 900, height: 500 });
  document.body.append(areas, screenRoot);

  const view = render(<SFProvider><Harness step={step} /><Tour /></SFProvider>);
  act(() => { fireEvent.click(screen.getByText('start')); });
  return view;
}

const spotlight = () => document.querySelector('[data-tour-spotlight="1"]') as HTMLElement;

beforeEach(() => {
  resetNavigation();
  setPathname('/overview');
  window.innerWidth = 1440;
  window.innerHeight = 900;
});
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('Tour spotlight', () => {
  it('is hidden until a step is active', () => {
    render(<SFProvider><Tour /></SFProvider>);
    expect(screen.queryByLabelText('Product tour')).toBeNull();
  });

  it('anchors the ring to the element the step names', () => {
    mount(0); // step 1 targets [data-tour="areas"]
    const ring = spotlight();
    // 252x800 sidebar, padded by 6px on every side.
    expect(ring.style.left).toBe('-6px');
    expect(ring.style.top).toBe('-6px');
    expect(ring.style.width).toBe('264px');
    expect(ring.style.height).toBe('812px');
    expect(ring.style.boxShadow).toContain('9999px');
  });

  it('falls back to the active screen root when the step names no element', () => {
    mount(2); // step 3 is about the overview screen as a whole
    const ring = spotlight();
    expect(ring.style.left).toBe('306px');
    expect(ring.style.top).toBe('54px');
    expect(ring.style.width).toBe('912px');
  });

  it('places the card beside the spotlight, inside the viewport', () => {
    mount(0);
    const card = screen.getByLabelText('Product tour').querySelector('div:nth-child(2)') as HTMLElement;
    // Right of the 252px sidebar (+6 pad +14 gap), and fully on screen.
    expect(card.style.left).toBe('272px');
    expect(parseFloat(card.style.left) + parseFloat(card.style.width)).toBeLessThanOrEqual(1440);
  });

  it('re-measures when the target moves', () => {
    mount(0);
    box(document.querySelector('[data-tour="areas"]') as HTMLElement, { left: 0, top: 0, width: 252, height: 400 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(spotlight().style.height).toBe('412px');
  });

  it('advances, navigates and finishes', () => {
    mount(0);
    expect(screen.getByText('Step 1 of ' + TOUR.length)).toBeTruthy();
    act(() => { fireEvent.click(screen.getByText('Next')); });
    expect(screen.getByText('Step 2 of ' + TOUR.length)).toBeTruthy();
    /* Step 2 is about the Documents branch, so advancing navigates there. */
    expect(router.push).toHaveBeenCalledWith('/documents');
  });

  it('closes on Escape', () => {
    mount(0);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.queryByLabelText('Product tour')).toBeNull();
  });

  it('gives every step a resolvable shape', () => {
    TOUR.forEach(step => {
      expect(typeof step.title).toBe('string');
      expect(step.target === null || typeof step.target === 'string').toBe(true);
    });
  });
});

/**
 * Routing was what broke the focus. A step changes the step index and asks the
 * router to navigate in the same breath; the navigation lands frames later,
 * and until it does the DOM still belongs to the previous screen. Measuring in
 * that window ringed the outgoing screen and then jumped.
 */
describe('Tour across a route change', () => {
  /** Re-render at a new URL, the way a completed navigation would. */
  function arriveAt(pathname: string, view: { rerender: (ui: React.ReactElement) => void }, step: number) {
    setPathname(pathname);
    act(() => { view.rerender(<SFProvider><Harness step={step} /><Tour /></SFProvider>); });
  }

  it('draws no ring while the step is still navigating', () => {
    /* Step 2 is about `/documents`; mounted at `/overview` it has not arrived. */
    mount(1);
    const ring = spotlight();
    /* A full-page scrim, not a ring around whatever the last screen left behind. */
    expect(ring.style.border).toBe('');
    expect(ring.style.inset).toBe('0px');
    expect(document.querySelector('[data-tour-pending="1"]')).toBeTruthy();
  });

  it('rings the target once the route arrives', () => {
    const view = mount(1);
    expect(spotlight().style.border).toBe('');

    arriveAt('/documents', view, 1);
    const ring = spotlight();
    expect(ring.style.border).toContain('solid');
    expect(ring.style.width).toBe('264px');
    expect(document.querySelector('[data-tour-pending="1"]')).toBeNull();
  });

  it('never measures the outgoing screen', () => {
    /* Step 3 has no selector, so it falls back to the screen root — the case
       that used to ring the previous screen, because a `[data-screen-label]`
       is always present, just the wrong one. */
    mount(2, '/documents');
    expect(spotlight().style.border).toBe('');
    expect(spotlight().style.inset).toBe('0px');
  });

  it('shows the step anyway if the route never arrives', () => {
    vi.useFakeTimers();
    try {
      /* The flat document routes redirect to `/documents` when the tenant has
         no draft, so a step naming `builder` settles on a screen it did not
         ask for. The tour must not hang waiting for it. */
      mount(1, '/overview');
      expect(document.querySelector('[data-tour-pending="1"]')).toBeTruthy();

      act(() => { vi.advanceTimersByTime(4000); });
      expect(document.querySelector('[data-tour-pending="1"]')).toBeNull();
      /* The card is still there and the tour is still steppable. */
      expect(screen.getByText('Step 2 of ' + TOUR.length)).toBeTruthy();
      expect(screen.getByText('Next')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits again on the next step rather than reusing the last arrival', () => {
    const view = mount(1);
    arriveAt('/documents', view, 1);
    expect(spotlight().style.border).toContain('solid');

    /* Step 7 is about `/reports`; the URL has not moved off `/documents`, so
       arriving once must not count as having arrived for every step after. */
    arriveAt('/documents', view, 6);
    act(() => { fireEvent.click(screen.getByText('start')); });
    expect(spotlight().style.border).toBe('');
    expect(document.querySelector('[data-tour-pending="1"]')).toBeTruthy();
  });

  it('goes back to the step\'s own screen', () => {
    const view = mount(1);
    arriveAt('/documents', view, 1);
    act(() => { fireEvent.click(screen.getByText('Back')); });
    expect(router.push).toHaveBeenCalledWith('/overview');
  });
});
