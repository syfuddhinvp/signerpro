'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { ROLE_LABEL, FLAG_ENV_TONE } from '@/lib/sf/data';
import { SECTION_PARAM, sectionFor } from '@/lib/sf/routes';
import { btn, pill, inputStyle, railHead, selectStyle, TEXT_MUTED, BORDER_STRONG, TEXT_MUTED_ON_DARK, TEXT_ON_DARK } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { startImpersonation } from '@/components/sf/SessionProvider';
import {
  directory as directoryApi,
  flags as flagsApi,
  tenants as tenantsApi,
} from '@/lib/api/resources';
import type {
  AuditStreamRow,
  CertificationView,
  DirectoryRow,
  FlagRow,
  PermissionMatrixView,
  PlatformPlanCard,
  PlatformStatTile,
  SecurityRow,
  TenantTableRow,
} from '@/lib/sf/adapters';
import Icon, { type IconName } from '@/components/sf/Icon';

const th: CSSProperties = { padding:'10px 14px', fontSize:'.6875rem', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, fontFamily:'var(--font-sans)' };
const thRight: CSSProperties = { padding:'10px 14px', fontSize:'.6875rem', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, textAlign:'right', fontFamily:'var(--font-sans)' };
const td: CSSProperties = { padding:'11px 14px', verticalAlign:'middle' };
const tdRight: CSSProperties = { padding:'11px 14px', textAlign:'right', verticalAlign:'middle' };

const superBannerStyle: CSSProperties = { background:'hsl(var(--color-bg-panel-dark))', borderRadius:'14px', padding:'13px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'14px' };
const superChip: CSSProperties = { padding:'4px 9px', borderRadius:'7px', background:'hsl(var(--color-bg-warning-solid))', color:'#3b1d00', fontSize:'.65625rem', fontWeight:700, fontFamily:'var(--font-sans)', letterSpacing:'.06em', whiteSpace:'nowrap', flex:'0 0 auto' };
const ghostBtn: CSSProperties = btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-subtle))', 'hsl(var(--color-border-subtle))');

const emptyCell: CSSProperties = { padding:'22px 14px', fontSize:'.78125rem', color:'hsl(var(--color-fg-muted))' };
const emptyNote: CSSProperties = { fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.6 };

