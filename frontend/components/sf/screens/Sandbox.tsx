'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { SB_LANG_TABS } from '@/lib/sf/data';
import { btn, inputStyle, jsonBoxStyle, lbl, linkBtn, pill, railHead, TONE_BAD, TONE_GOOD, TEXT_MUTED } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';
import { useDialogs } from '@/components/sf/DialogProvider';

/**
 * THERE IS NO SANDBOX BACKEND.
 *
 * Every send below is a real, session-authenticated request against the
 * caller's own production tenant, through `/api/proxy`. The prototype dressed
 * this screen as a seeded test tenant with a `sk_test_…` key and a Test/Live
 * toggle; none of that existed — the toggle was client-side only, the key was
 * a string that was never sent, and a `DELETE` on `/api/documents/library`
 * would have destroyed real documents.
 *
 * What remains: the same real endpoints, an unmissable warning, and an explicit
 * confirmation before any request that can write.
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

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const iconBtn: CSSProperties = { width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'.8125rem', lineHeight:1 };
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'.71875rem' });
  const codeArea: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'10px', padding:'10px 11px', fontSize:'.71875rem', lineHeight:1.7,
    fontFamily:"'Inter', 'Google Sans Flex', sans-serif", resize:'vertical', outline:'none', width:'100%', color:'#0f172a', background:'#fbfcfd' };

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
  const sbSnippets: Record<string, string> = {
    curl: 'curl -X ' + st.sbMethod + ' "https://api.signforge.com' + sbFullPath + '" \\\n  -H "Authorization: Bearer $SIGNFORGE_KEY" \\\n  -H "Content-Type: application/json"' + (st.sbMethod === 'GET' ? '' : " \\\n  -d '" + sbBodyLine + "'"),
    node: 'const sf = new SignForge(process.env.SIGNFORGE_KEY);\nconst res = await sf.request("' + st.sbMethod + '", "' + sbFullPath + '"' + (st.sbMethod === 'GET' ? '' : ', ' + sbBodyLine) + ');\nconsole.log(res);',
    python: 'import signforge\n\nsf = signforge.Client(os.environ["SIGNFORGE_KEY"])\nres = sf.request("' + st.sbMethod + '", "' + sbFullPath + '"' + (st.sbMethod === 'GET' ? '' : ', json=' + sbBodyLine) + ')\nprint(res)',
    php: '$sf = new \\SignForge\\Client(getenv("SIGNFORGE_KEY"));\n$res = $sf->request("' + st.sbMethod + '", "' + sbFullPath + '"' + (st.sbMethod === 'GET' ? '' : ', ' + sbBodyLine) + ');\nprint_r($res);'
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
    /* Anything other than GET writes to the caller's real workspace. */
    if (method !== 'GET') {
      const ok = await askConfirm({
        title: method + ' ' + sbFullPath,
        message: 'This runs against your live workspace and can create, change or delete real data. There is no test tenant.',
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
    void apiCall<unknown>(path, { method, query, body }).then(res => {
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
      const ms = Math.max(1, Math.round(elapsed));
      const status = res.ok ? res.status : res.error.status;
      const payload = res.ok ? res.data : { error: { status: res.error.status, kind: res.error.kind, message: res.error.message } };
      const rendered = payload === undefined ? '' : JSON.stringify(payload, null, 2);
      const entry = { method, path: sbFullPath, status, ms, env: 'live', body: rendered };
      set((x: any) => ({ sbSending: false, sbResponse: { status, ms, body: rendered },
        sbHistory: [entry].concat(x.sbHistory).slice(0, 6) } as any));
    });
  };
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
      <div style={{ gridColumn:'1 / -1', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:'14px', padding:'13px 15px', display:'flex', flexDirection:'column', gap:'4px' }}>
        <span style={{ fontSize:'.8125rem', fontWeight:700, color:'#b91c1c' }}>Live workspace — not a sandbox</span>
        <span style={{ fontSize:'.75rem', color:'#991b1b', lineHeight:1.6 }}>
          Requests are sent with your own session against your organization&rsquo;s real data. There is no test tenant and no test key.
          A POST, PATCH or DELETE here creates, changes or deletes real documents, contacts and templates — permanently.
        </span>
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
            <select value={sbPath} onChange={(e) => set({ sbPath: e.target.value, sbResponse: null } as any)} aria-label="Endpoint" style={{ height:'34px', flex:'1 1 200px', minWidth:'180px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 9px', fontSize:'.78125rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", background:'#fff', color:'#0f172a', outline:'none' }}>
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
                <button type="button" aria-label="Remove parameter" onClick={p.onRemove} style={iconBtn}>✕</button>
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
                <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{sbLatency}</span>
              </div>
            ) : null}
          </div>
          {hasSbResponse ? (
            <div style={{ display:'flex', flexDirection:'column', gap:'11px' }}>
              <pre style={jsonBoxStyle}>{sbResponseBody}</pre>
              <div style={{ display:'flex', flexDirection:'column', gap:'5px', borderTop:'1px solid #f2f4f8', paddingTop:'10px' }}>
                <span style={railHead}>Headers</span>
                {sbHeaders.map(h => (
                  <div key={h.k} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'.6875rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>
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
              <span style={{ marginLeft:'auto', fontSize:'.65625rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{h.meta}</span>
            </button>
          ))}
          <span style={{ fontSize:'.71875rem', color:'#b91c1c', lineHeight:1.5 }}>These calls run against your live workspace with your own session. There is no test tenant, nothing is sandboxed, and writes are permanent.</span>
        </div>
      </div>
    </section>
  );
}
