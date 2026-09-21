'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { useSF, type Contact } from '@/lib/sf/state';
import { SRC_TONE, type Dict } from '@/lib/sf/data';
import { btn, pill, railHead, TEXT_MUTED } from '@/lib/sf/ui';
import { contactPathFor } from '@/lib/sf/routes';
import Icon from '@/components/sf/Icon';

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
};

export default function Contacts({ contacts: allContacts, groupLabels, counts }: ContactsProps) {
  const { s, set, accent, initials } = useSF();
  const A = accent();
  const primaryBtn = btn(A, 'hsl(var(--color-fg-on-solid))', A);

  const ctCounts = counts;
  /* Same predicate as the prototype's `contactsFiltered`, over server rows. */
  const cq = s.contactQuery.toLowerCase();
  const ctList = allContacts.filter(c =>
    (s.contactGroup === 'all' || c.group === s.contactGroup) &&
    (!cq || (c.name + c.email + c.company + c.tags.join(' ')).toLowerCase().indexOf(cq) > -1));

  const contactGroups = ([['all', 'All']] as [string, string][])
    .concat(Object.keys(groupLabels).map(g => [g, groupLabels[g]] as [string, string]))
    .map(([id, label]) => {
      const on = s.contactGroup === id;
      return {
        id, label, count: String(ctCounts[id] || 0), selected: on ? 'true' : 'false',
        onClick: () => set({ contactGroup: id }),
        style: { height:'26px', padding:'0 9px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem', fontWeight: on ? 600 : 500, display:'inline-flex', alignItems:'center', gap:'5px',
          background: on ? 'hsl(var(--color-bg-surface))' : 'transparent', color: on ? 'hsl(var(--color-fg-default))' : 'hsl(var(--color-fg-muted))', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties,
        badge: { fontSize:'.625rem', fontFamily:'var(--font-sans)', color: on ? 'hsl(var(--color-fg-muted))' : TEXT_MUTED } as CSSProperties,
      };
    });

  const contacts = ctList.map((c, i) => {
    /* The record is a route now, so a row is a link: middle-click and
       "open in new tab" work, and the detail survives a reload. */
    return {
      id: c.id, name: c.name, email: c.email, company: c.company, source: c.source, initials: initials(c.name),
      envelopes: c.envelopes + ' envelopes',
      avatar: { width:'30px', height:'30px', borderRadius:'99px', background:c.color, color:'hsl(var(--color-fg-on-solid))', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
      sourcePill: pill(SRC_TONE[c.source]),
      href: contactPathFor(c.id),
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', width:'100%', padding:'11px 14px', borderTop: i ? '1px solid hsl(var(--color-border-faint))' : 'none',
        background:'transparent', border:'none', borderLeft:'3px solid transparent', cursor:'pointer', flexWrap:'wrap',
        color:'inherit', textDecoration:'none' } as CSSProperties,
    };
  });

  const openNewContact = () => set({ modal: 'contact' });
  /* A brand-new tenant has no contacts — the list chrome still renders. */
  const contactScopeLabel = allContacts.length
    ? 'Address book · ' + ctList.length + ' of ' + allContacts.length
    : 'Address book · 0 of 0';

  return (
    <section data-screen-label="Contacts" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>
      <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', overflow:'hidden' }}>
        <div style={{ padding:'12px 14px', borderBottom:'1px solid hsl(var(--color-border-hairline))', display:'flex', flexDirection:'column', gap:'9px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>{contactScopeLabel}</div>
            <div style={{ display:'flex', gap:'7px' }}>
              <button type="button" onClick={openNewContact} style={primaryBtn}><Icon name="addUser" size={13} />New contact</button>
            </div>
          </div>
          {allContacts.length ? (
            <>
              <div style={{ display:'flex', gap:'4px', background:'hsl(var(--color-bg-canvas))', padding:'4px', borderRadius:'10px', flexWrap:'wrap' }}>
                {contactGroups.map(g => (
                  <button key={g.id} type="button" onClick={g.onClick} aria-pressed={g.selected as unknown as boolean} style={g.style}>
                    {g.label} <span style={g.badge}>{g.count}</span>
                  </button>
                ))}
              </div>
              <input type="search" value={s.contactQuery} onChange={e => set({ contactQuery: e.target.value })}
                placeholder="Search name, email, company, tag…" aria-label="Search contacts"
                style={{ height:'32px', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'9px', padding:'0 11px', fontSize:'.78125rem', outline:'none', background:'hsl(var(--color-bg-subtle))' }} />
            </>
          ) : null}
        </div>
        {allContacts.length ? contacts.map(c => (
          <Link key={c.id} href={c.href} style={c.rowStyle}>
            <span style={c.avatar}>{c.initials}</span>
            <span style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'1 1 180px', minWidth:'160px', textAlign:'left' }}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, color:'hsl(var(--color-fg-default))', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.name}</span>
              <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{c.email} · {c.company}</span>
            </span>
            <span style={c.sourcePill}>{c.source}</span>
            <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, flex:'0 0 auto', width:'96px', textAlign:'right' }}>{c.envelopes}</span>
          </Link>
        )) : (
          <div style={{ padding:'22px 14px', fontSize:'.78125rem', color:'hsl(var(--color-fg-muted))' }}>No contacts yet — add one to start routing envelopes.</div>
        )}
      </div>
    </section>
  );
}
