'use client';
/* SignForge — Developer API screen. Ported verbatim from the prototype (template 1562–1756). */
import React from 'react';
import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { API_DEFS, API_STATS_META, API_TABS, EMBED_SNIPPET } from '@/lib/sf/data';
import { btn, inputStyle, jsonBoxStyle, lbl, pill, railHead, TONE_BAD, TONE_GOOD, TONE_WARN } from '@/lib/sf/ui';

export default function ApiScreen() {
  const { s, set, flash, accent } = useSF();
  const A = accent();

  const ghostBtn: CSSProperties = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn: CSSProperties = btn(A, '#fff', A);
  const superBtn: CSSProperties = Object.assign(btn('transparent', '#e2e8f0', '#334155'), { flex: '0 0 auto' });
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontSize: '11.5px' });

  const addonBannerStyle: CSSProperties = { background:'#0f172a', borderRadius:'14px', padding:'16px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px', flexWrap:'wrap' };

  const launchEmbed = () => {
    const picked = s.contacts.slice(0, 2);
    set({
      embedSession: { id:'es_7d10c2e4', host:'HostCRM', title:'Master Services Agreement — Acme Corp',
        externalId:'hostcrm:deal_8842', contacts: picked.map(c => c.name) },
      screen: 'builder',
      recipients: picked.map((c, i) => ({ id:'r' + (i + 1), name:c.name, email:c.email, role:c.role, color:c.color, order:i + 1, status:'Pending' }))
    });
    flash('Embed session es_7d10c2e4 opened · document and 2 contacts injected');
  };

  const apiStats = API_STATS_META.map(x => ({
    label: x.label,
    value: x.label === 'ACTIVE KEYS' ? String(s.apiKeys.filter(k => !k.revoked).length) : (x.value as string),
    meta: x.meta,
    metaStyle: { fontSize:'11px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color: x.good ? '#047857' : '#c2410c' } as CSSProperties
  }));

  const apiSectionTabs = ([['overview','Overview'],['apps','Apps & keys'],['endpoints','Endpoints'],['webhooks','Webhooks'],['usage','Plan usage'],['resources','Developer tools']] as [string, string][]).map(([id, label]) => {
    const on = s.apiSection === id;
    return { id, label, selected: on ? 'true' : 'false', onClick: () => set({ apiSection: id }),
      style: { height:'28px', padding:'0 11px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });

  const apiOverview = s.apiSection === 'overview';
  const apiApps = s.apiSection === 'apps';
  const apiWebhooksView = s.apiSection === 'webhooks';
  const apiUsageView = s.apiSection === 'usage';
  const apiResourcesView = s.apiSection === 'resources';

  const apiEndpointsGridStyle: CSSProperties = { display: s.apiSection === 'endpoints' ? 'grid' : 'none', gridTemplateColumns:'minmax(0,1.35fr) minmax(0,1fr)', gap:'16px', alignItems:'start' };

  const oauthApps = ([
    ['HostCRM production', 'client_9f2b7c41 · redirect https://app.hostcrm.com/oauth/callback', 'live'],
    ['HostCRM sandbox', 'client_41ab8f2c · redirect https://staging.hostcrm.com/oauth/callback', 'test'],
    ['Internal ops bot', 'client_7d10c2e4 · client-credentials grant', 'live']
  ] as [string, string, string][]).map(([label, meta, mode]) => ({ label, meta,
    pill: pill(mode === 'live' ? TONE_GOOD : TONE_WARN),
    pillLabel: mode.toUpperCase(),
    onManage: () => flash(label + ' settings opened') }));

  const webhookEndpoints = ([
    ['https://hooks.acme.io/signforge', '6 events · 99.9% delivered', true],
    ['https://app.hostcrm.com/webhooks/sf', '12 events · 99.8% delivered', true],
    ['https://halden.de/hooks/sf', '3 events · failing (502)', false]
  ] as [string, string, boolean][]).map(([url, meta, ok]) => ({ url, meta,
    pill: pill(ok ? TONE_GOOD : TONE_BAD),
    pillLabel: ok ? 'Healthy' : 'Failing',
    onTest: () => flash('Test event sent to ' + url),
    onEdit: () => flash('Endpoint editor — ' + url) }));

  const addWebhook = () => flash('New endpoint — subscribe to events and save');

  const planUsage = ([
    ['API requests', '4.1M of 10M', 41], ['Envelopes', '18,430 of 25,000', 74],
    ['Embed sessions', '642 of 2,000', 32], ['Webhook deliveries', '96k of 250k', 38],
    ['Storage', '1.16 TB of 2 TB', 58]
  ] as [string, string, number][]).map(([label, meta, pct]) => ({ label, meta,
    bar: { width: pct + '%', height:'100%', borderRadius:'99px', background: pct > 85 ? '#f59e0b' : A } as CSSProperties }));

  const devResources = ([
    ['Quickstart guide', 'Send your first envelope in 10 minutes', 'quickstart'],
    ['API reference', 'Full REST reference with schemas', 'reference'],
    ['API sandbox', 'Compose a call and inspect the live response', 'sandbox'],
    ['Embedding guide', 'Run the builder inside your own app', 'embed'],
    ['Webhooks', 'Signature verification and retry schedule', 'webhooks'],
    ['SDKs & sample apps', 'TypeScript, Python, PHP, Go, Java', 'sdks'],
    ['Migration guide', 'Move templates, contacts and archives', 'migration']
  ] as [string, string, string][]).map(([label, meta, target]) => ({ label, meta,
    onClick: () => { if (target === 'sandbox') set({ screen: 'sandbox' }); else set({ screen: 'guides', docsPage: target }); },
    style: { display:'flex', flexDirection:'column', gap:'4px', alignItems:'flex-start', textAlign:'left', padding:'13px', borderRadius:'12px',
      border:'1px solid #e3e7ee', background:'#fbfcfd', cursor:'pointer' } as CSSProperties }));

  const apiTabs = API_TABS.map(([id, label]) => {
    const on = s.apiTab === id;
    return { id, label, selected: on ? 'true' : 'false', onClick: () => set({ apiTab: id }),
      style: { height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });

  const ep = API_DEFS[s.apiTab];
  const apiMethodStyle: CSSProperties = { padding:'4px 9px', borderRadius:'7px', fontSize:'10.5px', fontWeight:700, fontFamily:"'Inter', 'Google Sans Flex', sans-serif",
    background: ep.method === 'GET' ? '#ecfdf5' : '#eef2ff', color: ep.method === 'GET' ? '#047857' : '#3730a3',
    border:'1px solid ' + (ep.method === 'GET' ? '#a7f3d0' : '#c7d2fe'), flex:'0 0 auto' };
  const apiParams = ep.params.map(([name, type, desc]) => ({ name, type, desc,
    typeStyle: { fontSize:'10.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#94a3b8', width:'66px', flex:'0 0 66px' } as CSSProperties }));
  const copyEndpoint = () => flash('https://api.signforge.com' + ep.path + ' copied');

  const createKey = () => {
    const n = s.apiKeys.length + 1;
    const key = { id:'k' + n, label:'Add-on key ' + n, mode:'test', secret:'sk_test_' + n + 'f4b••••••••••••••ae21',
      full:'sk_test_' + n + 'f4b7c19d2e5a83b6041cc77bd90ae21', created:'28 Aug 2026', lastUsed:'never', revoked:false, revealed:true };
    set(st => ({ apiKeys: st.apiKeys.concat([key]) }));
    flash('Key created · copy it now, the full value is shown once');
  };

  const apiKeys = s.apiKeys.map(k => ({
    id: k.id,
    label: k.label, mode: k.mode === 'live' ? 'LIVE' : 'TEST',
    secret: k.revoked ? 'revoked' : (k.revealed ? k.full : k.secret),
    meta: 'created ' + k.created + ' · last used ' + k.lastUsed,
    modePill: pill(k.mode === 'live' ? TONE_GOOD : TONE_WARN),
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background: k.revoked ? '#fafbfc' : '#fbfcfd', opacity: k.revoked ? .6 : 1, flexWrap:'wrap' } as CSSProperties,
    revealLabel: k.revealed ? 'Hide' : 'Reveal',
    onReveal: () => set(st => ({ apiKeys: st.apiKeys.map(x => x.id === k.id ? Object.assign({}, x, { revealed: !x.revealed }) : x) })),
    revokeLabel: k.revoked ? 'Restore' : 'Revoke',
    revokeStyle: k.revoked ? btn('#fff', '#047857', '#a7f3d0') : btn('#fff', '#b91c1c', '#fecaca'),
    onRevoke: () => { set(st => ({ apiKeys: st.apiKeys.map(x => x.id === k.id ? Object.assign({}, x, { revoked: !x.revoked, revealed: false }) : x) })); flash(k.label + (k.revoked ? ' restored' : ' revoked — requests will 401 within 30s')); }
  }));

  const scopeChips = Object.keys(s.scopes).map(name => {
    const on = s.scopes[name];
    return { label: name, selected: on ? 'true' : 'false',
      onClick: () => { set(st => ({ scopes: Object.assign({}, st.scopes, { [name]: !on }) })); flash(name + (on ? ' removed from the add-on' : ' granted to the add-on')); },
      style: { padding:'5px 10px', borderRadius:'99px', cursor:'pointer', fontSize:'11px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif",
        border:'1px solid ' + (on ? '#a7f3d0' : '#e3e7ee'), background: on ? '#ecfdf5' : '#fbfcfd', color: on ? '#047857' : '#94a3b8' } as CSSProperties };
  });

  const embedSnippet = EMBED_SNIPPET;

  return (
    <section data-screen-label="Developer API" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>

      <div style={addonBannerStyle}>
        <div style={{ display:'flex', flexDirection:'column', gap:'5px', minWidth:0 }}>
          <span style={{ fontSize:'14px', fontWeight:700, letterSpacing:'-.2px', color:'#f8fafc' }}>SignForge as an add-on</span>
          <span style={{ fontSize:'12px', color:'#94a3b8', lineHeight:1.6, maxWidth:'620px' }}>Expose users, contacts and documents to your host application over REST, then launch the preparation surface in place with an embed session that carries document and contact metadata.</span>
        </div>
        <div style={{ display:'flex', gap:'8px', flex:'0 0 auto' }}>
          <button type="button" onClick={launchEmbed} style={superBtn}>Launch embedded builder</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:'12px' }}>
        {apiStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'6px' }}>
            <span style={{ fontSize:'10.5px', letterSpacing:'.06em', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{st.label}</span>
            <span style={{ fontSize:'22px', fontWeight:700, letterSpacing:'-.7px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      <div role="tablist" aria-label="Developer sections" style={{ display:'flex', gap:'4px', background:'#eceff4', padding:'4px', borderRadius:'11px', alignSelf:'flex-start', flexWrap:'wrap' }}>
        {apiSectionTabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={t.selected === 'true'} onClick={t.onClick} style={t.style}>{t.label}</button>
        ))}
      </div>

      {apiOverview ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'12px' }}>
          {devResources.map(r => (
            <button key={r.label} type="button" onClick={r.onClick} style={r.style}>
              <span style={{ fontSize:'13px', fontWeight:600, color:'#0f172a' }}>{r.label}</span>
              <span style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.5 }}>{r.meta}</span>
            </button>
          ))}
        </div>
      ) : null}

      {apiApps ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>OAuth applications</div>
            <button type="button" onClick={createKey} style={ghostBtn}>Create app</button>
          </div>
          {oauthApps.map(a => (
            <div key={a.label} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd', flexWrap:'wrap' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0, flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ fontSize:'12.5px', fontWeight:600 }}>{a.label}</span>
                  <span style={a.pill}>{a.pillLabel}</span>
                </div>
                <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", wordBreak:'break-all' }}>{a.meta}</span>
              </div>
              <button type="button" onClick={a.onManage} style={ghostBtn}>Manage</button>
            </div>
          ))}
        </div>
      ) : null}

      {apiWebhooksView ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>Webhook endpoints</div>
            <button type="button" onClick={addWebhook} style={primaryBtn}>Add endpoint</button>
          </div>
          {webhookEndpoints.map(w => (
            <div key={w.url} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd', flexWrap:'wrap' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0, flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'12px', fontWeight:600, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", wordBreak:'break-all' }}>{w.url}</span>
                  <span style={w.pill}>{w.pillLabel}</span>
                </div>
                <span style={{ fontSize:'11px', color:'#64748b' }}>{w.meta}</span>
              </div>
              <div style={{ display:'flex', gap:'6px' }}>
                <button type="button" onClick={w.onTest} style={ghostBtn}>Send test</button>
                <button type="button" onClick={w.onEdit} style={ghostBtn}>Edit</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {apiUsageView ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Plan usage · current cycle</div>
          {planUsage.map(u => (
            <div key={u.label} style={{ display:'flex', alignItems:'center', gap:'12px' }}>
              <span style={{ width:'160px', fontSize:'12.5px', color:'#334155', flex:'0 0 160px' }}>{u.label}</span>
              <div style={{ flex:1, height:'7px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={u.bar}></div></div>
              <span style={{ width:'150px', textAlign:'right', fontSize:'11.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", flex:'0 0 150px' }}>{u.meta}</span>
            </div>
          ))}
        </div>
      ) : null}

      {apiResourcesView ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'12px' }}>
          {devResources.map(r => (
            <button key={r.label} type="button" onClick={r.onClick} style={r.style}>
              <span style={{ fontSize:'13px', fontWeight:600, color:'#0f172a' }}>{r.label} ↗</span>
              <span style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.5 }}>{r.meta}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div style={apiEndpointsGridStyle}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
          <div style={{ padding:'12px 15px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
            <div style={railHead}>Endpoints</div>
            <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px', flexWrap:'wrap' }}>
              {apiTabs.map(t => (
                <button key={t.id} type="button" onClick={t.onClick} aria-pressed={t.selected === 'true'} style={t.style}>{t.label}</button>
              ))}
            </div>
          </div>
          <div style={{ padding:'15px', display:'flex', flexDirection:'column', gap:'12px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'9px', flexWrap:'wrap' }}>
              <span style={apiMethodStyle}>{ep.method}</span>
              <span style={{ fontSize:'12.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#0f172a', wordBreak:'break-all' }}>{ep.path}</span>
              <button type="button" onClick={copyEndpoint} style={ghostBtn}>Copy</button>
            </div>
            <span style={{ fontSize:'12px', color:'#475569', lineHeight:1.6 }}>{ep.desc}</span>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              <span style={railHead}>Parameters</span>
              {apiParams.map(p => (
                <div key={p.name} style={{ display:'flex', gap:'10px', alignItems:'flex-start', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
                  <span style={{ fontSize:'11.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#0f172a', width:'118px', flex:'0 0 118px' }}>{p.name}</span>
                  <span style={p.typeStyle}>{p.type}</span>
                  <span style={{ fontSize:'11.5px', color:'#64748b', lineHeight:1.5, flex:1, minWidth:0 }}>{p.desc}</span>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={railHead}>Response · 200</span>
                <span style={{ fontSize:'10.5px', color:'#94a3b8' }}>application/json</span>
              </div>
              <pre style={jsonBoxStyle}>{ep.sample}</pre>
            </div>
          </div>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
              <div style={railHead}>API keys</div>
              <button type="button" onClick={createKey} style={ghostBtn}>Create key</button>
            </div>
            {apiKeys.map(k => (
              <div key={k.id} style={k.rowStyle}>
                <div style={{ display:'flex', flexDirection:'column', gap:'3px', flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'7px', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'12.5px', fontWeight:600 }}>{k.label}</span>
                    <span style={k.modePill}>{k.mode}</span>
                  </div>
                  <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", wordBreak:'break-all' }}>{k.secret}</span>
                  <span style={{ fontSize:'10.5px', color:'#94a3b8' }}>{k.meta}</span>
                </div>
                <div style={{ display:'flex', gap:'5px', flex:'0 0 auto' }}>
                  <button type="button" onClick={k.onReveal} style={ghostBtn}>{k.revealLabel}</button>
                  <button type="button" onClick={k.onRevoke} style={k.revokeStyle}>{k.revokeLabel}</button>
                </div>
              </div>
            ))}
          </div>

          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Embed snippet</div>
            <pre style={jsonBoxStyle}>{embedSnippet}</pre>
            <label style={lbl}>Allowed origins
              <input type="text" value={s.embedOrigins} onChange={(e) => set({ embedOrigins: e.target.value })} style={mono} />
            </label>
            <label style={lbl}>Return URL
              <input type="text" value={s.embedReturnUrl} onChange={(e) => set({ embedReturnUrl: e.target.value })} style={mono} />
            </label>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              <span style={railHead}>Scopes granted to the add-on</span>
              <div style={{ display:'flex', flexWrap:'wrap', gap:'6px' }}>
                {scopeChips.map(c => (
                  <button key={c.label} type="button" onClick={c.onClick} aria-pressed={c.selected === 'true'} style={c.style}>{c.label}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
