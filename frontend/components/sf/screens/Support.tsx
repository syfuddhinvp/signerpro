'use client';

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Inbox,
  MoreVertical, Search, X,
} from 'lucide-react';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import {
  TICKET_FILTERS, TK_STATUS_TONE, TK_STATUS_LABEL, TK_PRIO_TONE, TK_PRIO_LABEL
} from '@/lib/sf/data';
import { btn, pill, inputStyle, lbl, BORDER_STRONG, TEXT_MUTED } from '@/lib/sf/ui';
import {
  QUEUE_SORTS, NO_NARROWING, narrowTickets, queueFacets, sortTickets,
  type QueueNarrowing, type QueueSort
} from '@/lib/sf/supportQueue';
import { apiCall, type ApiResult } from '@/lib/api/browser';
import { support as supportApi } from '@/lib/api/resources';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import {
  toAgentOptions, toSupportTicket, toSupportTickets, toTicketCounts,
  type SupportTicketRow
} from '@/lib/sf/adapters';
import type { Dict } from '@/lib/sf/data';
import type { SupportAgent, TicketDetailResponse, TicketPage, TicketResponse } from '@/lib/api/types';

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

const PRIORITY_OPTIONS: [string, string][] = [
  ['', 'Any priority'], ['urgent', 'P1 · Urgent'], ['high', 'P2 · High'], ['normal', 'P3 · Normal'], ['low', 'P4 · Low'],
];

/** The assignee filter value that has no server parameter — see `narrowTickets`. */
const UNASSIGNED = 'unassigned';

/** Rows per request. The queue used to ask for 200 and page in the browser;
 *  `/tickets/page` takes `offset` and returns `total`, so the pager is real. */
const PAGE_SIZE = 25;

/** Status as a select, the way the design has it. The pill row above carries
 *  the same filter *with* its counts; both write `s.ticketFilter`. */