/** Filter values that live in the URL, so a filtered view is shareable. */
export type PlatformFilters = {
  q: string;
  status: string;
  plan: string;
  directoryQuery: string;
  role: string;
  mfa: string;
  flagEnvironment: string;
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
  planCodes: { code: string; name: string }[];
  directory: DirectoryRow[];
  directoryTotal: number;
  matrix: PermissionMatrixView;
  flags: FlagRow[];
  security: SecurityRow[];
  certifications: CertificationView[];
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
  stats, tenants, tenantTotal, planCodes, directory, directoryTotal, matrix, flags,
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
  const [scope, setScope] = useState('read');
  const [busy, setBusy] = useState(false);

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

  /* Not a plain API call: the backend mints the impersonation token, but it
     only takes effect once it is installed in the httpOnly session cookie,
     which client JS cannot write. `/api/auth/impersonate` does the swap and
     tells us where to land. See `app/api/auth/impersonate/route.ts`. */
  const submitImpersonation = () => {
    if (!dialog) return;
    /* The API requires a justification of at least 5 characters and a TTL
       between 60s and 1h; it records the session before issuing a token. */
    if (reason.trim().length < 5) { flash('A justification of at least 5 characters is required'); return; }
    setBusy(true);
    void startImpersonation({
      organizationId: dialog.tenant.id,
      justification: reason.trim(),
      ttlSeconds: Number(ttl) || 900,
      /* `write` implies `read`: the backend refuses unsafe methods on a
         read-only session, so a support visit meant to fix something has to
         ask for both up front. */
      scopes: scope === 'write' ? ['read', 'write'] : ['read'],
    }).then(result => {
      setBusy(false);
      if (!result.ok) { flash('Impersonation refused · ' + result.error); return; }
      closeDialog();
      /* A full navigation rather than `router.refresh()`: the cookie now holds
         a different identity, and middleware has to re-read it before any
         screen renders — the console itself is closed to us from here on. */
      window.location.assign(result.next);
    });
  };

  /* ── tenants table ───────────────────────────────────────────────────── */
  const tenantRows = tenants.map((t, i) => ({
    id: t.id, name: t.name, slug: t.slug, owner: t.owner, plan: t.plan, region: t.region,
    volume: t.volume, status: t.status, initials: initials(t.name),
    rowStyle: { borderTop: i ? '1px solid hsl(var(--color-border-hairline))' : 'none', opacity: t.suspended ? .62 : 1, cursor:'pointer' } as CSSProperties,
    avatar: { width:'30px', height:'30px', borderRadius:'9px', background:'hsl(var(--color-bg-panel-dark))', color:'hsl(var(--color-fg-on-solid))', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
    planPill: pill(t.planTone),
    statusPill: pill(t.statusTone),
    seatLabel: t.used.toLocaleString() + ' / ' + t.seats.toLocaleString(),
    seatBar: (() => {
      const pct = t.seats ? Math.min(100, Math.round(t.used / t.seats * 100)) : 0;
      return { width: pct + '%', height:'100%', borderRadius:'99px', background: pct > 92 ? 'hsl(var(--color-bg-warning-solid))' : 'hsl(var(--color-highlight-solid))' } as CSSProperties;
    })(),
    /* The row is the record page. A fold under the table could only ever hold
       a summary of what that page shows in full. */
    href: '/platform/tenants/' + t.id,
    onOpen: () => router.push('/platform/tenants/' + t.id),
    onImpersonate: () => { setReason(''); setScope('read'); setDialog({ kind: 'impersonate', tenant: t }); },
    suspendLabel: t.suspended ? 'Reinstate' : 'Suspend',
    suspendStyle: t.suspended ? btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-success))', 'hsl(var(--color-border-success))') : btn('hsl(var(--color-bg-surface))', 'hsl(var(--color-fg-danger))', 'hsl(var(--color-border-danger))'),
    onSuspend: () => {
      if (t.suspended) { reinstate(t); return; }
      setReason('');
      setDialog({ kind: 'suspend', tenant: t });
    },
  }));

  /* ── stats / tabs ────────────────────────────────────────────────────── */
  const platformStats = stats.map(x => ({
    label: x.label, value: x.value, meta: x.meta,
    metaStyle: { fontSize:'.6875rem', color: x.good ? 'hsl(var(--color-fg-success))' : 'hsl(var(--color-fg-warning))', fontFamily:'var(--font-sans)' } as CSSProperties,
  }));

  /* ── directory ───────────────────────────────────────────────────────── */
  const directoryRows = directory.map((u, i) => {
    const mfaOk = u.mfa !== 'None';
    return {
      id: u.id, name: u.name, email: u.email, tenant: u.tenant, role: u.role, mfa: u.mfa,
      lastActive: u.last, initials: initials(u.name),
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px 15px', borderTop: i ? '1px solid hsl(var(--color-border-hairline))' : 'none' } as CSSProperties,
      avatar: { width:'30px', height:'30px', borderRadius:'99px', background: u.role === 'super' ? 'hsl(var(--color-bg-panel-dark))' : 'hsl(var(--color-border-subtle))', color: u.role === 'super' ? 'hsl(var(--color-fg-on-solid))' : 'hsl(var(--color-fg-subtle))', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
      selectStyle: Object.assign({}, inputStyle, { width:'138px' }) as CSSProperties,
      mfaPill: pill(mfaOk ? { bg:'hsl(var(--color-bg-success-subtle))', fg:'hsl(var(--color-fg-success))', bd:'hsl(var(--color-border-success))' } : { bg:'hsl(var(--color-bg-danger-subtle))', fg:'hsl(var(--color-fg-danger))', bd:'hsl(var(--color-border-danger))' }),
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
      mark: (c ? 'check' : 'minus') as IconName, title: (matrix.columnLabels[i] ?? matrix.columns[i] ?? '') + (c ? ': allowed' : ': denied'),
      style: { width:'26px', height:'22px', borderRadius:'6px', display:'grid', placeItems:'center', fontSize:'.6875rem', fontWeight:700,
        background: c ? 'hsl(var(--color-bg-success-subtle))' : 'hsl(var(--color-bg-canvas))', color: c ? 'hsl(var(--color-fg-success))' : BORDER_STRONG, border:'1px solid ' + (c ? 'hsl(var(--color-border-success))' : 'hsl(var(--color-border-subtle))') } as CSSProperties,
    })),
  }));

  /* ── flags ───────────────────────────────────────────────────────────── */
  const [rollouts, setRollouts] = useState<Record<string, number>>({});

  /* The compliance editor: which record is open, the draft, and the API's own
     refusal (it rejects "certified" without evidence) shown where it happened
     rather than as a toast that disappears before it can be acted on. */
  const [certEdit, setCertEdit] = useState<string | null>(null);
  const [certBusy, setCertBusy] = useState(false);
  const [certError, setCertError] = useState('');
  const [certForm, setCertForm] = useState({
    status: 'not_assessed', auditor: '', assessedOn: '', expiresOn: '', evidenceUrl: '', notes: '',
  });
  const rolloutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patchFlag = (key: string, body: { enabled?: boolean; rollout_pct?: number }) => {
    void flagsApi.update(apiCall, key, body).then(res => {
      if (!res.ok) { flash('Could not update ' + key + ' · ' + res.error.message); return; }
      router.refresh();
    });
  };

  const flagRows = flags.map((f, i) => {
    const rollout = rollouts[f.key] ?? f.rollout;
    const envTone = FLAG_ENV_TONE[f.env] ?? { bg:'hsl(var(--color-bg-canvas))', fg:'hsl(var(--color-fg-subtle))', bd:'hsl(var(--color-border-subtle))' };
    return {
      key: f.key, env: f.env, desc: f.desc, rollout: String(rollout), rolloutLabel: rollout + '%',
      onStr: f.on ? 'true' : 'false', aria: 'Toggle ' + f.key,
      envPill: pill(envTone),
      rowStyle: { display:'flex', alignItems:'center', gap:'14px', padding:'11px', borderTop: i ? '1px solid hsl(var(--color-border-faint))' : 'none' } as CSSProperties,
      switch: { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: f.on ? 'hsl(var(--color-highlight-solid))' : BORDER_STRONG, position:'relative', flex:'0 0 38px' } as CSSProperties,
      knob: { position:'absolute', top:'3px', left: f.on ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'hsl(var(--color-bg-surface))', transition:'left .15s' } as CSSProperties,
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
    cardStyle: { background:'hsl(var(--color-bg-surface))', border:'1px solid ' + (p.code === 'enterprise' ? 'hsl(var(--color-accent-border))' : 'hsl(var(--color-border-subtle))'), borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' } as CSSProperties,
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
    badge: { padding:'4px 9px', borderRadius:'99px', border:'1px solid hsl(var(--color-border-warning))', background:'hsl(var(--color-bg-warning-subtle))',
      color:'#9a3412', fontSize:'.6875rem', fontWeight:600, whiteSpace:'nowrap', flex:'0 0 auto' } as CSSProperties,
    switch: { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: r.enforced ? 'hsl(var(--color-highlight-solid))' : BORDER_STRONG, position:'relative', flex:'0 0 38px' } as CSSProperties,
    knob: { position:'absolute', top:'3px', left: r.enforced ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'hsl(var(--color-bg-surface))', transition:'left .15s' } as CSSProperties,
    onToggle: () => {
      flash(r.label + ' → ' + (r.on ? 'disabled' : 'enabled'));
      void flagsApi.updateSecurityPosture(apiCall, { [r.key]: !r.on }).then(res => {
        if (!res.ok) { flash('Could not change posture · ' + res.error.message); return; }
        router.refresh();
      });
    },
  }));

  const auditRows = audit.map((a, i) => ({ key: a.key, label: a.label, meta: a.meta,
    dot: { width:'8px', height:'8px', borderRadius:'99px', marginTop:'5px', flex:'0 0 8px', background: i === 0 ? 'hsl(var(--color-bg-warning-solid))' : 'hsl(var(--color-border-strong))' } as CSSProperties }));

  /* A chip is the only thing anyone reads at a glance, so it has to carry the
     status honestly: green is reserved for an attestation that is current, and
     a lapsed one goes amber rather than quietly staying green. */
  const certs = certifications.map(c => {
    const tone = c.effectiveStatus === 'certified'
      ? { border:'hsl(var(--color-border-success))', background:'hsl(var(--color-bg-success-subtle))', color:'#065f46' }
      : c.effectiveStatus === 'expired'
        ? { border:'hsl(var(--color-border-danger))', background:'hsl(var(--color-bg-danger-subtle))', color:'hsl(var(--color-fg-danger))' }
        : c.effectiveStatus === 'in_process'
          ? { border:'hsl(var(--color-border-warning))', background:'hsl(var(--color-bg-warning-subtle))', color:'#9a3412' }
          : { border:'hsl(var(--color-border-subtle))', background:'hsl(var(--color-bg-subtle))', color:'hsl(var(--color-fg-subtle))' };
    return { ...c,
      style: { padding:'5px 10px', borderRadius:'99px', border:'1px solid ' + tone.border, background:tone.background, fontSize:'.71875rem', color:tone.color, fontFamily:'var(--font-sans)' } as CSSProperties };
  });

  const editingCert = certifications.find(c => c.id === certEdit) ?? null;

  const saveCert = () => {
    if (!editingCert || certBusy) return;
    setCertBusy(true);
    setCertError('');
    void flagsApi.updateCertification(apiCall, editingCert.id, {
      status: certForm.status,
      auditor: certForm.auditor.trim() || null,
      assessed_on: certForm.assessedOn || null,
      expires_on: certForm.expiresOn || null,
      evidence_url: certForm.evidenceUrl.trim() || null,
      notes: certForm.notes.trim() || null,
    }).then(res => {
      setCertBusy(false);
      if (!res.ok) { setCertError(res.error.message); return; }
      setCertEdit(null);
      flash(editingCert.name + ' → ' + res.data.effective_status.replace(/_/g, ' '));
      router.refresh();
    });
  };

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

      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:'12px' }}>
        {platformStats.map(st => (
          <div key={st.label} style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'7px' }}>
            <span style={{ fontSize:'.65625rem', letterSpacing:'.06em', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>{st.label}</span>
            <span style={{ fontSize:'1.5rem', fontWeight:700, letterSpacing:'-.8px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      {ptTenants ? (
        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', overflow:'hidden' }}>
          <div style={{ padding:'12px 15px', borderBottom:'1px solid hsl(var(--color-border-hairline))', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
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
                style={{ height:'32px', width:'240px', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'9px', padding:'0 11px', fontSize:'.78125rem', outline:'none', background:'hsl(var(--color-bg-subtle))' }} />
            </div>
          </div>
          <div data-sf-scroll="1" style={{ overflowX:'auto', maxWidth:'100%' }}>
            <table style={{ width:'100%', minWidth:'920px', borderCollapse:'collapse', fontSize:'.8125rem' }}>
              <thead>
                <tr style={{ textAlign:'left', color:'hsl(var(--color-fg-muted))' }}>
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
                  /* The whole row opens the record; the buttons in the last
                     cell stop the click so an action is never a navigation. */
                  <tr key={t.id} style={t.rowStyle} onClick={t.onOpen}>
                    <td style={td}>
                      <div style={{ display:'flex', alignItems:'center', gap:'11px' }}>
                        <span style={t.avatar}>{t.initials}</span>
                        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                          <Link href={t.href} style={{ textDecoration:'none', fontSize:'.84375rem', fontWeight:600, color:'hsl(var(--color-fg-default))' }}>{t.name}</Link>
                          <span style={{ fontSize:'.6875rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>{t.slug} · owner {t.owner}</span>
                        </div>
                      </div>
                    </td>
                    <td style={td}><span style={t.planPill}>{t.plan}</span></td>
                    <td style={td}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                        <span style={{ fontFamily:'var(--font-sans)', fontSize:'.75rem' }}>{t.seatLabel}</span>
                        <div style={{ width:'78px', height:'4px', borderRadius:'99px', background:'hsl(var(--color-bg-muted))', overflow:'hidden' }}><div style={t.seatBar}></div></div>
                      </div>
                    </td>
                    <td style={td}><span style={{ fontFamily:'var(--font-sans)', fontSize:'.75rem' }}>{t.volume}</span></td>
                    <td style={td}><span style={{ color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)', fontSize:'.71875rem' }}>{t.region}</span></td>
                    <td style={td}><span style={t.statusPill}>{t.status}</span></td>
                    <td style={tdRight} onClick={e => e.stopPropagation()}>
                      <div style={{ display:'inline-flex', gap:'6px' }}>
                        <Link href={t.href} style={{ ...ghostBtn, textDecoration:'none' }}>Details</Link>
                        <button type="button" onClick={t.onImpersonate} style={ghostBtn}><Icon name="eye" size={12} />Impersonate</button>
                        <button type="button" onClick={t.onSuspend} style={t.suspendStyle}><Icon name="pause" size={12} />{t.suspendLabel}</button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={7} style={emptyCell}>No tenants match these filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>

        </div>
      ) : null}

      {ptUsers ? (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.7fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
          <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', overflow:'hidden' }}>
            <div style={{ padding:'12px 15px', borderBottom:'1px solid hsl(var(--color-border-hairline))', display:'flex', justifyContent:'space-between', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
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
                  style={{ height:'32px', width:'200px', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'9px', padding:'0 11px', fontSize:'.78125rem', outline:'none', background:'hsl(var(--color-bg-subtle))' }} />
              </div>
            </div>
            {directoryRows.length ? directoryRows.map(u => (
              <div key={u.id} style={u.rowStyle} data-sf-userrow="1">
                <span style={u.avatar}>{u.initials}</span>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'1 1 180px', minWidth:'170px' }}>
                  <span style={{ fontSize:'.8125rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.name}</span>
                  <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.email} · {u.tenant}</span>
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
          <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={railHead}>Role permission matrix</div>
            {permRows.length ? permRows.map(p => (
              <div key={p.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'8px 0', borderBottom:'1px solid hsl(var(--color-border-faint))' }}>
                <span style={{ fontSize:'.75rem', color:'hsl(var(--color-fg-subtle))' }}>{p.label}</span>
                <div style={{ display:'flex', gap:'6px' }}>
                  {p.cells.map((c, ci) => (
                    <span key={ci} style={c.style} title={c.title}><Icon name={c.mark} size={12} /></span>
                  ))}
                </div>
              </div>
            )) : (<span style={emptyNote}>Permission matrix unavailable.</span>)}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'6px', fontSize:'.625rem', color:TEXT_MUTED, fontFamily:'var(--font-sans)' }}>{matrix.columnAbbrev.join(' · ')}</div>
          </div>
        </div>
      ) : null}

      {ptFlags ? (
        <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
            <div style={railHead}>Feature flags &amp; rollout</div>
            <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
              <select value={filters.flagEnvironment} onChange={e => pushQuery({ flagEnv: e.target.value })} aria-label="Filter by environment" style={selectStyle}>
                {FLAG_ENV_OPTIONS.map(([id, label]) => (<option key={id} value={id}>{label}</option>))}
              </select>
              <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>edge config · propagates in ~15s</span>
            </div>
          </div>
          {flagRows.length ? flagRows.map(f => (
            <div key={f.key} style={f.rowStyle}>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'.78125rem', fontWeight:600, fontFamily:'var(--font-sans)' }}>{f.key}</span>
                  <span style={f.envPill}>{f.env}</span>
                </div>
                <span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.5 }}>{f.desc}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
                <span style={{ fontSize:'.6875rem', fontFamily:'var(--font-sans)', color:'hsl(var(--color-fg-subtle))', width:'64px', textAlign:'right' }}>{f.rolloutLabel}</span>
                <input type="range" min="0" max="100" step="5" value={f.rollout} onChange={f.onRollout} aria-label="Rollout percentage" style={{ width:'120px', accentColor:'hsl(var(--color-accent-solid))' }} />
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
                <span style={{ fontSize:'.75rem', color:'hsl(var(--color-fg-muted))' }}>/ seat / mo</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'7px', borderTop:'1px solid hsl(var(--color-border-hairline))', paddingTop:'11px' }}>
                {p.lines.map(l => (
                  <div key={l.k} style={{ display:'flex', justifyContent:'space-between', fontSize:'.75rem', gap:'10px' }}>
                    <span style={{ color:'hsl(var(--color-fg-muted))' }}>{l.k}</span><span style={{ fontWeight:500, fontFamily:'var(--font-sans)' }}>{l.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'.71875rem', color:'hsl(var(--color-fg-subtle))', borderTop:'1px solid hsl(var(--color-border-hairline))', paddingTop:'11px' }}>
                <span>{p.tenantsLabel}</span><span style={{ fontFamily:'var(--font-sans)', fontWeight:600 }}>{p.mrr} MRR</span>
              </div>
            </div>
          ))}
          {!planCards.length ? (
            <div style={{ gridColumn:'1 / -1', background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px' }}>
              <span style={emptyNote}>No plans configured.</span>
            </div>
          ) : null}
          <div style={{ gridColumn:'1 / -1', background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Metered usage · current cycle</div>
            {/* Platform-wide metering has no endpoint (`GET /api/billing/usage`
                is scoped to the caller's own tenant). The prototype's constants
                are gone rather than presented as capacity figures. */}
            <span style={emptyNote}>Platform-wide metered usage is not available — there is no cross-tenant usage endpoint. Per-tenant usage is on each tenant&rsquo;s record page.</span>
          </div>
        </div>
      ) : null}

      {ptSecurity ? (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
          <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Security posture</div>
            <span style={{ fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.5 }}>
              Controls marked <strong>Not implemented</strong> have no enforcement anywhere in the
              product. Nothing you can change here restricts access.
            </span>
            {securityRows.length ? securityRows.map(r => (
              <div key={r.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', padding:'10px 11px', border:'1px solid hsl(var(--color-border-hairline))', borderRadius:'11px', background:'hsl(var(--color-bg-subtle))' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                  <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{r.label}</span>
                  <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>{r.meta}</span>
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
            <div style={{ background:'hsl(var(--color-bg-panel-dark))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
              <div style={{ fontSize:'.6875rem', letterSpacing:'.08em', color:TEXT_MUTED_ON_DARK, fontFamily:'var(--font-sans)' }}>PLATFORM AUDIT STREAM</div>
              {auditRows.length ? auditRows.map(a => (
                <div key={a.key} style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
                  <span style={a.dot}></span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={{ fontSize:'.78125rem', color:'hsl(var(--color-fg-on-solid))', fontWeight:500 }}>{a.label}</span>
                    <span style={{ fontSize:'.65625rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)', wordBreak:'break-all' }}>{a.meta}</span>
                  </div>
                </div>
              )) : (<span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.6 }}>No administrative actions recorded yet.</span>)}
            </div>
            <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
              <div style={railHead}>Compliance certifications</div>
              {certs.length ? certs.map(c => (
                <div key={c.id} style={{ display:'flex', flexDirection:'column', gap:'7px', padding:'10px 11px', border:'1px solid hsl(var(--color-border-hairline))', borderRadius:'11px', background:'hsl(var(--color-bg-subtle))' }}>
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
                    <span style={c.style}>{c.label}</span>
                    <button type="button" style={ghostBtn} onClick={() => {
                      setCertError('');
                      setCertEdit(certEdit === c.id ? null : c.id);
                      setCertForm({ status: c.status, auditor: c.auditor, assessedOn: c.assessedOn, expiresOn: c.expiresOn, evidenceUrl: c.evidenceUrl, notes: c.notes });
                    }}>{certEdit === c.id ? 'Cancel' : 'Edit'}</button>
                  </div>
                  <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)', lineHeight:1.5 }}>{c.evidence}</span>
                  {c.evidenceUrl ? (
                    <a href={c.evidenceUrl} target="_blank" rel="noreferrer noopener" style={{ fontSize:'.6875rem', color:A, wordBreak:'break-all' }}>{c.evidenceUrl}</a>
                  ) : null}
                  {certEdit === c.id ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:'7px', paddingTop:'3px' }}>
                      <select value={certForm.status} aria-label={c.name + ' status'} style={selectStyle}
                        onChange={e => setCertForm({ ...certForm, status: e.target.value })}>
                        <option value="not_assessed">Not assessed</option>
                        <option value="in_process">In process</option>
                        <option value="certified">Certified</option>
                      </select>
                      <input value={certForm.auditor} placeholder="Auditor (firm that issued it)" aria-label={c.name + ' auditor'} style={inputStyle}
                        onChange={e => setCertForm({ ...certForm, auditor: e.target.value })} />
                      <div style={{ display:'flex', gap:'7px' }}>
                        <input type="date" value={certForm.assessedOn} aria-label={c.name + ' assessed on'} style={{ ...inputStyle, flex:1 }}
                          onChange={e => setCertForm({ ...certForm, assessedOn: e.target.value })} />
                        <input type="date" value={certForm.expiresOn} aria-label={c.name + ' expires on'} style={{ ...inputStyle, flex:1 }}
                          onChange={e => setCertForm({ ...certForm, expiresOn: e.target.value })} />
                      </div>
                      <input value={certForm.evidenceUrl} placeholder="https://… link to the report" aria-label={c.name + ' evidence URL'} style={inputStyle}
                        onChange={e => setCertForm({ ...certForm, evidenceUrl: e.target.value })} />
                      <input value={certForm.notes} placeholder="Notes (scope, exceptions)" aria-label={c.name + ' notes'} style={inputStyle}
                        onChange={e => setCertForm({ ...certForm, notes: e.target.value })} />
                      {certError ? (<span role="alert" style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-danger))', lineHeight:1.5 }}>{certError}</span>) : null}
                      <button type="button" disabled={certBusy} style={btn(A, 'hsl(var(--color-fg-on-solid))', A)} onClick={saveCert}>
                        {certBusy ? 'Saving…' : 'Save record'}
                      </button>
                      <span style={{ fontSize:'.65625rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.5 }}>
                        Recording <strong>Certified</strong> requires the auditor, the assessment date and a link to the report.
                      </span>
                    </div>
                  ) : null}
                </div>
              )) : (<span style={emptyNote}>No certifications recorded.</span>)}
              <span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.5 }}>{complianceNote}</span>
            </div>
          </div>
        </div>
      ) : null}

      {dialog ? (
        <div role="dialog" aria-modal="true" aria-label={dialog.kind === 'suspend' ? 'Suspend tenant' : 'Start impersonation'}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,.42)', display:'grid', placeItems:'center', padding:'22px', zIndex:60 }}>
          <div style={{ background:'hsl(var(--color-bg-surface))', border:'1px solid hsl(var(--color-border-subtle))', borderRadius:'16px', padding:'18px', width:'min(460px, 100%)', display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <span style={{ fontSize:'.9375rem', fontWeight:700, letterSpacing:'-.2px' }}>
                {dialog.kind === 'suspend' ? 'Suspend ' + dialog.tenant.name : 'Impersonate ' + dialog.tenant.name}
              </span>
              <span style={{ fontSize:'.71875rem', color:'hsl(var(--color-fg-muted))', lineHeight:1.5 }}>
                {dialog.kind === 'suspend'
                  ? 'All envelopes freeze immediately. The reason is stored on the tenant and written to the platform audit stream.'
                  : 'You will be signed in as the tenant owner until the session expires or you end it. The justification and the session are recorded before the token exists.'}
              </span>
            </div>
            <label style={{ display:'flex', flexDirection:'column', gap:'5px', fontSize:'.6875rem', letterSpacing:'.04em', textTransform:'uppercase', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>
              {dialog.kind === 'suspend' ? 'Reason (min 3 characters)' : 'Justification (min 5 characters)'}
              <input value={reason} onChange={e => setReason(e.target.value)} autoFocus
                placeholder={dialog.kind === 'suspend' ? 'non-payment · dunning step 4' : 'INC-4471 · signer cannot complete envelope'}
                style={inputStyle} />
            </label>
            {dialog.kind === 'impersonate' ? (
              <>
                <label style={{ display:'flex', flexDirection:'column', gap:'5px', fontSize:'.6875rem', letterSpacing:'.04em', textTransform:'uppercase', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>
                  Session lifetime
                  <select value={ttl} onChange={e => setTtl(e.target.value)} style={Object.assign({}, inputStyle, { width:'100%' })}>
                    <option value="300">5 minutes</option>
                    <option value="900">15 minutes</option>
                    <option value="1800">30 minutes</option>
                    <option value="3600">1 hour</option>
                  </select>
                </label>
                {/* Without this the session was always read-only, so every
                    action taken to fix the customer's problem came back 403. */}
                <label style={{ display:'flex', flexDirection:'column', gap:'5px', fontSize:'.6875rem', letterSpacing:'.04em', textTransform:'uppercase', color:'hsl(var(--color-fg-muted))', fontFamily:'var(--font-sans)' }}>
                  Access
                  <select value={scope} onChange={e => setScope(e.target.value)} style={Object.assign({}, inputStyle, { width:'100%' })}>
                    <option value="read">Read only — look, change nothing</option>
                    <option value="write">Read and write — act on the tenant&rsquo;s behalf</option>
                  </select>
                </label>
                <span style={{ fontSize:'.6875rem', color:'hsl(var(--color-fg-warning))', lineHeight:1.5 }}>
                  Everything you do is attributed to you in the tenant&rsquo;s audit trail, not to {dialog.tenant.owner || 'the owner'}.
                </span>
              </>
            ) : null}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'8px' }}>
              <button type="button" onClick={closeDialog} style={ghostBtn}><Icon name="close" size={13} />Cancel</button>
              <button type="button" disabled={busy}
                onClick={dialog.kind === 'suspend' ? submitSuspend : submitImpersonation}
                style={dialog.kind === 'suspend' ? btn('hsl(var(--color-bg-danger-solid))', 'hsl(var(--color-fg-on-solid))', 'hsl(var(--color-fg-danger))') : btn(A, 'hsl(var(--color-fg-on-solid))', A)}>
                <Icon name={dialog.kind === 'suspend' ? 'pause' : 'eye'} size={13} />{busy ? 'Working…' : dialog.kind === 'suspend' ? 'Suspend tenant' : 'Start session'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
