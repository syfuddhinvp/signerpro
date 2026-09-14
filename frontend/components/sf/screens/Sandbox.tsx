'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { SB_LANG_TABS } from '@/lib/sf/data';
import { btn, inputStyle, jsonBoxStyle, lbl, linkBtn, pill, railHead, TONE_BAD, TONE_GOOD, TEXT_MUTED } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { sandboxHeaders } from '@/lib/api/resources';
import { useDialogs } from '@/components/sf/DialogProvider';
import Icon from '@/components/sf/Icon';

/**
 * The sandbox is real now, and the toggle means something.
 *
 * The prototype dressed this screen as a seeded test tenant with a `sk_test_…`
 * key and a Test/Live switch, none of which existed: the toggle was
 * client-side only, the key was a string that was never sent, and a `DELETE`
 * on `/api/documents/library` would have destroyed real documents.
 *
 * What backs it now (API-11) is a paired sandbox organization. Test mode sends
 * `X-SignerPro-Sandbox`, the backend resolves the request to that shadow
 * tenant, and outbound email, SMS and payment collection are suppressed there.
 * Live mode sends nothing extra and still hits the caller's real workspace, so
 * the warning below is shown per mode rather than removed, and a write in live
 * mode still asks first.
 */
const SB_PATH_OPTIONS: string[] = [
  '/api/me',
  '/api/contacts',
  '/api/documents/library',
  '/api/templates',
  '/api/embed/sessions',
  '/api/api-keys/usage',
];

/** Only the app's own API is reachable through the proxy. */
const API_PREFIX = '/api/';

