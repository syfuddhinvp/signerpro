'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { DOCS_PAGES, DOC_NAV } from '@/lib/sf/data';
import { btn, jsonBoxStyle, railHead, BORDER_STRONG, TEXT_MUTED } from '@/lib/sf/ui';
import Icon from '@/components/sf/Icon';

export default function Guides() {
  const { s, set, accent } = useSF();
  const A = accent();
  const ghostBtn = btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))');

  const docPage = (DOCS_PAGES as any)[s.docsPage] || (DOCS_PAGES as any).quickstart;
  const docNav = DOC_NAV.map(([id, label, group], i) => {
    const on = s.docsPage === id;
    return { id, label, group, newGroup: i === 0 || DOC_NAV[i - 1][2] !== group,
      onClick: () => set({ screen: 'guides', docsPage: id } as any),
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'8px 10px', borderRadius:'9px', border:'none', cursor:'pointer', textAlign:'left',
        background: on ? 'hsl(var(--color-accent-subtle))' : 'transparent', color: on ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-subtle))', fontSize:'.78125rem', fontWeight: on ? 600 : 500 } as CSSProperties,
      dot: { width:'7px', height:'7px', borderRadius:'99px', background: on ? A : BORDER_STRONG, flex:'0 0 7px' } as CSSProperties };
  });
  const docIndex = DOC_NAV.findIndex(([id]) => id === s.docsPage);
  const docPrev = docIndex > 0 ? DOC_NAV[docIndex - 1] : null;
  const docNext = docIndex >= 0 && docIndex < DOC_NAV.length - 1 ? DOC_NAV[docIndex + 1] : null;
  const docSections = docPage.sections.map((sec: any) => ({
    h: sec.h, p: sec.p || '', hasP: !!sec.p,
    code: sec.code || '', hasCode: !!sec.code,
    hasItems: !!(sec.items && sec.items.length),
    items: (sec.items || []).map((text: string) => ({ text }))
  }));

  return (
    <section data-screen-label="Guides" style={{ display:'flex', height:'100%', minHeight:0, alignItems:'stretch', overflow:'hidden' }}>
      <div data-sf-scroll="1" style={{ width:'216px', flex:'0 0 216px', borderRight:'1px solid hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-surface))', padding:'16px 13px', display:'flex', flexDirection:'column', gap:'10px', overflow:'auto' }}>
        <span style={railHead}>Guides &amp; docs</span>
        <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
          {docNav.map(n => (
            <div key={n.id} style={{ display:'contents' }}>
              {n.newGroup ? (
                <span style={{ ...railHead, marginTop: n.group === 'Getting started' ? 0 : '12px' }}>{n.group}</span>
              ) : null}
              <button type="button" onClick={n.onClick} style={n.style} aria-current={n.id === s.docsPage ? 'page' : undefined}>
                <span style={n.dot}></span><span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.label}</span>
              </button>
            </div>
          ))}
        </div>
        <div style={{ marginTop:'auto', borderTop:'1px solid hsl(var(--color-border-hairline))', paddingTop:'12px', display:'flex', flexDirection:'column', gap:'7px' }}>
          <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, lineHeight:1.5 }}>Prefer to be shown? The tour walks the same steps in your own workspace.</span>
          <button type="button" onClick={() => set({ tourStep: 0 } as any)} style={ghostBtn}><Icon name="play" size={13} />Start product tour</button>
          <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, lineHeight:1.5 }}>Developers: run any call without leaving the app — against your live workspace, not a test tenant.</span>
          <button type="button" onClick={() => set({ screen: 'sandbox' } as any)} style={ghostBtn}><Icon name="developer" size={13} />Open API console</button>
        </div>
      </div>

      <div data-sf-scroll="1" style={{ flex:1, minWidth:0, overflow:'auto', padding:'24px 26px 44px' }}>
        <div style={{ maxWidth:'720px', display:'flex', flexDirection:'column', gap:'20px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <h2 style={{ margin:0, fontSize:'1.4375rem', fontWeight:700, letterSpacing:'-.6px' }}>{docPage.title}</h2>
            <p style={{ margin:0, fontSize:'.84375rem', color:'hsl(var(--color-fg-subtle))', lineHeight:1.7, textWrap:'pretty' } as CSSProperties}>{docPage.lede}</p>
          </div>
          {docSections.map((sec: any, i: number) => (
            <div key={i} style={{ display:'flex', flexDirection:'column', gap:'10px', borderTop:'1px solid hsl(var(--color-border-subtle))', paddingTop:'18px' }}>
              <h3 style={{ margin:0, fontSize:'.90625rem', fontWeight:600, letterSpacing:'-.2px' }}>{sec.h}</h3>
              {sec.hasP ? (
                <p style={{ margin:0, fontSize:'.78125rem', color:'hsl(var(--color-fg-subtle))', lineHeight:1.75, textWrap:'pretty' } as CSSProperties}>{sec.p}</p>
              ) : null}
              {sec.hasItems ? (
                <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                  {sec.items.map((it: any, j: number) => (
                    <div key={j} style={{ display:'flex', gap:'9px', alignItems:'flex-start' }}>
                      <span style={{ width:'6px', height:'6px', borderRadius:'99px', background:BORDER_STRONG, marginTop:'7px', flex:'0 0 6px' }}></span>
                      <span style={{ fontSize:'.78125rem', color:'hsl(var(--color-fg-subtle))', lineHeight:1.65 }}>{it.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {sec.hasCode ? (<pre style={jsonBoxStyle}>{sec.code}</pre>) : null}
            </div>
          ))}
          <nav aria-label="Guide pages" style={{ display:'flex', gap:'10px', borderTop:'1px solid hsl(var(--color-border-subtle))', paddingTop:'18px' }}>
            {docPrev ? (
              <button type="button" onClick={() => set({ docsPage: docPrev[0] } as any)} style={ghostBtn}><Icon name="arrowLeft" size={13} />{docPrev[1]}</button>
            ) : null}
            {docNext ? (
              <button type="button" onClick={() => set({ docsPage: docNext[0] } as any)} style={{ ...ghostBtn, marginLeft:'auto' }}>{docNext[1]}<Icon name="arrowRight" size={13} /></button>
            ) : null}
          </nav>
        </div>
      </div>
    </section>
  );
}
