/**
 * Platform admin (tenants, directory, flags, plans, security) — server component.
 *
 * Every filter is a URL search param, so a filtered view is shareable and the
 * filtering happens in the API rather than over a fully-loaded table:
 *   `?q=&status=&plan=`      → GET /api/saas/tenants
 *   `?tenant=<id>`           → GET /api/saas/tenants/{id}
 *   `?duser=&drole=&dmfa=`   → GET /api/saas/directory
 *   `?flagEnv=`              → GET /api/saas/flags
 *
 * The remaining tabs come from `/api/saas/roles`, `/api/saas/security-posture`,
 * `/api/saas/compliance`, `/api/saas/audit`, `/api/billing/plans` and
 * `/api/saas/revenue` (per-plan tenant counts and MRR).
 */

import type { Metadata } from 'next';
import Platform, { type PlatformFilters } from '@/components/sf/screens/Platform';
import { serverCaller } from '@/lib/api/client';
import {
  billing as billingApi,
  directory as directoryApi,
  flags as flagsApi,
  logs as logsApi,
  revenue as revenueApi,
  tenants as tenantsApi,
} from '@/lib/api/resources';
import {
  toCertificationLabels,
  toComplianceNote,
  toDirectoryRows,
  toFlagRows,
  toPermissionMatrix,
  toPlatformAuditStream,
  toPlatformPlanCards,
  toPlatformStats,
  toSecurityRows,
  toTenantTableRows,
} from '@/lib/sf/adapters';
import type { ComplianceResponse, PlatformOverview } from '@/lib/api/types';
import ApiUnavailable from '@/components/sf/ApiUnavailable';

export const metadata: Metadata = { title: 'Tenants · SignForge Platform' };

const EMPTY_OVERVIEW: PlatformOverview = {
  tenants: { total: 0, trial: 0, suspended: 0, active: 0 },
  seats: { provisioned: 0, activated: 0 },
  envelopes_30d: 0,
  mrr_cents: 0,
  incidents_90d: 0,
  uptime_pct: null,
  errors_24h: 0,
  mrr_series: [],
  health: [],
};

const EMPTY_COMPLIANCE: ComplianceResponse = {
  certifications: [],
  last_key_rotation_at: null,
  rotation_interval_days: 90,
  key_rotation_implemented: false,
  disclaimer: 'Compliance information is unavailable — the platform API could not be reached.',
};

type SearchParams = { [key: string]: string | string[] | undefined };

function one(value: string | string[] | undefined): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v ?? '';
}

/** `all`/empty means "no filter" — the param is simply not sent. */
function orAll(value: string): string {
  return value || 'all';
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const query = await searchParams;

  const filters: PlatformFilters = {
    q: one(query.q),
    status: orAll(one(query.status)),
    plan: orAll(one(query.plan)),
    directoryQuery: one(query.duser),
    role: orAll(one(query.drole)),
    mfa: orAll(one(query.dmfa)),
    flagEnvironment: orAll(one(query.flagEnv)),
    tenantId: one(query.tenant),
  };

  const api = serverCaller('/platform/tenants');

  const [
    overviewResult, tenantsResult, directoryResult, matrixResult, flagsResult,
    postureResult, complianceResult, auditResult, plansResult, revenueResult, detailResult,
  ] = await Promise.all([
    tenantsApi.overview(api),
    tenantsApi.list(api, {
      q: filters.q || undefined,
      status: filters.status === 'all' ? undefined : filters.status,
      plan: filters.plan === 'all' ? undefined : filters.plan,
      limit: 100,
    }),
    directoryApi.list(api, {
      q: filters.directoryQuery || undefined,
      role: filters.role === 'all' ? undefined : filters.role,
      mfa: filters.mfa === 'all' ? undefined : filters.mfa === 'true',
      limit: 100,
    }),
    directoryApi.permissionMatrix(api),
    flagsApi.list(api, { environment: filters.flagEnvironment === 'all' ? undefined : filters.flagEnvironment }),
    flagsApi.securityPosture(api),
    flagsApi.compliance(api),
    logsApi.platformAudit(api, { limit: 5 }),
    billingApi.plans(api),
    revenueApi.summary(api),
    filters.tenantId ? tenantsApi.get(api, filters.tenantId) : Promise.resolve(null),
  ]);

  const overview = overviewResult.ok ? overviewResult.data : EMPTY_OVERVIEW;
  const tenantPage = tenantsResult.ok ? tenantsResult.data : { items: [], total: 0 };
  const directoryPage = directoryResult.ok ? directoryResult.data : { items: [], total: 0 };
  const matrix = matrixResult.ok ? matrixResult.data : { columns: [], column_labels: [], permissions: [] };
  const flagList = flagsResult.ok ? flagsResult.data : [];
  const posture = postureResult.ok ? postureResult.data : [];
  const compliance = complianceResult.ok ? complianceResult.data : EMPTY_COMPLIANCE;
  const audit = auditResult.ok ? auditResult.data.items : [];
  const plans = plansResult.ok ? plansResult.data : [];
  const summary = revenueResult.ok ? revenueResult.data : null;
  const detail = detailResult && detailResult.ok ? detailResult.data : null;

  return (
    <>
      {!overviewResult.ok || !tenantsResult.ok || !directoryResult.ok || !complianceResult.ok ? (
        <div style={{ padding: '22px 22px 0' }}>
          <ApiUnavailable what="The tenant directory and posture" detail={(overviewResult.ok ? null : overviewResult.error.message) ?? (tenantsResult.ok ? null : tenantsResult.error.message) ?? (directoryResult.ok ? null : directoryResult.error.message) ?? (complianceResult.ok ? null : complianceResult.error.message)} />
        </div>
      ) : null}
      <Platform
        stats={toPlatformStats(overview)}
        tenants={toTenantTableRows(tenantPage.items)}
        tenantTotal={tenantPage.total}
        tenantDetail={detail}
        planCodes={plans.map(p => ({ code: p.code, name: p.name }))}
        directory={toDirectoryRows(directoryPage.items)}
        directoryTotal={directoryPage.total}
        matrix={toPermissionMatrix(matrix)}
        flags={toFlagRows(flagList)}
        security={toSecurityRows(posture)}
        certifications={toCertificationLabels(compliance)}
        complianceNote={toComplianceNote(compliance)}
        audit={toPlatformAuditStream(audit)}
        plans={toPlatformPlanCards(plans, summary)}
        filters={filters}
        seatsLabel={overview.seats.provisioned.toLocaleString()}
        tenantCountLabel={String(overview.tenants.total)}
      />
    </>
  );
}
