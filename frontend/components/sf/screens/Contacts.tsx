'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useSF, type Contact } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { ROLE_WORDS, SRC_TONE, type Dict } from '@/lib/sf/data';
import { btn, jsonBoxStyle, pill, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { contacts as contactsApi } from '@/lib/api/resources';
import type { ContactHistoryEntry } from '@/lib/api/types';

/**
 * Server data, adapted in `app/(app)/contacts/page.tsx` via
 * `lib/sf/adapters.ts`. The screen owns only UI state (search text, selected
 * group, selected contact) — the rows themselves come from the API.
 */
export type ContactsProps = {
  contacts: Contact[];
  /** Group key → label, from `GET /api/contacts/groups`. */
  groupLabels: Dict<string>;
  /** Pill counts from `GET /api/contacts` (`counts` + an `all` bucket). */
  counts: Dict<number>;
  /**
   * The draft envelope "Add as recipient" targets. Null when the workspace has
   * no draft yet — the toast still fires, but nothing is persisted.
   */
  draftDocumentId: string | null;
};

/** `2026-08-14T…` → `14 Aug 2026`; an absent timestamp stays absent. */
function historyDate(iso: string | null): string {
  if (!iso) return 'no date recorded';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'no date recorded' : d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

/**
 * The contact detail, raised as a modal over the address book rather than
 * living in a side rail: the list gets the full width, and the record —
 * fields, signing history, API shape — gets a dialog it can scroll on its own.
 *
 * Mounted only while a contact is open, so the history fetch below is keyed to
 * that contact's lifetime; closing the dialog cancels it.
 */
function ContactDetail({ ct, groupLabels, draftDocumentId, onClose }: {
  ct: Contact;
  groupLabels: Dict<string>;
  draftDocumentId: string | null;
  onClose: () => void;
}) {
  const { set, flash, accent, initials, recips } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();
  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');

  /* The prototype rendered the same four invented envelopes for every contact.
     `GET /api/contacts/{id}/history` is the real per-contact record. */
  const [history, setHistory] = useState<ContactHistoryEntry[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setHistoryFailed(false);
    void contactsApi.history(apiCall, ct.id, { limit: 10 }).then(res => {
      if (cancelled) return;
      if (!res.ok) { setHistoryFailed(true); setHistory([]); return; }
      setHistory(res.data);
    });
    return () => { cancelled = true; };
  }, [ct.id]);

  /* The four things a dialog owes its user: focus in, Escape out, a tab trap,
     and focus back to the row that opened it. Same contract as `Modals.tsx`. */
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;
    const SELECTOR = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(root.querySelectorAll<HTMLElement>(SELECTOR));

    (focusable()[0] ?? root).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); root.focus(); return; }
      const head = items[0];
      const tail = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const outside = !active || !root.contains(active);
      if (event.shiftKey && (active === head || outside)) { event.preventDefault(); tail.focus(); }
      else if (!event.shiftKey && (active === tail || outside)) { event.preventDefault(); head.focus(); }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (opener && document.contains(opener)) opener.focus();
    };
    /* Keyed on the contact so re-opening a different row re-runs focus-in. */
  }, [ct.id, onClose]);

  const ctFields = ([
    { k:'Email', v:ct.email, mono:true }, { k:'Phone', v:ct.phone, mono:true },
    { k:'Company', v:ct.company, mono:false }, { k:'Default role', v:ROLE_WORDS[ct.role], mono:false },
    { k:'Group', v:groupLabels[ct.group] ?? ct.group, mono:false }, { k:'Source', v:ct.source, mono:true },
    { k:'Envelopes', v:String(ct.envelopes), mono:true }, { k:'Last signed', v:ct.lastSigned, mono:true },
  ]).map(f => ({ k:f.k, v:f.v, style: { fontWeight:500, textAlign:'right', wordBreak:'break-all', fontFamily: f.mono ? "'Inter', 'Google Sans Flex', sans-serif" : 'inherit' } as CSSProperties }));

  const ctHistory = (history ?? []).map(h => {
    const done = h.status === 'completed';
    return {
      key: h.document_id,
      title: h.title,
      meta: h.event + ' · ' + historyDate(h.occurred_at),
      status: h.status,
      dot: { width:'8px', height:'8px', borderRadius:'99px', background: done ? '#10b981' : A, flex:'0 0 8px' } as CSSProperties,
      pill: pill(done ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' }),
    };
  });

  const ctJson = '{\n  "id": "' + ct.id + '",\n  "name": "' + ct.name + '",\n  "email": "' + ct.email + '",\n  "company": "' + ct.company + '",\n  "title": "' + ct.title + '",\n  "default_role": "' + ct.role + '",\n  "group": "' + ct.group + '",\n  "source": "' + ct.source.toLowerCase() + '",\n  "tags": ' + JSON.stringify(ct.tags) + ',\n  "envelope_count": ' + ct.envelopes + ',\n  "last_signed_at": "' + ct.lastSigned + '"\n}';

  const ctTags = ct.tags.concat([ct.source]).map(label => ({
    label,
    style: { padding:'4px 9px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'.65625rem', color:'#475569', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties,
  }));

  const ctAvatar: CSSProperties = { width:'40px', height:'40px', borderRadius:'99px', background:ct.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'.875rem', fontWeight:700, flex:'0 0 40px' };
  const iconBtn: CSSProperties = { width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'.8125rem', lineHeight:1, flex:'0 0 28px' };

  const ctAddRecipient = () => {
    const list = recips();
    if (list.some(r => r.email === ct.email)) { flash(ct.name + ' is already a recipient on this envelope'); return; }
    /* Optimistic first — the toast must fire immediately, as in the prototype. */
    set({ recipients: list.concat([{ id:'r' + (list.length + 1), name:ct.name, email:ct.email, role:ct.role, color:ct.color, order:list.length + 1, status:'Pending' } as any]) });
    flash(ct.name + ' added as recipient ' + (list.length + 1) + ' · assign fields in the builder');
    if (!draftDocumentId) return;
    void contactsApi
      .addAsRecipients(apiCall, { document_id: draftDocumentId, contact_ids: [ct.id] })
      .then(res => {
        if (!res.ok) { flash('Could not add ' + ct.name + ' · ' + res.error.message); return; }
        router.refresh();
      });
  };
  const ctSendEnvelope = () => go('routing', { documentId: draftDocumentId });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={'Contact · ' + ct.name}
      ref={dialogRef}
      tabIndex={-1}
      data-sf-modal-open=""
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
      style={{ position:'fixed', inset:0, zIndex:80, background:'rgba(15,23,42,.55)', display:'grid', placeItems:'center', padding:'24px' }}
    >
      <div style={{ width:'min(88vw, 1180px)', height:'calc(100vh - 48px)', display:'flex', flexDirection:'column', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', boxShadow:'0 24px 60px rgba(15,23,42,.28)', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'16px 18px', borderBottom:'1px solid #eef1f6', flex:'0 0 auto' }}>
          <span style={ctAvatar}>{initials(ct.name)}</span>
          <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0, flex:1 }}>
            <span style={{ fontSize:'.9375rem', fontWeight:700, letterSpacing:'-.2px' }}>{ct.name}</span>
            <span style={{ fontSize:'.71875rem', color:'#64748b' }}>{ct.title + ' · ' + ct.company}</span>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} style={iconBtn}>✕</button>
        </div>

        {/* Two columns at this width — the record on the left, its trail and
            API shape on the right. `auto-fit` collapses to one column on a
            narrow viewport without needing a media query. */}
        <div data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', padding:'16px 18px 20px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(340px, 1fr))', gap:'16px 24px', alignItems:'start' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px', minWidth:0 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {ctFields.map(f => (
              <div key={f.k} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'.78125rem', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
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

          <div style={{ display:'flex', flexDirection:'column', gap:'16px', minWidth:0 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'11px', borderTop:'1px solid #e3e7ee', paddingTop:'14px' }}>
            <div style={railHead}>Signing history</div>
            {history === null ? (
              <span style={{ fontSize:'.75rem', color:TEXT_MUTED }}>Loading…</span>
            ) : ctHistory.length === 0 ? (
              <span style={{ fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6 }}>
                {historyFailed ? 'This contact’s signing history could not be loaded.' : 'No envelopes involving this contact yet.'}
              </span>
            ) : null}
            {ctHistory.map(h => (
              <div key={h.key} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
                <span style={h.dot}></span>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:1, minWidth:0 }}>
                  <span style={{ fontSize:'.78125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{h.title}</span>
                  <span style={{ fontSize:'.65625rem', color:'#64748b' }}>{h.meta}</span>
                </div>
                <span style={h.pill}>{h.status}</span>
              </div>
            ))}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:'9px', borderTop:'1px solid #e3e7ee', paddingTop:'14px' }}>
            <div style={railHead}>API representation</div>
            <pre style={jsonBoxStyle}>{ctJson}</pre>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Contacts({ contacts: allContacts, groupLabels, counts, draftDocumentId }: ContactsProps) {
  const { s, set, accent, initials } = useSF();
  const A = accent();
  const primaryBtn = btn(A, '#fff', A);

  const ctCounts = counts;
  /* Same predicate as the prototype's `contactsFiltered`, over server rows. */
  const cq = s.contactQuery.toLowerCase();
  const ctList = allContacts.filter(c =>
    (s.contactGroup === 'all' || c.group === s.contactGroup) &&
    (!cq || (c.name + c.email + c.company + c.tags.join(' ')).toLowerCase().indexOf(cq) > -1));

  /* The detail is a modal, so nothing is selected until a row is opened —
     there is no implicit "first contact" any more. */
  const openContact = allContacts.find(c => c.id === s.openContact) || null;
  const closeDetail = useCallback(() => set({ openContact: '' }), [set]);

  const contactGroups = ([['all', 'All']] as [string, string][])
    .concat(Object.keys(groupLabels).map(g => [g, groupLabels[g]] as [string, string]))
    .map(([id, label]) => {
      const on = s.contactGroup === id;
      return {
        id, label, count: String(ctCounts[id] || 0), selected: on ? 'true' : 'false',
        onClick: () => set({ contactGroup: id }),
        style: { height:'26px', padding:'0 9px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem', fontWeight: on ? 600 : 500, display:'inline-flex', alignItems:'center', gap:'5px',
          background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties,
        badge: { fontSize:'.625rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: on ? '#64748b' : TEXT_MUTED } as CSSProperties,
      };
    });

  const contacts = ctList.map((c, i) => {
    const on = s.openContact === c.id;
    return {
      id: c.id, name: c.name, email: c.email, company: c.company, source: c.source, initials: initials(c.name),
      envelopes: c.envelopes + ' envelopes',
      avatar: { width:'30px', height:'30px', borderRadius:'99px', background:c.color, color:'#fff', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
      sourcePill: pill(SRC_TONE[c.source]),
      onOpen: () => set({ openContact: c.id }),
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', width:'100%', padding:'11px 14px', borderTop: i ? '1px solid #f2f4f8' : 'none',
        background: on ? '#f8faff' : 'transparent', border:'none', borderLeft:'3px solid ' + (on ? A : 'transparent'), cursor:'pointer', flexWrap:'wrap' } as CSSProperties,
    };
  });

  const openNewContact = () => set({ modal: 'contact' });
  /* A brand-new tenant has no contacts — the list chrome still renders. */
  const contactScopeLabel = allContacts.length
    ? 'Address book · ' + ctList.length + ' of ' + allContacts.length
    : 'Address book · 0 of 0';

  return (
    <section data-screen-label="Contacts" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
        <div style={{ padding:'12px 14px', borderBottom:'1px solid #eef1f6', display:'flex', flexDirection:'column', gap:'9px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>{contactScopeLabel}</div>
            <div style={{ display:'flex', gap:'7px' }}>
              <button type="button" onClick={openNewContact} style={primaryBtn}>New contact</button>
            </div>
          </div>
          {allContacts.length ? (
            <>
              <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px', flexWrap:'wrap' }}>
                {contactGroups.map(g => (
                  <button key={g.id} type="button" onClick={g.onClick} aria-pressed={g.selected as unknown as boolean} style={g.style}>
                    {g.label} <span style={g.badge}>{g.count}</span>
                  </button>
                ))}
              </div>
              <input type="search" value={s.contactQuery} onChange={e => set({ contactQuery: e.target.value })}
                placeholder="Search name, email, company, tag…" aria-label="Search contacts"
                style={{ height:'32px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'.78125rem', outline:'none', background:'#fbfcfd' }} />
            </>
          ) : null}
        </div>
        {allContacts.length ? contacts.map(c => (
          <button key={c.id} type="button" onClick={c.onOpen} style={c.rowStyle}>
            <span style={c.avatar}>{c.initials}</span>
            <span style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'1 1 180px', minWidth:'160px', textAlign:'left' }}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</span>
              <span style={{ fontSize:'.6875rem', color:'#64748b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.email} · {c.company}</span>
            </span>
            <span style={c.sourcePill}>{c.source}</span>
            <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, flex:'0 0 auto', width:'96px', textAlign:'right' }}>{c.envelopes}</span>
          </button>
        )) : (
          <div style={{ padding:'22px 14px', fontSize:'.78125rem', color:'#64748b' }}>No contacts yet — add one to start routing envelopes.</div>
        )}
      </div>

      {openContact ? (
        <ContactDetail
          ct={openContact}
          groupLabels={groupLabels}
          draftDocumentId={draftDocumentId}
          onClose={closeDetail}
        />
      ) : null}
    </section>
  );
}