const STATUS_OPTIONS: [string, string][] = [
  ['all', 'All statuses'], ['open', 'Open'], ['pending', 'Pending'], ['escalated', 'Escalated'], ['resolved', 'Resolved'],
];

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

  /* Queue shaping the API has no parameter for. `sort` and `narrowing` reorder
     and narrow the page in hand; `priority` / `assignee` are query params, so
     they change what is fetched. */
  const [sort, setSort] = useState<QueueSort>('sla');
  const [narrowing, setNarrowing] = useState<QueueNarrowing>(NO_NARROWING);
  const [priorityFilter, setPriorityFilter] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState('');
  const [offset, setOffset] = useState(0);
  /* Bulk selection is by ticket id, and is dropped whenever the underlying
     rows change: a checkbox that survives into a different page of results
     would apply an action to a row nobody looked at. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Which row's action menu is open, by ticket id. */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  /* The thread is a drawer now, so it is shut until a row is opened. It is not
     open on mount: a dialog that traps focus the moment a screen loads takes
     the keyboard away from a reader who only wanted the queue. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /* Platform-side thread view: internal notes can be hidden to read the thread
     as the customer received it. */
  const [customerView, setCustomerView] = useState(false);

  const [fetchError, setFetchError] = useState<string | null>(null);
  useEffect(() => { setTkPage(page); }, [page]);
  useEffect(() => { setOpenDetail(detail); }, [detail]);

  const statusParam = s.ticketFilter === 'all' ? undefined : s.ticketFilter;
  const queryParam = s.ticketQuery.trim() || undefined;
  const priorityParam = priorityFilter || undefined;
  const assigneeParam = assigneeFilter && assigneeFilter !== UNASSIGNED ? assigneeFilter : undefined;

  const listParams = useMemo(() => ({
    status: statusParam, q: queryParam, priority: priorityParam,
    assignee_user_id: assigneeParam, scope, limit: PAGE_SIZE, offset,
  }), [statusParam, queryParam, priorityParam, assigneeParam, scope, offset]);

  /* A narrower filter can leave the current offset past the end of the result
     set, which reads as an empty queue. Any filter change goes back to page 1. */
  useEffect(() => {
    setOffset(0);
  }, [statusParam, queryParam, priorityParam, assigneeParam]);

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      void supportApi.ticketPage(apiCall, listParams).then(res => {
        if (cancelled) return;
        /* Same rule as Logs: a failed refetch keeps the last good page rather
           than rendering an outage as an empty queue. */
        if (res.ok) { setTkPage(res.data); setFetchError(null); }
        else setFetchError(res.error.message);
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [listParams]);

  const loadTicket = useCallback((id: string) => {
    void supportApi.ticket(apiCall, id).then(res => { if (res.ok) setOpenDetail(res.data); });
  }, []);

  const primaryBtn = btn(A, '#fff', A);
  const successBtn = btn('#059669', '#fff', '#059669');
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const dangerStyle = btn('#fff', '#b91c1c', '#fecaca');
  const textareaStyle: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'9px', padding:'8px 10px', fontSize:'.78125rem', resize:'vertical', outline:'none', width:'100%', color:'#0f172a' };
  /* Every control that writes goes through `mutate`, so they all dim together
     while one write is in flight rather than inviting a second. */
  const whileBusy = (style: CSSProperties): CSSProperties =>
    busy ? Object.assign({}, style, { opacity:.55, cursor:'progress' }) : style;

  /* Shape the raw rows before the adapter formats their timestamps —
     "28 Aug 11:45" cannot be sorted, `created_at` can. */
  const rawItems: TicketResponse[] = tkPage.items;
  const facets = queueFacets(rawItems);
  const shownItems = useMemo(
    () => sortTickets(narrowTickets(rawItems, assigneeFilter === UNASSIGNED ? { ...narrowing, unassigned: true } : narrowing), sort),
    [rawItems, narrowing, assigneeFilter, sort],
  );
  const tkList = toSupportTickets(shownItems);
  const tkCounts: Dict<number> = toTicketCounts(tkPage.counts);

  const filtersOn = Boolean(statusParam || queryParam || priorityFilter || assigneeFilter || narrowing.breached || narrowing.unassigned);
  const clearFilters = () => {
    set({ ticketFilter: 'all', ticketQuery: '' });
    setPriorityFilter(''); setAssigneeFilter(''); setNarrowing(NO_NARROWING);
  };

  const ticketFilters = TICKET_FILTERS.map(([id, label]) => {
    const on = s.ticketFilter === id;
    return {
      id, label, count: String(tkCounts[id] ?? 0), selected: (on ? 'true' : 'false') as 'true' | 'false',
      onClick: () => set({ ticketFilter: id }),
      style: { height:'26px', padding:'0 9px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem', fontWeight: on ? 600 : 500, display:'inline-flex', alignItems:'center', gap:'5px',
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties,
      badge: { fontSize:'.625rem', fontFamily:'var(--font-sans)', color: on ? '#64748b' : TEXT_MUTED } as CSSProperties
    };
  });

  /** A "needs attention" chip: a one-click narrowing of the page in hand. */
  const attentionChip = (on: boolean, tone: { bg: string; fg: string; bd: string }): CSSProperties =>
    ({ display:'inline-flex', alignItems:'center', gap:'5px', padding:'4px 9px', borderRadius:'99px', cursor:'pointer',
      fontSize:'.6875rem', fontWeight:600, fontFamily:'var(--font-sans)',
      background: on ? tone.fg : tone.bg, color: on ? '#fff' : tone.fg, border:'1px solid ' + (on ? tone.fg : tone.bd) });

  const attention = [
    { id:'breached', label:'Breached', count: facets.breached, on: narrowing.breached, tone: { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' },
      onClick: () => setNarrowing(n => ({ ...n, breached: !n.breached })) },
    { id:'unassigned', label:'Unassigned', count: facets.unassigned, on: narrowing.unassigned || assigneeFilter === UNASSIGNED,
      tone: { bg:'#fff7ed', fg:'#c2410c', bd:'#fed7aa' },
      onClick: () => setNarrowing(n => ({ ...n, unassigned: !n.unassigned })) },
    { id:'urgent', label:'P1 open', count: facets.urgent, on: priorityFilter === 'urgent', tone: { bg:'#eef2ff', fg:'#4338ca', bd:'#c7d2fe' },
      onClick: () => setPriorityFilter(p => (p === 'urgent' ? '' : 'urgent')) },
  ];

  /* The opened thread: whatever detail we hold, else the first listed row. */
  const detailRow: SupportTicketRow | null = openDetail ? toSupportTicket(openDetail) : null;
  const tk: SupportTicketRow | null =
    (detailRow && tkList.some(t => t.ticketId === detailRow.ticketId) ? detailRow : null) || detailRow || tkList[0] || null;

  /* One draft per ticket. Switching threads stashes what you were writing and
     restores what you had written here, so a reply is never lost to a click
     on another row. */
  const drafts = useRef<Dict<string>>({});
  const draftOwner = useRef<string>(tk ? tk.ticketId : '');
  const openTicketRow = useCallback((id: string) => {
    if (draftOwner.current && draftOwner.current !== id) drafts.current[draftOwner.current] = s.replyDraft;
    draftOwner.current = id;
    set({ openTicket: id, replyDraft: drafts.current[id] ?? '' });
    setDrawerOpen(true);
    loadTicket(id);
  }, [loadTicket, s.replyDraft, set]);

  const closeDrawer = useCallback(() => { setDrawerOpen(false); }, []);
  /* Deliberately NOT a modal dialog, and so deliberately not wired to
     `useModalBehaviour`: this panel is a preview of the row the reader is
     standing on, the way a mail client's is. Making it modal would make the
     queue behind it inert -- no ↑/↓ walking, no clicking the next ticket --
     which is the one thing this screen exists to do. Focus therefore stays on
     the row, and the panel is a labelled region rather than a dialog. Escape
     still shuts it. */
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDrawer(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  const rowRefs = useRef<Dict<HTMLButtonElement | null>>({});
  /** ↑/↓ (and j/k) walk the queue and open as they go, the way a mail client does. */
  const onQueueKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' || e.key === 'j' ? 1 : (e.key === 'ArrowUp' || e.key === 'k' ? -1 : 0);
    if (!step || tkList.length === 0) return;
    e.preventDefault();
    const at = tk ? tkList.findIndex(t => t.ticketId === tk.ticketId) : -1;
    const next = tkList[Math.min(tkList.length - 1, Math.max(0, (at < 0 ? 0 : at + step)))];
    if (!next) return;
    openTicketRow(next.ticketId);
    rowRefs.current[next.ticketId]?.focus();
  };

  const tickets = tkList.map((t, i) => {
    const on = tk ? tk.ticketId === t.ticketId : false;
    const overdue = t.slaBreached;
    return {
      id: t.ticketId,
      reference: t.id,
      subject: t.subject,
      requester: t.requester,
      requesterInitials: initials(t.requester || t.requesterEmail),
      assigneeLabel: t.assigneeName || 'Unassigned',
      unassigned: !t.assigneeName,
      updated: t.updated,
      breached: overdue,
      meta: t.id + ' · ' + (isPlat ? t.tenant + ' · ' : '') + t.requester + ' · ' + t.created,
      /* Second meta line: who owns it and when it last moved — the two things
         a queue is triaged on that the first line had no room for. */
      trail: (t.assigneeName || 'Unassigned') + ' · updated ' + t.updated.toLowerCase()
        + (t.messageCount ? ' · ' + t.messageCount + (t.messageCount === 1 ? ' message' : ' messages') : ''),
      statusLabel: TK_STATUS_LABEL[t.status] ?? t.status, priorityLabel: TK_PRIO_LABEL[t.priority] ?? t.priority, sla: t.sla,
      statusPill: pill(TK_STATUS_TONE[t.status] ?? TK_STATUS_TONE.open), priorityPill: pill(TK_PRIO_TONE[t.priority] ?? TK_PRIO_TONE.normal),
      slaPill: pill(t.status === 'resolved' ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : (overdue ? { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' } : { bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' })),
      priorityBar: { width:'3px', alignSelf:'stretch', borderRadius:'99px', background: (TK_PRIO_TONE[t.priority] ?? TK_PRIO_TONE.normal).c, flex:'0 0 3px' } as CSSProperties,
      current: (on ? 'true' : undefined) as 'true' | undefined,
      onOpen: () => openTicketRow(t.ticketId),
      rowStyle: { display:'flex', gap:'10px', alignItems:'stretch', width:'100%', padding:'11px 13px', borderTop: i ? '1px solid #f2f4f8' : 'none',
        background: on ? '#f8faff' : 'transparent', border:'none', borderLeft:'3px solid ' + (on ? A : 'transparent'), cursor:'pointer' } as CSSProperties
    };
  });

  /* ── selection, export and paging ───────────────────────────────────── */

  const shownIds = tkList.map(t => t.ticketId);
  /* Selection is intersected with what is actually on screen, so narrowing the
     queue can never leave a hidden row selected. */
  const selected = selectedIds.filter(id => shownIds.includes(id));
  const allSelected = selected.length > 0 && selected.length === shownIds.length;
  const toggleRow = (id: string) =>
    setSelectedIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : ids.concat([id])));
  const toggleAll = () => setSelectedIds(allSelected ? [] : shownIds);
  useEffect(() => { setSelectedIds([]); setMenuFor(null); }, [offset, listParams]);

  /** Resolve every selected ticket. One PATCH each -- there is no bulk
   *  endpoint -- and the page is refetched once at the end, not per row. */
  const bulkResolve = () => {
    if (busy || selected.length === 0) return;
    setBusy(true);
    const ids = selected.slice();
    void Promise.all(ids.map(id => supportApi.update(apiCall, id, { status: 'resolved' }))).then(results => {
      setBusy(false);
      const failed = results.filter(r => !r.ok).length;
      flash(failed
        ? (ids.length - failed) + ' of ' + ids.length + ' resolved · ' + failed + ' could not be changed'
        : ids.length + (ids.length === 1 ? ' ticket resolved' : ' tickets resolved'));
      setSelectedIds([]);
      void supportApi.ticketPage(apiCall, listParams).then(next => { if (next.ok) setTkPage(next.data); });
      if (tk && ids.includes(tk.ticketId)) loadTicket(tk.ticketId);
      router.refresh();
    });
  };

  /* Export is the rows in hand, not a server report: what you filtered to is
     what lands in the file. `text/csv` with a `download` name, so no endpoint
     and no round trip. */
  const exportCsv = () => {
    if (tkList.length === 0) { flash('Nothing to export'); return; }
    const head = ['Reference', 'Subject', 'Requester', 'Status', 'Priority', 'Assignee', 'Updated', 'SLA'];
    const cell = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    const csv = [head.map(cell).join(',')].concat(tkList.map(t => [
      t.id, t.subject, t.requesterEmail || t.requester,
      TK_STATUS_LABEL[t.status] ?? t.status, TK_PRIO_LABEL[t.priority] ?? t.priority,
      t.assigneeName || 'Unassigned', t.updated, t.sla,
    ].map(cell).join(','))).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'support-tickets.csv';
    a.click();
    URL.revokeObjectURL(url);
    flash(tkList.length + (tkList.length === 1 ? ' ticket exported' : ' tickets exported'));
  };

  const firstShown = tkPage.total === 0 ? 0 : offset + 1;
  const lastShown = offset + tickets.length;
  const pageCount = Math.max(1, Math.ceil(tkPage.total / PAGE_SIZE));
  const pageIndex = Math.floor(offset / PAGE_SIZE);
  /* A window of at most five page buttons around the current one: a queue of
     4,000 tickets must not render 160 buttons. */
  const pageWindow = Array.from({ length: pageCount }, (_, i) => i)
    .filter(i => Math.abs(i - pageIndex) <= 2 || i === 0 || i === pageCount - 1);

  const internalCount = tk ? tk.messages.filter(m => m.internal).length : 0;
  const tkVisibleMsgs = tk ? tk.messages.filter(m => (isPlat && !customerView) || !m.internal) : [];
  const tkMessages = tkVisibleMsgs.map(m => ({
    author: m.author, role: m.role, ts: m.ts, body: m.body, internal: m.internal, initials: initials(m.author),
    wrapStyle: { display:'flex', flexDirection:'column', gap:'7px', padding:'12px 13px', borderRadius:'12px',
      border:'1px solid ' + (m.internal ? '#fde68a' : '#eef1f6'),
      background: m.internal ? '#fffbeb' : (m.side === 'agent' ? '#f8faff' : '#fbfcfd') } as CSSProperties,
    chip: { width:'26px', height:'26px', borderRadius:'99px', display:'grid', placeItems:'center', fontSize:'.625rem', fontWeight:700, flex:'0 0 26px',
      background: m.side === 'agent' ? A : '#0f172a', color:'#fff' } as CSSProperties,
    internalPill: Object.assign(pill({ bg:'#fef3c7', fg:'#92400e', bd:'#fde68a' }), { marginLeft:'auto' }) as CSSProperties
  }));

  /* A long thread opens on its newest message, not its oldest. */
  const threadRef = useRef<HTMLDivElement | null>(null);
  const threadKey = (tk ? tk.ticketId : '') + ':' + tkVisibleMsgs.length;
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [threadKey]);

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
      void supportApi.ticketPage(apiCall, listParams)
        .then(next => { if (next.ok) setTkPage(next.data); });
      router.refresh();
    });
  };

  const ticketStats = stats.map(x => ({
    label: x.label, value: x.value, meta: x.meta, good: x.good,
    metaStyle: { fontSize:'.65625rem', fontFamily:'var(--font-sans)', color: x.good ? '#047857' : '#c2410c' } as CSSProperties
  }));

  const openNewTicket = () => set({ modal: 'ticket' });

  const slaBoxStyle: CSSProperties = { height:'32px', display:'flex', alignItems:'center', padding:'0 10px', borderRadius:'9px', fontSize:'.75rem', fontFamily:'var(--font-sans)',
    border:'1px solid ' + (tk && tk.status === 'resolved' ? '#a7f3d0' : '#fed7aa'), background: tk && tk.status === 'resolved' ? '#ecfdf5' : '#fff7ed',
    color: tk && tk.status === 'resolved' ? '#047857' : '#c2410c' };

  const tkTags = tk ? tk.tags.concat([tk.category]).map(label => ({
    label,
    style: { padding:'4px 9px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'.65625rem', color:'#475569', fontFamily:'var(--font-sans)' } as CSSProperties
  })) : [];
  const tkEnvelopeStyle: CSSProperties = { padding:'4px 9px', borderRadius:'99px', border:'1px solid #c7d2fe', background:'#eef2ff', fontSize:'.65625rem', color:'#3730a3', fontFamily:'var(--font-sans)', cursor:'pointer' };

  const internalRow: CSSProperties = { display:'inline-flex', alignItems:'center', gap:'9px', height:'30px', padding:'0 11px', borderRadius:'9px', cursor:'pointer',
    border:'1px solid ' + (s.replyInternal ? '#fde68a' : '#e3e7ee'), background: s.replyInternal ? '#fffbeb' : '#fff' };
  const internalSwitch: CSSProperties = { width:'32px', height:'18px', borderRadius:'99px', background: s.replyInternal ? '#f59e0b' : BORDER_STRONG, position:'relative', flex:'0 0 32px' };
  const internalKnob: CSSProperties = { position:'absolute', top:'2px', left: s.replyInternal ? '16px' : '2px', width:'14px', height:'14px', borderRadius:'99px', background:'#fff', transition:'left .15s' };

  const macros = quickReplies.map(([label, body]) => ({
    label,
    onClick: () => set({ replyDraft: body }),
    style: { padding:'5px 10px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'.6875rem', color:'#475569', cursor:'pointer' } as CSSProperties
  }));

  /* Internal notes are platform-only and the API enforces it (403); the switch
     is never offered to a tenant caller, so `internal` can only be true here. */
  const replyInternal = isPlat && s.replyInternal;
  const sendReplyLabel = replyInternal ? 'Add internal note' : 'Send reply';
  const sendReply = () => {
    const body = s.replyDraft.trim();
    if (!body) { flash('Write a message first'); return; }
    if (!tk) { flash('Open a ticket first'); return; }
    if (busy) return;
    const ticketId = tk.ticketId;
    const toWhom = replyInternal
      ? 'Internal note added — not visible to the customer'
      : 'Reply sent to ' + (isPlat ? tk.requesterEmail : 'SignerPro support');
    flash(toWhom);
    delete drafts.current[ticketId];
    set({ replyDraft: '' });
    mutate(() => supportApi.reply(apiCall, ticketId, { body, internal: replyInternal }), 'Could not send the reply');
  };
  /* ⌘/Ctrl+Enter sends, the shortcut every other reply box in the industry has;
     plain Enter still writes a newline. */
  const onReplyKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendReply(); }
  };

  const agentOptions = toAgentOptions(agents, tk);
  /** The queue-side assignee filter carries each agent's load, so triage can
   *  see who is already buried before handing them another ticket. */
  const agentFilterOptions = [{ id:'', name:'Any assignee' }, { id: UNASSIGNED, name:'Unassigned' }].concat(
    agents.map(a => ({ id: a.id, name: a.name + ' · ' + a.open_ticket_count + ' open' })));

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

  const copyReference = () => {
    if (!tk) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard) { flash('Could not reach the clipboard — select the reference and copy it by hand'); return; }
    void navigator.clipboard.writeText(tk.id).then(
      () => flash(tk.id + ' copied'),
      () => flash('Could not reach the clipboard — select the reference and copy it by hand'),
    );
  };

  const emptyNoteStyle: CSSProperties = { margin:'15px 17px', border:'1px dashed #8492a6', borderRadius:'12px', padding:'22px', textAlign:'center', fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6 };
  const cardStyle: CSSProperties = { background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px' };
  const thStyle: CSSProperties = { padding:'11px 14px', fontSize:'.625rem', fontWeight:600, letterSpacing:'.06em', textTransform:'uppercase',
    color:'#64748b', fontFamily:'var(--font-sans)', textAlign:'left', whiteSpace:'nowrap' };
  const tdStyle: CSSProperties = { padding:'12px 14px', verticalAlign:'top' };
  const pagerBtn = (on: boolean, disabled = false): CSSProperties => ({
    minWidth:'30px', height:'28px', padding:'0 9px', borderRadius:'8px', cursor: disabled ? 'default' : 'pointer',
    fontSize:'.71875rem', fontWeight: on ? 600 : 500, fontFamily:'var(--font-sans)',
    border:'1px solid ' + (on ? '#c7d2fe' : '#e3e7ee'), background: on ? '#eef2ff' : '#fff',
    color: on ? A : '#475569', opacity: disabled ? .45 : 1, display:'inline-flex', alignItems:'center', justifyContent:'center', gap:'4px' });
  const iconChip = (good: boolean): CSSProperties => ({ width:'38px', height:'38px', borderRadius:'11px', display:'grid', placeItems:'center', flex:'0 0 38px',
    background: good ? '#eef2ff' : '#fff7ed', color: good ? A : '#c2410c' });
  const avatarChip: CSSProperties = { width:'24px', height:'24px', borderRadius:'99px', display:'grid', placeItems:'center', flex:'0 0 24px',
    background:'#f1f5f9', color:'#475569', fontSize:'.5625rem', fontWeight:700, fontFamily:'var(--font-sans)' };
  const kebabStyle: CSSProperties = { border:'1px solid transparent', background:'none', borderRadius:'7px', padding:'3px', cursor:'pointer', color:TEXT_MUTED, display:'inline-flex' };
  const menuStyle: CSSProperties = { position:'absolute', top:'100%', right:0, zIndex:5, minWidth:'168px', background:'#fff',
    border:'1px solid #e3e7ee', borderRadius:'11px', boxShadow:'0 8px 24px rgba(15,23,42,.14)', padding:'5px', display:'flex', flexDirection:'column' };
  const menuItem: CSSProperties = { border:'none', background:'none', textAlign:'left', padding:'7px 9px', borderRadius:'7px', fontSize:'.71875rem', color:'#334155', cursor:'pointer' };
  const searchWrapStyle: CSSProperties = { position:'relative', flex:'1 1 260px', minWidth:'200px', maxWidth:'380px' };
  const searchInputStyle: CSSProperties = { width:'100%', height:'34px', display:'block', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px 0 31px',
    fontSize:'.78125rem', outline:'none', background:'#fbfcfd', color:'#0f172a' };
  const searchIconStyle: CSSProperties = { position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', color:TEXT_MUTED, pointerEvents:'none' };
  const drawerStyle: CSSProperties = { position:'fixed', top:0, right:0, bottom:0, zIndex:56, width:'min(640px, 100vw)',
    background:'#fff', borderLeft:'1px solid #e3e7ee', boxShadow:'-24px 0 60px -30px rgba(15,23,42,.45)',
    display:'flex', flexDirection:'column', overflow:'hidden', animation:'sfSlideIn .18s ease' };
  const closeBtnStyle: CSSProperties = { border:'1px solid #e3e7ee', background:'#fff', borderRadius:'9px', width:'30px', height:'30px',
    display:'grid', placeItems:'center', cursor:'pointer', color:'#475569', flex:'0 0 30px' };

  /** The tone of each stat tile's icon badge follows the tile's own `good`. */
  const TILE_ICONS = [Inbox, Clock, CheckCircle2];
  /* `inputStyle` is width:100% -- it is built for a stacked `<label>`. On the
     filter row the selects sit side by side, so each one sizes to itself. */
  const selectStyle: CSSProperties = Object.assign({}, inputStyle, {
    height:'34px', fontSize:'.71875rem', background:'#fbfcfd', width:'auto', minWidth:'126px', flex:'0 1 auto', cursor:'pointer',
  });
  const linkBtn: CSSProperties = { border:'none', background:'none', padding:0, color:A, fontSize:'.65625rem', fontWeight:600, cursor:'pointer', fontFamily:'var(--font-sans)' };

  return (
    <section data-screen-label="Support" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>
      {fetchError ? (
        <ApiUnavailable what="The ticket queue" detail={fetchError} onRetry={() => setFetchError(null)} />
      ) : null}

      {/* Stat tiles. Three, not the four the design drew: the fourth ("solved
          today") has no field on either stats endpoint, and a tile is not the
          place to guess. */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(210px, 1fr))', gap:'12px' }}>
        {ticketStats.map((st, i) => {
          const Icon = TILE_ICONS[i] ?? Inbox;
          return (
            <div key={st.label} style={{ ...cardStyle, padding:'14px 15px', display:'flex', alignItems:'center', gap:'12px' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0, flex:1 }}>
                <span style={{ fontSize:'.625rem', letterSpacing:'.06em', color:'#64748b', fontFamily:'var(--font-sans)' }}>{st.label}</span>
                <span style={{ fontSize:'1.5rem', fontWeight:700, letterSpacing:'-.8px', lineHeight:1.1 }}>{st.value}</span>
                <span style={st.metaStyle}>{st.meta}</span>
              </div>
              <span style={iconChip(st.good)} aria-hidden="true"><Icon width={18} height={18} /></span>
            </div>
          );
        })}
      </div>

      {/* Filters. Search and the selects sit on one line as drawn; the status
          pills and attention chips stay because they carry counts a select
          cannot show. */}
      <div style={{ ...cardStyle, padding:'13px 15px', display:'flex', flexDirection:'column', gap:'11px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
          <div style={searchWrapStyle}>
            <Search width={15} height={15} style={searchIconStyle} aria-hidden="true" />
            <input type="search" value={s.ticketQuery} onChange={(e) => set({ ticketQuery: e.target.value })}
              placeholder="Search ticket ref, subject, or requester…" aria-label="Search tickets" style={searchInputStyle} />
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'7px', flexWrap:'wrap', flex:'1 1 auto', justifyContent:'flex-end' }}>
            <select aria-label="Filter by status" value={s.ticketFilter} onChange={(e) => set({ ticketFilter: e.target.value })} style={selectStyle}>
              {STATUS_OPTIONS.map(([value, label]) => (<option key={value} value={value}>{label}</option>))}
            </select>
            <select aria-label="Filter by priority" value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} style={selectStyle}>
              {PRIORITY_OPTIONS.map(([value, label]) => (<option key={value || 'any'} value={value}>{label}</option>))}
            </select>
            {isPlat ? (
              <select aria-label="Filter by assignee" value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} style={selectStyle}>
                {agentFilterOptions.map(a => (<option key={a.id || 'any'} value={a.id}>{a.name}</option>))}
              </select>
            ) : null}
            <select aria-label="Sort tickets" value={sort} onChange={(e) => setSort(e.target.value as QueueSort)} style={selectStyle}>
              {QUEUE_SORTS.map(([value, label]) => (<option key={value} value={value}>{label}</option>))}
            </select>
            <button type="button" onClick={exportCsv} title="Export CSV" aria-label="Export CSV"
              style={{ ...ghostBtn, padding:'0 9px', display:'inline-flex', alignItems:'center' }}>
              <Download width={15} height={15} aria-hidden="true" />
            </button>
            <button type="button" onClick={openNewTicket} style={primaryBtn}>New ticket</button>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
          <div role="group" aria-label="Status" style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px', flexWrap:'wrap' }}>
            {ticketFilters.map(f => (
              <button key={f.id} type="button" onClick={f.onClick} aria-pressed={f.selected} style={f.style}>{f.label} <span style={f.badge}>{f.count}</span></button>
            ))}
          </div>
          <div role="group" aria-label="Needs attention" style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
            {attention.map(c => (
              <button key={c.id} type="button" onClick={c.onClick} aria-pressed={c.on ? 'true' : 'false'} style={attentionChip(c.on, c.tone)}>
                {c.label} <span style={{ fontFamily:'var(--font-sans)', opacity:.85 }}>{c.count}</span>
              </button>
            ))}
          </div>
          {filtersOn ? (<button type="button" onClick={clearFilters} style={{ ...linkBtn, marginLeft:'auto' }}>Clear filters</button>) : null}
        </div>
      </div>

      {/* The queue. Rows stay buttons inside the first cell, so a click, Enter
          and ↑/↓ all behave exactly as they did before this became a table. */}
      <div style={{ ...cardStyle, overflow:'visible' }}>
        {selected.length ? (
          <div style={{ padding:'9px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', gap:'10px', background:'#f8faff', borderRadius:'16px 16px 0 0' }}>
            <span style={{ fontSize:'.71875rem', color:'#334155', fontFamily:'var(--font-sans)' }}>
              {selected.length + (selected.length === 1 ? ' ticket selected' : ' tickets selected')}
            </span>
            <div style={{ marginLeft:'auto', display:'flex', gap:'7px' }}>
              <button type="button" onClick={() => setSelectedIds([])} style={ghostBtn}>Clear</button>
              {/* "Resolve selected", not "Mark resolved": the thread below has
                  its own resolve button, and two identically-named buttons on
                  one screen act on different things. */}
              <button type="button" disabled={busy} onClick={bulkResolve} style={whileBusy(successBtn)}>Resolve selected</button>
            </div>
          </div>
        ) : null}
        <div style={{ overflowX:'auto' }}>
          <div role="group" aria-label="Ticket queue" onKeyDown={onQueueKeyDown}>
            <table style={{ width:'100%', minWidth:'880px', borderCollapse:'collapse', textAlign:'left' }}>
              <thead>
                <tr style={{ background:'#f8fafc', borderBottom:'1px solid #e3e7ee' }}>
                  <th scope="col" style={{ ...thStyle, width:'34px' }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select every ticket on this page"
                      disabled={tickets.length === 0} style={{ cursor: tickets.length ? 'pointer' : 'default' }} />
                  </th>
                  <th scope="col" style={thStyle}>Ticket details</th>
                  <th scope="col" style={thStyle}>Requester</th>
                  <th scope="col" style={thStyle}>Status</th>
                  <th scope="col" style={thStyle}>Priority</th>
                  <th scope="col" style={thStyle}>Assignee</th>
                  <th scope="col" style={thStyle}>Last update</th>
                  <th scope="col" style={{ ...thStyle, textAlign:'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t, i) => (
                  <tr key={t.id} style={{ borderTop: i ? '1px solid #f2f4f8' : 'none', background: t.current ? '#f8faff' : 'transparent' }}>
                    <td style={tdStyle}>
                      <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggleRow(t.id)}
                        aria-label={'Select ' + t.reference} style={{ cursor:'pointer' }} />
                    </td>
                    <td style={{ ...tdStyle, maxWidth:'380px' }}>
                      {/* `data-ticket-row` marks the one button per row that
                          opens the thread -- the row also carries a checkbox
                          and an actions menu, so "the row" needs a hook that
                          does not depend on button order. */}
                      <button type="button" data-ticket-row="" onClick={t.onOpen} aria-current={t.current} ref={(el) => { rowRefs.current[t.id] = el; }}
                        style={{ border:'none', background:'none', padding:0, textAlign:'left', cursor:'pointer', display:'flex', flexDirection:'column', gap:'4px', width:'100%' }}>
                        <span style={{ display:'flex', alignItems:'center', gap:'7px', flexWrap:'wrap' }}>
                          <span style={{ fontSize:'.75rem', fontWeight:700, color: t.current ? A : '#0f172a', fontFamily:'var(--font-sans)' }}>{t.reference}</span>
                          {t.breached ? (
                            <span style={{ ...pill({ bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }), display:'inline-flex', alignItems:'center', gap:'4px' }}>
                              <AlertTriangle width={10} height={10} aria-hidden="true" /> SLA breached
                            </span>
                          ) : null}
                        </span>
                        <span style={{ fontSize:'.78125rem', fontWeight:600, color:'#334155', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'350px' }}>{t.subject}</span>
                        <span style={{ fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>{t.trail}</span>
                      </button>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={avatarChip} aria-hidden="true">{t.requesterInitials}</span>
                        <span style={{ fontSize:'.75rem', color:'#475569', whiteSpace:'nowrap' }}>{t.requester}</span>
                      </span>
                    </td>
                    <td style={tdStyle}><span style={t.statusPill}>{t.statusLabel}</span></td>
                    <td style={tdStyle}><span style={t.priorityPill}>{t.priorityLabel}</span></td>
                    <td style={tdStyle}>
                      <span style={{ fontSize:'.75rem', color: t.unassigned ? '#c2410c' : '#475569', whiteSpace:'nowrap' }}>{t.assigneeLabel}</span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                        <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', whiteSpace:'nowrap' }}>{t.updated}</span>
                        <span style={t.slaPill}>{t.sla}</span>
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign:'right' }}>
                      <span style={{ position:'relative', display:'inline-block' }}>
                        <button type="button" aria-label={'Actions for ' + t.reference} aria-expanded={menuFor === t.id}
                          onClick={() => setMenuFor(id => (id === t.id ? null : t.id))} style={kebabStyle}>
                          <MoreVertical width={15} height={15} aria-hidden="true" />
                        </button>
                        {menuFor === t.id ? (
                          <span style={menuStyle} role="menu">
                            <button type="button" role="menuitem" style={menuItem} onClick={() => { setMenuFor(null); t.onOpen(); }}>Open thread</button>
                            <button type="button" role="menuitem" style={menuItem} disabled={busy}
                              onClick={() => { setMenuFor(null); setSelectedIds([t.id]); }}>Select</button>
                          </span>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* One empty state, not two: this note used to sit beside the
                detail pane's own "nothing here yet", which read as two
                different answers to the same question. */}
            {tickets.length === 0 ? (
              <div style={emptyNoteStyle}>
                {filtersOn
                  ? 'No tickets match these filters. Clear them to see the whole queue.'
                  : (isPlat ? 'No tickets in the queue yet.' : 'You have no support tickets yet. Raise one with “New ticket”.')}
              </div>
            ) : null}
          </div>
        </div>

        {/* Pagination is server-side: `offset` on `/tickets/page`, against the
            `total` it returns. */}
        <div style={{ padding:'11px 15px', borderTop:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
          <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>
            {'Showing ' + firstShown + '–' + lastShown + ' of ' + tkPage.total + (isPlat ? ' · ↑↓ to walk the queue' : '')}
          </span>
          <span style={{ display:'flex', alignItems:'center', gap:'5px' }}>
            <button type="button" onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))} disabled={pageIndex === 0}
              style={pagerBtn(false, pageIndex === 0)}><ChevronLeft width={13} height={13} aria-hidden="true" /> Previous</button>
            {pageWindow.map((i, at) => (
              <span key={i} style={{ display:'inline-flex', alignItems:'center', gap:'5px' }}>
                {at > 0 && i - pageWindow[at - 1] > 1 ? (<span style={{ fontSize:'.6875rem', color:TEXT_MUTED }}>…</span>) : null}
                <button type="button" onClick={() => setOffset(i * PAGE_SIZE)} aria-current={i === pageIndex ? 'page' : undefined}
                  aria-label={'Page ' + (i + 1)} style={pagerBtn(i === pageIndex)}>{i + 1}</button>
              </span>
            ))}
            <button type="button" onClick={() => setOffset(o => o + PAGE_SIZE)} disabled={pageIndex >= pageCount - 1}
              style={pagerBtn(false, pageIndex >= pageCount - 1)}>Next <ChevronRight width={13} height={13} aria-hidden="true" /></button>
          </span>
        </div>
      </div>

      {/* The thread, as a right-hand drawer over the queue: the table needs the
          full width, and a reader working the queue wants the row they clicked
          in front of them, not below the fold. */}
      {drawerOpen && tk ? (
        <>
          <div role="region" aria-label={'Ticket ' + tk.id + ' · ' + tk.subject} style={drawerStyle}>
        <div style={{ padding:'15px 17px', borderBottom:'1px solid #eef1f6', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
              <span style={{ fontSize:'.9375rem', fontWeight:700, letterSpacing:'-.2px' }}>{tk.subject}</span>
              <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>
                {tk.id + ' · ' + tk.tenant + ' · ' + tk.requesterEmail + ' · opened ' + tk.created + ' · updated ' + tk.updated.toLowerCase()}
              </span>
            </div>
            <div style={{ display:'flex', gap:'6px', flex:'0 0 auto', alignItems:'center' }}>
              {busy ? (<span aria-live="polite" style={{ fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>Saving…</span>) : null}
              <button type="button" onClick={copyReference} style={ghostBtn}>Copy ref</button>
              {tk.status !== 'resolved' ? (
                <button type="button" disabled={busy} onClick={() => { flash(tk.id + ' resolved · CSAT survey sent to ' + tk.requesterEmail); mutate(() => supportApi.update(apiCall, tk.ticketId, { status: 'resolved' }), 'Could not resolve the ticket'); }} style={whileBusy(successBtn)}>Mark resolved</button>
              ) : null}
              {tk.status === 'resolved' ? (
                <button type="button" disabled={busy} onClick={() => { flash(tk.id + ' reopened'); mutate(() => supportApi.update(apiCall, tk.ticketId, { status: 'open' }), 'Could not reopen the ticket'); }} style={whileBusy(ghostBtn)}>Reopen</button>
              ) : null}
              <button type="button" onClick={closeDrawer} aria-label="Close ticket" style={closeBtnStyle}>
                <X width={15} height={15} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:'9px' }}>
            <label style={lbl}>Status
              <select value={tk.status} disabled={busy} onChange={(e) => onStatusChange(e.target.value)} style={inputStyle}>
                <option value="open">Open</option>
                <option value="pending">Pending customer</option>
                <option value="escalated">Escalated</option>
                <option value="resolved">Resolved</option>
              </select>
            </label>
            <label style={lbl}>Priority
              <select value={tk.priority} disabled={busy} onChange={(e) => onPriorityChange(e.target.value)} style={inputStyle}>
                <option value="urgent">P1 · Urgent</option>
                <option value="high">P2 · High</option>
                <option value="normal">P3 · Normal</option>
                <option value="low">P4 · Low</option>
              </select>
            </label>
            <label style={lbl}>Assignee
              <select value={tk.assignee} onChange={(e) => onAssigneeChange(e.target.value)} style={inputStyle} disabled={isPlat ? busy : true}>
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
              <button type="button" onClick={() => go('audit', { workspace: 'tenant', documentId: tk.documentId })} style={tkEnvelopeStyle}>{'Envelope ' + tk.envelope + ' ›'}</button>
            ) : null}
          </div>
        </div>

        <div style={{ padding:'9px 17px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'9px' }}>
          <span style={{ fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>
            {tkVisibleMsgs.length + (tkVisibleMsgs.length === 1 ? ' message' : ' messages')
              + (isPlat && internalCount ? ' · ' + internalCount + ' internal' : '')}
          </span>
          {isPlat && internalCount ? (
            <button type="button" aria-pressed={customerView ? 'true' : 'false'} onClick={() => setCustomerView(v => !v)} style={linkBtn}>
              {customerView ? 'Show internal notes' : 'View as the customer'}
            </button>
          ) : null}
        </div>

        <div ref={threadRef} data-sf-scroll="1" style={{ flex:1, minHeight:0, overflow:'auto', padding:'15px 17px', display:'flex', flexDirection:'column', gap:'12px' }}>
          {tkMessages.map((m, i) => (
            <div key={i} style={m.wrapStyle}>
              <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
                <span style={m.chip}>{m.initials}</span>
                <div style={{ display:'flex', flexDirection:'column', gap:'1px', minWidth:0 }}>
                  <span style={{ fontSize:'.75rem', fontWeight:600, color:'#0f172a' }}>{m.author}</span>
                  <span style={{ fontSize:'.65625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>{m.role} · {m.ts}</span>
                </div>
                {m.internal ? (<span style={m.internalPill}>Internal note</span>) : null}
              </div>
              <div style={{ fontSize:'.78125rem', color:'#334155', lineHeight:1.65, whiteSpace:'pre-wrap' }}>{m.body}</div>
            </div>
          ))}
          {tkMessages.length === 0 ? (
            <div style={{ fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6 }}>
              {customerView ? 'Every message on this ticket is an internal note — the customer has not been written to yet.' : 'No messages on this ticket yet.'}
            </div>
          ) : null}
        </div>

        <div style={{ borderTop:'1px solid #eef1f6', padding:'13px 17px', display:'flex', flexDirection:'column', gap:'10px' }}>
          <textarea rows={3} value={s.replyDraft} onChange={(e) => set({ replyDraft: e.target.value })} onKeyDown={onReplyKeyDown}
            placeholder={isPlat ? 'Reply to the customer, or switch to an internal note…' : 'Add details, logs or a screenshot description…'}
            aria-label="Reply" style={textareaStyle} />
          <div style={{ display:'flex', alignItems:'center', gap:'9px', flexWrap:'wrap' }}>
            {isPlat ? (
              <button type="button" role="switch" aria-checked={s.replyInternal ? 'true' : 'false'} onClick={() => set(st => ({ replyInternal: !st.replyInternal }))} style={internalRow}>
                <span style={{ fontSize:'.75rem', color:'#334155' }}>Internal note</span>
                <span style={internalSwitch}><span style={internalKnob}></span></span>
              </button>
            ) : null}
            {macros.map(m => (<button key={m.label} type="button" onClick={m.onClick} style={m.style}>{m.label}</button>))}
            <div style={{ marginLeft:'auto', display:'flex', gap:'8px', alignItems:'center' }}>
              <span style={{ fontSize:'.625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>⌘↵ to send</span>
              {tk.status !== 'escalated' && tk.status !== 'resolved' ? (
                <button type="button" disabled={busy} onClick={() => { flash(tk.id + ' escalated to on-call engineering · P1'); mutate(() => supportApi.escalate(apiCall, tk.ticketId), 'Could not escalate the ticket'); }} style={whileBusy(dangerStyle)}>Escalate</button>
              ) : null}
              <button type="button" disabled={busy} onClick={sendReply} style={whileBusy(primaryBtn)}>{sendReplyLabel}</button>
            </div>
          </div>
        </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
