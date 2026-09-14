'use client';
/* SignerPro — Developer API screen. Markup ported verbatim from the prototype
   (template 1562–1756); the data now comes from the API. */
import React from 'react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { useNav } from '@/lib/sf/nav';
import { SECTION_PARAM, sectionFor } from '@/lib/sf/routes';
import { useDialogs } from '@/components/sf/DialogProvider';
import { API_DEFS, API_TABS, EMBED_SNIPPET } from '@/lib/sf/data';
import { btn, inputStyle, jsonBoxStyle, lbl, pill, railHead, TONE_GOOD, TONE_MUTED, TONE_WARN, TEXT_MUTED, TEXT_SUBTLE } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { apiKeys as apiKeysApi, billing as billingApi, organizations as organizationsApi, webhooks as webhooksApi } from '@/lib/api/resources';
import Icon from '@/components/sf/Icon';
import {
  fromOriginsField, toApiKeyRows, toApiUsageTiles, toOriginsField, toScopeState,
  type ApiKeyRow, type StatTile
} from '@/lib/sf/adapters';
import type {
  ApiKeyResponse, ApiKeyScopeResponse, ApiKeyUsageResponse, ApiSettingsResponse, ContactResponse,
  UsageRow, WebhookDeliveryResponse, WebhookDeliveryStatus, WebhookEndpointResponse,
  WebhookEventTypeResponse
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
  /* The sub-view is the URL, not client state. It used to be a store key
     driven from two controls at once — this screen's tab strip and the
     sidebar group above it — which could disagree and neither of which was
     linkable. The sidebar owns it now; the tab strip is gone. */
  const section = sectionFor('api', useSearchParams().get(SECTION_PARAM));
  const { askText, askConfirm } = useDialogs();

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

  const [webhookRows, setWebhookRows] = useState<WebhookEndpointResponse[] | null>(null);
  const [webhookSecret, setWebhookSecret] = useState<{ url: string; secret: string; rotated: boolean } | null>(null);
  const [usageRows, setUsageRows] = useState<UsageRow[] | null>(null);

  /** The endpoint whose delivery log and subscription are expanded, if any. */
  const [openEndpoint, setOpenEndpoint] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDeliveryResponse[] | null>(null);
  const [deliveryFilter, setDeliveryFilter] = useState<WebhookDeliveryStatus | 'all'>('all');
  const [eventCatalogue, setEventCatalogue] = useState<WebhookEventTypeResponse[]>([]);

  const loadWebhooks = useCallback(() => {
    void webhooksApi.list(apiCall).then(res => {
      setWebhookRows(res.ok ? res.data : []);
    });
  }, []);

  /** The delivery log for the expanded endpoint. Without it a failing endpoint
      is undebuggable from the UI: the backend records every attempt, its status
      code and its error, and none of it was reachable. */
  const loadDeliveries = useCallback((endpointId: string, filter: WebhookDeliveryStatus | 'all') => {
    setDeliveries(null);
    void webhooksApi.deliveries(apiCall, endpointId, {
      status: filter === 'all' ? undefined : filter,
      limit: 50,
    }).then(res => { setDeliveries(res.ok ? res.data : []); });
  }, []);

  useEffect(() => { loadWebhooks(); }, [loadWebhooks]);
  useEffect(() => {
    if (!openEndpoint) { setDeliveries(null); return; }
    loadDeliveries(openEndpoint, deliveryFilter);
  }, [openEndpoint, deliveryFilter, loadDeliveries]);
  useEffect(() => {
    void webhooksApi.eventTypes(apiCall).then(res => { if (res.ok) setEventCatalogue(res.data); });
  }, []);
  useEffect(() => {
    void billingApi.usage(apiCall).then(res => { setUsageRows(res.ok ? res.data.rows : []); });
  }, []);

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
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily: 'var(--font-sans)', fontSize: '.71875rem' });

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
    metaStyle: { fontSize:'.6875rem', fontFamily:'var(--font-sans)', color: x.good ? '#047857' : '#c2410c' } as CSSProperties
  }));

  const apiOverview = section === 'overview';
  const apiWebhooksView = section === 'webhooks';
  const apiUsageView = section === 'usage';
  const apiResourcesView = section === 'resources';

  const apiEndpointsGridStyle: CSSProperties = { display: section === 'endpoints' ? 'grid' : 'none', gridTemplateColumns:'minmax(0,1.35fr) minmax(0,1fr)', gap:'16px', alignItems:'start' };

  /* Real webhook endpoints. No delivery-health figure is shown: the list
     endpoint does not report one, and the prototype's "99.9% delivered" /
     "failing (502)" strings were invented. */
  const webhookEndpoints = (webhookRows ?? []).map(w => ({
    id: w.id,
    url: w.url,
    meta: [
      w.event_types && w.event_types.length ? w.event_types.length + ' event types' : 'all event types',
      w.description,
      'created ' + new Date(w.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }),
    ].filter(Boolean).join(' · '),
    pill: pill(w.is_active ? TONE_GOOD : TONE_MUTED),
    pillLabel: w.is_active ? 'Active' : 'Disabled',
    isActive: w.is_active,
    eventTypes: w.event_types,
    isOpen: openEndpoint === w.id,
    onToggleOpen: () => { setDeliveryFilter('all'); setOpenEndpoint(openEndpoint === w.id ? null : w.id); },
    onTest: () => {
      void webhooksApi.sendTest(apiCall, w.id).then(res => {
        if (!res.ok) { flash('Test send failed · ' + res.error.message); return; }
        const first = res.data[0];
        flash(first
          ? 'Test event ' + first.event_type + ' · ' + first.status + (first.status_code ? ' (' + first.status_code + ')' : '')
          : 'Test event queued');
        loadWebhooks();
        if (openEndpoint === w.id) loadDeliveries(w.id, deliveryFilter);
      });
    },
    onToggle: () => {
      void webhooksApi.update(apiCall, w.id, { is_active: !w.is_active }).then(res => {
        if (!res.ok) { flash('Could not update the endpoint · ' + res.error.message); return; }
        loadWebhooks();
      });
    },
    onRotate: () => {
      void askConfirm({
        title: 'Rotate signing secret',
        message: w.url + ' will be signed with a new secret immediately. Deliveries signed with the old one stop verifying as soon as you rotate, so update your receiver first.',
        cta: 'Rotate secret',
        danger: true,
      }).then(ok => {
        if (!ok) return;
        void webhooksApi.rotateSecret(apiCall, w.id).then(res => {
          if (!res.ok) { flash('Could not rotate the secret · ' + res.error.message); return; }
          setWebhookSecret({ url: res.data.url, secret: res.data.secret, rotated: true });
          flash('Secret rotated · copy it now, it is shown once');
          loadWebhooks();
        });
      });
    },
    /** `null` event_types is the backend's wildcard; a list is a subscription. */
    onSetEvents: (next: string[] | null) => {
      void webhooksApi.update(apiCall, w.id, { event_types: next }).then(res => {
        if (!res.ok) { flash('Could not update the subscription · ' + res.error.message); return; }
        loadWebhooks();
      });
    },
    onDelete: () => {
      void askConfirm({ title: 'Delete endpoint', message: w.url + ' stops receiving events immediately. This cannot be undone.', cta: 'Delete endpoint', danger: true }).then(ok => {
        if (!ok) return;
        void webhooksApi.remove(apiCall, w.id).then(res => {
          if (!res.ok) { flash('Could not delete the endpoint · ' + res.error.message); return; }
          flash('Endpoint deleted');
          if (openEndpoint === w.id) setOpenEndpoint(null);
          loadWebhooks();
        });
      });
    },
  }));

  /** Replay resets the attempt counter and re-sends immediately. Only offered
      for deliveries that actually failed — replaying a success duplicates it. */
  const replayDelivery = (delivery: WebhookDeliveryResponse) => {
    void webhooksApi.replay(apiCall, delivery.id).then(res => {
      if (!res.ok) { flash('Replay failed · ' + res.error.message); return; }
      flash('Replayed ' + res.data.event_type + ' · ' + res.data.status
        + (res.data.status_code ? ' (' + res.data.status_code + ')' : ''));
      if (openEndpoint) loadDeliveries(openEndpoint, deliveryFilter);
    });
  };

  const addWebhook = async () => {
    const url = await askText({ title: 'Add endpoint', label: 'Endpoint URL', message: 'Events are POSTed here as they happen.', placeholder: 'https://…', cta: 'Create endpoint', required: true });
    if (!url) return;
    void webhooksApi.create(apiCall, { url }).then(res => {
      if (!res.ok) { flash('Could not create the endpoint · ' + res.error.message); return; }
      setWebhookSecret({ url: res.data.url, secret: res.data.secret, rotated: false });
      flash('Endpoint created · copy the signing secret now, it is shown once');
      loadWebhooks();
    });
  };

  /* `GET /api/billing/usage` returns a purpose-built `rows` array. */
  const planUsage = (usageRows ?? []).map((row: UsageRow) => ({
    key: row.key, label: row.label, meta: row.display,
    bar: { width: Math.max(0, Math.min(100, row.pct)) + '%', height:'100%', borderRadius:'99px', background: row.pct > 85 ? '#f59e0b' : A } as CSSProperties }));

  const devResources = ([
    ['Quickstart guide', 'Send your first envelope in 10 minutes', 'quickstart'],
    ['API reference', 'Full REST reference with schemas', 'reference'],
    ['API console', 'Compose a call against your live workspace', 'sandbox'],
    ['Embedding guide', 'Run the builder inside your own app', 'embed'],
    ['Webhooks', 'Signature verification and retry schedule', 'webhooks'],
    ['Migration guide', 'Move templates, contacts and archives', 'migration']
  ] as [string, string, string][]).map(([label, meta, target]) => ({ label, meta,
    onClick: () => { if (target === 'sandbox') go('sandbox'); else { set({ docsPage: target }); go('guides'); } },
    style: { display:'flex', flexDirection:'column', gap:'4px', alignItems:'flex-start', textAlign:'left', padding:'13px', borderRadius:'12px',
      border:'1px solid #e3e7ee', background:'#fbfcfd', cursor:'pointer' } as CSSProperties }));

  const apiTabs = API_TABS.map(([id, label]) => {
    const on = s.apiTab === id;
    return { id, label, selected: on ? 'true' : 'false', onClick: () => set({ apiTab: id }),
      style: { height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.75rem', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });

  /* `apiTab` is persisted client state, so a value from an older build (or a
     removed tab) must not take the screen down with an undefined `ep`. */
  const ep = API_DEFS[s.apiTab] || API_DEFS[API_TABS[0][0]];
  const apiMethodStyle: CSSProperties = { padding:'4px 9px', borderRadius:'7px', fontSize:'.65625rem', fontWeight:700, fontFamily:'var(--font-sans)',
    background: ep.method === 'GET' ? '#ecfdf5' : '#eef2ff', color: ep.method === 'GET' ? '#047857' : '#3730a3',
    border:'1px solid ' + (ep.method === 'GET' ? '#a7f3d0' : '#c7d2fe'), flex:'0 0 auto' };
  const apiParams = ep.params.map(([name, type, desc]) => ({ name, type, desc,
    typeStyle: { fontSize:'.65625rem', fontFamily:'var(--font-sans)', color:TEXT_MUTED, width:'66px', flex:'0 0 66px' } as CSSProperties }));
  const copyEndpoint = () => flash((typeof window === 'undefined' ? '' : window.location.origin) + ep.path + ' copied');

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
      style: { padding:'5px 10px', borderRadius:'99px', cursor:'pointer', fontSize:'.6875rem', fontFamily:'var(--font-sans)',
        border:'1px solid ' + (on ? '#a7f3d0' : '#e3e7ee'), background: on ? '#ecfdf5' : '#fbfcfd', color: on ? '#047857' : TEXT_MUTED } as CSSProperties };
  });

  const embedSnippet = EMBED_SNIPPET;

  return (
    <section data-screen-label="Developer API" style={{ padding:'22px 22px 40px', display:'flex', flexDirection:'column', gap:'16px' }}>

      <div style={addonBannerStyle}>
        <div style={{ display:'flex', flexDirection:'column', gap:'5px', minWidth:0 }}>
          <span style={{ fontSize:'.875rem', fontWeight:700, letterSpacing:'-.2px', color:'#f8fafc' }}>SignerPro as an add-on</span>
          <span style={{ fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6, maxWidth:'620px' }}>Expose users, contacts and documents to your host application over REST, then launch the preparation surface in place with an embed session that carries document and contact metadata.</span>
        </div>
        <div style={{ display:'flex', gap:'8px', flex:'0 0 auto' }}>
          <button type="button" onClick={launchEmbed} style={superBtn}>Launch embedded builder</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, minmax(0,1fr))', gap:'12px' }}>
        {apiStats.map(st => (
          <div key={st.label} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px 15px', display:'flex', flexDirection:'column', gap:'6px' }}>
            <span style={{ fontSize:'.65625rem', letterSpacing:'.06em', color:'#64748b', fontFamily:'var(--font-sans)' }}>{st.label}</span>
            <span style={{ fontSize:'1.375rem', fontWeight:700, letterSpacing:'-.7px' }}>{st.value}</span>
            <span style={st.metaStyle}>{st.meta}</span>
          </div>
        ))}
      </div>

      {apiOverview ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'12px' }}>
          {devResources.map(r => (
            <button key={r.label} type="button" onClick={r.onClick} style={r.style}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, color:'#0f172a' }}>{r.label}</span>
              <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.5 }}>{r.meta}</span>
            </button>
          ))}
        </div>
      ) : null}

      {apiWebhooksView ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>Webhook endpoints</div>
            <button type="button" onClick={addWebhook} style={primaryBtn}>Add endpoint</button>
          </div>
          {webhookSecret ? (
            <div style={{ border:'1px solid #c7d2fe', background:'#eef2ff', borderRadius:'12px', padding:'11px', display:'flex', flexDirection:'column', gap:'5px' }}>
              <span style={{ fontSize:'.75rem', fontWeight:600 }}>{webhookSecret.rotated ? 'New signing secret for ' : 'Signing secret for '}{webhookSecret.url}</span>
              <span style={{ fontSize:'.71875rem', fontFamily:'var(--font-sans)', wordBreak:'break-all', color:'#3730a3' }}>{webhookSecret.secret}</span>
              <button type="button" onClick={() => setWebhookSecret(null)} style={ghostBtn}>Dismiss</button>
            </div>
          ) : null}
          {webhookRows === null ? (
            <div style={{ border:'1px dashed #8492a6', borderRadius:'12px', padding:'18px', textAlign:'center', fontSize:'.75rem', color:TEXT_MUTED }}>Loading endpoints…</div>
          ) : webhookEndpoints.length === 0 ? (
            <div style={{ border:'1px dashed #8492a6', borderRadius:'12px', padding:'18px', textAlign:'center', fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6 }}>No webhook endpoints yet. Add one to receive envelope and billing events.</div>
          ) : null}
          {webhookEndpoints.map(w => (
            <div key={w.id} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd', flexWrap:'wrap' }}>
              <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0, flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                  <span style={{ fontSize:'.75rem', fontWeight:600, fontFamily:'var(--font-sans)', wordBreak:'break-all' }}>{w.url}</span>
                  <span style={w.pill}>{w.pillLabel}</span>
                </div>
                <span style={{ fontSize:'.6875rem', color:'#64748b' }}>{w.meta}</span>
              </div>
              <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                <button type="button" onClick={w.onToggleOpen} aria-expanded={w.isOpen} style={w.isOpen ? primaryBtn : ghostBtn}>
                  {w.isOpen ? 'Hide activity' : 'Activity'}
                </button>
                <button type="button" onClick={w.onTest} style={ghostBtn}>Send test</button>
                <button type="button" onClick={w.onToggle} style={ghostBtn}>{w.pillLabel === 'Active' ? 'Disable' : 'Enable'}</button>
                <button type="button" onClick={w.onRotate} style={ghostBtn}>Rotate secret</button>
                <button type="button" onClick={w.onDelete} style={btn('#fff', '#b91c1c', '#fecaca')}>Delete</button>
              </div>

              {w.isOpen ? (
                <div style={{ flex:'1 0 100%', display:'flex', flexDirection:'column', gap:'10px', borderTop:'1px solid #e3e7ee', paddingTop:'11px' }}>
                  {/* Subscription. `null` is the backend wildcard, so "All
                      events" is a real state rather than "every box ticked". */}
                  <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                    <span style={lbl}>Subscribed events</span>
                    <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                      <button
                        type="button"
                        onClick={() => w.onSetEvents(null)}
                        aria-pressed={w.eventTypes === null}
                        style={w.eventTypes === null ? primaryBtn : ghostBtn}
                      >All events</button>
                      {eventCatalogue.map(evt => {
                        const subscribed = w.eventTypes !== null && w.eventTypes.includes(evt.event_type);
                        return (
                          <button
                            key={evt.event_type}
                            type="button"
                            title={evt.description}
                            aria-pressed={subscribed}
                            onClick={() => {
                              const current = w.eventTypes ?? [];
                              const next = subscribed
                                ? current.filter(item => item !== evt.event_type)
                                : [...current, evt.event_type];
                              // An empty list would subscribe to nothing at
                              // all, which is what Disable is for; fall back
                              // to the wildcard instead of a silent mute.
                              w.onSetEvents(next.length ? next : null);
                            }}
                            style={subscribed ? primaryBtn : ghostBtn}
                          >{evt.event_type}</button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Delivery log. Every attempt the backend recorded. */}
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
                    <span style={lbl}>Recent deliveries</span>
                    <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
                      {(['all', 'succeeded', 'failed', 'exhausted', 'pending'] as const).map(status => (
                        <button
                          key={status}
                          type="button"
                          aria-pressed={deliveryFilter === status}
                          onClick={() => setDeliveryFilter(status)}
                          style={deliveryFilter === status ? primaryBtn : ghostBtn}
                        >{status === 'all' ? 'All' : status === 'exhausted' ? 'Dead-lettered' : status[0].toUpperCase() + status.slice(1)}</button>
                      ))}
                    </div>
                  </div>

                  {deliveries === null ? (
                    <span style={{ fontSize:'.71875rem', color:TEXT_MUTED }}>Loading deliveries…</span>
                  ) : deliveries.length === 0 ? (
                    <span style={{ fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.6 }}>
                      {deliveryFilter === 'all'
                        ? 'No deliveries yet. Send a test event, or wait for the first envelope.'
                        : 'No ' + deliveryFilter + ' deliveries.'}
                    </span>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                      {deliveries.map(d => (
                        <div key={d.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 10px', border:'1px solid #eef1f6', borderRadius:'10px', background:'#fff', flexWrap:'wrap' }}>
                          <span style={pill(d.status === 'succeeded' ? TONE_GOOD : d.status === 'pending' ? TONE_MUTED : TONE_WARN)}>
                            {d.status === 'exhausted' ? 'Dead-lettered' : d.status}
                          </span>
                          <span style={{ fontSize:'.71875rem', fontWeight:600, minWidth:0 }}>{d.event_type}</span>
                          <span style={{ fontSize:'.6875rem', color:TEXT_SUBTLE, fontFamily:'var(--font-sans)' }}>
                            {d.status_code ? 'HTTP ' + d.status_code : 'no response'}
                            {' · attempt ' + d.attempt}
                            {d.next_retry_at ? ' · retries ' + new Date(d.next_retry_at).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : ''}
                          </span>
                          <span style={{ fontSize:'.6875rem', color:TEXT_SUBTLE, marginLeft:'auto' }}>
                            {new Date(d.created_at).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                          </span>
                          {d.status === 'failed' || d.status === 'exhausted' ? (
                            <button type="button" onClick={() => replayDelivery(d)} style={ghostBtn}>Replay</button>
                          ) : null}
                          {d.error ? (
                            <span style={{ flex:'1 0 100%', fontSize:'.6875rem', color:'#b91c1c', fontFamily:'var(--font-sans)', wordBreak:'break-word' }}>{d.error}</span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {apiUsageView ? (
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={railHead}>Plan usage · current cycle</div>
          {usageRows === null ? (
            <span style={{ fontSize:'.75rem', color:TEXT_MUTED }}>Loading usage…</span>
          ) : planUsage.length === 0 ? (
            <span style={{ fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6 }}>This plan meters nothing this cycle.</span>
          ) : null}
          {planUsage.map(u => (
            <div key={u.key} style={{ display:'flex', alignItems:'center', gap:'12px' }}>
              <span style={{ width:'160px', fontSize:'.78125rem', color:'#334155', flex:'0 0 160px' }}>{u.label}</span>
              <div style={{ flex:1, height:'7px', borderRadius:'99px', background:'#eef1f6', overflow:'hidden' }}><div style={u.bar}></div></div>
              <span style={{ width:'150px', textAlign:'right', fontSize:'.71875rem', color:'#64748b', fontFamily:'var(--font-sans)', flex:'0 0 150px' }}>{u.meta}</span>
            </div>
          ))}
        </div>
      ) : null}

      {apiResourcesView ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0,1fr))', gap:'12px' }}>
          {devResources.map(r => (
            <button key={r.label} type="button" onClick={r.onClick} style={r.style}>
              <span style={{ fontSize:'.8125rem', fontWeight:600, color:'#0f172a', display:'inline-flex', alignItems:'center', gap:'5px' }}>{r.label}<Icon name="externalLink" size={12} /></span>
              <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.5 }}>{r.meta}</span>
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
              <span style={{ fontSize:'.78125rem', fontFamily:'var(--font-sans)', color:'#0f172a', wordBreak:'break-all' }}>{ep.path}</span>
              <button type="button" onClick={copyEndpoint} style={ghostBtn}>Copy</button>
            </div>
            <span style={{ fontSize:'.75rem', color:'#475569', lineHeight:1.6 }}>{ep.desc}</span>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              <span style={railHead}>Parameters</span>
              {apiParams.length === 0 ? (
                <span style={{ fontSize:'.71875rem', color:TEXT_MUTED, lineHeight:1.5 }}>None. The route takes no query parameters.</span>
              ) : null}
              {apiParams.map(p => (
                <div key={p.name} style={{ display:'flex', gap:'10px', alignItems:'flex-start', padding:'7px 0', borderTop:'1px solid #f2f4f8' }}>
                  <span style={{ fontSize:'.71875rem', fontFamily:'var(--font-sans)', color:'#0f172a', width:'118px', flex:'0 0 118px' }}>{p.name}</span>
                  <span style={p.typeStyle}>{p.type}</span>
                  <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.5, flex:1, minWidth:0 }}>{p.desc}</span>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <span style={railHead}>Example response · 200</span>
                <span style={{ fontSize:'.65625rem', color:TEXT_MUTED }}>application/json</span>
              </div>
              {/* Illustrative, not live: the payload is a hand-written example
                  from `API_DEFS`, so it is labelled as one both in the heading
                  and above the block itself. */}
              <span style={{ fontSize:'.6875rem', color:TEXT_SUBTLE, lineHeight:1.5 }}>
                Illustrative example — placeholder data, not your workspace. Call the endpoint with
                one of your API keys to see your own records.
              </span>
              <pre style={jsonBoxStyle} aria-label="Example response payload">{ep.sample}</pre>
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
                    <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{k.label}</span>
                    <span style={k.modePill}>{k.mode}</span>
                  </div>
                  <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', wordBreak:'break-all' }}>{k.secret}</span>
                  <span style={{ fontSize:'.65625rem', color:TEXT_MUTED }}>{k.meta}</span>
                </div>
                <div style={{ display:'flex', gap:'5px', flex:'0 0 auto' }}>
                  <button type="button" onClick={k.onReveal} style={ghostBtn}>{k.revealLabel}</button>
                  <button type="button" onClick={k.onRevoke} style={k.revokeStyle}>{k.revokeLabel}</button>
                </div>
              </div>
            ))}
            {apiKeys.length === 0 ? (
              <div style={{ border:'1px dashed #8492a6', borderRadius:'12px', padding:'18px', textAlign:'center', fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6 }}>No API keys yet. Create one to start calling the REST API.</div>
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
