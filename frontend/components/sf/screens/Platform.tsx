'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import {
  TENANTS, PLATFORM_USERS, PERMS, PERM_COLUMNS, PLATFORM_TABS, ROLE_LABEL,
  FLAG_META, FLAG_ENV_TONE, PLAN_TONE, STATUS_TONE, PLANS, USAGE_ROWS,
  SEC_DEFS, PLATFORM_AUDIT, CERTIFICATIONS,
} from '@/lib/sf/data';
import { btn, pill, inputStyle, railHead } from '@/lib/sf/ui';

const th: CSSProperties = { padding:'10px 14px', fontSize:'11px', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
const thRight: CSSProperties = { padding:'10px 14px', fontSize:'11px', letterSpacing:'.06em', textTransform:'uppercase', fontWeight:500, textAlign:'right', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" };
const td: CSSProperties = { padding:'11px 14px', verticalAlign:'middle' };
const tdRight: CSSProperties = { padding:'11px 14px', textAlign:'right', verticalAlign:'middle' };

const superBannerStyle: CSSProperties = { background:'#0f172a', borderRadius:'14px', padding:'13px 15px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'14px' };
const superChip: CSSProperties = { padding:'4px 9px', borderRadius:'7px', background:'#f59e0b', color:'#3b1d00', fontSize:'10.5px', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", letterSpacing:'.06em', whiteSpace:'nowrap', flex:'0 0 auto' };
const superBtn: CSSProperties = Object.assign(btn('transparent', '#e2e8f0', '#334155'), { flex:'0 0 auto' });
const ghostBtn: CSSProperties = btn('#fff', '#475569', '#e3e7ee');

export default function Platform() {
  const { s, set, flash, accent, initials, tenantsFiltered, tenantStatus } = useSF();
  const A = accent();

  /* ── tenants ── */
  const tenants = tenantsFiltered().map((t, i) => {
    const st = tenantStatus(t), suspended = st === 'Suspended';
    const pct = Math.round(t.used / t.seats * 100);
    return {
      name: t.name, slug: t.slug, owner: t.owner, plan: t.plan, region: t.region, volume: t.volume, status: st,
      initials: initials(t.name),
      rowStyle: { borderTop: i ? '1px solid #eef1f6' : 'none', opacity: suspended ? .62 : 1 } as CSSProperties,
      avatar: { width:'30px', height:'30px', borderRadius:'9px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'11px', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
      planPill: pill(PLAN_TONE[t.plan]),
      statusPill: pill(STATUS_TONE[st] || STATUS_TONE.Active),
      seatLabel: t.used.toLocaleString() + ' / ' + t.seats.toLocaleString(),
      seatBar: { width: pct + '%', height:'100%', borderRadius:'99px', background: pct > 92 ? '#f59e0b' : '#10b981' } as CSSProperties,
      onImpersonate: () => flash('Impersonation session opened for ' + t.name + ' · expires in 30 min · logged'),
      suspendLabel: suspended ? 'Reinstate' : 'Suspend',
      suspendStyle: suspended ? btn('#fff', '#047857', '#a7f3d0') : btn('#fff', '#b91c1c', '#fecaca'),
      onSuspend: () => {
        set(st2 => ({ tenantOverrides: Object.assign({}, st2.tenantOverrides, { [t.slug]: suspended ? 'Active' : 'Suspended' }) }));
        flash(t.name + (suspended ? ' reinstated' : ' suspended — all envelopes frozen'));
      },
    };
  });

  const totalSeats = TENANTS.reduce((a, t) => a + t.seats, 0);
  const mrr = TENANTS.reduce((a, t) => a + t.mrr, 0);

  const platformStats = [
    { label:'TENANTS', value:String(TENANTS.length), meta:'2 in trial · 1 suspended', good:true },
    { label:'SEATS PROVISIONED', value:totalSeats.toLocaleString(), meta:'88% activated', good:true },
    { label:'ENVELOPES · 30D', value:'38.9k', meta:'+12.4% vs prior', good:true },
    { label:'MRR', value:'$' + (mrr / 1000).toFixed(1) + 'k', meta:'net retention 118%', good:true },
    { label:'INCIDENTS · 90D', value:'0', meta:'99.99% signing uptime', good:true },
  ].map(x => ({ label:x.label, value:x.value, meta:x.meta,
    metaStyle: { fontSize:'11px', color: x.good ? '#047857' : '#c2410c', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties }));

  const platformTabs = PLATFORM_TABS.map(([id, label]) => {
    const on = s.platformTab === id;
    return { id, label, selected: on ? 'true' : 'false', onClick: () => set({ platformTab: id }),
      style: { height:'30px', padding:'0 13px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'12.5px', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });

  /* ── directory ── */
  const platformUsers = PLATFORM_USERS.map((u, i) => {
    const role = s.userRoles[u.email] || u.role;
    const mfaOk = u.mfa !== 'None';
    return {
      name: u.name, email: u.email, tenant: u.tenant, role, mfa: u.mfa, lastActive: u.last, initials: initials(u.name),
      rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px 15px', borderTop: i ? '1px solid #eef1f6' : 'none' } as CSSProperties,
      avatar: { width:'30px', height:'30px', borderRadius:'99px', background: role === 'super' ? '#0f172a' : '#e3e7ee', color: role === 'super' ? '#f8fafc' : '#475569', display:'grid', placeItems:'center', fontSize:'11px', fontWeight:700, flex:'0 0 30px' } as CSSProperties,
      selectStyle: Object.assign({}, inputStyle, { width:'138px' }) as CSSProperties,
      mfaPill: pill(mfaOk ? { bg:'#ecfdf5', fg:'#047857', bd:'#a7f3d0' } : { bg:'#fef2f2', fg:'#b91c1c', bd:'#fecaca' }),
      onRole: (e: React.ChangeEvent<HTMLSelectElement>) => {
        const v = e.target.value;
        set(st => ({ userRoles: Object.assign({}, st.userRoles, { [u.email]: v }) }));
        flash(u.name + ' → ' + ROLE_LABEL[v] + ' · change logged');
      },
    };
  });

  const permRows = PERMS.map(([label, cells]) => ({
    label,
    cells: cells.map((c, i) => ({
      mark: c ? '✓' : '–', title: PERM_COLUMNS[i] + (c ? ': allowed' : ': denied'),
      style: { width:'26px', height:'22px', borderRadius:'6px', display:'grid', placeItems:'center', fontSize:'11px', fontWeight:700,
        background: c ? '#ecfdf5' : '#f5f6f8', color: c ? '#047857' : '#cbd5e1', border:'1px solid ' + (c ? '#a7f3d0' : '#e3e7ee') } as CSSProperties,
    })),
  }));

  /* ── flags ── */
  const flags = Object.keys(s.flagState).map((key, i) => {
    const f = s.flagState[key], m = FLAG_META[key];
    const envTone = FLAG_ENV_TONE[m[0]];
    return {
      key, env: m[0], desc: m[1], rollout: String(f.rollout), rolloutLabel: f.rollout + '%',
      onStr: f.on ? 'true' : 'false', aria: 'Toggle ' + key,
      envPill: pill(envTone),
      rowStyle: { display:'flex', alignItems:'center', gap:'14px', padding:'11px', borderTop: i ? '1px solid #f2f4f8' : 'none' } as CSSProperties,
      switch: { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: f.on ? '#10b981' : '#cbd5e1', position:'relative', flex:'0 0 38px' } as CSSProperties,
      knob: { position:'absolute', top:'3px', left: f.on ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' } as CSSProperties,
      onToggle: () => { set(st => ({ flagState: Object.assign({}, st.flagState, { [key]: { on: !f.on, rollout: f.rollout } }) })); flash(key + ' → ' + (f.on ? 'off' : 'on')); },
      onRollout: (e: React.ChangeEvent<HTMLInputElement>) => { const v = parseInt(e.target.value, 10); set(st => ({ flagState: Object.assign({}, st.flagState, { [key]: { on: f.on, rollout: v } }) })); },
    };
  });

  /* ── plans & usage ── */
  const plans = PLANS.map(p => {
    const list = TENANTS.filter(t => t.plan === p.name);
    return { name:p.name, price:p.price, tag:p.tag, lines:p.lines,
      tenantsLabel: list.length + (list.length === 1 ? ' tenant' : ' tenants'),
      mrr: '$' + (list.reduce((a, t) => a + t.mrr, 0) / 1000).toFixed(1) + 'k',
      tagStyle: pill(p.tone),
      cardStyle: { background:'#fff', border:'1px solid ' + (p.name === 'Enterprise' ? '#c7d2fe' : '#e3e7ee'), borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' } as CSSProperties };
  });

  const usageRows = USAGE_ROWS.map(u => ({ label:u.label, value:u.value,
    bar: { width: u.pct + '%', height:'100%', borderRadius:'99px', background: u.pct > 85 ? '#f59e0b' : A } as CSSProperties }));

  /* ── security ── */
  const securityRows = SEC_DEFS.map(([key, label, meta]) => {
    const on = s.security[key];
    return { key, label, meta, onStr: on ? 'true' : 'false',
      switch: { width:'38px', height:'21px', borderRadius:'99px', border:'none', cursor:'pointer', background: on ? '#10b981' : '#cbd5e1', position:'relative', flex:'0 0 38px' } as CSSProperties,
      knob: { position:'absolute', top:'3px', left: on ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff', transition:'left .15s' } as CSSProperties,
      onToggle: () => { set(st => ({ security: Object.assign({}, st.security, { [key]: !on }) })); flash(label + ' → ' + (on ? 'disabled' : 'enabled')); } };
  });

  const platformAudit = PLATFORM_AUDIT.map(([label, meta], i) => ({ label, meta,
    dot: { width:'8px', height:'8px', borderRadius:'99px', marginTop:'5px', flex:'0 0 8px', background: i === 0 ? '#f59e0b' : '#334155' } as CSSProperties }));

  const certs = CERTIFICATIONS.map(label => ({ label,
    style: { padding:'5px 10px', borderRadius:'99px', border:'1px solid #e3e7ee', background:'#fbfcfd', fontSize:'11.5px', color:'#475569', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" } as CSSProperties }));

  const ptTenants = s.platformTab === 'tenants';
  const ptUsers = s.platformTab === 'users';
  const ptFlags = s.platformTab === 'flags';
  const ptBilling = s.platformTab === 'billing';
  const ptSecurity = s.platformTab === 'security';

  const stepUp = () => flash('Step-up MFA satisfied · elevated session valid 15 min');

  return (
    <section data-screen-label="Platform admin" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>

      <div style={superBannerStyle}>
        <div style={{ display:'flex', alignItems:'center', gap:'11px', minWidth:0 }}>
          <span style={superChip}>SUPER ADMIN</span>
          <span style={{ fontSize:'12.5px', color:'#cbd5e1', lineHeight:1.5 }}>Global scope — {String(TENANTS.length)} tenants, {totalSeats.toLocaleString()} seats. Every action here is written to the platform audit stream and requires step-up MFA.</span>
        </div>
        <button type="button" onClick={stepUp} style={superBtn}>Re-authenticate</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, minmax(0,1fr))', gap:'12px' }}>
        {platformStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'7px' }}>
            <span style={{ fontSize:'10.5px', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{st.label}</span>
            <span style={{ fontSize:'24px', fontWeight:700, letterSpacing:'-.8px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Platform sections" style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'11px', alignSelf:'flex-start' }}>
        {platformTabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={t.selected === 'true'} onClick={t.onClick} style={t.style}>{t.label}</button>
        ))}
      </div>

      {ptTenants ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
          <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px' }}>
            <div style={railHead}>Tenants / organisations</div>
            <input type="search" value={s.tenantQuery} onChange={e => set({ tenantQuery: e.target.value })} placeholder="Filter by org, region, plan…" aria-label="Filter tenants" style={{ height:'32px', width:'240px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 11px', fontSize:'12.5px', outline:'none', background:'#fbfcfd' }} />
          </div>
          <div data-sf-scroll="1" style={{ overflowX:'auto', maxWidth:'100%' }}>
            <table style={{ width:'100%', minWidth:'920px', borderCollapse:'collapse', fontSize:'13px' }}>
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
                {tenants.map(t => (
                  <tr key={t.slug} style={t.rowStyle}>
                    <td style={td}>
                      <div style={{ display:'flex', alignItems:'center', gap:'11px' }}>
                        <span style={t.avatar}>{t.initials}</span>
                        <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                          <span style={{ fontSize:'13.5px', fontWeight:600 }}>{t.name}</span>
                          <span style={{ fontSize:'11px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{t.slug} · owner {t.owner}</span>
                        </div>
                      </div>
                    </td>
                    <td style={td}><span style={t.planPill}>{t.plan}</span></td>
                    <td style={td}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
                        <span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'12px' }}>{t.seatLabel}</span>
                        <div style={{ width:'78px', height:'4px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={t.seatBar}></div></div>
                      </div>
                    </td>
                    <td style={td}><span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'12px' }}>{t.volume}</span></td>
                    <td style={td}><span style={{ color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11.5px' }}>{t.region}</span></td>
                    <td style={td}><span style={t.statusPill}>{t.status}</span></td>
                    <td style={tdRight}>
                      <div style={{ display:'inline-flex', gap:'6px' }}>
                        <button type="button" onClick={t.onImpersonate} style={ghostBtn}>Impersonate</button>
                        <button type="button" onClick={t.onSuspend} style={t.suspendStyle}>{t.suspendLabel}</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {ptUsers ? (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1.7fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
            <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={railHead}>Directory · cross-tenant</div>
              <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>SCIM synced 4 min ago</span>
            </div>
            {platformUsers.map(u => (
              <div key={u.email} style={u.rowStyle} data-sf-userrow="1">
                <span style={u.avatar}>{u.initials}</span>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', flex:'1 1 180px', minWidth:'170px' }}>
                  <span style={{ fontSize:'13px', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.name}</span>
                  <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{u.email} · {u.tenant}</span>
                </div>
                <select value={u.role} onChange={u.onRole} aria-label="Role" style={u.selectStyle}>
                  <option value="super">Super admin</option>
                  <option value="orgadmin">Org admin</option>
                  <option value="sender">Sender</option>
                  <option value="viewer">Viewer</option>
                </select>
                <span style={u.mfaPill}>{u.mfa}</span>
                <span style={{ fontSize:'11px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", width:'82px', textAlign:'right' }}>{u.lastActive}</span>
              </div>
            ))}
          </div>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={railHead}>Role permission matrix</div>
            {permRows.map(p => (
              <div key={p.label} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', padding:'8px 0', borderBottom:'1px solid #f2f4f8' }}>
                <span style={{ fontSize:'12px', color:'#334155' }}>{p.label}</span>
                <div style={{ display:'flex', gap:'6px' }}>
                  {p.cells.map((c, ci) => (
                    <span key={ci} style={c.style} title={c.title}>{c.mark}</span>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display:'flex', justifyContent:'flex-end', gap:'6px', fontSize:'10px', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>SUP · ORG · SND · VIW</div>
          </div>
        </div>
      ) : null}

      {ptFlags ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <div style={railHead}>Feature flags &amp; rollout</div>
            <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>edge config · propagates in ~15s</span>
          </div>
          {flags.map(f => (
            <div key={f.key} style={f.rowStyle}>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'12.5px', fontWeight:600, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{f.key}</span>
                  <span style={f.envPill}>{f.env}</span>
                </div>
                <span style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.5 }}>{f.desc}</span>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
                <span style={{ fontSize:'11px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#475569', width:'64px', textAlign:'right' }}>{f.rolloutLabel}</span>
                <input type="range" min="0" max="100" step="5" value={f.rollout} onChange={f.onRollout} aria-label="Rollout percentage" style={{ width:'120px', accentColor:'#4f46e5' }} />
                <button type="button" role="switch" aria-checked={f.onStr === 'true'} aria-label={f.aria} onClick={f.onToggle} style={f.switch}><span style={f.knob}></span></button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {ptBilling ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'16px', alignItems:'start' }}>
          {plans.map(p => (
            <div key={p.name} style={p.cardStyle}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={{ fontSize:'14px', fontWeight:700, letterSpacing:'-.2px' }}>{p.name}</span>
                <span style={p.tagStyle}>{p.tag}</span>
              </div>
              <div style={{ display:'flex', alignItems:'baseline', gap:'5px' }}>
                <span style={{ fontSize:'26px', fontWeight:700, letterSpacing:'-1px' }}>{p.price}</span>
                <span style={{ fontSize:'12px', color:'#64748b' }}>/ seat / mo</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:'7px', borderTop:'1px solid #eef1f6', paddingTop:'11px' }}>
                {p.lines.map(l => (
                  <div key={l.k} style={{ display:'flex', justifyContent:'space-between', fontSize:'12px', gap:'10px' }}>
                    <span style={{ color:'#64748b' }}>{l.k}</span><span style={{ fontWeight:500, fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{l.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'11.5px', color:'#475569', borderTop:'1px solid #eef1f6', paddingTop:'11px' }}>
                <span>{p.tenantsLabel}</span><span style={{ fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontWeight:600 }}>{p.mrr} MRR</span>
              </div>
            </div>
          ))}
          <div style={{ gridColumn:'1 / -1', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Metered usage · current cycle</div>
            {usageRows.map(u => (
              <div key={u.label} style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                <span style={{ width:'170px', fontSize:'12.5px', color:'#334155' }}>{u.label}</span>
                <div style={{ flex:1, height:'7px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={u.bar}></div></div>
                <span style={{ width:'150px', textAlign:'right', fontSize:'11.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#475569' }}>{u.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {ptSecurity ? (
        <div style={{ display:'grid', gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Security posture</div>
            {securityRows.map(r => (
              <div key={r.key} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', padding:'10px 11px', border:'1px solid #eef1f6', borderRadius:'11px', background:'#fbfcfd' }}>
                <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                  <span style={{ fontSize:'12.5px', fontWeight:600 }}>{r.label}</span>
                  <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{r.meta}</span>
                </div>
                <button type="button" role="switch" aria-checked={r.onStr === 'true'} aria-label={r.label} onClick={r.onToggle} style={r.switch}><span style={r.knob}></span></button>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
            <div style={{ background:'#0f172a', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
              <div style={{ fontSize:'11px', letterSpacing:'.08em', color:'#94a3b8', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>PLATFORM AUDIT STREAM</div>
              {platformAudit.map(a => (
                <div key={a.meta} style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
                  <span style={a.dot}></span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                    <span style={{ fontSize:'12.5px', color:'#e2e8f0', fontWeight:500 }}>{a.label}</span>
                    <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", wordBreak:'break-all' }}>{a.meta}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
              <div style={railHead}>Compliance certifications</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'7px' }}>
                {certs.map(c => (<span key={c.label} style={c.style}>{c.label}</span>))}
              </div>
              <span style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.5 }}>Residency enforced per tenant. Key material is HSM-backed with 90-day rotation; document hashes are anchored hourly to an append-only ledger.</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
