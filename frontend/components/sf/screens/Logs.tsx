'use client';

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { useSF } from '@/lib/sf/state';
import { LEVEL_TONE } from '@/lib/sf/data';
import { apiCall } from '@/lib/api/browser';
import { logs as logsApi } from '@/lib/api/resources';
import { toLogLevelFilters, toLogRow, toLogRows, toLogSourceFilters } from '@/lib/sf/adapters';
import type { SystemLogPage } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import { TEXT_MUTED_ON_DARK } from '@/lib/sf/ui';

export type LogsProps = {
  /** `GET /api/logs` (tenant) or `GET /api/saas/logs` (platform). */
  page: SystemLogPage;
  /** Which of the two the client re-queries when a filter changes. */
  scope: 'tenant' | 'platform';
  /** The retention window the page requested, echoed back as `since_days`. */
  sinceDays: number;
  /** The tenant slug the footer prints (`scope: acme`). */
  orgSlug: string;
  /**
   * `ApiError.message` when the server render's own `GET /logs` failed, so the
   * `page` above is a substituted empty page rather than an empty workspace.
   */
  loadError?: string | null;
};

export default function Logs({ page, scope, sinceDays, orgSlug, loadError = null }: LogsProps) {
  const { s, set, isPlat: isPlatFn } = useSF();
  const isPlat = isPlatFn();

  /* Filtering belongs to the API (`source` / `level` / `q` / `since_days`), so a
     filter change re-queries instead of narrowing a client array. */
  const [logPage, setLogPage] = useState<SystemLogPage>(page);
  /* Non-null while the most recent query failed. The last good page stays on
     screen underneath it: a failed refetch must never be rendered as a
     workspace with zero events. */
  const [fetchError, setFetchError] = useState<string | null>(loadError);
  const [reloadNonce, setReloadNonce] = useState(0);

  /* An empty `page` is ambiguous — an empty log window and a server render that
     could not reach the API produce the same prop. When it is empty we verify
     once from the client so the ambiguity is resolved into either real rows or
     an explicit outage. A page that already has rows skips the extra call. */
  const firstLoad = useRef(page.items.length > 0 && !loadError);

  useEffect(() => { setLogPage(page); setFetchError(loadError); }, [page, loadError]);

  const sourceParam = s.logSource === 'all' ? undefined : s.logSource;
  const levelParam = s.logLevel === 'all' ? undefined : s.logLevel;
  const queryParam = s.logQuery.trim() || undefined;

  useEffect(() => {
    if (firstLoad.current) { firstLoad.current = false; return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = { source: sourceParam, level: levelParam, q: queryParam, since_days: sinceDays, limit: 200 };
      const call = scope === 'platform' ? logsApi.platform(apiCall, params) : logsApi.tenant(apiCall, params);
      void call.then(res => {
        if (cancelled) return;
        /* Keep the last good page on a failure — replacing it with an empty
           page renders an outage as "no events matched", which is a different
           and much more reassuring claim than the one that is true. */
        if (res.ok) { setLogPage(res.data); setFetchError(null); }
        else setFetchError(res.error.message);
      });
    }, 220);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [sourceParam, levelParam, queryParam, scope, sinceDays, reloadNonce]);

  const retry = () => { firstLoad.current = false; setReloadNonce(n => n + 1); };

  /* The row already carries its payload; the platform detail endpoint is the
     authoritative copy, so expanding a row on the platform side fetches it. */
  const [detailPayloads, setDetailPayloads] = useState<Record<string, string>>({});
  const expandLog = (id: string) => {
    if (scope !== 'platform' || detailPayloads[id] !== undefined) return;
    void logsApi.platformDetail(apiCall, id).then(res => {
      if (!res.ok) return;
      setDetailPayloads(prev => ({ ...prev, [id]: toLogRow(res.data).payload }));
    });
  };

  const logRows = toLogRows(logPage.items);

  const chipStyle = (on: boolean): CSSProperties => ({
    height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.75rem', fontWeight: on ? 600 : 500,
    background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none'
  });

  /* The filter groups come from the API's own `sources` / `levels` lists — the
     tenant endpoint already omits the platform-only sources. */
  const logSources = toLogSourceFilters(logPage.sources)
    .map(([id, label]) => {
      const on = s.logSource === id;
      return { id, label, selected: (on ? 'true' : 'false') as 'true' | 'false', onClick: () => set({ logSource: id }), style: chipStyle(on) };
    });

  const logLevels = toLogLevelFilters(logPage.levels).map(([id, label]) => {
    const on = s.logLevel === id;
    return { id, label, selected: (on ? 'true' : 'false') as 'true' | 'false', onClick: () => set({ logLevel: id }), style: chipStyle(on) };
  });

  const logs = logRows.map((l, i) => {
    const open = s.openLog === l.id;
    const tone = LEVEL_TONE[l.level] ?? LEVEL_TONE.info;
    return {
      key: l.id,
      ts: l.ts, level: l.level.toUpperCase(), source: l.source, msg: l.msg, code: l.code, latency: l.latency,
      payload: detailPayloads[l.id] ?? l.payload,
      open, openStr: (open ? 'true' : 'false') as 'true' | 'false',
      onToggle: () => { if (!open) expandLog(l.id); set({ openLog: open ? null : l.id }); },
      wrapStyle: { borderTop: i ? '1px solid #1a2740' : 'none', background: open ? '#0b1424' : 'transparent' } as CSSProperties,
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', width:'100%', padding:'9px 15px', background:'transparent', border:'none', cursor:'pointer' } as CSSProperties,
      levelStyle: { padding:'2px 7px', borderRadius:'6px', background: tone.bg, color: tone.fg, fontSize:'.59375rem', fontWeight:700, fontFamily:'var(--font-sans)', flex:'0 0 auto' } as CSSProperties,
      srcStyle: { fontSize:'.65625rem', color:TEXT_MUTED_ON_DARK, fontFamily:'var(--font-sans)', width:'62px', flex:'0 0 62px', textAlign:'left' } as CSSProperties,
      codeStyle: { fontSize:'.65625rem', fontFamily:'var(--font-sans)', flex:'0 0 auto', width:'34px', textAlign:'right',
        color: l.code === '429' || l.code === '402' || l.code === '422' || l.code === '502' ? '#fda4af' : '#64748b' } as CSSProperties
    };
  });

  const logCountLabel = logs.length + ' of ' + logPage.total + ' events';
  const logScopeLabel = isPlat ? 'scope: all tenants' : 'scope: ' + orgSlug;

  return (
    <section data-screen-label="Logs" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'14px' }}>
      {fetchError ? (
        <ApiUnavailable what="The log stream" detail={fetchError} onRetry={retry} />
      ) : null}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
        <div style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'10px' }}>
          {logSources.map(l => (
            <button key={l.id} type="button" onClick={l.onClick} aria-pressed={l.selected} style={l.style}>{l.label}</button>
          ))}
        </div>
        <div style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'10px' }}>
          {logLevels.map(l => (
            <button key={l.id} type="button" onClick={l.onClick} aria-pressed={l.selected} style={l.style}>{l.label}</button>
          ))}
        </div>
        <input type="search" value={s.logQuery} onChange={(e) => set({ logQuery: e.target.value })} placeholder="Search message, request id, actor…" aria-label="Search logs"
          style={{ height:'32px', flex:1, minWidth:'200px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'.78125rem', outline:'none', background:'#fff' }} />
        <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', flex:'0 0 auto' }}>{logCountLabel}</span>
      </div>

      <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:'16px', overflow:'hidden' }}>
        {logs.map(l => (
          <div key={l.key} style={l.wrapStyle}>
            <button type="button" onClick={l.onToggle} aria-expanded={l.openStr} style={l.rowStyle}>
              <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', flex:'0 0 auto' }}>{l.ts}</span>
              <span style={l.levelStyle}>{l.level}</span>
              <span style={l.srcStyle}>{l.source}</span>
              <span style={{ fontSize:'.75rem', color:'#e2e8f0', fontFamily:'var(--font-sans)', flex:1, minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', textAlign:'left' }}>{l.msg}</span>
              <span style={l.codeStyle}>{l.code}</span>
              <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', flex:'0 0 auto', width:'56px', textAlign:'right' }}>{l.latency}</span>
            </button>
            {l.open ? (
              <pre style={{ margin:0, padding:'12px 16px 16px 16px', fontFamily:'var(--font-sans)', fontSize:'.6875rem', color:'#a5b4fc', background:'#0b1424', whiteSpace:'pre-wrap', wordBreak:'break-all', lineHeight:1.65 }}>{l.payload}</pre>
            ) : null}
          </div>
        ))}
        {logs.length === 0 ? (
          <div style={{ padding:'26px 15px', textAlign:'center', fontSize:'.75rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>No events in this window.</div>
        ) : null}
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>
        <span>retention 90 days · streamed to S3 + Datadog</span>
        <span>{logScopeLabel}</span>
      </div>
    </section>
  );
}
