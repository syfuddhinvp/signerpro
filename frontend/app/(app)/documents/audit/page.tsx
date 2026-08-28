/**
 * Audit trail & certificate — the real, tamper-evident trail for one envelope.
 *
 * Endpoints (see `backend/app/api/routes/audit.py`):
 *   GET /api/documents/{id}/audit-logs          → the chained entries, newest first
 *   GET /api/documents/{id}/audit-logs/verify   → chain-integrity state
 *   GET /api/documents/{id}/certificate/summary → the certificate card
 *
 * The envelope is `?document=<id>`, falling back to the most recently touched
 * document in the library so the screen is never empty for an active tenant.
 */

import type { Metadata } from 'next';
import Audit from '@/components/sf/screens/Audit';
import { serverCaller } from '@/lib/api/client';
import { audit as auditApi, documents as documentsApi, recipients as recipientsApi } from '@/lib/api/resources';
import {
  documentStatusBucket, toAttestations, toAuditRows, toCertificateCard,
} from '@/lib/sf/adapters';
import { STATUS, type Dict } from '@/lib/sf/data';
import type {
  AuditChainVerification, AuditTrailEntry, CertificateSummaryResponse,
  DocumentResponse, RecipientResponse,
} from '@/lib/api/types';

export const metadata: Metadata = { title: 'Audit trail · SignForge' };

type SearchParams = { document?: string };

export default async function Page({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const api = serverCaller('/documents/audit');
  const params = (await searchParams) ?? {};

  // 1. Resolve the envelope: explicit `?document=` wins, newest otherwise.
  let document: DocumentResponse | null = null;
  if (params.document) {
    const result = await documentsApi.get(api, params.document);
    if (result.ok) document = result.data;
  }
  if (!document) {
    const newest = await documentsApi.library(api, { sort: 'recent', limit: 1 });
    document = newest.ok ? (newest.data.items[0] ?? null) : null;
  }

  if (!document) {
    return (
      <Audit
        entries={[]}
        certificate={null}
        chain={null}
        attestations={[]}
        documentTitle={null}
        verifyUrl=""
      />
    );
  }

  const documentId = document.id;

  const [trailResult, verifyResult, certResult, recipientsResult] = await Promise.all([
    auditApi.documentTrail(api, documentId),
    auditApi.verifyChain(api, documentId),
    // NOTE: `resources.audit.certificate` points at `/certificate`, but the
    // router only mounts `/certificate/summary` — called directly until that
    // resource is corrected (it is outside this screen's files).
    api<CertificateSummaryResponse>(`/api/documents/${documentId}/certificate/summary`, { method: 'GET' }),
    recipientsApi.list(api, documentId),
  ]);

  const entries: AuditTrailEntry[] = trailResult.ok ? trailResult.data : [];
  const verification: AuditChainVerification | null = verifyResult.ok ? verifyResult.data : null;
  const summary: CertificateSummaryResponse | null = certResult.ok ? certResult.data : null;
  const recipientList: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];

  const emailById: Dict<string> = {};
  for (const recipient of recipientList) emailById[recipient.id] = recipient.email;

  const statusKey = documentStatusBucket(summary?.document_status ?? document.status);
  const statusLabel = STATUS[statusKey]?.label ?? 'Draft';

  return (
    <Audit
      entries={toAuditRows(entries, emailById)}
      certificate={summary ? toCertificateCard(summary, statusKey, statusLabel) : null}
      chain={verification
        ? { valid: verification.valid, entryCount: verification.entry_count, hashAlgorithm: verification.hash_algorithm }
        : null}
      attestations={toAttestations(recipientList, entries)}
      documentTitle={document.title}
      verifyUrl={`/documents/audit?document=${documentId}`}
    />
  );
}
