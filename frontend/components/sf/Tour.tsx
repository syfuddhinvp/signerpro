'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { type ScreenKey, screenForPath, workspaceForPath } from '@/lib/sf/routes';
import { tourSteps } from '@/lib/sf/data';
import { useOptionalSession } from '@/components/sf/SessionProvider';
import { btn, linkBtn as linkBtnOf, TEXT_MUTED } from '@/lib/sf/ui';

/** Breathing room between the highlighted element and the ring around it. */
const SPOT_PAD = 6;
/** Gap between the ring and the card that explains it. */
const CARD_GAP = 14;
const CARD_W = 330;
/** Enough for the tallest step's copy; only used to keep the card on screen. */
const CARD_H_EST = 210;
/** Viewport margin the card is never allowed to cross. */
const EDGE = 14;
/**
 * How long to wait for a step's screen to actually arrive before showing the
 * step anyway.
 *
 * Some steps cannot arrive at all: the flat document routes resolve a document
 * server-side and redirect to `/documents` when the tenant has none, so the
 * URL settles on a screen the step never named. Without a ceiling the tour
 * would sit there waiting for a navigation that already finished.
 */
const ARRIVAL_TIMEOUT = 4000;
/**
 * Frames to keep re-measuring after arriving. A server-rendered screen paints
 * over several frames — PDF canvases and data tables land late — and the ring
 * has to follow it down rather than freeze on the first layout.
 */
const SETTLE_FRAMES = 90;

type Rect = { left: number; top: number; width: number; height: number };

/**
 * Finds the element a step points at. Steps name a selector; when they do not
 * — or the selector misses, which happens for the instant between a step's
 * navigation and the new screen painting — the active screen root stands in.
 */
function resolveTarget(selector: string | null): Element | null {
  if (selector) {
    const hit = document.querySelector(selector);
    if (hit) return hit;
  }
  return document.querySelector('[data-screen-label]');
}

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * Places the card beside the spotlight: to its right when there is room, then
 * left, then below, then above, and finally docked bottom-right when the
 * highlighted element is too big to sit next to. Whatever is chosen is clamped
 * into the viewport, so the card is never half off-screen on a small window.
 */
function placeCard(spot: Rect | null): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - EDGE * 2);
  const docked: CSSProperties = { left: vw - w - EDGE, top: vh - CARD_H_EST - EDGE, width: w };
  if (!spot) return docked;

  const right = spot.left + spot.width + SPOT_PAD + CARD_GAP;
  const left = spot.left - SPOT_PAD - CARD_GAP - w;
  const below = spot.top + spot.height + SPOT_PAD + CARD_GAP;
  const above = spot.top - SPOT_PAD - CARD_GAP - CARD_H_EST;

  let x: number;
  let y: number;
  if (right + w <= vw - EDGE) { x = right; y = spot.top; }
  else if (left >= EDGE) { x = left; y = spot.top; }
  else if (below + CARD_H_EST <= vh - EDGE) { x = spot.left; y = below; }
  else if (above >= EDGE) { x = spot.left; y = above; }
  else return docked;

  return {
    left: Math.min(Math.max(x, EDGE), Math.max(EDGE, vw - w - EDGE)),
    top: Math.min(Math.max(y, EDGE), Math.max(EDGE, vh - CARD_H_EST - EDGE)),
    width: w,
  };
}

