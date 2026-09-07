/**
 * Reports (RPT-1…8). One route, one scope.
 *
 * `GET /api/reports/*` derives the tenant from the caller's own
 * `organization_id` and takes no tenant or "all tenants" parameter, so there
 * is no platform variant to serve: the platform workspace does not carry a
 * Reports area, and platform-wide aggregates live on `/api/saas/*` (the
 * Platform overview screen). The loader that existed only to be shared with a
 * second route is inlined here.
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
 *
 * The range picker is the `?range=` search param, not client state, so a range
 * is shareable and every change re-runs this component server-side.
 */

import type { Metadata } from 'next';
import ApiUnavailable from '@/components/sf/ApiUnavailable';
import Reports from '@/components/sf/screens/Reports';
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

export const metadata: Metadata = { title: 'Reports · SignerPro' };

type ReportsSearchParams = { range?: string | string[] };

export default async function Page({ searchParams }: { searchParams: Promise<ReportsSearchParams> }) {
  const range = normalizeReportRange((await searchParams).range);
  const api = serverCaller('/reports');

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

  // A failed aggregate must not render as a workspace where nothing happened:
  // every tile would read zero, which is a measurement, not an outage.
  const loadFailure = [overviewRes, invitesRes, docsRes, recipRes, sendersRes].find(result => !result.ok);

  return (
    <>
      {loadFailure && !loadFailure.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="Your reports" detail={loadFailure.error.message} />
        </div>
      ) : null}
      <Reports
        range={range}
        inviteTotal={invites.total}
        inviteSplit={toInviteSplit(invites.split ?? [])}
        tiles={toReportTiles(overview, senders.length)}
        recipientRows={toRecipientReportRows(recipients.items ?? [])}
        recipientTotal={recipients.total ?? 0}
        docRows={toDocumentReportRows(docs.items ?? [])}
        tplRows={toTemplateReportRows(templates.items ?? [])}
        customFields={catalogue.fields ?? []}
        savedReports={saved.map(item => ({ id: item.id, name: item.name, fields: item.fields ?? [] }))}
      />
    </>
  );
}
