'use client';
/* SignForge — Developer API screen. Markup ported verbatim from the prototype
   (template 1562–1756); the data now comes from the API. */
import React from 'react';
import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { API_DEFS, API_TABS, EMBED_SNIPPET } from '@/lib/sf/data';
import { btn, inputStyle, jsonBoxStyle, lbl, pill, railHead, TONE_BAD, TONE_GOOD, TONE_WARN } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { apiKeys as apiKeysApi, organizations as organizationsApi } from '@/lib/api/resources';
import {
  fromOriginsField, toApiKeyRows, toApiUsageTiles, toOriginsField, toScopeState,
  type ApiKeyRow, type StatTile
} from '@/lib/sf/adapters';
import type {
  ApiKeyResponse, ApiKeyScopeResponse, ApiKeyUsageResponse, ApiSettingsResponse, ContactResponse
} from '@/lib/api/types';

/**
 * `POST /api/embed/sessions` (`backend/app/schemas/embed.py#EmbedSessionResponse`).
 * `lib/api/resources.ts` has no embed group yet, so this screen calls the path
 * directly through the proxy; the response fields are mirrored here.
 */
type EmbedSessionResponse = {
  id: string;
  url: string;
  landing: string;
  document_id: string | null;
  external_id: string | null;
  return_url: string | null;
  expires_at: string;
};

export type ApiScreenProps = {
  /** `GET /api/api-keys` — masked keys only; the secret is never listed. */
  keys: ApiKeyResponse[];
  /** `GET /api/api-keys/scopes` — the grantable scope catalogue. */
  scopeCatalogue: ApiKeyScopeResponse[];
  /** `GET /api/api-keys/usage` — the four stat tiles. */
  usage: ApiKeyUsageResponse | null;
  /** `GET /api/organizations/me/api-settings` — embed origins / return URL. */
  apiSettings: ApiSettingsResponse | null;
  /** Contacts injected into a launched embed session. */
  embedContacts: ContactResponse[];
};