export default function Sandbox() {
  const { s, set, flash, accent } = useSF();
  const A = accent();
  const { askConfirm } = useDialogs();
  const st: any = s;

  /* Live unless the caller says otherwise. A missing value must never read as
     sandbox: someone whose store predates this flag has to land in the mode
     the warning describes, not in one the backend might not honour. */
  const inSandbox: boolean = st.sbSandbox === true;

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const iconBtn: CSSProperties = { width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'.8125rem', lineHeight:1 };
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:'var(--font-sans)', fontSize:'.71875rem' });
  const codeArea: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'10px', padding:'10px 11px', fontSize:'.71875rem', lineHeight:1.7,
    fontFamily:'var(--font-sans)', resize:'vertical', outline:'none', width:'100%', color:'#0f172a', background:'#fbfcfd' };

  /* The request the Send button will actually issue — the snippets are generated
     from exactly these values, so what a developer copies is what just ran. */
  const sbQuery: [string, string][] = (st.sbParams as { k: string; v: string }[])
    .filter(p => p.k.trim() !== '')
    .map(p => [p.k.trim(), p.v] as [string, string]);
  const sbQueryString = sbQuery.length
    ? '?' + sbQuery.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&')
    : '';
  /* The store's initial `sbPath` is the prototype's `/v1/contacts`; fall back to
     the first real endpoint until the select is touched. */
  const sbPath: string = SB_PATH_OPTIONS.indexOf(String(st.sbPath)) > -1 ? String(st.sbPath) : SB_PATH_OPTIONS[0];
  const sbFullPath = sbPath + sbQueryString;
  const sbBodyLine = String(st.sbBody).replace(/\n\s*/g, ' ');
  /* The snippets reproduce the request that the Send button issues, against
     this deployment's own origin. There is no SDK to import — these are the
     plain-transport equivalents of the call composed above. */
  const sbOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  /* A snippet that ran in test mode must reproduce the mode, not just the
     path — otherwise copying it out of the console silently promotes the call
     to live. */
  const sbCurlSandbox = inSandbox ? ' \\\n  -H "X-SignerPro-Sandbox: 1"' : '';
  const sbJsSandbox = inSandbox ? ',\n    "X-SignerPro-Sandbox": "1"' : '';
  const sbPySandbox = inSandbox ? ', "X-SignerPro-Sandbox": "1"' : '';
  /* These are `/api/…` app routes, authenticated by the session cookie — not
     the `/api/v1` public surface, which takes an `X-API-Key` header. The
     snippets used to send `Authorization: Bearer $SIGNERPRO_KEY`, a header no
     route on either surface reads, so a developer copying one got a 401 from a
     block captioned as the request that had just succeeded. */
  const sbAuthNote = '# session-authenticated app route — send your session cookie.\n' +
    '# The read-only public surface is /api/v1/… with an X-API-Key header instead.';
  const sbSnippets: Record<string, string> = {
    curl: sbAuthNote + '\ncurl -X ' + st.sbMethod + ' "' + sbOrigin + sbFullPath + '" \\\n  -b "$SIGNERPRO_SESSION_COOKIE" \\\n  -H "Content-Type: application/json"' + sbCurlSandbox + (st.sbMethod === 'GET' ? '' : " \\\n  -d '" + sbBodyLine + "'"),
    node: '// from the browser, the cookie rides along with credentials: "include"\n' +
      'const res = await fetch("' + sbFullPath + '", {\n  method: "' + st.sbMethod + '",\n  credentials: "include",\n  headers: {\n    "Content-Type": "application/json"' + sbJsSandbox + '\n  }' + (st.sbMethod === 'GET' ? '' : ',\n  body: JSON.stringify(' + sbBodyLine + ')') + '\n});\nconsole.log(await res.json());',
    python: sbAuthNote + '\nimport os, requests\n\nres = requests.request(\n    "' + st.sbMethod + '",\n    "' + sbOrigin + sbFullPath + '",\n    headers={"Cookie": os.environ["SIGNERPRO_SESSION_COOKIE"]' + sbPySandbox + '}' + (st.sbMethod === 'GET' ? '' : ',\n    json=' + sbBodyLine) + '\n)\nprint(res.json())'
  };
  const sbLangTabs = SB_LANG_TABS.map(([id, label]) => {
    const on = st.sbLang === id;
    return { id, label, selected: on ? 'true' : 'false', onClick: () => set({ sbLang: id } as any),
      style: { height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem', fontWeight: on ? 600 : 500,
        background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b', boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });
  const sbPathOptions = SB_PATH_OPTIONS.map(p => ({ id: p, label: p }));
  const sbParams = st.sbParams.map((p: any, i: number) => ({
    k: p.k, v: p.v,
    onKey: (e: any) => { const val = e.target.value; set((x: any) => ({ sbParams: x.sbParams.map((y: any, j: number) => j === i ? { k: val, v: y.v } : y) } as any)); },
    onVal: (e: any) => { const val = e.target.value; set((x: any) => ({ sbParams: x.sbParams.map((y: any, j: number) => j === i ? { k: y.k, v: val } : y) } as any)); },
    onRemove: () => set((x: any) => ({ sbParams: x.sbParams.filter((_y: any, j: number) => j !== i) } as any))
  }));
  const sbHistory = st.sbHistory.map((h: any, i: number) => ({
    key: i, label: h.method + ' ' + h.path, meta: h.status + ' · ' + h.ms + 'ms',
    onClick: () => set({ sbMethod: h.method, sbResponse: { status: h.status, ms: h.ms, body: h.body } } as any),
    pill: pill(h.status < 300 ? TONE_GOOD : TONE_BAD),
    style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'9px 10px', borderRadius:'10px', border:'1px solid #eef1f6', background:'#fbfcfd', cursor:'pointer', textAlign:'left' } as CSSProperties
  }));

  const sbBodyVisible = st.sbMethod !== 'GET';
  const sbSendLabel = st.sbSending ? 'Sending…' : 'Send request';
  /** A real call through `/api/proxy`; the status, latency and body are the API's. */
  const sbSend = async () => {
    if (st.sbSending) return;
    const method = st.sbMethod as 'GET' | 'POST' | 'PATCH' | 'DELETE';
    const path = sbPath;
    /* In live mode anything other than GET writes to the caller's real
       workspace, so it is confirmed. In the sandbox there is nothing to
       protect, and a confirmation on every write would train people to click
       through the one that matters. */
    if (method !== 'GET' && !inSandbox) {
      const ok = await askConfirm({
        title: method + ' ' + sbFullPath,
        message: 'This runs against your live workspace and can create, change or delete real data. Switch to Test to send it to your sandbox instead.',
        cta: 'Send request',
        danger: true,
      });
      if (!ok) return;
    }
    if (!path.startsWith(API_PREFIX)) { flash('Only this deployment\u2019s own /api paths can be called'); return; }

    let body: unknown;
    if (method !== 'GET' && String(st.sbBody).trim()) {
      try {
        body = JSON.parse(st.sbBody);
      } catch {
        flash('The request body is not valid JSON');
        return;
      }
    }

    const query: Record<string, string> = {};
    for (const [k, v] of sbQuery) query[k] = v;

    set({ sbSending: true, sbResponse: null } as any);
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    void apiCall<unknown>(path, { method, query, body, headers: sandboxHeaders(inSandbox) }).then(res => {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      const ms = Math.max(1, Math.round(elapsed));
      const status = res.ok ? res.status : res.error.status;
      const payload = res.ok ? res.data : { error: { status: res.error.status, kind: res.error.kind, message: res.error.message } };
      const rendered = payload === undefined ? '' : JSON.stringify(payload, null, 2);
      const entry = { method, path: sbFullPath, status, ms, env: inSandbox ? 'test' : 'live', body: rendered };
      set((x: any) => ({ sbSending: false, sbResponse: { status, ms, body: rendered },
        sbHistory: [entry].concat(x.sbHistory).slice(0, 6) } as any));
    });
  };
  /* Seeding and resetting are sandbox-only on the backend too: both routes go
     through `_require_sandbox`, so these buttons cannot reach live records
     even if the toggle were wrong. */
  const sbSeed = async () => {
    const res = await apiCall<{ contact_count: number; document_count: number }>(
      '/api/sandbox/seed', { method: 'POST', headers: sandboxHeaders(true) });
    if (res.ok) flash('Sandbox seeded — ' + res.data.contact_count + ' contacts, ' + res.data.document_count + ' documents');
    else flash(res.error.message);
  };

  const sbReset = async () => {
    const ok = await askConfirm({
      title: 'Reset the sandbox',
      message: 'This deletes every document and contact in your sandbox. Your live workspace is not touched.',
      cta: 'Reset sandbox',
      danger: true,
    });
    if (!ok) return;
    const res = await apiCall<{ deleted_documents: number; deleted_contacts: number }>(
      '/api/sandbox/reset', { method: 'POST', headers: sandboxHeaders(true) });
    if (res.ok) flash('Sandbox cleared — ' + res.data.deleted_documents + ' documents, ' + res.data.deleted_contacts + ' contacts deleted');
    else flash(res.error.message);
  };

  const modeTabs = ([['live', 'Live'], ['test', 'Test']] as [string, string][]).map(([id, label]) => {
    const on = (id === 'test') === inSandbox;
    return { id, label, selected: on ? 'true' : 'false',
      onClick: () => set({ sbSandbox: id === 'test', sbResponse: null } as any),
      style: { height:'26px', padding:'0 12px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'.71875rem',
        fontWeight: on ? 600 : 500, background: on ? '#fff' : 'transparent', color: on ? '#0f172a' : '#64748b',
        boxShadow: on ? '0 1px 2px rgba(15,23,42,.12)' : 'none' } as CSSProperties };
  });

  const resp: any = st.sbResponse;
  const hasSbResponse = !!resp;
  const sbEmpty = !resp;
  const sbStatus = resp ? String(resp.status) : '';
  const sbLatency = resp ? resp.ms + 'ms' : '';
  const sbResponseBody = resp ? resp.body : '';
  const sbStatusPill = pill(resp && resp.status < 300 ? TONE_GOOD : TONE_BAD);
  /* Only what the transport actually knows. `lib/api/browser#apiCall` returns
     the parsed body, not the response headers, so nothing here is invented. */
  const sbHeaders = ([
    ['content-type','application/json'],
    ['status', sbStatus],
    ['duration', sbLatency]
  ] as [string, string][]).map(([k, v]) => ({ k, v }));
  const sbEmptyNote = 'Send a request to see the response, headers and timing.';

  return (
    <section data-screen-label="API console" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1.15fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
      <div style={{ gridColumn:'1 / -1', background: inSandbox ? '#ecfdf5' : '#fef2f2', border:'1px solid ' + (inSandbox ? '#a7f3d0' : '#fecaca'), borderRadius:'14px', padding:'13px 15px', display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'14px', flexWrap:'wrap' }}>
        <div style={{ display:'flex', flexDirection:'column', gap:'4px', flex:'1 1 380px', minWidth:0 }}>
          {inSandbox ? (
            <>
              <span style={{ fontSize:'.8125rem', fontWeight:700, color:'#047857' }}>Sandbox — a separate organization</span>
              <span style={{ fontSize:'.75rem', color:'#065f46', lineHeight:1.6 }}>
                Requests resolve to your sandbox tenant. Nothing here can read or change live records, and outbound
                email, SMS and payment collection are suppressed. Seed it with sample data, or clear it, at any time.
              </span>
            </>
          ) : (
            <>
              <span style={{ fontSize:'.8125rem', fontWeight:700, color:'#b91c1c' }}>Live workspace</span>
              <span style={{ fontSize:'.75rem', color:'#991b1b', lineHeight:1.6 }}>
                Requests are sent with your own session against your organization&rsquo;s real data. A POST, PATCH or
                DELETE here creates, changes or deletes real documents, contacts and templates — permanently.
                Switch to Test to send them to your sandbox instead.
              </span>
            </>
          )}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
          <div role="group" aria-label="Environment" style={{ display:'flex', gap:'4px', background: inSandbox ? '#d1fae5' : '#fee2e2', padding:'4px', borderRadius:'10px' }}>
            {modeTabs.map(m => (
              <button key={m.id} type="button" onClick={m.onClick} aria-pressed={m.selected as any} style={m.style}>{m.label}</button>
            ))}
          </div>
          {inSandbox ? (
            <>
              <button type="button" onClick={sbSeed} style={ghostBtn}>Seed data</button>
              <button type="button" onClick={sbReset} style={ghostBtn}>Reset</button>
            </>
          ) : null}
        </div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'13px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={railHead}>Request</div>
          </div>

          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <select value={st.sbMethod} onChange={(e) => set({ sbMethod: e.target.value, sbResponse: null } as any)} aria-label="Method" style={{ height:'34px', width:'104px', flex:'0 0 104px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 9px', fontSize:'.78125rem', background:'#fff', color:'#0f172a', outline:'none' }}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <select value={sbPath} onChange={(e) => set({ sbPath: e.target.value, sbResponse: null } as any)} aria-label="Endpoint" style={{ height:'34px', flex:'1 1 200px', minWidth:'180px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 9px', fontSize:'.78125rem', fontFamily:'var(--font-sans)', background:'#fff', color:'#0f172a', outline:'none' }}>
              {sbPathOptions.map(o => (<option key={o.id} value={o.id}>{o.label}</option>))}
            </select>
            <button type="button" onClick={sbSend} style={primaryBtn}>{sbSendLabel}</button>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={railHead}>Query parameters</span>
              <button type="button" onClick={() => set((x: any) => ({ sbParams: x.sbParams.concat([{ k:'', v:'' }]) } as any))} style={linkBtn(A)}>+ Add parameter</button>
            </div>
            {sbParams.map((p: any, i: number) => (
              <div key={i} style={{ display:'flex', gap:'8px', alignItems:'center' }}>
                <input type="text" value={p.k} onChange={p.onKey} placeholder="key" aria-label="Parameter name" style={mono} />
                <input type="text" value={p.v} onChange={p.onVal} placeholder="value" aria-label="Parameter value" style={mono} />
                <button type="button" aria-label="Remove parameter" onClick={p.onRemove} style={iconBtn}><Icon name="close" size={13} /></button>
              </div>
            ))}
          </div>

          {sbBodyVisible ? (
            <label style={lbl}>Request body
              <textarea rows={7} value={st.sbBody} onChange={(e) => set({ sbBody: e.target.value } as any)} aria-label="Request body" style={codeArea}></textarea>
            </label>
          ) : null}
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'11px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px', flexWrap:'wrap' }}>
            <div style={railHead}>Code snippet</div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px' }}>
                {sbLangTabs.map(l => (
                  <button key={l.id} type="button" onClick={l.onClick} aria-pressed={l.selected as any} style={l.style}>{l.label}</button>
                ))}
              </div>
              <button type="button" onClick={() => flash('Snippet copied')} style={ghostBtn}>Copy</button>
            </div>
          </div>
          <pre style={jsonBoxStyle}>{sbSnippets[st.sbLang]}</pre>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>Response</div>
            {hasSbResponse ? (
              <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                <span style={sbStatusPill}>{sbStatus}</span>
                <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{sbLatency}</span>
              </div>
            ) : null}
          </div>
          {hasSbResponse ? (
            <div style={{ display:'flex', flexDirection:'column', gap:'11px' }}>
              <pre style={jsonBoxStyle}>{sbResponseBody}</pre>
              <div style={{ display:'flex', flexDirection:'column', gap:'5px', borderTop:'1px solid #f2f4f8', paddingTop:'10px' }}>
                <span style={railHead}>Headers</span>
                {sbHeaders.map(h => (
                  <div key={h.k} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'.6875rem', fontFamily:'var(--font-sans)' }}>
                    <span style={{ color:'#64748b' }}>{h.k}</span><span style={{ color:'#0f172a', wordBreak:'break-all' }}>{h.v}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {sbEmpty ? (
            <div style={{ border:'1px dashed #8492a6', borderRadius:'12px', padding:'22px', textAlign:'center', fontSize:'.75rem', color:TEXT_MUTED, lineHeight:1.6 }}>{sbEmptyNote}</div>
          ) : null}
        </div>

        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'10px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'10px' }}>
            <div style={railHead}>Recent calls</div>
            <button type="button" onClick={() => set({ sbResponse: null, sbHistory: [] } as any)} style={linkBtn(A)}>Clear</button>
          </div>
          {sbHistory.map((h: any) => (
            <button key={h.key} type="button" onClick={h.onClick} style={h.style}>
              <span style={h.pill}>{h.label}</span>
              <span style={{ marginLeft:'auto', fontSize:'.65625rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{h.meta}</span>
            </button>
          ))}
          <span style={{ fontSize:'.71875rem', color:'#b91c1c', lineHeight:1.5 }}>These calls run against your live workspace with your own session. There is no test tenant, nothing is sandboxed, and writes are permanent.</span>
        </div>
      </div>
    </section>
  );
}
