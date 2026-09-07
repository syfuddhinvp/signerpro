'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { ROLE_LABEL, FLAG_ENV_TONE } from '@/lib/sf/data';
import { SECTION_PARAM, sectionFor } from '@/lib/sf/routes';
import { btn, pill, inputStyle, railHead, selectStyle, TEXT_MUTED, BORDER_STRONG, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import {
  directory as directoryApi,
  flags as flagsApi,
  tenants as tenantsApi,
} from '@/lib/api/resources';
import type {
  AuditStreamRow,
  DirectoryRow,
  FlagRow,
  PermissionMatrixView,
  PlatformPlanCard,
  PlatformStatTile,
  SecurityRow,
  TenantTableRow,
} from '@/lib/sf/adapters';
import { formatCents, formatRelative, tenantStatusLabel } from '@/lib/sf/adapters';
import type { ImpersonationSessionResponse, TenantDetail } from '@/lib/api/types';

const th: CSSProperties = { padding:'10px 14px', fontSize:'.6875rem', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, fontFamily:'var(--font-sans)' };
const thRight: CSSProperties = { padding:'10px 14px', fontSize:'.6875rem', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, textAlign:'right', fontFamily:'var(--font-sans)' };
const td: CSSProperties = { padding:'11px 14px', verticalAlign:'middle' };
const tdRight: CSSProperties = { padding:'11px 14px', textAlign:'right', verticalAlign:'middle' };

const superBannerStyle: CSSProperties = { background:'#0f172a', borderRadius:'14px', padding:'13px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'14px' };
const superChip: CSSProperties = { padding:'4px 9px', borderRadius:'7px', background:'#f59e0b', color:'#3b1d00', fontSize:'.65625rem', fontWeight:700, fontFamily:'var(--font-sans)', letterSpacing:'.06em', whiteSpace:'nowrap', flex:'0 0 auto' };
const ghostBtn: CSSProperties = btn('#fff', '#475569', '#e3e7ee');

const emptyCell: CSSProperties = { padding:'22px 14px', fontSize:'.78125rem', color:'#64748b' };
const emptyNote: CSSProperties = { fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.6 };

/** `expires_at` is in the future, which `formatRelative` does not express. */
function expiresIn(iso: string): string {
  const minutes = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (Number.isNaN(minutes)) return 'unknown';
  if (minutes <= 0) return 'expired';
  if (minutes < 60) return 'in ' + minutes + ' min';
  const hours = Math.round(minutes / 60);
  return 'in ' + hours + (hours === 1 ? ' hour' : ' hours');
}

/** Filter values that live in the URL, so a filtered view is shareable. */
export type PlatformFilters = {
  q: string;
  status: string;
  plan: string;
  directoryQuery: string;
  role: string;
  mfa: string;
  flagEnvironment: string;
  /** The tenant whose detail panel is open (`?tenant=`). */
  tenantId: string;
};

/**
 * Server data, adapted in `app/(app)/platform/tenants/page.tsx`. The tenants,
 * directory and flag lists are filtered by the API (the filter values above are
 * URL search params, which the page turns into query params) — nothing here
 * filters a full table client-side.
 */
export type PlatformProps = {
  stats: PlatformStatTile[];
  tenants: TenantTableRow[];
  tenantTotal: number;
  tenantDetail: TenantDetail | null;
  planCodes: { code: string; name: string }[];
  directory: DirectoryRow[];
  directoryTotal: number;
  matrix: PermissionMatrixView;
  flags: FlagRow[];
  security: SecurityRow[];
  certifications: string[];
  complianceNote: string;
  audit: AuditStreamRow[];
  plans: PlatformPlanCard[];
  filters: PlatformFilters;
  seatsLabel: string;
  tenantCountLabel: string;
};

const TENANT_STATUS_OPTIONS: [string, string][] = [
  ['all', 'Any status'], ['active', 'Active'], ['trialing', 'Trial'],
  ['past_due', 'Past due'], ['suspended', 'Suspended'],
];
const ROLE_OPTIONS: [string, string][] = [
  ['all', 'Any role'], ['super', 'Super admin'], ['admin', 'Org admin'], ['sender', 'Sender'],
];
const MFA_OPTIONS: [string, string][] = [['all', 'Any MFA'], ['true', 'MFA on'], ['false', 'MFA off']];
const FLAG_ENV_OPTIONS: [string, string][] = [
  ['all', 'All environments'], ['prod', 'prod'], ['staging', 'staging'], ['canary', 'canary'],
];

export default function Platform({
  stats, tenants, tenantTotal, tenantDetail, planCodes, directory, directoryTotal, matrix, flags,
  security, certifications, complianceNote, audit, plans, filters, seatsLabel, tenantCountLabel,
}: PlatformProps) {
  const { flash, accent, initials } = useSF();
  const A = accent();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /* The console's five sections are the URL now, owned by the sidebar; the
     duplicate in-screen tab strip that drove the same store key is gone. */
  const section = sectionFor('platform', searchParams.get(SECTION_PARAM));

  /* ── URL-backed filters ──────────────────────────────────────────────── */
  const pushQuery = useCallback((patch: Record<string, string>) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    router.replace(qs ? pathname + '?' + qs : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  /* The input keeps the typed characters; the URL keeps the committed value. */
  const [tenantQuery, setTenantQuery] = useState(filters.q);
  const [directoryQuery, setDirectoryQuery] = useState(filters.directoryQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const pushDebounced = (patch: Record<string, string>) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => pushQuery(patch), 350);
  };

  /* ── privileged actions ──────────────────────────────────────────────── */
  const [dialog, setDialog] = useState<{ kind: 'suspend' | 'impersonate'; tenant: TenantTableRow } | null>(null);
  const [reason, setReason] = useState('');
  const [ttl, setTtl] = useState('900');
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<ImpersonationSessionResponse | null>(null);

  const closeDialog = () => { setDialog(null); setReason(''); setBusy(false); };

  const submitSuspend = () => {
    if (!dialog) return;
    if (reason.trim().length < 3) { flash('A suspension reason of at least 3 characters is required'); return; }
    setBusy(true);
    void tenantsApi.suspend(apiCall, dialog.tenant.id, reason.trim()).then(res => {
      setBusy(false);
      if (!res.ok) { flash('Could not suspend ' + dialog.tenant.name + ' · ' + res.error.message); return; }
      flash(res.data.name + ' suspended — all envelopes frozen');
      closeDialog();
      router.refresh();
    });
  };

  const reinstate = (t: TenantTableRow) => {
    flash(t.name + ' reinstated');
    void tenantsApi.resume(apiCall, t.id).then(res => {
      if (!res.ok) { flash('Could not reinstate ' + t.name + ' · ' + res.error.message); return; }
      router.refresh();
    });
  };

  const submitImpersonation = () => {
    if (!dialog) return;
    /* The API requires a justification of at least 5 characters and a TTL
       between 60s and 1h; it records the session before issuing a token. */
    if (reason.trim().length < 5) { flash('A justification of at least 5 characters is required'); return; }
    setBusy(true);
    void tenantsApi
      .impersonate(apiCall, dialog.tenant.id, { justification: reason.trim(), ttl_seconds: Number(ttl) || 900 })
      .then(res => {
        setBusy(false);
        if (!res.ok) { flash('Impersonation refused · ' + res.error.message); return; }
        setSession(res.data);
        flash('Impersonating ' + res.data.organization_name + ' as ' + res.data.impersonated_user_email);
        closeDialog();
        router.refresh();
      });
  };

  const endImpersonation = () => {
    void tenantsApi.stopImpersonation(apiCall).then(res => {
      if (!res.ok) { flash('Could not end impersonation · ' + res.error.message); return; }
      flash(res.data.ended_sessions + ' impersonation session(s) ended');
      setSession(null);
      router.refresh();
    });
  };

  /* ── tenants table ───────────────────────────────────────────────────── */
  const tenantRows = tenants.map((t, i) => ({
    id: t.id, name: t.name, slug: t.slug, owner: t.owner, plan: t.plan, region: t.region,
    volume: t.volume, status: t.status, initials: initials(t.name),
    rowStyle: { borderTop: i ? '1px solid #eef1f6' : 'none', opacity: t.suspended ? .62 : 1 } as CSSProperties,
    avatar: { width:'30px', height:'30px', borderRadius:'9px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
    planPill: pill(t.planTone),
    statusPill: pill(t.statusTone),
    seatLabel: t.used.toLocaleString() + ' / ' + t.seats.toLocaleString(),
    seatBar: (() => {
      const pct = t.seats ? Math.min(100, Math.round(t.used / t.seats * 100)) : 0;
      return { width: pct + '%', height:'100%', borderRadius:'99px', background: pct > 92 ? '#f59e0b' : '#10b981' } as CSSProperties;
    })(),
    onOpen: () => pushQuery({ tenant: filters.tenantId === t.id ? '' : t.id }),
    onImpersonate: () => { setReason(''); setDialog({ kind: 'impersonate', tenant: t }); },
    suspendLabel: t.suspended ? 'Reinstate' : 'Suspend',
    suspendStyle: t.suspended ? btn('#fff', '#047857', '#a7f3d0') : btn('#fff', '#b91c1c', '#fecaca'),
    onSuspend: () => {
      if (t.suspended) { reinstate(t); return; }
      setReason('');
      setDialog({ kind: 'suspend', tenant: t });
    },
  }));

  /* ── tenant detail (?tenant=…) ───────────────────────────────────────── */
  const detailFields: { k: string; v: string }[] = tenantDetail ? [
    { k:'Slug', v: tenantDetail.slug || '—' },
    { k:'Owner', v: tenantDetail.owner_email || '—' },
    { k:'Plan', v: tenantDetail.plan_name },
    { k:'Status', v: tenantStatusLabel(tenantDetail.status) },
    { k:'Seats', v: tenantDetail.seats_activated.toLocaleString() + ' / ' + tenantDetail.seats_licensed.toLocaleString() },
    { k:'MRR', v: formatCents(tenantDetail.mrr_cents) },
    { k:'Envelopes · 30d', v: tenantDetail.envelope_volume_30d.toLocaleString() },
    { k:'Open tickets', v: String(tenantDetail.open_ticket_count) },
    { k:'Incidents · 90d', v: String(tenantDetail.incidents_90d) },
    { k:'Billing email', v: tenantDetail.billing_email || '—' },
    { k:'Live mode', v: tenantDetail.live_mode_enabled ? 'enabled' : 'test only' },
    { k:'Created', v: formatRelative(tenantDetail.created_at) },
    ...(tenantDetail.suspension_reason ? [{ k:'Suspension reason', v: tenantDetail.suspension_reason }] : []),
  ] : [];

  const overrideFor = (key: string): boolean | null => {
    const row = tenantDetail?.flag_overrides.find(o => o.key === key);
    return row ? row.enabled : null;
  };

  const setOverride = (key: string, enabled: boolean | null) => {
    if (!tenantDetail) return;
    flash(key + ' override for ' + tenantDetail.name + ' → ' + (enabled === null ? 'cleared' : enabled ? 'on' : 'off'));
    void tenantsApi.setFlagOverride(apiCall, tenantDetail.id, { key, enabled }).then(res => {
      if (!res.ok) { flash('Could not set override · ' + res.error.message); return; }
      router.refresh();
    });
  };

  /* ── stats / tabs ────────────────────────────────────────────────────── */
  const platformStats = stats.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize:'.6875rem', color: x.good ? '#047857' : '#c2410c', fontFamily:'var(--font-sans)' } as CSSProperties,
  }));

  /* ── directory ───────────────────────────────────────────────────────── */
  const directoryRows = directory.map((u, i) => {
    const mfaOk = u.mfa !== 'None';
    return {
      id: u.id, name: u.name, email: u.email, tenant: u.tenant, role: u.role, mfa: u.mfa,
      lastActive: u.last, initials: initials(u.name),
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px 15px', borderTop: i ? '1px solid #eef1f6' : 'none' } as CSSProperties,
      avatar: { width:'30px', height:'30px', borderRadius:'99px', background: u.role === 'super' ? '#0f172a' : '#e3e7ee', color: u.role === 'super' ? '#f8fafc' : '#475569', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
      selectStyle: Object.assign({}, inputStyle, { width:'138px' }) as CSSProperties,
      mfaPill: pill(mfaOk ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }),
      onRole: (e: React.ChangeEvent<HTMLSelectElement>) => {
        const v = e.target.value;
        flash(u.name + ' → ' + (ROLE_LABEL[v] ?? v) + ' · change logged');
        void directoryApi.setRole(apiCall, u.id, v).then(res => {
          if (!res.ok) { flash('Could not change role · ' + res.error.message); return; }
          router.refresh();
        });
      },
    };
  });

  const permRows = matrix.rows.map(row => ({
    label: row.label,
    cells: row.allowed.map((c, i) => ({
      mark: c ? '✓' : '–', title: (matrix.columnLabels[i] ?? matrix.columns[i] ?? '') + (c ? ': allowed' : ': denied'),
      style: { width:'26px', height:'22px', borderRadius:'6px', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700,
        background: c ? '#ecfdf5' : '#f5f6f8', color: c ? '#047857' : BORDER_STRONG, border:'1px solid ' + (c ? '#a7f3d0' : '#e3e7ee') } as CSSProperties,
    })),
  }));

  /* ── flags ───────────────────────────────────────────────────────────── */
  const [rollouts, setRollouts] = useState<Record<string, number>>({});
  const rolloutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patchFlag = (key: string, body: { enabled?: boolean; rollout_pct?: number }) => {
    void flagsApi.update(apiCall, key, body).then(res => {
      if (!res.ok) { flash('Could not update ' + key + ' · ' + res.error.message); return; }
      router.refresh();
    });
  };

  const flagRows = flags.map((f, i) => {
    const rollout = rollouts[f.key] ?? f.rollout;
    const envTone = FLAG_ENV_TONE[f.env] ?? { bg:'#f5f6f8', fg:'#475569', bd:'#e3e7ee' };
    return {
      key: f.key, env: f.env, desc: f.desc, rollout: String(rollout), rolloutLabel: rollout + '%',
      onStr: f.on ? 'true' : 'false', aria: 'Toggle ' + f.key,
      envPill: pill(envTone),
      rowStyle: { display:'flex', alignItems:'center', gap:'14px', padding:'11px', borderTop: i ? '1px solid #f2f4f8' : 'none' } as CSSProperties,
      switch: { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: f.on ? '#10b981' : BORDER_STRONG, position:'relative', flex:'0 0 38px' } as CSSProperties,
      knob: { position:'absolute', top:'3px', left: f.on ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' } as CSSProperties,
      onToggle: () => { flash(f.key + ' → ' + (f.on ? 'off' : 'on')); patchFlag(f.key, { enabled: !f.on }); },
      onRollout: (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseInt(e.target.value, 10);
        setRollouts(prev => ({ ...prev, [f.key]: v }));
        if (rolloutTimer.current) clearTimeout(rolloutTimer.current);
        rolloutTimer.current = setTimeout(() => patchFlag(f.key, { rollout_pct: v }), 400);
      },
    };
  });

  /* ── plans & usage ───────────────────────────────────────────────────── */
  const planCards = plans.map(p => ({
    code: p.code, name: p.name, price: p.price, tag: p.tag, lines: p.lines,
    tenantsLabel: p.tenantsLabel, mrr: p.mrr, tagStyle: pill(p.tone),
    cardStyle: { background:'#fff', border:'1px solid ' + (p.code === 'enterprise' ? '#c7d2fe' : '#e3e7ee'), borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' } as CSSProperties,
  }));


  /* ── security ────────────────────────────────────────────────────────── */
  /* A control that nothing enforces must not render as a working switch: an
     operator flipping "IP allowlist for admin console" and seeing it go green
     would believe the console is IP-restricted when no code checks an address.
     Unimplemented rows render as a static "Not implemented" state instead. */
  const securityRows = security.map(r => ({
    key: r.key, label: r.label, meta: r.meta,
    implemented: r.implemented,
    onStr: r.enforced ? 'true' : 'false',
    badge: { padding:'4px 9px', borderRadius:'99px', border:'1px solid #fed7aa', background:'#fff7ed',
      color:'#9a3412', fontSize:'.6875rem', fontWeight:600, whiteSpace:'nowrap', flex:'0 0 auto' } as CSSProperties,
    switch: { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: r.enforced ? '#10b981' : BORDER_STRONG, position:'relative', flex:'0 0 38px' } as CSSProperties,
    knob: { position:'absolute', top:'3px', left: r.enforced ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' } as CSSProperties,
    onToggle: () => {
      flash(r.label + ' → ' + (r.on ? 'disabled' : 'enabled'));
      void flagsApi.updateSecurityPosture(apiCall, { [r.key]: !r.on }).then(res => {
        if (!res.ok) { flash('Could not change posture · ' + res.error.message); return; }
        router.refresh();
      });
    },
  }));

  const auditRows = audit.map((a, i) => ({ key: a.key, label: a.label, meta: a.meta,
    dot: { width:'8px', height:'8px', borderRadius:'99px', marginTop:'5px', flex:'0 0 8px', background: i === 0 ? '#f59e0b' : '#334155' } as CSSProperties }));

  const certs = certifications.map(label => ({ label,
    style: { padding:'5px 10px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'.71875rem', color:'#475569', fontFamily:'var(--font-sans)' } as CSSProperties }));

  const ptTenants = section === 'tenants';
  const ptUsers = section === 'users';
  const ptFlags = section === 'flags';
  const ptBilling = section === 'billing';
  const ptSecurity = section === 'security';


  return (
    <section data-screen-label="Platform admin" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>

      <div style={superBannerStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:'11px', minWidth:0 }}>
          <span style={superChip}>SUPER ADMIN</span>
          <span style={{ fontSize:'.78125rem', color:TEXT_ON_DARK, lineHeight:1.5 }}>Global scope — {tenantCountLabel} tenants, {seatsLabel} seats. Every action here is written to the platform audit stream.</span>
        </div>
      </div>

      {session ? (
        <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:'14px', padding:'13px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'14px', flexWrap:'wrap' }}>
          <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
            <span style={{ fontSize:'.78125rem', fontWeight:600, color:'#9a3412' }}>Impersonating {session.organization_name} as {session.impersonated_user_email}</span>
            <span style={{ fontSize:'.6875rem', color:'#c2410c', fontFamily:'var(--font-sans)', wordBreak:'break-all' }}>
              session {session.id} · expires {expiresIn(session.expires_at)} · {session.justification}
              {session.scopes.length ? ' · scopes ' + session.scopes.join(', ') : ''}
            </span>
          </div>
          <button type="button" onClick={endImpersonation} style={btn('#fff', '#b91c1c', '#fecaca')}>End impersonation</button>
        </div>
      ) : null}

      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:'12px' }}>
        {platformStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'7px' }}>
            <span style={{ fontSize:'.65625rem', letterSpacing:'.06em', color:'#64748b', fontFamily:'var(--font-sans)' }}>{st.label}</span>
            <span style={{ fontSize:'1.5rem', fontWeight:700, letterSpacing:'-.8px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      {ptTenants ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
          <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={railHead}>Tenants / organisations · {tenants.length} of {tenantTotal}</div>
            <div style={{ display:'flex', alignItems:'center', gap:'7px', flexWrap:'wrap' }}>
              <select value={filters.status} onChange={e => pushQuery({ status: e.target.value })} aria-label="Filter by status" style={selectStyle}>
                {TENANT_STATUS_OPTIONS.map(([id, label]) => (<option key={id} value={id}>{label}</option>))}
              </select>
              <select value={filters.plan} onChange={e => pushQuery({ plan: e.target.value })} aria-label="Filter by plan" style={selectStyle}>
                <option value="all">Any plan</option>
                {planCodes.map(p => (<option key={p.code} value={p.code}>{p.name}</option>))}
              </select>
              <input type="search" value={tenantQuery}
                onChange={e => { setTenantQuery(e.target.value); pushDebounced({ q: e.target.value }); }}
                placeholder="Filter by org, region, plan…" aria-label="Filter tenants"
                style={{ height:'32px', width:'240px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'.78125rem', outline:'none', background:'#fbfcfd' }} />
            </div>
          </div>
          <div data-sf-scroll="1" style={{ overflowX:'auto', maxWidth:'100%' }}>
            <table style={{ width:'100%', minWidth:'920px', borderCollapse:'collapse', fontSize:'.8125rem' }}>
              <thead>
                <tr style={{ textAlign:'left', color:'#64748b' }}>
                  <th scope="col" style={th}>Organisation</th>
                  <th scope="col" style={th}>Plan</th>
                  <th scope="col" style={th}>Seats</th>
                  <th scope="col" style={th}>Envelopes / mo</th>
                  <th scope="col" style={th}>Region</th>
                  <th scope="col" style={th}>Status</th>
                  <th scope="col" style={thRight}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tenantRows.length ? tenantRows.map(t => (
                  <tr key={t.id} style={t.rowStyle}>
                    <td style={td}>
                      <div style={{ display:'flex', alignItems:'center', gap:'11px' }}>
                        <span style={t.avatar}>{t.initials}</span>
                        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                          <button type="button" onClick={t.onOpen} style={{ background:'none', border:'none', padding:0, cursor:'pointer', textAlign:'left', fontSize:'.84375rem', fontWeight:600, color:'#0f172a' }}>{t.name}</button>
                          <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>{t.slug} · owner {t.owner}</span>
                        </div>
                      </div>
                    </td>
                    <td style={td}><span style={t.planPill}>{t.plan}</span></td>
                    <td style={td}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                        <span style={{ fontFamily:'var(--font-sans)', fontSize:'.75rem' }}>{t.seatLabel}</span>
                        <div style={{ width:'78px', height:'4px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={t.seatBar}></div></div>
                      </div>
                    </td>
                    <td style={td}><span style={{ fontFamily:'var(--font-sans)', fontSize:'.75rem' }}>{t.volume}</span></td>
                    <td style={td}><span style={{ color:'#64748b', fontFamily:'var(--font-sans)', fontSize:'.71875rem' }}>{t.region}</span></td>
                    <td style={td}><span style={t.statusPill}>{t.status}</span></td>
                    <td style={tdRight}>
                      <div style={{ display:'inline-flex', gap:'6px' }}>
                        <button type="button" onClick={t.onImpersonate} style={ghostBtn}>Impersonate</button>
                        <button type="button" onClick={t.onSuspend} style={t.suspendStyle}>{t.suspendLabel}</button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} style={emptyCell}>No tenants match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {tenantDetail ? (
            <div style={{ borderTop:'1px solid #eef1f6', padding:'16px', display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'16px', alignItems:'start', background:'#fbfcfd' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
                  <div style={railHead}>{tenantDetail.name} · detail</div>
                  <button type="button" onClick={() => pushQuery({ tenant: '' })} style={ghostBtn}>Close</button>
                </div>
                {detailFields.map(f => (
                  <div key={f.k} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'.78125rem', padding:'6px 0', borderTop:'1px solid #f2f4f8' }}>
                    <span style={{ color:'#64748b' }}>{f.k}</span>
                    <span style={{ fontWeight:500, textAlign:'right', wordBreak:'break-all' }}>{f.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
                <div style={railHead}>Feature flag overrides</div>
                {flags.length ? flags.map(f => {
                  const value = overrideFor(f.key);
                  return (
                    <div key={f.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'8px 10px', border:'1px solid #eef1f6', borderRadius:'11px', background:'#fff' }}>
                      <span style={{ fontSize:'.75rem', fontFamily:'var(--font-sans)', minWidth:0, wordBreak:'break-all' }}>{f.key}</span>
                      <select value={value === null ? 'inherit' : value ? 'on' : 'off'}
                        onChange={e => setOverride(f.key, e.target.value === 'inherit' ? null : e.target.value === 'on')}
                        aria-label={'Override ' + f.key} style={selectStyle}>
                        <option value="inherit">Inherit ({f.on ? 'on' : 'off'})</option>
                        <option value="on">Force on</option>
                        <option value="off">Force off</option>
                      </select>
                    </div>
                  );
                }) : (<span style={emptyNote}>No feature flags defined.</span>)}
                {tenantDetail.admins.length ? (
                  <>
                    <div style={railHead}>Administrators</div>
                    {tenantDetail.admins.map(a => (
                      <div key={a.id} style={{ display:'flex', justifyContent:'space-between', gap:'10px', fontSize:'.75rem', padding:'6px 0', borderTop:'1px solid #f2f4f8' }}>
                        <span style={{ color:'#334155' }}>{a.name}</span>
                        <span style={{ color:'#64748b', fontFamily:'var(--font-sans)', wordBreak:'break-all' }}>{a.email}</span>
                      </div>
                    ))}
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {ptUsers ? (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.7fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
            <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
              <div style={railHead}>Directory · cross-tenant · {directory.length} of {directoryTotal}</div>
              <div style={{ display:'flex', alignItems:'center', gap:'7px', flexWrap:'wrap' }}>
                <select value={filters.role} onChange={e => pushQuery({ drole: e.target.value })} aria-label="Filter by role" style={selectStyle}>
                  {ROLE_OPTIONS.map(([id, label]) => (<option key={id} value={id}>{label}</option>))}
                </select>
                <select value={filters.mfa} onChange={e => pushQuery({ dmfa: e.target.value })} aria-label="Filter by MFA" style={selectStyle}>
                  {MFA_OPTIONS.map(([id, label]) => (<option key={id} value={id}>{label}</option>))}
                </select>
                <input type="search" value={directoryQuery}
                  onChange={e => { setDirectoryQuery(e.target.value); pushDebounced({ duser: e.target.value }); }}
                  placeholder="Search name or email…" aria-label="Search directory"
                  style={{ height:'32px', width:'200px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'.78125rem', outline:'none', background:'#fbfcfd' }} />
              </div>
            </div>
            {directoryRows.length ? directoryRows.map(u => (
              <div key={u.id} style={u.rowStyle} data-sf-userrow="1">
                <span style={u.avatar}>{u.initials}</span>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'1 1 180px', minWidth:'170px' }}>
                  <span style={{ fontSize:'.8125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.name}</span>
                  <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.email} · {u.tenant}</span>
                </div>
                <select value={u.role} onChange={u.onRole} aria-label="Role" style={u.selectStyle}>
                  <option value="super">Super admin</option>
                  <option value="orgadmin">Org admin</option>
                  <option value="sender">Sender</option>
                  <option value="viewer">Viewer</option>
                </select>
                <span style={u.mfaPill}>{u.mfa}</span>
                <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)', width:'82px', textAlign:'right' }}>{u.lastActive}</span>
              </div>
            )) : (
              <div style={emptyCell}>No users match these filters.</div>
            )}
          </div>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={railHead}>Role permission matrix</div>
            {permRows.length ? permRows.map(p => (
              <div key={p.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'8px 0', borderBottom:'1px solid #f2f4f8' }}>
                <span style={{ fontSize:'.75rem', color:'#334155' }}>{p.label}</span>
                <div style={{ display:'flex', gap:'6px' }}>
                  {p.cells.map((c, ci) => (
                    <span key={ci} style={c.style} title={c.title}>{c.mark}</span>
                  ))}
                </div>
              </div>
            )) : (<span style={emptyNote}>Permission matrix unavailable.</span>)}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'6px', fontSize:'.625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>{matrix.columnAbbrev.join(' · ')}</div>
          </div>
        </div>
      ) : null}

      {ptFlags ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
            <div style={railHead}>Feature flags &amp; rollout</div>
            <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
              <select value={filters.flagEnvironment} onChange={e => pushQuery({ flagEnv: e.target.value })} aria-label="Filter by environment" style={selectStyle}>
                {FLAG_ENV_OPTIONS.map(([id, label]) => (<option key={id} value={id}>{label}</option>))}
              </select>
              <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>edge config · propagates in ~15s</span>
            </div>
          </div>
          {flagRows.length ? flagRows.map(f => (
            <div key={f.key} style={f.rowStyle}>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'.78125rem', fontWeight:600, fontFamily:'var(--font-sans)' }}>{f.key}</span>
                  <span style={f.envPill}>{f.env}</span>
                </div>
                <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.5 }}>{f.desc}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
                <span style={{ fontSize:'.6875rem', fontFamily:'var(--font-sans)', color:'#475569', width:'64px', textAlign:'right' }}>{f.rolloutLabel}</span>
                <input type="range" min="0" max="100" step="5" value={f.rollout} onChange={f.onRollout} aria-label="Rollout percentage" style={{ width:'120px', accentColor:'#4f46e5' }} />
                <button type="button" role="switch" aria-checked={f.onStr === 'true'} aria-label={f.aria} onClick={f.onToggle} style={f.switch}><span style={f.knob}></span></button>
              </div>
            </div>
          )) : (<span style={emptyNote}>No feature flags in this environment.</span>)}
        </div>
      ) : null}

      {ptBilling ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'16px', alignItems:'start' }}>
          {planCards.map(p => (
            <div key={p.code} style={p.cardStyle}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:'.875rem', fontWeight:700, letterSpacing:'-.2px' }}>{p.name}</span>
                <span style={p.tagStyle}>{p.tag}</span>
              </div>
              <div style={{ display:'flex', alignItems:'baseline', gap:'5px' }}>
                <span style={{ fontSize:'1.625rem', fontWeight:700, letterSpacing:'-1px' }}>{p.price}</span>
                <span style={{ fontSize:'.75rem', color:'#64748b' }}>/ seat / mo</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'7px', borderTop:'1px solid #eef1f6', paddingTop:'11px' }}>
                {p.lines.map(l => (
                  <div key={l.k} style={{ display:'flex', justifyContent:'space-between', fontSize:'.75rem', gap:'10px' }}>
                    <span style={{ color:'#64748b' }}>{l.k}</span><span style={{ fontWeight:500, fontFamily:'var(--font-sans)' }}>{l.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.71875rem', color:'#475569', borderTop:'1px solid #eef1f6', paddingTop:'11px' }}>
                <span>{p.tenantsLabel}</span><span style={{ fontFamily:'var(--font-sans)', fontWeight:600 }}>{p.mrr} MRR</span>
              </div>
            </div>
          ))}
          {!planCards.length ? (
            <div style={{ gridColumn:'1 / -1', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px' }}>
              <span style={emptyNote}>No plans configured.</span>
            </div>
          ) : null}
          <div style={{ gridColumn:'1 / -1', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Metered usage · current cycle</div>
            {/* Platform-wide metering has no endpoint (`GET /api/billing/usage`
                is scoped to the caller's own tenant). The prototype's constants
                are gone rather than presented as capacity figures. */}
            <span style={emptyNote}>Platform-wide metered usage is not available — there is no cross-tenant usage endpoint. Per-tenant usage is on each tenant&rsquo;s detail panel.</span>
          </div>
        </div>
      ) : null}

      {ptSecurity ? (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Security posture</div>
            <span style={{ fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.5 }}>
              Controls marked <strong>Not implemented</strong> have no enforcement anywhere in the
              product. Nothing you can change here restricts access.
            </span>
            {securityRows.length ? securityRows.map(r => (
              <div key={r.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', padding:'10px 11px', border:'1px solid #eef1f6', borderRadius:'11px', background:'#fbfcfd' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                  <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{r.label}</span>
                  <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{r.meta}</span>
                </div>
                {r.implemented ? (
                  <button type="button" role="switch" aria-checked={r.onStr === 'true'} aria-label={r.label} onClick={r.onToggle} style={r.switch}><span style={r.knob}></span></button>
                ) : (
                  <span style={r.badge} title="No code path enforces this control.">Not implemented</span>
                )}
              </div>
            )) : (<span style={emptyNote}>Security posture unavailable.</span>)}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'#0f172a', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
              <div style={{ fontSize:'.6875rem', letterSpacing:'.08em', color:TEXT_MUTED_ON_DARK, fontFamily:'var(--font-sans)' }}>PLATFORM AUDIT STREAM</div>
              {auditRows.length ? auditRows.map(a => (
                <div key={a.key} style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
                  <span style={a.dot}></span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={{ fontSize:'.78125rem', color:'#e2e8f0', fontWeight:500 }}>{a.label}</span>
                    <span style={{ fontSize:'.65625rem', color:'#64748b', fontFamily:'var(--font-sans)', wordBreak:'break-all' }}>{a.meta}</span>
                  </div>
                </div>
              )) : (<span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.6 }}>No administrative actions recorded yet.</span>)}
            </div>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
              <div style={railHead}>Compliance certifications</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'7px' }}>
                {certs.length ? certs.map(c => (<span key={c.label} style={c.style}>{c.label}</span>)) : (<span style={emptyNote}>No certifications recorded.</span>)}
              </div>
              <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.5 }}>{complianceNote}</span>
            </div>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <div role="dialog" aria-modal="true" aria-label={dialog.kind === 'suspend' ? 'Suspend tenant' : 'Start impersonation'}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.42)', display:'grid', placeItems:'center', padding:'22px', zIndex:60 }}>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', width:'min(460px, 100%)', display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <span style={{ fontSize:'.9375rem', fontWeight:700, letterSpacing:'-.2px' }}>
                {dialog.kind === 'suspend' ? 'Suspend ' + dialog.tenant.name : 'Impersonate ' + dialog.tenant.name}
              </span>
              <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.5 }}>
                {dialog.kind === 'suspend'
                  ? 'All envelopes freeze immediately. The reason is stored on the tenant and written to the platform audit stream.'
                  : 'A short-lived token is issued for the tenant owner. The justification and the session are recorded before the token exists.'}
              </span>
            </div>
            <label style={{ display:'flex', flexDirection:'column', gap:'5px', fontSize:'.6875rem', letterSpacing:'.04em', textTransform:'uppercase', color:'#64748b', fontFamily:'var(--font-sans)' }}>
              {dialog.kind === 'suspend' ? 'Reason (min 3 characters)' : 'Justification (min 5 characters)'}
              <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                placeholder={dialog.kind === 'suspend' ? 'non-payment · dunning step 4' : 'INC-4471 · signer cannot complete envelope'}
                style={inputStyle} />
            </label>
            {dialog.kind === 'impersonate' ? (
              <label style={{ display:'flex', flexDirection:'column', gap:'5px', fontSize:'.6875rem', letterSpacing:'.04em', textTransform:'uppercase', color:'#64748b', fontFamily:'var(--font-sans)' }}>
                Session lifetime
                <select value={ttl} onChange={e => setTtl(e.target.value)} style={Object.assign({}, inputStyle, { width:'100%' })}>
                  <option value="300">5 minutes</option>
                  <option value="900">15 minutes</option>
                  <option value="1800">30 minutes</option>
                  <option value="3600">1 hour</option>
                </select>
              </label>
            ) : null}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
              <button type="button" onClick={closeDialog} style={ghostBtn}>Cancel</button>
              <button type="button" disabled={busy}
                onClick={dialog.kind === 'suspend' ? submitSuspend : submitImpersonation}
                style={dialog.kind === 'suspend' ? btn('#b91c1c', '#fff', '#b91c1c') : btn(A, '#fff', A)}>
                {busy ? 'Working…' : dialog.kind === 'suspend' ? 'Suspend tenant' : 'Start session'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
