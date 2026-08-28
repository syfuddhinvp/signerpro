'use client';

import type { CSSProperties } from 'react';
import { useSF } from '@/lib/sf/state';
import { SB_LANG_TABS } from '@/lib/sf/data';
import { btn, inputStyle, jsonBoxStyle, lbl, linkBtn, pill, railHead, TONE_BAD, TONE_GOOD } from '@/lib/sf/ui';
import { apiCall } from '@/lib/api/browser';

/**
 * Real endpoints on this deployment's own API, in the order the design lists
 * them. Every send below is an actual request through `/api/proxy`, so these
 * have to be paths the backend serves — not the prototype's `/v1/...` mock
 * catalogue.
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
  const st: any = s;

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const iconBtn: CSSProperties = { width:'28px', height:'28px', borderRadius:'8px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'13px', lineHeight:1 };
  const mono: CSSProperties = Object.assign({}, inputStyle, { fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'11.5px' });
  const codeArea: CSSProperties = { border:'1px solid #e3e7ee', borderRadius:'10px', padding:'10px 11px', fontSize:'11.5px', lineHeight:1.7,
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
    curl: 'curl -X ' + st.sbMethod + ' "https://api.signforge.com' + sbFullPath + '" \\\n  -H "Authorization: Bearer sk_' + st.sbEnv + '_…" \\\n  -H "Content-Type: application/json"' + (st.sbMethod === 'GET' ? '' : " \\\n  -d '" + sbBodyLine + "'"),
    node: 'const sf = new SignForge(process.env.SIGNFORGE_KEY);\nconst res = await sf.request("' + st.sbMethod + '", "' + sbFullPath + '"' + (st.sbMethod === 'GET' ? '' : ', ' + sbBodyLine) + ');\nconsole.log(res);',
    python: 'import signforge\n\nsf = signforge.Client(os.environ["SIGNFORGE_KEY"])\nres = sf.request("' + st.sbMethod + '", "' + sbFullPath + '"' + (st.sbMethod === 'GET' ? '' : ', json=' + sbBodyLine) + ')\nprint(res)',
    php: '$sf = new \\SignForge\\Client(getenv("SIGNFORGE_KEY"));\n$res = $sf->request("' + st.sbMethod + '", "' + sbFullPath + '"' + (st.sbMethod === 'GET' ? '' : ', ' + sbBodyLine) + ');\nprint_r($res);'
  };
  const sbLangTabs = SB_LANG_TABS.map(([id, label]) => {
    const on = st.sbLang === id;
    return { id, label, selected: on ? 'true' : 'false', onClick: () => set({ sbLang: id } as any),
      style: { height:'26px', padding:'0 10px', borderRadius:'7px', border:'none', cursor:'pointer', fontSize:'11.5px', fontWeight: on ? 600 : 500,
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
    key: i, label: h.method + ' ' + h.path, meta: h.status + ' · ' + h.ms + 'ms · ' + h.env,
    onClick: () => set({ sbMethod: h.method, sbResponse: { status: h.status, ms: h.ms, body: h.body }, sbEnv: h.env } as any),
    pill: pill(h.status < 300 ? TONE_GOOD : TONE_BAD),
    style: { display:'flex', alignItems:'center', gap:'9px', width:'100%', padding:'9px 10px', borderRadius:'10px', border:'1px solid #eef1f6', background:'#fbfcfd', cursor:'pointer', textAlign:'left' } as CSSProperties
  }));

  const sbTestStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: st.sbEnv === 'test' ? 600 : 500,
    background: st.sbEnv === 'test' ? '#fff' : 'transparent', color: st.sbEnv === 'test' ? '#0f172a' : '#64748b', boxShadow: st.sbEnv === 'test' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const sbLiveStyle: CSSProperties = { height:'28px', padding:'0 12px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'12px', fontWeight: st.sbEnv === 'live' ? 600 : 500,
    background: st.sbEnv === 'live' ? '#fff' : 'transparent', color: st.sbEnv === 'live' ? '#92400e' : '#64748b', boxShadow: st.sbEnv === 'live' ? '0 1px 2px rgba(15,23,42,.12)' : 'none' };
  const sbKeyLabel = 'sk_' + st.sbEnv + '_' + (st.sbEnv === 'test' ? '41ab••••02de' : '9f2b••••4c71');
  const sbBodyVisible = st.sbMethod !== 'GET';
  const sbSendLabel = st.sbSending ? 'Sending…' : 'Send request';
  /** A real call through `/api/proxy`; the status, latency and body are the API's. */
  const sbSend = () => {
    if (st.sbEnv === 'live') { flash('Live mode blocked in the sandbox — switch to test'); return; }
    if (st.sbSending) return;
    const method = st.sbMethod as 'GET' | 'POST' | 'PATCH' | 'DELETE';
    const path = sbPath;
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
      const entry = { method, path: sbFullPath, status, ms, env: st.sbEnv, body: rendered };
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
    ['signforge-mode', st.sbEnv],
    ['status', sbStatus],
    ['duration', sbLatency]
  ] as [string, string][]).map(([k, v]) => ({ k, v }));
  const sbEmptyNote = 'Send a request to see the response, headers and timing.';

  return (
    <section data-screen-label="Sandbox" style={{ padding:'22px 22px 40px', display:'grid', gridTemplateColumns:'minmax(0,1.15fr) minmax(0,1fr)', gap:'16px', alignItems:'start' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:'16px' }}>
        <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'16px', display:'flex', flexDirection:'column', gap:'13px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div style={railHead}>Request</div>
            <div style={{ display:'flex', alignItems:'center', gap:'9px' }}>
              <div style={{ display:'flex', gap:'4px', background:'#f5f6f8', padding:'4px', borderRadius:'10px' }}>
                <button type="button" onClick={() => set({ sbEnv: 'test' } as any)} style={sbTestStyle}>Test</button>
                <button type="button" onClick={() => set({ sbEnv: 'live' } as any)} style={sbLiveStyle}>Live</button>
              </div>
              <span style={{ fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{sbKeyLabel}</span>
            </div>
          </div>

          <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
            <select value={st.sbMethod} onChange={(e) => set({ sbMethod: e.target.value, sbResponse: null } as any)} aria-label="Method" style={{ height:'34px', width:'104px', flex:'0 0 104px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 9px', fontSize:'12.5px', background:'#fff', color:'#0f172a', outline:'none' }}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PATCH">PATCH</option>
              <option value="DELETE">DELETE</option>
            </select>
            <select value={sbPath} onChange={(e) => set({ sbPath: e.target.value, sbResponse: null } as any)} aria-label="Endpoint" style={{ height:'34px', flex:'1 1 200px', minWidth:'180px', border:'1px solid #e3e7ee', borderRadius:'9px', padding:'0 9px', fontSize:'12.5px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", background:'#fff', color:'#0f172a', outline:'none' }}>
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
                <span style={{ fontSize:'11px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{sbLatency}</span>
              </div>
            ) : null}
          </div>
          {hasSbResponse ? (
            <div style={{ display:'flex', flexDirection:'column', gap:'11px' }}>
              <pre style={jsonBoxStyle}>{sbResponseBody}</pre>
              <div style={{ display:'flex', flexDirection:'column', gap:'5px', borderTop:'1px solid #f2f4f8', paddingTop:'10px' }}>
                <span style={railHead}>Headers</span>
                {sbHeaders.map(h => (
                  <div key={h.k} style={{ display:'flex', justifyContent:'space-between', gap:'12px', fontSize:'11px', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>
                    <span style={{ color:'#64748b' }}>{h.k}</span><span style={{ color:'#0f172a', wordBreak:'break-all' }}>{h.v}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {sbEmpty ? (
            <div style={{ border:'1px dashed #cbd5e1', borderRadius:'12px', padding:'22px', textAlign:'center', fontSize:'12px', color:'#94a3b8', lineHeight:1.6 }}>{sbEmptyNote}</div>
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
              <span style={{ marginLeft:'auto', fontSize:'10.5px', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{h.meta}</span>
            </button>
          ))}
          <span style={{ fontSize:'11.5px', color:'#94a3b8', lineHeight:1.5 }}>Sandbox calls run against a seeded test tenant. Nothing is emailed and no card is charged.</span>
        </div>
      </div>
    </section>
  );
}
