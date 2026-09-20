/**
 * The developer page.
 *
 * Every claim maps to `FEATURES.md` §14 (API keys, the public REST API,
 * webhooks, sandbox, in-app reference) and §15 (embedding with scoped,
 * revocable session tokens and a `frame-ancestors` allowlist). The four code
 * samples call the same three endpoints in the same order, because that is
 * the actual shape of sending a document through the API: create it, add a
 * recipient, send it.
 */
import type { Metadata } from 'next';
import { Hero, Grid, Card, CodeTabs, Faq, CtaBand, Cta, CtaRow } from '@/components/marketing';
import type { CodeSample } from '@/components/marketing';

export const metadata: Metadata = {
  title: 'Developers — SignerPro API',
  description:
    'Send a document for signature from your own code: create it, add a recipient, send it. API keys, webhooks, embedding and a sandbox, on every paid plan.',
};

const SAMPLES: CodeSample[] = [
  {
    label: 'cURL',
    language: 'bash',
    code: `curl -X POST https://api.signerpro.com/api/documents \\
  -H "Authorization: Bearer $SIGNERPRO_API_KEY" \\
  -F "file=@contract.pdf" \\
  -F "title=Master Services Agreement"

curl -X POST https://api.signerpro.com/api/documents/doc_123/recipients \\
  -H "Authorization: Bearer $SIGNERPRO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"email": "customer@example.com", "role": "signer"}'

curl -X POST https://api.signerpro.com/api/documents/doc_123/send \\
  -H "Authorization: Bearer $SIGNERPRO_API_KEY"`,
  },
  {
    label: 'JavaScript',
    language: 'javascript',
    code: `const key = process.env.SIGNERPRO_API_KEY;
const base = 'https://api.signerpro.com/api';

const doc = await fetch(\`\${base}/documents\`, {
  method: 'POST',
  headers: { Authorization: \`Bearer \${key}\` },
  body: form, // file + title
}).then(r => r.json());

await fetch(\`\${base}/documents/\${doc.id}/recipients\`, {
  method: 'POST',
  headers: { Authorization: \`Bearer \${key}\`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'customer@example.com', role: 'signer' }),
});

await fetch(\`\${base}/documents/\${doc.id}/send\`, {
  method: 'POST',
  headers: { Authorization: \`Bearer \${key}\` },
});`,
  },
  {
    label: 'Python',
    language: 'python',
    code: `import os, requests

key = os.environ["SIGNERPRO_API_KEY"]
base = "https://api.signerpro.com/api"
headers = {"Authorization": f"Bearer {key}"}

doc = requests.post(
    f"{base}/documents",
    headers=headers,
    files={"file": open("contract.pdf", "rb")},
    data={"title": "Master Services Agreement"},
).json()

requests.post(
    f"{base}/documents/{doc['id']}/recipients",
    headers=headers,
    json={"email": "customer@example.com", "role": "signer"},
)

requests.post(f"{base}/documents/{doc['id']}/send", headers=headers)`,
  },
  {
    label: 'Go',
    language: 'go',
    code: `key := os.Getenv("SIGNERPRO_API_KEY")
base := "https://api.signerpro.com/api"

req, _ := http.NewRequest("POST", base+"/documents", body)
req.Header.Set("Authorization", "Bearer "+key)
resp, _ := http.DefaultClient.Do(req)
var doc struct{ ID string \`json:"id"\` }
json.NewDecoder(resp.Body).Decode(&doc)

recipient, _ := json.Marshal(map[string]string{
    "email": "customer@example.com",
    "role":  "signer",
})
http.Post(base+"/documents/"+doc.ID+"/recipients", "application/json", bytes.NewReader(recipient))

req2, _ := http.NewRequest("POST", base+"/documents/"+doc.ID+"/send", nil)
req2.Header.Set("Authorization", "Bearer "+key)
http.DefaultClient.Do(req2)`,
  },
];

const CAPABILITIES = [
  {
    // FEATURES.md §14 — API keys with scopes, usage stats, roll/revoke.
    title: 'API keys with scopes',
    body: 'Issue a key scoped to what it needs, watch its usage, and roll or revoke it without touching the others.',
  },
  {
    // FEATURES.md §14 — public REST API.
    title: 'A REST API that mirrors the app',
    body: 'Documents, recipients, audit logs, users and contacts — the same objects the app shows you, reachable from your own code.',
  },
  {
    // FEATURES.md §14 — webhooks, event catalogue, delivery log, replay.
    title: 'Webhooks you can trust',
    body: 'Subscribe to the events you care about, rotate the signing secret when you need to, and replay a delivery from the log instead of guessing what was sent.',
  },
  {
    // FEATURES.md §15 — embedding, scoped session tokens.
    title: 'Embedded signing',
    body: 'Drop the signing view into your own product with a scoped, revocable session token, and control who is allowed to frame it.',
  },
  {
    // FEATURES.md §14 — sandbox with seed/reset.
    title: 'A sandbox that resets',
    body: 'Build against seeded test data and reset it whenever you want, without ever touching a real document.',
  },
  {
    // FEATURES.md §14 — in-app API reference and request logs.
    title: 'Docs and logs in the app',
    body: 'The API reference and your recent requests live next to your keys, so you can debug a call without leaving the dashboard.',
  },
];

