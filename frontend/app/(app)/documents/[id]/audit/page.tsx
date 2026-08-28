/**
 * Audit trail & certificate — the real, tamper-evident trail for one envelope,
 * named by the `[id]` route param.
 *
 * Endpoints (see `backend/app/api/routes/audit.py`):
 *   GET /api/documents/{id}/audit-logs          → the chained entries, newest first
 *   GET /api/documents/{id}/audit-logs/verify   → chain-integrity state
 *   GET /api/documents/{id}/certificate/summary → the certificate card
 *
 * `/documents/audit` resolves the most recently touched document and redirects
 * here, so the sidebar link still works from a cold start.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Audit from '@/components/sf/screens/Audit';
import { serverCaller } from '@/lib/api/client';
import { audit as auditApi, documents as documentsApi, recipients as recipientsApi } from '@/lib/api/resources';
import {
  docStatusBucket, toAttestations, toAuditRows, toCertificateCard,
} from '@/lib/sf/adapters';
import { STATUS, type Dict } from '@/lib/sf/data';
import { documentPathFor } from '@/lib/sf/routes';
import type {
  AuditChainVerification, AuditTrailEntry, CertificateSummaryResponse,
  RecipientResponse,
} from '@/lib/api/types';

export const metadata: Metadata = { title: 'Audit trail · SignForge' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id: documentId } = await params;
  const verifyUrl = documentPathFor('audit', documentId);
  const api = serverCaller(verifyUrl);

  const documentResult = await documentsApi.get(api, documentId);
  if (!documentResult.ok) notFound();
  const document = documentResult.data;

  const [trailResult, verifyResult, certResult, recipientsResult] = await Promise.all([
    auditApi.documentTrail(api, documentId),
    auditApi.verifyChain(api, documentId),
    auditApi.certificate(api, documentId),
    recipientsApi.list(api, documentId),
  ]);

  const entries: AuditTrailEntry[] = trailResult.ok ? trailResult.data : [];
  const verification: AuditChainVerification | null = verifyResult.ok ? verifyResult.data : null;
  const summary: CertificateSummaryResponse | null = certResult.ok ? certResult.data : null;
  const recipientList: RecipientResponse[] = recipientsResult.ok ? recipientsResult.data : [];

  const emailById: Dict<string> = {};
  for (const recipient of recipientList) emailById[recipient.id] = recipient.email;

  const statusKey = docStatusBucket(summary?.document_status ?? document.status);
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
      verifyUrl={verifyUrl}
    />
  );
}
