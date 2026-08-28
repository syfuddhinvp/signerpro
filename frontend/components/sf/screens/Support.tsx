'use client';

import type { CSSProperties } from 'react';
import { useSF, ticketsScoped } from '@/lib/sf/state';
import {
  AGENTS, TICKET_FILTERS, TK_STATUS_TONE, TK_STATUS_LABEL, TK_PRIO_TONE, TK_PRIO_LABEL,
  TICKET_STATS_PLATFORM, TICKET_STATS_TENANT, TICKET_QUICK_REPLIES_PLATFORM, TICKET_QUICK_REPLIES_TENANT
} from '@/lib/sf/data';
import { btn, pill, inputStyle, lbl, railHead } from '@/lib/sf/ui';

export default function Support() {
  const { s, set, flash, accent, initials, isPlat: isPlatFn, ticketCounts, ticketsFiltered } = useSF();
  const A = accent();
  const isPlat = isPlatFn();

  const primaryBtn = btn(A, '#fff', A);
  const successBtn = btn('#059669', '#fff', '#059669');
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const dangerStyle = btn('#fff', '#b91c1c', '#fecaca');
  const textareaStyle: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'9px', padding:'8px 10px', fontSize:'12.5px', resize:'vertical', outline:'none', width:'100%', color:'#0f172a' };

  const tkScoped = ticketsScoped(s, isPlat);
  const tkCounts = ticketCounts();
  const tkList = ticketsFiltered();

  const ticketFilters = TICKET_FILTERS.map(([id, label]) => {
    const on = s.ticketFilter === id;
    return {
      id, label, count: String(tkCounts[id]), selected: (on ? 'true' : 'false') as 'true' | 'false',
      onClick: () => set({ ticketFilter: id }),
      style: { height:'26px', padding:'0 9px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'11.5px', fontWeight: on ? 600 : 500, display:'inline-flex', alignItems:'center', gap:'5px',
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties,
      badge: { fontSize:'10px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: on ? '#64748b' : '#94a3b8' } as CSSProperties
    };
  });

  const tickets = tkList.map((t, i) => {
    const on = s.openTicket === t.id;
    const overdue = t.sla.indexOf('left') > -1 && (t.sla.indexOf('m left') > -1 && t.sla.indexOf('h') < 0);
    return {
      id: t.id,
      subject: t.subject,
      meta: t.id + ' · ' + (isPlat ? t.tenant + ' · ' : '') + t.requester + ' · ' + t.created,
      statusLabel: TK_STATUS_LABEL[t.status], priorityLabel: TK_PRIO_LABEL[t.priority], sla: t.sla,
      statusPill: pill(TK_STATUS_TONE[t.status]), priorityPill: pill(TK_PRIO_TONE[t.priority]),
      slaPill: pill(t.status === 'resolved' ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : (overdue ? { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' } : { bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' })),
      priorityBar: { width:'3px', alignSelf:'stretch', borderRadius:'99px', background: TK_PRIO_TONE[t.priority].c, flex:'0 0 3px' } as CSSProperties,
      onOpen: () => set({ openTicket: t.id, replyDraft: '' }),
      rowStyle: { display:'flex', gap:'10px', alignItems:'stretch', width:'100%', padding:'11px 13px', borderTop: i ? '1px solid #f2f4f8' : 'none',
        background: on ? '#f8faff' : 'transparent', border:'none', borderLeft:'3px solid ' + (on ? A : 'transparent'), cursor:'pointer' } as CSSProperties
    };
  });

  const tk = s.tickets.find(t => t.id === s.openTicket) || tkList[0] || tkScoped[0] || s.tickets[0];
  const tkVisibleMsgs = tk.messages.filter(m => isPlat || !m.internal);
  const tkMessages = tkVisibleMsgs.map(m => ({
    author: m.author, role: m.role, ts: m.ts, body: m.body, internal: m.internal, initials: initials(m.author),
    wrapStyle: { display:'flex', flexDirection:'column', gap:'7px', padding:'12px 13px', borderRadius:'12px',
      border:'1px solid ' + (m.internal ? '#fde68a' : '#eef1f6'),
      background: m.internal ? '#fffbeb' : (m.side === 'agent' ? '#f8faff' : '#fbfcfd') } as CSSProperties,
    chip: { width:'26px', height:'26px', borderRadius:'99px', display:'grid', placeItems:'center', fontSize:'10px', fontWeight:700, flex:'0 0 26px',
      background: m.side === 'agent' ? A : '#0f172a', color:'#fff' } as CSSProperties,
    internalPill: Object.assign(pill({ bg:'#fef3c7', fg:'#92400e', bd:'#fde68a' }), { marginLeft:'auto' }) as CSSProperties
  }));

  const setTk = (patch: any) => set(st => ({ tickets: st.tickets.map(x => x.id === tk.id ? Object.assign({}, x, patch) : x) }));

  const openCount = String(tkCounts.open + tkCounts.escalated + tkCounts.pending);
  const ticketStats = (isPlat ? TICKET_STATS_PLATFORM : TICKET_STATS_TENANT).map(x => ({
    label: x.label, value: x.value === undefined ? openCount : x.value, meta: x.meta,
    metaStyle: { fontSize:'10.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: x.good ? '#047857' : '#c2410c' } as CSSProperties
  }));

  const ticketScopeLabel = isPlat ? 'Queue · ' + tkList.length + ' tickets' : 'Your tickets · ' + tkList.length;
  const openNewTicket = () => set({ modal: 'ticket' });

  const slaBoxStyle: CSSProperties = { height:'32px', display:'flex', alignItems:'center', padding:'0 10px', borderRadius:'9px', fontSize:'12px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif",
    border:'1px solid ' + (tk.status === 'resolved' ? '#a7f3d0' : '#fed7aa'), background: tk.status === 'resolved' ? '#ecfdf5' : '#fff7ed',
    color: tk.status === 'resolved' ? '#047857' : '#c2410c' };

  const tkTags = (tk.tags as string[]).concat([tk.category]).map(label => ({
    label,
    style: { padding:'4px 9px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'10.5px', color:'#475569', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties
  }));
  const tkEnvelopeStyle: CSSProperties = { padding:'4px 9px', borderRadius:'99px', border:'1px solid #c7d2fe', background:'#eef2ff', fontSize:'10.5px', color:'#3730a3', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", cursor:'pointer' };

  const internalRow: CSSProperties = { display:'inline-flex', alignItems:'center', gap:'9px', height:'30px', padding:'0 11px', borderRadius:'9px', cursor:'pointer',
    border:'1px solid ' + (s.replyInternal ? '#fde68a' : '#e3e7ee'), background: s.replyInternal ? '#fffbeb' : '#fff' };
  const internalSwitch: CSSProperties = { width:'32px', height:'18px', borderRadius:'99px', background: s.replyInternal ? '#f59e0b' : '#cbd5e1', position:'relative', flex:'0 0 32px' };
  const internalKnob: CSSProperties = { position:'absolute', top:'2px', left: s.replyInternal ? '16px' : '2px', width:'14px', height:'14px', borderRadius:'99px', background:'#fff', transition:'left .15s' };

  const macros = (isPlat ? TICKET_QUICK_REPLIES_PLATFORM : TICKET_QUICK_REPLIES_TENANT).map(([label, body]) => ({
    label,
    onClick: () => set({ replyDraft: body }),
    style: { padding:'5px 10px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'11px', color:'#475569', cursor:'pointer' } as CSSProperties
  }));

  const sendReplyLabel = s.replyInternal && isPlat ? 'Add internal note' : 'Send reply';
  const sendReply = () => {
    const body = s.replyDraft.trim();
    if (!body) { flash('Write a message first'); return; }
    const msg = {
      author: isPlat ? 'Marco Diaz' : 'Priya Raman',
      role: isPlat ? 'Support engineer · SignForge' : 'Org admin · Acme',
      ts: '28 Aug 12:0' + (tk.messages.length % 10),
      internal: isPlat && s.replyInternal,
      side: isPlat ? 'agent' : 'customer',
      body
    };
    set(st => ({
      tickets: st.tickets.map(x => x.id === tk.id ? Object.assign({}, x, {
        messages: x.messages.concat([msg]),
        status: msg.internal ? x.status : (isPlat ? 'pending' : (x.status === 'resolved' ? 'open' : x.status))
      }) : x),
      replyDraft: ''
    }));
    flash(msg.internal ? 'Internal note added — not visible to the customer' : 'Reply sent to ' + (isPlat ? tk.requesterEmail : 'SignForge support'));
  };

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
        </div>
      </div>

      <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', display:'flex', flexDirection:'column', overflow:'hidden' }}>
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
                <button type="button" onClick={() => { setTk({ status: 'resolved', sla: 'met in 3h 04m' }); flash(tk.id + ' resolved · CSAT survey sent to ' + tk.requesterEmail); }} style={successBtn}>Mark resolved</button>
              ) : null}
              {tk.status === 'resolved' ? (
                <button type="button" onClick={() => { setTk({ status: 'open' }); flash(tk.id + ' reopened'); }} style={ghostBtn}>Reopen</button>
              ) : null}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:'9px' }}>
            <label style={lbl}>Status
              <select value={tk.status} onChange={(e) => { const v = e.target.value; setTk({ status: v }); flash(tk.id + ' → ' + TK_STATUS_LABEL[v]); }} style={inputStyle}>
                <option value="open">Open</option>
                <option value="pending">Pending customer</option>
                <option value="escalated">Escalated</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label style={lbl}>Priority
              <select value={tk.priority} onChange={(e) => { const v = e.target.value; setTk({ priority: v }); flash(tk.id + ' → ' + TK_PRIO_LABEL[v] + (v === 'urgent' ? ' · on-call paged' : '')); }} style={inputStyle}>
                <option value="urgent">P1 · Urgent</option>
                <option value="high">P2 · High</option>
                <option value="normal">P3 · Normal</option>
                <option value="low">P4 · Low</option>
              </select>
            </label>
            <label style={lbl}>Assignee
              <select value={tk.assignee} onChange={(e) => { const v = e.target.value; setTk({ assignee: v }); flash(tk.id + ' assigned to ' + ((AGENTS.find(a => a.id === v) || {}) as any).name); }} style={inputStyle} disabled={isPlat ? undefined : true}>
                {AGENTS.map(a => (<option key={a.id} value={a.id}>{a.name}</option>))}
              </select>
            </label>
            <label style={lbl}>SLA target
              <div style={slaBoxStyle}>{tk.sla}</div>
            </label>
          </div>

          <div style={{ display:'flex', gap:'7px', flexWrap:'wrap' }}>
            {tkTags.map((g, i) => (<span key={g.label + i} style={g.style}>{g.label}</span>))}
            {tk.envelope ? (
              <button type="button" onClick={() => set({ workspace: 'tenant', screen: 'audit' })} style={tkEnvelopeStyle}>{'Envelope ' + tk.envelope + ' ›'}</button>
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
                <button type="button" onClick={() => { setTk({ status: 'escalated', priority: 'urgent' }); flash(tk.id + ' escalated to on-call engineering · P1'); }} style={dangerStyle}>Escalate</button>
              ) : null}
              <button type="button" onClick={sendReply} style={primaryBtn}>{sendReplyLabel}</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
