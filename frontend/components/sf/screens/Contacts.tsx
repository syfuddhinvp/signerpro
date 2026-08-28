'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { GROUP_LABELS, ROLE_WORDS, SRC_TONE } from '@/lib/sf/data';
import { btn, jsonBoxStyle, pill, railHead } from '@/lib/sf/ui';

/* The prototype's signing-history rows (data.ts ships only the first three). */
const CT_HISTORY_ROWS: [string, string, string, string][] = [
  ['Master Services Agreement — Acme Corp', 'ENV-2291-KD · signed 14 Aug 2026', 'Completed', 'good'],
  ['Order Form — Enterprise Tier Renewal', 'ENV-2271-TT · sent 25 Aug 2026', 'Waiting', 'info'],
  ['Mutual NDA — Vertex Robotics', 'ENV-2287-QB · viewed 27 Aug 2026', 'Viewed', 'info'],
  ['Statement of Work #14', 'ENV-2280-LM · signed 8 Aug 2026', 'Completed', 'good'],
];

export default function Contacts() {
  const { s, set, flash, accent, initials, recips, contactCounts, contactsFiltered } = useSF();
  const { go } = useNav();
  const A = accent();
  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  const ctCounts = contactCounts();
  const ctList = contactsFiltered();

  const contactGroups = ([['all', 'All']] as [string, string][])
    .concat(Object.keys(GROUP_LABELS).map(g => [g, GROUP_LABELS[g]] as [string, string]))
    .map(([id, label]) => {
      const on = s.contactGroup === id;
      return {
        id, label, count: String(ctCounts[id] || 0), selected: on ? 'true' : 'false',
        onClick: () => set({ contactGroup: id }),
        style: { height:'26px', padding:'0 9px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'11.5px', fontWeight: on ? 600 : 500, display:'inline-flex', alignItems:'center', gap:'5px',
          background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties,
        badge: { fontSize:'10px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: on ? '#64748b' : '#94a3b8' } as CSSProperties,
      };
    });

  const contacts = ctList.map((c, i) => {
    const on = s.openContact === c.id;
    return {
      id: c.id, name: c.name, email: c.email, company: c.company, source: c.source, initials: initials(c.name),
      envelopes: c.envelopes + ' envelopes',
      avatar: { width:'30px', height:'30px', borderRadius:'99px', background:c.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'11px', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
      sourcePill: pill(SRC_TONE[c.source]),
      onOpen: () => set({ openContact: c.id }),
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', width:'100%', padding:'11px 14px', borderTop: i ? '1px solid #f2f4f8' : 'none',
        background: on ? '#f8faff' : 'transparent', border:'none', borderLeft:'3px solid ' + (on ? A : 'transparent'), cursor:'pointer', flexWrap:'wrap' } as CSSProperties,
    };
  });

  const ct = s.contacts.find(c => c.id === s.openContact) || ctList[0] || s.contacts[0];

  const ctFields = ([
    { k:'Email', v:ct.email, mono:true }, { k:'Phone', v:ct.phone, mono:true },
    { k:'Company', v:ct.company, mono:false }, { k:'Default role', v:ROLE_WORDS[ct.role], mono:false },
    { k:'Group', v:GROUP_LABELS[ct.group], mono:false }, { k:'Source', v:ct.source, mono:true },
    { k:'Envelopes', v:String(ct.envelopes), mono:true }, { k:'Last signed', v:ct.lastSigned, mono:true },
  ]).map(f => ({ k:f.k, v:f.v, style: { fontWeight:500, textAlign:'right', wordBreak:'break-all', fontFamily: f.mono ? "'Inter', 'Google Sans Flex', sans-serif" : 'inherit' } as CSSProperties }));

  const ctHistory = CT_HISTORY_ROWS.map(([title, meta, status, tone]) => ({
    title, meta, status,
    dot: { width:'8px', height:'8px', borderRadius:'99px', background: tone === 'good' ? '#10b981' : A, flex:'0 0 8px' } as CSSProperties,
    pill: pill(tone === 'good' ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' }),
  }));

  const ctJson = '{\n  "id": "' + ct.id + '",\n  "name": "' + ct.name + '",\n  "email": "' + ct.email + '",\n  "company": "' + ct.company + '",\n  "title": "' + ct.title + '",\n  "default_role": "' + ct.role + '",\n  "group": "' + ct.group + '",\n  "source": "' + ct.source.toLowerCase() + '",\n  "tags": ' + JSON.stringify(ct.tags) + ',\n  "envelope_count": ' + ct.envelopes + ',\n  "last_signed_at": "' + ct.lastSigned + '"\n}';

  const ctTags = ct.tags.concat([ct.source]).map(label => ({
    label,
    style: { padding:'4px 9px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'10.5px', color:'#475569', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties,
  }));

  const ctAvatar: CSSProperties = { width:'40px', height:'40px', borderRadius:'99px', background:ct.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'14px', fontWeight:700, flex:'0 0 40px' };

  const ctAddRecipient = () => {
    const list = recips();
    if (list.some(r => r.email === ct.email)) { flash(ct.name + ' is already a recipient on this envelope'); return; }
    set({ recipients: list.concat([{ id:'r' + (list.length + 1), name:ct.name, email:ct.email, role:ct.role, color:ct.color, order:list.length + 1, status:'Pending' } as any]) });
    flash(ct.name + ' added as recipient ' + (list.length + 1) + ' · assign fields in the builder');
  };
  const ctSendEnvelope = () => go('routing');
  const openNewContact = () => set({ modal: 'contact' });
  const syncContacts = () => flash('CRM sync queued · 412 contacts scanned, 3 updated');
  const contactScopeLabel = 'Address book · ' + ctList.length + ' of ' + s.contacts.length;

  return (
    <section data-screen-label="Contacts" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1.35fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
        <div style={{ padding:'12px 14px', borderBottom:'1px solid #eef1f6', display:'flex', flexDirection:'column', gap:'9px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>{contactScopeLabel}</div>
            <div style={{ display:'flex', gap:'7px' }}>
              <button type="button" onClick={syncContacts} style={ghostBtn}>Sync CRM</button>
              <button type="button" onClick={openNewContact} style={primaryBtn}>New contact</button>
            </div>
          </div>
          <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px', flexWrap:'wrap' }}>
            {contactGroups.map(g => (
              <button key={g.id} type="button" onClick={g.onClick} aria-pressed={g.selected as unknown as boolean} style={g.style}>
                {g.label} <span style={g.badge}>{g.count}</span>
              </button>
            ))}
          </div>
          <input type="search" value={s.contactQuery} onChange={e => set({ contactQuery: e.target.value })}
            placeholder="Search name, email, company, tag…" aria-label="Search contacts"
            style={{ height:'32px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'12.5px', outline:'none', background:'#fbfcfd' }} />
        </div>
        {contacts.map(c => (
          <button key={c.id} type="button" onClick={c.onOpen} style={c.rowStyle}>
            <span style={c.avatar}>{c.initials}</span>
            <span style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'1 1 180px', minWidth:'160px', textAlign:'left' }}>
              <span style={{ fontSize:'13px', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</span>
              <span style={{ fontSize:'11px', color:'#64748b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.email} · {c.company}</span>
            </span>
            <span style={c.sourcePill}>{c.source}</span>
            <span style={{ fontSize:'11px', color:'#94a3b8', flex:'0 0 auto', width:'96px', textAlign:'right' }}>{c.envelopes}</span>
          </button>
        ))}
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
            <span style={ctAvatar}>{initials(ct.name)}</span>
            <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
              <span style={{ fontSize:'15px', fontWeight:700, letterSpacing:'-.2px' }}>{ct.name}</span>
              <span style={{ fontSize:'11.5px', color:'#64748b' }}>{ct.title + ' · ' + ct.company}</span>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {ctFields.map(f => (
              <div key={f.k} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'12.5px', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
                <span style={{ color:'#64748b' }}>{f.k}</span>
                <span style={f.style}>{f.v}</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            {ctTags.map((t, i) => (<span key={t.label + i} style={t.style}>{t.label}</span>))}
          </div>
          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <button type="button" onClick={ctAddRecipient} style={primaryBtn}>Add as recipient</button>
            <button type="button" onClick={ctSendEnvelope} style={ghostBtn}>Send envelope</button>
          </div>
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Signing history</div>
          {ctHistory.map(h => (
            <div key={h.meta} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
              <span style={h.dot}></span>
              <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                <span style={{ fontSize:'12.5px', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{h.title}</span>
                <span style={{ fontSize:'10.5px', color:'#64748b' }}>{h.meta}</span>
              </div>
              <span style={h.pill}>{h.status}</span>
            </div>
          ))}
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'9px' }}>
          <div style={railHead}>API representation</div>
          <pre style={jsonBoxStyle}>{ctJson}</pre>
        </div>
      </div>
    </section>
  );
}
