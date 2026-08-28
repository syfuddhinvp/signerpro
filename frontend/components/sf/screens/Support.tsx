'use client';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import {
  TICKET_FILTERS, TK_STATUS_TONE, TK_STATUS_LABEL, TK_PRIO_TONE, TK_PRIO_LABEL
} from '@/lib/sf/data';
import { btn, pill, inputStyle, lbl, railHead } from '@/lib/sf/ui';
import { apiCall, type ApiResult } from '@/lib/api/browser';
import { support as supportApi } from '@/lib/api/resources';
import {
  toAgentOptions, toSupportTicket, toSupportTickets, toTicketCounts,
  type SupportTicketRow
} from '@/lib/sf/adapters';
import type { Dict } from '@/lib/sf/data';
import type { SupportAgent, TicketDetailResponse, TicketPage } from '@/lib/api/types';

export type SupportProps = {
  /** `GET /api/support/tickets/page` — rows plus the pill counts. */
  page: TicketPage;
  /** `GET /api/support/tickets/{id}` for the first row, thread included. */
  detail: TicketDetailResponse | null;
  /** `GET /api/support/agents` (platform only; empty for a tenant caller). */
  agents: SupportAgent[];
  /** `GET /api/support/stats` or `/api/support/queue/stats`, already tiled. */
  stats: { label: string; value: string; meta: string; good: boolean }[];
  /** `GET /api/support/quick-replies`, as `[label, body]` pairs. */
  quickReplies: [string, string][];
  /** `scope=all` on the platform queue. */
  scope: 'all' | undefined;
};

const EMPTY_PAGE: TicketPage = { items: [], total: 0, counts: { all: 0, open: 0, pending: 0, escalated: 0, resolved: 0 } };