export default function ApiScreen({ keys, scopeCatalogue, usage, apiSettings, embedContacts }: ApiScreenProps) {
  const { s, set, flash, accent } = useSF();
  const { go } = useNav();
  const router = useRouter();
  const A = accent();

  const keyRows: ApiKeyRow[] = toApiKeyRows(keys);
  /* The scope panel edits one key's grants. The design has no key picker, so it
     targets the first live key — the one the embed snippet would be used with. */
  const scopeTarget = keyRows.find(k => !k.revoked) ?? null;
  const scopeState = toScopeState(scopeCatalogue, scopeTarget?.scopes ?? []);

  /**
   * The plaintext secret comes back from create/roll exactly once. It is held
   * only in this component's state for the one-time display, never written to
   * the SF store, never logged, and never sent anywhere but the clipboard.
   */
  const [freshSecret, setFreshSecret] = useState<{ keyId: string; label: string; secret: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [origins, setOrigins] = useState(toOriginsField(apiSettings));
  const [returnUrl, setReturnUrl] = useState(apiSettings?.default_return_url ?? '');
  useEffect(() => { setOrigins(toOriginsField(apiSettings)); }, [apiSettings]);
  useEffect(() => { setReturnUrl(apiSettings?.default_return_url ?? ''); }, [apiSettings]);

  const saveEmbedSettings = (patch: Partial<ApiSettingsResponse>) => {
    void organizationsApi.updateApiSettings(apiCall, patch).then(res => {
      if (!res.ok) { flash('Could not save the embed settings · ' + res.error.message); return; }
      router.refresh();
    });
  };

  const ghostBtn: CSSProperties = btn('#fff', '#475569', '#e3e7ee');
  const primaryBtn: CSSProperties = btn(A, '#fff', A);
  const superBtn: CSSProperties = Object.assign(btn('transparent', '#e2e8f0', '#334155'), { flex: '0 0 auto' });
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily: "'Inter', 'Google Sans Flex', sans-serif", fontSize: '11.5px' });

  const addonBannerStyle: CSSProperties = { background:'#0f172a', borderRadius:'14px', padding:'16px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'16px', flexWrap:'wrap' };

  const launchEmbed = () => {
    if (busy) return;
    const picked = embedContacts.slice(0, 2);
    setBusy(true);
    void apiCall<EmbedSessionResponse>('/api/embed/sessions', {
      method: 'POST',
      body: {
        landing: 'builder',
        contacts: picked.map(c => ({ id: c.id, name: c.name, email: c.email, role: c.default_role })),
        return_url: returnUrl || null,
      },
    }).then(res => {
      setBusy(false);
      if (!res.ok) { flash('Could not open an embed session · ' + res.error.message); return; }
      const session = res.data;
      set({
        embedSession: { id: session.id, host:'HostCRM', title: session.external_id || 'Embedded document',
          externalId: session.external_id || '', contacts: picked.map(c => c.name) },
        recipients: picked.map((c, i) => ({ id:'r' + (i + 1), name:c.name, email:c.email, role:c.default_role, color:c.color || '#6366f1', order:i + 1, status:'Pending' }))
      });
      go('builder');
      flash('Embed session ' + session.id + ' opened · document and ' + picked.length + ' contacts injected');
    });
  };

  const apiStats = toApiUsageTiles(usage).map((x: StatTile) => ({
    label: x.label,
    value: x.value,
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

  /* Awaiting an OAuth-application endpoint (no `/api/oauth/apps` exists yet). */
  const oauthApps = ([
    ['HostCRM production', 'client_9f2b7c41 · redirect https://app.hostcrm.com/oauth/callback', 'live'],
    ['HostCRM sandbox', 'client_41ab8f2c · redirect https://staging.hostcrm.com/oauth/callback', 'test'],
    ['Internal ops bot', 'client_7d10c2e4 · client-credentials grant', 'live']
  ] as [string, string, string][]).map(([label, meta, mode]) => ({ label, meta,
    pill: pill(mode === 'live' ? TONE_GOOD : TONE_WARN),
    pillLabel: mode.toUpperCase(),
    onManage: () => flash(label + ' settings opened') }));

  /* Awaiting webhook-endpoint CRUD; `/api/webhooks/event-types` is all there is. */
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

  /* Awaiting a per-quota shape on `/api/billing/usage` (it has no API-request,
     embed-session or webhook-delivery quotas yet). */
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
    onClick: () => { if (target === 'sandbox') go('sandbox'); else { set({ docsPage: target }); go('guides'); } },
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

  /* The one-time secret. It is shown once and never again: there is no reveal
     endpoint, so a listed key can only ever display its `masked` form. */
  const showOnce = (keyId: string, label: string, secret: string) => {
    setFreshSecret({ keyId, label, secret });
    flash(label + ' · copy it now, the full value is shown once');
  };

  const createKey = () => {
    if (busy) return;
    setBusy(true);
    const label = 'Add-on key ' + (keyRows.length + 1);
    void apiKeysApi.create(apiCall, { label, mode: 'test' }).then(res => {
      setBusy(false);
      if (!res.ok) { flash('Could not create the key · ' + res.error.message); return; }
      showOnce(res.data.id, res.data.label, res.data.secret);
      router.refresh();
    });
  };

  const rollKey = (row: ApiKeyRow) => {
    if (busy) return;
    setBusy(true);
    void apiKeysApi.roll(apiCall, row.id).then(res => {
      setBusy(false);
      if (!res.ok) { flash('Could not roll ' + row.label + ' · ' + res.error.message); return; }
      showOnce(res.data.id, res.data.label, res.data.secret);
      router.refresh();
    });
  };

  const toggleKey = (row: ApiKeyRow) => {
    if (busy) return;
    setBusy(true);
    const call = row.revoked ? apiKeysApi.restore(apiCall, row.id) : apiKeysApi.revoke(apiCall, row.id);
    void call.then(res => {
      setBusy(false);
      if (!res.ok) { flash('Could not update ' + row.label + ' · ' + res.error.message); return; }
      if (freshSecret && freshSecret.keyId === row.id) setFreshSecret(null);
      flash(row.label + (row.revoked ? ' restored' : ' revoked — requests will 401 within 30s'));
      router.refresh();
    });
  };

  /** The clipboard action the design already has — the only place the secret goes. */
  const copySecret = () => {
    if (!freshSecret) return;
    const value = freshSecret.secret;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value).then(
        () => flash('Secret copied · it will not be shown again'),
        () => flash('Could not reach the clipboard — select and copy it by hand'),
      );
      return;
    }
    flash('Clipboard unavailable — select and copy it by hand');
  };

  const apiKeys = keyRows.map(k => ({
    id: k.id,
    label: k.label, mode: k.mode === 'live' ? 'LIVE' : 'TEST',
    secret: k.revoked ? 'revoked' : (freshSecret && freshSecret.keyId === k.id ? freshSecret.secret : k.masked),
    meta: freshSecret && freshSecret.keyId === k.id && !k.revoked
      ? 'Copy this secret now — it will not be shown again'
      : 'created ' + k.created + ' · last used ' + k.lastUsed,
    modePill: pill(k.mode === 'live' ? TONE_GOOD : TONE_WARN),
    rowStyle: { display:'flex', alignItems:'center', gap:'11px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background: k.revoked ? '#fafbfc' : '#fbfcfd', opacity: k.revoked ? .6 : 1, flexWrap:'wrap' } as CSSProperties,
    /* No reveal endpoint exists: the choices are "copy the secret you were just
       handed" or "roll the key to be handed a new one". */
    revealLabel: freshSecret && freshSecret.keyId === k.id ? 'Copy' : 'Roll',
    onReveal: () => { if (freshSecret && freshSecret.keyId === k.id) copySecret(); else rollKey(k); },
    revokeLabel: k.revoked ? 'Restore' : 'Revoke',
    revokeStyle: k.revoked ? btn('#fff', '#047857', '#a7f3d0') : btn('#fff', '#b91c1c', '#fecaca'),
    onRevoke: () => toggleKey(k)
  }));

  const scopeChips = Object.keys(scopeState).map(name => {
    const on = scopeState[name];
    return { label: name, selected: on ? 'true' : 'false',
      onClick: () => {
        if (!scopeTarget) { flash('Create a key first — scopes are granted per key'); return; }
        const call = on
          ? apiKeysApi.revokeScopes(apiCall, scopeTarget.id, [name])
          : apiKeysApi.grantScopes(apiCall, scopeTarget.id, [name]);
        flash(name + (on ? ' removed from the add-on' : ' granted to the add-on'));
        void call.then(res => {
          if (!res.ok) { flash('Could not change ' + name + ' · ' + res.error.message); return; }
          router.refresh();
        });
      },
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
            {apiKeys.length === 0 ? (
              <div style={{ border:'1px dashed #cbd5e1', borderRadius:'12px', padding:'18px', textAlign:'center', fontSize:'12px', color:'#94a3b8', lineHeight:1.6 }}>No API keys yet. Create one to start calling the REST API.</div>
            ) : null}
          </div>

          <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
            <div style={railHead}>Embed snippet</div>
            <pre style={jsonBoxStyle}>{embedSnippet}</pre>
            <label style={lbl}>Allowed origins
              <input type="text" value={origins} onChange={(e) => setOrigins(e.target.value)} onBlur={() => saveEmbedSettings({ allowed_origins: fromOriginsField(origins) })} style={mono} />
            </label>
            <label style={lbl}>Return URL
              <input type="text" value={returnUrl} onChange={(e) => setReturnUrl(e.target.value)} onBlur={() => saveEmbedSettings({ default_return_url: returnUrl || null })} style={mono} />
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