export default function Tour() {
  const { s, set, flash, accent } = useSF();
  const { go } = useNav();
  const A = accent();
  const pathname = usePathname() || '/';

  /* Optional because the tour also mounts in tests and previews that render
     the shell without an authenticated session; no session reads as no
     platform access, which is the safe side to be wrong on. */
  const session = useOptionalSession();
  const steps = tourSteps(session?.isPlatformAdmin === true, session?.role);

  const tourActive = s.tourStep >= 0 && s.tourStep < steps.length;
  const tour = tourActive ? steps[s.tourStep] : null;
  const selector = tour ? tour.target : null;

  /* ── arrival ────────────────────────────────────────────────────────────
     A step changes the step index and asks the router to navigate in the same
     breath, but the navigation lands whole frames later — a server component
     has to render first. In between, the step is the new one and the DOM is
     still the old screen, so measuring then put the ring around the *outgoing*
     screen and made it jump when the new one painted. Nothing is measured
     until the URL says we are where the step says we should be. */
  const atScreen = !!tour
    && screenForPath(pathname) === tour.screen
    && workspaceForPath(pathname) === tour.ws;

  const [waived, setWaived] = useState(false);
  useEffect(() => {
    setWaived(false);
    if (!tourActive || atScreen) return;
    const timer = setTimeout(() => setWaived(true), ARRIVAL_TIMEOUT);
    return () => clearTimeout(timer);
  }, [tourActive, s.tourStep, atScreen]);

  const arrived = atScreen || waived;

  const [spot, setSpot] = useState<Rect | null>(null);
  const spotRef = useRef<Rect | null>(null);
  spotRef.current = spot;

  /* The target is re-measured rather than read once: the step's own navigation
     swaps the screen underneath us, the sidebar reflows per rail section, and
     the user can still scroll and resize while the card is up. */
  const sync = useCallback(() => {
    const el = tourActive && arrived ? resolveTarget(selector) : null;
    const next = el ? measure(el) : null;
    if (!sameRect(spotRef.current, next)) {
      spotRef.current = next;
      setSpot(next);
    }
  }, [tourActive, arrived, selector]);

  useLayoutEffect(() => {
    sync();
    if (!tourActive || !arrived) return;

    /* Re-measure across the frames the new screen takes to settle, then leave
       it to the observers. The poll is what catches an element that does not
       exist yet — a ResizeObserver can only watch something already there. */
    let raf = 0;
    let ticks = 0;
    const tick = () => { sync(); if (++ticks < SETTLE_FRAMES) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);

    const el = resolveTarget(selector);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [tourActive, arrived, selector, sync]);

  /* Escape leaves the tour, the same as "Skip tour". */
  useEffect(() => {
    if (!tourActive) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ tourStep: -1 }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tourActive, set]);

  if (!tour) return null;

  const linkBtn = linkBtnOf(A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);

  const tourStepLabel = 'Step ' + (s.tourStep + 1) + ' of ' + steps.length;
  const tourDots = steps.map((_x, i) => ({
    style: {
      width: i === s.tourStep ? '18px' : '6px', height: '6px', borderRadius: '99px',
      background: i === s.tourStep ? A : (i < s.tourStep ? '#c7d2fe' : '#e3e7ee'), transition: 'width .18s',
    } as CSSProperties,
  }));

  /* One element does both jobs: the ring is its border, and the dimming is an
     enormous spread shadow around it, so the cut-out can never drift out of
     register with the highlight the way four separate scrim panels can. With
     no target to point at it degrades to a plain full-page scrim. */
  const spotStyle: CSSProperties = spot && arrived
    ? {
        position: 'fixed',
        left: spot.left - SPOT_PAD, top: spot.top - SPOT_PAD,
        width: spot.width + SPOT_PAD * 2, height: spot.height + SPOT_PAD * 2,
        borderRadius: '14px', border: '2px solid ' + A,
        boxShadow: '0 0 0 9999px rgba(15,23,42,.45)',
        pointerEvents: 'none', zIndex: 120, transition: 'all .18s ease',
      }
    : { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', pointerEvents: 'none', zIndex: 120 };

  const tourCardStyle: CSSProperties = {
    position: 'fixed', ...placeCard(spot),
    background: '#fff', borderRadius: '15px', padding: '16px', boxShadow: '0 28px 60px -22px rgba(15,23,42,.55)', zIndex: 121,
    display: 'flex', flexDirection: 'column', gap: '12px', animation: 'sfIn .16s ease',
  };
  const tourNextLabel = s.tourStep === steps.length - 1 ? 'Finish' : 'Next';

  const tourNext = () => {
    const n = s.tourStep + 1;
    if (n >= steps.length) { set({ tourStep: -1 }); flash('Tour complete — reopen it any time from the help menu'); return; }
    const st1 = steps[n];
    set({ tourStep: n });
    go(st1.screen as ScreenKey, { workspace: st1.ws });
  };
  const tourBack = () => {
    const p = Math.max(0, s.tourStep - 1);
    const st2 = steps[p];
    set({ tourStep: p });
    go(st2.screen as ScreenKey, { workspace: st2.ws });
  };
  const tourSkip = () => set({ tourStep: -1 });

  return (
    <div role="dialog" aria-modal="false" aria-label="Product tour">
      <div data-tour-spotlight="1" style={spotStyle}></div>
      <div style={tourCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span style={{ fontSize: '.65625rem', letterSpacing: '.06em', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>{tourStepLabel}</span>
          <button type="button" onClick={tourSkip} style={linkBtn}>Skip tour</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <span style={{ fontSize: '.9375rem', fontWeight: 700, letterSpacing: '-.3px' }}>{tour.title}</span>
          <span style={{ fontSize: '.78125rem', color: '#475569', lineHeight: 1.65, textWrap: 'pretty' } as CSSProperties}>{tour.body}</span>
          {arrived ? null : (
            /* Said out loud rather than left as a blank pause: the step's copy
               describes a screen that is not on screen yet. */
            <span data-tour-pending="1" style={{ fontSize: '.71875rem', color: TEXT_MUTED, fontFamily: 'var(--font-sans)' }}>
              Opening the screen this step is about…
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', borderTop: '1px solid #eef1f6', paddingTop: '12px' }}>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            {tourDots.map((d, i) => (<span key={i} style={d.style}></span>))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '7px' }}>
            <button type="button" onClick={tourBack} style={ghostBtn}>Back</button>
            <button type="button" onClick={tourNext} style={primaryBtn}>{tourNextLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