export default function Support({ page, detail, agents, stats, quickReplies, scope }: SupportProps) {
  const { s, set, flash, accent, initials, isPlat: isPlatFn } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();
  const isPlat = isPlatFn();

  /* Server data lives in props; the API owns the filtering, so a filter change
     re-queries rather than narrowing a client array. */
  const [tkPage, setTkPage] = useState<TicketPage>(page);
  const [openDetail, setOpenDetail] = useState<TicketDetailResponse | null>(detail);
  const [busy, setBusy] = useState(false);
  const firstLoad = useRef(true);

  useEffect(() => { setTkPage(page); }, [page]);
  useEffect(() => { setOpenDetail(detail); }, [detail]);

  const statusParam = s.ticketFilter === 'all' ? undefined : s.ticketFilter;
  const queryParam = s.ticketQuery.trim() || undefined;

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void supportApi.ticketPage(apiCall, { status: statusParam, q: queryParam, scope, limit: 200 }).then(res => {
        if (cancelled) return;
        setTkPage(res.ok ? res.data : EMPTY_PAGE);
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [statusParam, queryParam, scope]);

  const loadTicket = useCallback((id: string) => {
    void supportApi.ticket(apiCall, id).then(res => { if (res.ok) setOpenDetail(res.data); });
  }, []);

  const primaryBtn = btn(A, '#fff', A);
  const successBtn = btn('#059669', '#fff', '#059669');
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const dangerStyle = btn('#fff', '#b91c1c', '#fecaca');
  const textareaStyle: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'9px', padding:'8px 10px', fontSize:'12.5px', resize:'vertical', outline:'none', width:'100%', color:'#0f172a' };

  const tkList = toSupportTickets(tkPage.items);
  const tkCounts: Dict<number> = toTicketCounts(tkPage.counts);

  const ticketFilters = TICKET_FILTERS.map(([id, label]) => {
    const on = s.ticketFilter === id;
    return {
      id, label, count: String(tkCounts[id] ?? 0), selected: (on ? 'true' : 'false') as 'true' | 'false',
      onClick: () => set({ ticketFilter: id }),
      style: { height:'26px', padding:'0 9px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'11.5px', fontWeight: on ? 600 : 500, display:'inline-flex', alignItems:'center', gap:'5px',
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties,
      badge: { fontSize:'10px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: on ? '#64748b' : '#94a3b8' } as CSSProperties
    };
  });

  /* The opened thread: whatever detail we hold, else the first listed row. */
  const detailRow: SupportTicketRow | null = openDetail ? toSupportTicket(openDetail) : null;
  const tk: SupportTicketRow | null =
    (detailRow && tkList.some(t => t.ticketId === detailRow.ticketId) ? detailRow : null) || detailRow || tkList[0] || null;

  const tickets = tkList.map((t, i) => {
    const on = tk ? tk.ticketId === t.ticketId : false;
    const overdue = t.slaBreached;
    return {
      id: t.ticketId,
      subject: t.subject,
      meta: t.id + ' · ' + (isPlat ? t.tenant + ' · ' : '') + t.requester + ' · ' + t.created,
      statusLabel: TK_STATUS_LABEL[t.status] ?? t.status, priorityLabel: TK_PRIO_LABEL[t.priority] ?? t.priority, sla: t.sla,
      statusPill: pill(TK_STATUS_TONE[t.status] ?? TK_STATUS_TONE.open), priorityPill: pill(TK_PRIO_TONE[t.priority] ?? TK_PRIO_TONE.normal),
      slaPill: pill(t.status === 'resolved' ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : (overdue ? { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' } : { bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' })),
      priorityBar: { width:'3px', alignSelf:'stretch', borderRadius:'99px', background: (TK_PRIO_TONE[t.priority] ?? TK_PRIO_TONE.normal).c, flex:'0 0 3px' } as CSSProperties,
      onOpen: () => { set({ openTicket: t.ticketId, replyDraft: '' }); loadTicket(t.ticketId); },
      rowStyle: { display:'flex', gap:'10px', alignItems:'stretch', width:'100%', padding:'11px 13px', borderTop: i ? '1px solid #f2f4f8' : 'none',
        background: on ? '#f8faff' : 'transparent', border:'none', borderLeft:'3px solid ' + (on ? A : 'transparent'), cursor:'pointer' } as CSSProperties
    };
  });

  const tkVisibleMsgs = tk ? tk.messages.filter(m => isPlat || !m.internal) : [];
  const tkMessages = tkVisibleMsgs.map(m => ({
    author: m.author, role: m.role, ts: m.ts, body: m.body, internal: m.internal, initials: initials(m.author),
    wrapStyle: { display:'flex', flexDirection:'column', gap:'7px', padding:'12px 13px', borderRadius:'12px',
      border:'1px solid ' + (m.internal ? '#fde68a' : '#eef1f6'),
      background: m.internal ? '#fffbeb' : (m.side === 'agent' ? '#f8faff' : '#fbfcfd') } as CSSProperties,
    chip: { width:'26px', height:'26px', borderRadius:'99px', display:'grid', placeItems:'center', fontSize:'10px', fontWeight:700, flex:'0 0 26px',
      background: m.side === 'agent' ? A : '#0f172a', color:'#fff' } as CSSProperties,
    internalPill: Object.assign(pill({ bg:'#fef3c7', fg:'#92400e', bd:'#fde68a' }), { marginLeft:'auto' }) as CSSProperties
  }));

  /** One mutation path: call, absorb the returned detail, refresh the page data. */
  const mutate = (
    run: () => Promise<ApiResult<TicketDetailResponse>>,
    fallbackMessage: string,
  ) => {
    if (busy) return;
    setBusy(true);
    void run().then(res => {
      setBusy(false);
      if (!res.ok) { flash(fallbackMessage + ' · ' + res.error.message); return; }
      setOpenDetail(res.data);
      void supportApi.ticketPage(apiCall, { status: statusParam, q: queryParam, scope, limit: 200 })
        .then(next => { if (next.ok) setTkPage(next.data); });
      router.refresh();
    });
  };

  const ticketStats = stats.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize:'10.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: x.good ? '#047857' : '#c2410c' } as CSSProperties
  }));

  const ticketScopeLabel = isPlat ? 'Queue · ' + tkPage.total + ' tickets' : 'Your tickets · ' + tkPage.total;
  const openNewTicket = () => set({ modal: 'ticket' });

  const slaBoxStyle: CSSProperties = { height:'32px', display:'flex', alignItems:'center', padding:'0 10px', borderRadius:'9px', fontSize:'12px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif",
    border:'1px solid ' + (tk && tk.status === 'resolved' ? '#a7f3d0' : '#fed7aa'), background: tk && tk.status === 'resolved' ? '#ecfdf5' : '#fff7ed',
    color: tk && tk.status === 'resolved' ? '#047857' : '#c2410c' };

  const tkTags = tk ? tk.tags.concat([tk.category]).map(label => ({
    label,
    style: { padding:'4px 9px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'10.5px', color:'#475569', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties
  })) : [];
  const tkEnvelopeStyle: CSSProperties = { padding:'4px 9px', borderRadius:'99px', border:'1px solid #c7d2fe', background:'#eef2ff', fontSize:'10.5px', color:'#3730a3', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", cursor:'pointer' };

  const internalRow: CSSProperties = { display:'inline-flex', alignItems:'center', gap:'9px', height:'30px', padding:'0 11px', borderRadius:'9px', cursor:'pointer',
    border:'1px solid ' + (s.replyInternal ? '#fde68a' : '#e3e7ee'), background: s.replyInternal ? '#fffbeb' : '#fff' };
  const internalSwitch: CSSProperties = { width:'32px', height:'18px', borderRadius:'99px', background: s.replyInternal ? '#f59e0b' : '#cbd5e1', position:'relative', flex:'0 0 32px' };
  const internalKnob: CSSProperties = { position:'absolute', top:'2px', left: s.replyInternal ? '16px' : '2px', width:'14px', height:'14px', borderRadius:'99px', background:'#fff', transition:'left .15s' };

  const macros = quickReplies.map(([label, body]) => ({
    label,
    onClick: () => set({ replyDraft: body }),
    style: { padding:'5px 10px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'11px', color:'#475569', cursor:'pointer' } as CSSProperties
  }));

  /* Internal notes are platform-only and the API enforces it (403); the switch
     is never offered to a tenant caller, so `internal` can only be true here. */
  const replyInternal = isPlat && s.replyInternal;
  const sendReplyLabel = replyInternal ? 'Add internal note' : 'Send reply';
  const sendReply = () => {
    const body = s.replyDraft.trim();
    if (!body) { flash('Write a message first'); return; }
    if (!tk) { flash('Open a ticket first'); return; }
    const ticketId = tk.ticketId;
    const toWhom = replyInternal
      ? 'Internal note added — not visible to the customer'
      : 'Reply sent to ' + (isPlat ? tk.requesterEmail : 'SignForge support');
    flash(toWhom);
    set({ replyDraft: '' });
    mutate(() => supportApi.reply(apiCall, ticketId, { body, internal: replyInternal }), 'Could not send the reply');
  };

  const agentOptions = toAgentOptions(agents, tk);

  const onStatusChange = (value: string) => {
    if (!tk) return;
    flash(tk.id + ' → ' + (TK_STATUS_LABEL[value] ?? value));
    mutate(() => supportApi.update(apiCall, tk.ticketId, { status: value }), 'Could not change the status');
  };
  const onPriorityChange = (value: string) => {
    if (!tk) return;
    flash(tk.id + ' → ' + (TK_PRIO_LABEL[value] ?? value) + (value === 'urgent' ? ' · on-call paged' : ''));
    mutate(() => supportApi.update(apiCall, tk.ticketId, { priority: value }), 'Could not change the priority');
  };
  const onAssigneeChange = (value: string) => {
    if (!tk) return;
    const picked = agentOptions.find(a => a.id === value);
    flash(tk.id + ' assigned to ' + (picked ? picked.name : 'Unassigned'));
    mutate(() => supportApi.update(apiCall, tk.ticketId, { assignee_user_id: value }), 'Could not assign the ticket');
  };

  const emptyNoteStyle: CSSProperties = { margin:'15px 17px', border:'1px dashed #cbd5e1', borderRadius:'12px', padding:'22px', textAlign:'center', fontSize:'12px', color:'#94a3b8', lineHeight:1.6 };

  return (
    <section data-screen-label="Support" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1.5fr)', gap:'16px', alignItems:'start' }}>

      <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'10px' }}>
          {ticketStats.map(st => (
            <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'13px', padding:'12px 13px', display:'flex', flexDirection:'column', gap:'5px' }}>
              <span style={{ fontSize:'10px', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{st.label}</span>
              <span style={{ fontSize:'20px', fontWeight:700, letterSpacing:'-.6px' }}>{st.value}</span>
              <span style={st.metaStyle}>{st.meta}</span>
            </div>
          ))}
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
          <div style={{ padding:'11px 13px', borderBottom:'1px solid #eef1f6', display:'flex', flexDirection:'column', gap:'9px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
              <div style={railHead}>{ticketScopeLabel}</div>
              <button type="button" onClick={openNewTicket} style={primaryBtn}>New ticket</button>
            </div>
            <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px', flexWrap:'wrap' }}>
              {ticketFilters.map(f => (
                <button key={f.id} type="button" onClick={f.onClick} aria-pressed={f.selected} style={f.style}>{f.label} <span style={f.badge}>{f.count}</span></button>
              ))}
            </div>
            <input type="search" value={s.ticketQuery} onChange={(e) => set({ ticketQuery: e.target.value })} placeholder="Search subject, ticket id, requester…" aria-label="Search tickets"
              style={{ height:'32px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'12.5px', outline:'none', background:'#fbfcfd' }} />
          </div>
          {tickets.map(t => (
            <button key={t.id} type="button" onClick={t.onOpen} style={t.rowStyle}>
              <span style={t.priorityBar}></span>
              <span style={{ display:'flex', flexDirection:'column', gap:'4px', flex:1, minWidth:0, textAlign:'left' }}>
                <span style={{ fontSize:'12.5px', fontWeight:600, color:'#0f172a', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.subject}</span>
                <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{t.meta}</span>
                <span style={{ display:'flex', gap:'5px', flexWrap:'wrap' }}>
                  <span style={t.statusPill}>{t.statusLabel}</span>
                  <span style={t.priorityPill}>{t.priorityLabel}</span>
                  <span style={t.slaPill}>{t.sla}</span>
                </span>
              </span>
            </button>
          ))}
          {tickets.length === 0 ? (
            <div style={emptyNoteStyle}>No tickets match this filter.</div>
          ) : null}
        </div>
      </div>

      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {tk ? (
          <>
        <div style={{ padding:'15px 17px', borderBottom:'1px solid #eef1f6', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
              <span style={{ fontSize:'15px', fontWeight:700, letterSpacing:'-.2px' }}>{tk.subject}</span>
              <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>
                {tk.id + ' · ' + tk.tenant + ' · ' + tk.requesterEmail + ' · opened ' + tk.created}
              </span>
            </div>
            <div style={{ display:'flex', gap:'6px', flex:'0 0 auto' }}>
              {tk.status !== 'resolved' ? (
                <button type="button" onClick={() => { flash(tk.id + ' resolved · CSAT survey sent to ' + tk.requesterEmail); mutate(() => supportApi.update(apiCall, tk.ticketId, { status: 'resolved' }), 'Could not resolve the ticket'); }} style={successBtn}>Mark resolved</button>
              ) : null}
              {tk.status === 'resolved' ? (
                <button type="button" onClick={() => { flash(tk.id + ' reopened'); mutate(() => supportApi.update(apiCall, tk.ticketId, { status: 'open' }), 'Could not reopen the ticket'); }} style={ghostBtn}>Reopen</button>
              ) : null}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:'9px' }}>
            <label style={lbl}>Status
              <select value={tk.status} onChange={(e) => onStatusChange(e.target.value)} style={inputStyle}>
                <option value="open">Open</option>
                <option value="pending">Pending customer</option>
                <option value="escalated">Escalated</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label style={lbl}>Priority
              <select value={tk.priority} onChange={(e) => onPriorityChange(e.target.value)} style={inputStyle}>
                <option value="urgent">P1 · Urgent</option>
                <option value="high">P2 · High</option>
                <option value="normal">P3 · Normal</option>
                <option value="low">P4 · Low</option>
              </select>
            </label>
            <label style={lbl}>Assignee
              <select value={tk.assignee} onChange={(e) => onAssigneeChange(e.target.value)} style={inputStyle} disabled={isPlat ? undefined : true}>
                {agentOptions.map(a => (<option key={a.id || 'unassigned'} value={a.id}>{a.name}</option>))}
              </select>
            </label>
            <label style={lbl}>SLA target
              <div style={slaBoxStyle}>{tk.sla}</div>
            </label>
          </div>

          <div style={{ display:'flex', gap:'7px', flexWrap:'wrap' }}>
            {tkTags.map((g, i) => (<span key={g.label + i} style={g.style}>{g.label}</span>))}
            {tk.envelope ? (
              <button type="button" onClick={() => go('audit', { workspace: 'tenant' })} style={tkEnvelopeStyle}>{'Envelope ' + tk.envelope + ' ›'}</button>
            ) : null}
          </div>
        </div>

        <div data-sf-scroll="1" style={{ flex:1, minHeight:0, maxHeight:'440px', overflow:'auto', padding:'15px 17px', display:'flex', flexDirection:'column', gap:'12px' }}>
          {tkMessages.map((m, i) => (
            <div key={i} style={m.wrapStyle}>
              <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
                <span style={m.chip}>{m.initials}</span>
                <div style={{ display:'flex', flexDirection:'column', gap:'1px', minWidth:0 }}>
                  <span style={{ fontSize:'12px', fontWeight:600, color:'#0f172a' }}>{m.author}</span>
                  <span style={{ fontSize:'10.5px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{m.role} · {m.ts}</span>
                </div>
                {m.internal ? (<span style={m.internalPill}>Internal note</span>) : null}
              </div>
              <div style={{ fontSize:'12.5px', color:'#334155', lineHeight:1.65, whiteSpace:'pre-wrap' }}>{m.body}</div>
            </div>
          ))}
        </div>

        <div style={{ borderTop:'1px solid #eef1f6', padding:'13px 17px', display:'flex', flexDirection:'column', gap:'10px' }}>
          <textarea rows={3} value={s.replyDraft} onChange={(e) => set({ replyDraft: e.target.value })}
            placeholder={isPlat ? 'Reply to the customer, or switch to an internal note…' : 'Add details, logs or a screenshot description…'}
            aria-label="Reply" style={textareaStyle} />
          <div style={{ display:'flex', alignItems:'center', gap:'9px', flexWrap:'wrap' }}>
            {isPlat ? (
              <button type="button" role="switch" aria-checked={s.replyInternal ? 'true' : 'false'} onClick={() => set(st => ({ replyInternal: !st.replyInternal }))} style={internalRow}>
                <span style={{ fontSize:'12px', color:'#334155' }}>Internal note</span>
                <span style={internalSwitch}><span style={internalKnob}></span></span>
              </button>
            ) : null}
            {macros.map(m => (<button key={m.label} type="button" onClick={m.onClick} style={m.style}>{m.label}</button>))}
            <div style={{ marginLeft:'auto', display:'flex', gap:'8px' }}>
              {tk.status !== 'escalated' && tk.status !== 'resolved' ? (
                <button type="button" onClick={() => { flash(tk.id + ' escalated to on-call engineering · P1'); mutate(() => supportApi.escalate(apiCall, tk.ticketId), 'Could not escalate the ticket'); }} style={dangerStyle}>Escalate</button>
              ) : null}
              <button type="button" onClick={sendReply} style={primaryBtn}>{sendReplyLabel}</button>
            </div>
          </div>
        </div>
          </>
        ) : (
          <div style={emptyNoteStyle}>
            {isPlat ? 'No tickets in the queue yet.' : 'You have no support tickets yet. Raise one with “New ticket”.'}
          </div>
        )}
      </div>
    </section>
  );
}
