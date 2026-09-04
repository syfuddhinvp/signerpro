/**
 * Public verification — the only screen anyone can reach with no account and no
 * token, and the only place the product's tamper-evidence claim can be checked
 * by someone who is not the tenant asserting it.
 *
 *   GET /api/verify/{id}?sha256=…  →  seal state, signer counts, chain validity
 *
 * The hash is the credential. A document id on its own verifies nothing, so
 * this page is safe to link publicly and safe to put behind the QR block on a
 * certificate: whoever holds the paper holds the hash printed on it.
 *
 * A wrong hash and an unknown id are the same answer here, exactly as they are
 * in the API — anything else would tell a stranger which ids exist.
 */

import type { Metadata } from 'next';
import { apiFetchPublic } from '@/lib/api/client';
import { TEXT_MUTED } from '@/lib/sf/ui';

export const metadata: Metadata = { title: 'Verify a document · SignForge' };

type VerificationResponse = {
  verified: boolean;
  detail: string | null;
  document_id: string | null;
  sealed_at: string | null;
  signers_total: number | null;
  signers_completed: number | null;
  hash_algorithm: string | null;
  final_sha256: string | null;
  final_pdf_intact: boolean | null;
  audit_entry_count: number | null;
  chain_valid: boolean | null;
};

const PAGE: React.CSSProperties = {
  minHeight: '100vh', background: '#f5f6f8', display: 'grid', placeItems: 'start center',
  padding: '48px 20px', fontFamily: "'Inter', 'Google Sans Flex', system-ui, sans-serif",
};
const CARD: React.CSSProperties = {
  width: '100%', maxWidth: '560px', background: '#fff', border: '1px solid #e3e7ee',
  borderRadius: '14px', padding: '28px', boxShadow: '0 1px 2px rgba(15,23,42,.04)',
};
const ROW: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: '16px',
  padding: '11px 0', borderTop: '1px solid #eef1f6', fontSize: '.8125rem',
};
const LABEL: React.CSSProperties = { color: '#64748b' };
const VALUE: React.CSSProperties = { color: '#0f172a', fontWeight: 600, textAlign: 'right', wordBreak: 'break-all' };

function Banner({ ok, title, body }: { ok: boolean; title: string; body: string }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '14px 16px',
        borderRadius: '10px', marginBottom: '20px',
        background: ok ? '#ecfdf5' : '#fef2f2',
        border: `1px solid ${ok ? '#a7f3d0' : '#fecaca'}`,
      }}
    >
      <span aria-hidden style={{ fontSize: '1rem', lineHeight: 1.3 }}>{ok ? '✓' : '!'}</span>
      <span>
        <strong style={{ display: 'block', color: ok ? '#065f46' : '#991b1b', fontSize: '.875rem' }}>{title}</strong>
        <span style={{ color: ok ? '#047857' : '#b91c1c', fontSize: '.8125rem' }}>{body}</span>
      </span>
    </div>
  );
}

export default async function Page({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sha256?: string }>;
}) {
  const { id } = await params;
  const { sha256 = '' } = await searchParams;

  const query = sha256 ? `?sha256=${encodeURIComponent(sha256)}` : '';
  const result = await apiFetchPublic<VerificationResponse>(`/api/verify/${encodeURIComponent(id)}${query}`);

  // The backend being unreachable is not the same as "this document is fake",
  // and must never be rendered as though it were.
  if (!result.ok) {
    return (
      <main style={PAGE}>
        <div style={CARD}>
          <Banner
            ok={false}
            title="Verification is unavailable"
            body="The verification service could not be reached. This says nothing about the document — please try again shortly."
          />
        </div>
      </main>
    );
  }

  const data = result.data;
  const sealed = data.sealed_at ? new Date(data.sealed_at).toUTCString() : null;

  return (
    <main style={PAGE}>
      <div style={CARD}>
        <h1 style={{ fontSize: '1.0625rem', margin: '0 0 4px', color: '#0f172a' }}>Document verification</h1>
        <p style={{ fontSize: '.8125rem', color: '#64748b', margin: '0 0 20px' }}>
          Checks a sealed document against its audit trail and the bytes on file. No account required.
        </p>

        {data.verified ? (
          <Banner
            ok
            title="This document is intact"
            body="The file matches the hash recorded when it was sealed, and its audit trail verifies end to end."
          />
        ) : (
          <Banner
            ok={false}
            title="Not verified"
            body={
              data.detail
              ?? 'This document is sealed, but it no longer matches its seal. Treat the copy you hold as unverified.'
            }
          />
        )}

        {data.document_id && (
          <div>
            <div style={{ ...ROW, borderTop: 'none' }}>
              <span style={LABEL}>Document</span><span style={VALUE}>{data.document_id}</span>
            </div>
            {sealed && (
              <div style={ROW}><span style={LABEL}>Sealed</span><span style={VALUE}>{sealed}</span></div>
            )}
            <div style={ROW}>
              <span style={LABEL}>Signers</span>
              <span style={VALUE}>{data.signers_completed} of {data.signers_total} completed</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>File matches its seal</span>
              <span style={VALUE}>{data.final_pdf_intact ? 'Yes' : 'No'}</span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>Audit trail</span>
              <span style={VALUE}>
                {data.chain_valid ? 'Verified' : 'Failed'} · {data.audit_entry_count} entries
              </span>
            </div>
            <div style={ROW}>
              <span style={LABEL}>{data.hash_algorithm}</span>
              <span style={{ ...VALUE, fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontWeight: 500, fontSize: '.6875rem' }}>
                {data.final_sha256}
              </span>
            </div>
          </div>
        )}

        <p style={{ fontSize: '.6875rem', color: TEXT_MUTED, marginTop: '20px', lineHeight: 1.6 }}>
          Verification confirms that a sealed document still matches what was recorded at signing.
          It is an electronic signature record under ESIGN/UETA; it is not a cryptographic
          document signature (PAdES/QES), and this page does not assert the identity of the signers.
        </p>
      </div>
    </main>
  );
}
