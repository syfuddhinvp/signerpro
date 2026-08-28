'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { DOCS_PAGES, DOC_NAV } from '@/lib/sf/data';
import { btn, jsonBoxStyle, railHead } from '@/lib/sf/ui';

export default function Guides() {
  const { s, set, accent } = useSF();
  const A = accent();
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const docPage = (DOCS_PAGES as any)[s.docsPage] || (DOCS_PAGES as any).quickstart;
  const docNav = DOC_NAV.map(([id, label]) => {
    const on = s.docsPage === id;
    return { id, label, onClick: () => set({ screen: 'guides', docsPage: id } as any),
      style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'8px 10px', borderRadius:'9px', border:'none', cursor:'pointer', textAlign:'left',
        background: on ? '#eef2ff' : 'transparent', color: on ? '#0f172a' : '#475569', fontSize:'12.5px', fontWeight: on ? 600 : 500 } as CSSProperties,
      dot: { width:'7px', height:'7px', borderRadius:'99px', background: on ? A : '#cbd5e1', flex:'0 0 7px' } as CSSProperties };
  });
  const docSections = docPage.sections.map((sec: any) => ({
    h: sec.h, p: sec.p || '', hasP: !!sec.p,
    code: sec.code || '', hasCode: !!sec.code,
    hasItems: !!(sec.items && sec.items.length),
    items: (sec.items || []).map((text: string) => ({ text }))
  }));

  return (
    <section data-screen-label="Guides" style={{ display:'flex', minHeight:'100%', alignItems:'stretch' }}>
      <div data-sf-scroll="1" style={{ width:'216px', flex:'0 0 216px', borderRight:'1px solid #e3e7ee', background:'#fff', padding:'16px 13px', display:'flex', flexDirection:'column', gap:'10px', overflow:'auto' }}>
        <span style={railHead}>Documentation</span>
        <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
          {docNav.map(n => (
            <button key={n.id} type="button" onClick={n.onClick} style={n.style}>
              <span style={n.dot}></span><span style={{ flex:'1 1 auto', minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.label}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop:'auto', borderTop:'1px solid #eef1f6', paddingTop:'12px', display:'flex', flexDirection:'column', gap:'7px' }}>
          <span style={{ fontSize:'11px', color:'#94a3b8', lineHeight:1.5 }}>Try any call against seeded test data without leaving the app.</span>
          <button type="button" onClick={() => set({ screen: 'sandbox' } as any)} style={ghostBtn}>Open sandbox</button>
        </div>
      </div>

      <div data-sf-scroll="1" style={{ flex:1, minWidth:0, overflow:'auto', padding:'24px 26px 44px' }}>
        <div style={{ maxWidth:'720px', display:'flex', flexDirection:'column', gap:'20px' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
            <h2 style={{ margin:0, fontSize:'23px', fontWeight:700, letterSpacing:'-.6px' }}>{docPage.title}</h2>
            <p style={{ margin:0, fontSize:'13.5px', color:'#475569', lineHeight:1.7, textWrap:'pretty' } as CSSProperties}>{docPage.lede}</p>
          </div>
          {docSections.map((sec: any, i: number) => (
            <div key={i} style={{ display:'flex', flexDirection:'column', gap:'10px', borderTop:'1px solid #e3e7ee', paddingTop:'18px' }}>
              <h3 style={{ margin:0, fontSize:'14.5px', fontWeight:600, letterSpacing:'-.2px' }}>{sec.h}</h3>
              {sec.hasP ? (
                <p style={{ margin:0, fontSize:'12.5px', color:'#475569', lineHeight:1.75, textWrap:'pretty' } as CSSProperties}>{sec.p}</p>
              ) : null}
              {sec.hasItems ? (
                <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                  {sec.items.map((it: any, j: number) => (
                    <div key={j} style={{ display:'flex', gap:'9px', alignItems:'flex-start' }}>
                      <span style={{ width:'6px', height:'6px', borderRadius:'99px', background:'#cbd5e1', marginTop:'7px', flex:'0 0 6px' }}></span>
                      <span style={{ fontSize:'12.5px', color:'#334155', lineHeight:1.65 }}>{it.text}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              {sec.hasCode ? (<pre style={jsonBoxStyle}>{sec.code}</pre>) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
