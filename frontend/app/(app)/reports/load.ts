/**
 * Server loader shared by the two Reports routes: `app/(app)/reports/page.tsx`
 * (tenant) and `app/(app)/platform/reports/page.tsx` (platform). It lives in
 * its own module because a Next `page.tsx` may only export the route contract.
 *
 * Every section is a real endpoint:
 *   `/api/reports/overview`     tiles, completion rate, median turnaround
 *   `/api/reports/invites`      the stacked invite split
 *   `/api/reports/documents`    the documents table
 *   `/api/reports/templates`    the templates table
 *   `/api/reports/recipients`   the nine-column recipients table
 *   `/api/reports/senders`      the sender count behind "DOCUMENTS CREATED"
 *   `/api/reports/fields`       the custom-report dimension catalogue
 *   `/api/reports/custom`       saved definitions the builder resumes
 */

import type { ReportsProps } from '@/components/sf/screens/Reports';
import { serverCaller } from '@/lib/api/client';
import { reports as reportsApi } from '@/lib/api/resources';
import {
  EMPTY_REPORT_OVERVIEW,
  normalizeReportRange,
  toDocumentReportRows,
  toInviteSplit,
  toRecipientReportRows,
  toReportTiles,
  toTemplateReportRows,
} from '@/lib/sf/adapters';

export type ReportsSearchParams = { range?: string | string[] };

/**
 * Load every report section for one range.
 *
 * `scope` exists because `app/(app)/platform/reports/page.tsx` renders the same
 * screen. The reports router derives the tenant from the caller's own
 * `organization_id` and takes no tenant/platform parameter, so there is no
 * platform scope to request: the platform variant says so on the screen rather
 * than passing the operator's own tenant off as the whole platform.
 */
export async function loadReportsProps(
  next: string,
  scope: 'tenant' | 'platform',
  searchParams: ReportsSearchParams,
): Promise<ReportsProps> {
  const range = normalizeReportRange(searchParams.range);
  const api = serverCaller(next);

  const [overviewRes, invitesRes, docsRes, tplRes, recipRes, sendersRes, fieldsRes, customRes] = await Promise.all([
    reportsApi.overview(api, { range }),
    reportsApi.invites(api, { range }),
    reportsApi.documents(api, { range, limit: 50 }),
    reportsApi.templates(api, { range, limit: 50 }),
    reportsApi.recipientsReport(api, { range, limit: 100 }),
    reportsApi.senders(api, { range }),
    reportsApi.catalogue(api),
    reportsApi.customList(api),
  ]);

  const overview = overviewRes.ok ? overviewRes.data : EMPTY_REPORT_OVERVIEW;
  const invites = invitesRes.ok ? invitesRes.data : { total: 0, split: [] };
  const docs = docsRes.ok ? docsRes.data : { items: [], total: 0 };
  const templates = tplRes.ok ? tplRes.data : { items: [], total: 0 };
  const recipients = recipRes.ok ? recipRes.data : { items: [], total: 0 };
  const senders = sendersRes.ok ? sendersRes.data : [];
  const catalogue = fieldsRes.ok ? fieldsRes.data : { fields: [], reports: [], ranges: [] };
  const saved = customRes.ok ? customRes.data : [];

  return {
    scope,
    range,
    inviteTotal: invites.total,
    inviteSplit: toInviteSplit(invites.split ?? []),
    tiles: toReportTiles(overview, senders.length),
    recipientRows: toRecipientReportRows(recipients.items ?? []),
    recipientTotal: recipients.total ?? 0,
    docRows: toDocumentReportRows(docs.items ?? []),
    tplRows: toTemplateReportRows(templates.items ?? []),
    customFields: catalogue.fields ?? [],
    savedReports: saved.map(item => ({ id: item.id, name: item.name, fields: item.fields ?? [] })),
    scopeNotice:
      scope === 'platform'
        ? 'Platform-wide reporting is not available on the API: GET /api/reports/* is scoped to the caller’s own organization. The figures below are your operator tenant only — not every tenant on the platform.'
        : null,
  };
}