const FAQ = [
  {
    q: 'Do I need a paid plan to use the API?',
    a: 'The sandbox and a scoped set of endpoints are open on the free plan. The full API, webhooks and embedding are on every paid plan, with no separate developer tier to unlock.',
  },
  {
    q: 'How do webhooks handle a failed delivery?',
    a: 'Every attempt is written to the delivery log with its response, so you can see why it failed and replay it once your endpoint is back up.',
  },
  {
    q: 'Can I test without sending a real document?',
    a: 'Yes. The sandbox is a separate environment you can seed with test data and reset at any time, so nothing you build against it touches a live workspace.',
  },
  {
    q: 'What can iframe the embedded view?',
    a: 'Only the origins on your `frame-ancestors` allowlist. You set that list yourself, and a session token is scoped and revocable independent of it.',
  },
];

export default function DevelopersPage() {
  return (
    <>
      <Hero
        eyebrow="Developers"
        title="Send a document from your own code"
        lead="Create a document, add a recipient, send it. The same API keys, webhooks and sandbox are on every paid plan, not held back for the top tier."
        actions={
          <CtaRow>
            <Cta href="/register" size="lg">
              Get an API key
            </Cta>
            <Cta href="#sandbox" variant="on-dark" size="lg">
              See the sandbox
            </Cta>
          </CtaRow>
        }
      />

      <section id="api" className="scroll-mt-24 bg-mk-canvas px-mk-gutter py-mk-section">
        <div className="mx-auto max-w-mk-wide">
          <header className="mb-mk-stack-lg text-center">
            <p className="m-0 mb-3 text-mk-eyebrow uppercase text-mk-action-fg">The API</p>
            <h2 className="m-0 font-display text-mk-display-lg text-mk-ink">
              Three calls, one signed document
            </h2>
          </header>
          <CodeTabs samples={SAMPLES} />
        </div>
      </section>

      <Grid columns={3} className="mx-auto max-w-mk-wide px-mk-gutter py-mk-section">
        {CAPABILITIES.map(item => (
          <Card key={item.title}>
            <h3 className="m-0 mb-2 text-mk-copy-lg font-bold text-mk-ink">{item.title}</h3>
            <p className="m-0 text-mk-copy-sm text-mk-ink-muted">{item.body}</p>
          </Card>
        ))}
      </Grid>

      <section
        id="webhooks"
        className="scroll-mt-24 border-y border-mk-hairline bg-mk-canvas-alt px-mk-gutter py-mk-section"
      >
        <div className="mx-auto max-w-mk-prose text-center">
          <p className="m-0 mb-3 text-mk-eyebrow uppercase text-mk-action-fg">Webhooks</p>
          <h2 className="m-0 mb-4 font-display text-mk-display-md text-mk-ink">
            Know the moment something changes
          </h2>
          <p className="m-0 text-mk-copy-md text-mk-ink-muted">
            Pick the events you need from the catalogue, and point them at your endpoint.
            Rotate the signing secret whenever you want, watch every delivery in the log, and
            replay one that failed instead of resending it by hand with a test call.
          </p>
        </div>
      </section>

      <section id="embedding" className="scroll-mt-24 bg-mk-canvas px-mk-gutter py-mk-section">
        <div className="mx-auto max-w-mk-prose text-center">
          <p className="m-0 mb-3 text-mk-eyebrow uppercase text-mk-action-fg">Embedding</p>
          <h2 className="m-0 mb-4 font-display text-mk-display-md text-mk-ink">
            Put signing inside your own product
          </h2>
          <p className="m-0 text-mk-copy-md text-mk-ink-muted">
            An embedded session runs on a token scoped to one document and revocable at any
            time. You decide which origins are allowed to frame it, so the surface only ever
            loads where you meant it to.
          </p>
        </div>
      </section>

      <section
        id="sandbox"
        className="scroll-mt-24 border-y border-mk-hairline bg-mk-canvas-alt px-mk-gutter py-mk-section"
      >
        <div className="mx-auto max-w-mk-prose text-center">
          <p className="m-0 mb-3 text-mk-eyebrow uppercase text-mk-action-fg">Sandbox</p>
          <h2 className="m-0 mb-4 font-display text-mk-display-md text-mk-ink">
            Build against fake data, safely
          </h2>
          <p className="m-0 text-mk-copy-md text-mk-ink-muted">
            Seed the sandbox with test documents and recipients, break things, and reset it
            when you are done. Nothing you send there reaches a real signer.
          </p>
        </div>
      </section>

      <Faq items={FAQ} title="Questions before you integrate" />

      <CtaBand
        title="Get your first API key"
        lead="Create a workspace, open the developer settings, and send your first document from a script instead of a form."
        secondary={{ href: '/pricing', label: 'See pricing' }}
      />
    </>
  );
}
