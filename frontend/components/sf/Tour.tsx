'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { TOUR } from '@/lib/sf/data';
import { btn, linkBtn as linkBtnOf } from '@/lib/sf/ui';

export default function Tour() {
  const { s, set, flash, accent } = useSF();
  const A = accent();

  const tourActive = s.tourStep >= 0 && s.tourStep < TOUR.length;
  const tour = tourActive ? TOUR[s.tourStep] : null;
  if (!tour) return null;

  const linkBtn = linkBtnOf(A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn = btn(A, '#fff', A);

  const tourTitle = tour.title;
  const tourBody = tour.body;
  const tourStepLabel = 'Step ' + (s.tourStep + 1) + ' of ' + TOUR.length;
  const tourDots = TOUR.map((x: any, i: number) => ({
    style: {
      width: i === s.tourStep ? '18px' : '6px', height: '6px', borderRadius: '99px',
      background: i === s.tourStep ? A : (i < s.tourStep ? '#c7d2fe' : '#e3e7ee'), transition: 'width .18s',
    } as CSSProperties,
  }));
  const tourSpotStyle: CSSProperties = {
    position: 'fixed', left: tour.spot.left + 'px', top: tour.spot.top + 'px', width: tour.spot.width + 'px', height: tour.spot.height + 'px',
    borderRadius: '14px', boxShadow: '0 0 0 9999px rgba(15,23,42,.6)', border: '2px solid ' + A, pointerEvents: 'none', zIndex: 120, transition: 'all .22s ease',
  };
  const tourCardStyle: CSSProperties = {
    position: 'fixed', left: Math.min(tour.card.left, 980) + 'px', top: tour.card.top + 'px', width: '330px', maxWidth: '86vw',
    background: '#fff', borderRadius: '15px', padding: '16px', boxShadow: '0 28px 60px -22px rgba(15,23,42,.55)', zIndex: 121,
    display: 'flex', flexDirection: 'column', gap: '12px', animation: 'sfIn .16s ease',
  };
  const tourNextLabel = s.tourStep === TOUR.length - 1 ? 'Finish' : 'Next';

  const tourNext = () => {
    const n = s.tourStep + 1;
    if (n >= TOUR.length) { set({ tourStep: -1 }); flash('Tour complete — reopen it any time from the help menu'); return; }
    const st1 = TOUR[n];
    set({ tourStep: n, workspace: st1.ws, screen: st1.screen });
  };
  const tourBack = () => {
    const p = Math.max(0, s.tourStep - 1);
    const st2 = TOUR[p];
    set({ tourStep: p, workspace: st2.ws, screen: st2.screen });
  };
  const tourSkip = () => set({ tourStep: -1 });

  return (
    <div role="dialog" aria-modal="false" aria-label="Product tour">
      <div style={tourSpotStyle}></div>
      <div style={tourCardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <span style={{ fontSize: '10.5px', letterSpacing: '.06em', color: '#94a3b8', fontFamily: "'Inter', 'Google Sans Flex', sans-serif" }}>{tourStepLabel}</span>
          <button type="button" onClick={tourSkip} style={linkBtn}>Skip tour</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <span style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-.3px' }}>{tourTitle}</span>
          <span style={{ fontSize: '12.5px', color: '#475569', lineHeight: 1.65, textWrap: 'pretty' } as CSSProperties}>{tourBody}</span>
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
