/**
 * The authenticated application layout: rail + sidebar + header chrome around
 * every in-app route, plus the globally mounted modal and product-tour hosts.
 *
 * Server component on purpose — the session guard has to run before any screen
 * renders, so an unauthenticated request never ships app markup. The identity
 * is handed to the client tree as data only; the token stays in its httpOnly
 * cookie and is never serialised into the page.
 *
 * It also fetches the shell's own numbers (sidebar badges, folder counts, team
 * folders, envelope quota) and passes them to `Shell` as props. Every call has
 * a fallback: a failing endpoint degrades that badge to blank rather than
 * breaking the chrome around an otherwise working screen.
 */
import { requireSession } from '@/lib/auth/session';
import { SessionProvider, type ClientSession } from '@/components/sf/SessionProvider';
import Shell, { type ShellData } from '@/components/sf/Shell';
import Modals from '@/components/sf/Modals';
import Tour from '@/components/sf/Tour';
import { serverCallerSoft } from '@/lib/api/client';
import {
  billing as billingApi,
  documents as documentsApi,
  folders as foldersApi,
  invoices as invoicesApi,
  logs as logsApi,
  notifications as notificationsApi,
  support as supportApi,
} from '@/lib/api/resources';
import type { FolderResponse, FolderTreeResponse } from '@/lib/api/types';

/** The `/api/billing/usage` row that meters envelopes for the current cycle. */
const ENVELOPE_USAGE_KEY = 'max_documents_per_month';
/** Same retention window the logs screen queries, so the badge matches it. */
const LOG_SINCE_DAYS = 90;
/** How many rows the bell shows before "see all" would be the answer. */
const NOTIFICATION_PAGE = 20;

/** The folder tree, depth-first, with the path in the label so nested folders
 *  stay tellable apart in a flat sidebar list. */
function flattenFolders(tree: FolderTreeResponse): ShellData['userFolders'] {
  const out: ShellData['userFolders'] = [];
  const walk = (nodes: FolderResponse[], prefix: string, scope: string) => {
    for (const node of nodes) {
      const name = prefix ? `${prefix} / ${node.name}` : node.name;
      out.push({ id: node.id, name, count: node.document_count ?? 0, scope: node.scope ?? scope });
      if (node.children?.length) walk(node.children, name, scope);
    }
  };
  walk(tree.personal ?? [], '', 'personal');
  walk(tree.team ?? [], '', 'team');
  return out;
}

async function loadShellData(): Promise<ShellData> {
  /* Soft caller on purpose: the brief is that a failing endpoint blanks its
     badge, so the chrome must not hijack navigation on a 401 — the screen's
     own `serverCaller` still redirects to /login with the right `next`. */
  const api = serverCallerSoft();

  const [countsResult, foldersResult, usageResult, invoicesResult, logsResult, ticketsResult, notificationsResult] =
    await Promise.all([
      documentsApi.counts(api),
      foldersApi.tree(api),
      billingApi.usage(api),
      invoicesApi.list(api, { scope: 'organization' }),
      logsApi.tenant(api, { since_days: LOG_SINCE_DAYS, limit: 1 }),
      supportApi.ticketPage(api, { limit: 1 }),
      /* The bell's first paint, so the badge is correct in server HTML rather
         than appearing a beat after hydration. */
      notificationsApi.list(api, { limit: NOTIFICATION_PAGE }),
    ]);

  const counts = countsResult.ok ? countsResult.data : null;
  const envelopes = usageResult.ok
    ? (usageResult.data.rows.find(row => row.key === ENVELOPE_USAGE_KEY) ?? null)
    : null;
  const ticketCounts = ticketsResult.ok ? ticketsResult.data.counts : null;

  return {
    quick: counts
      ? {
          inbox: counts.inbox,
          outbox: counts.outbox,
          completed: counts.completed,
          drafts: counts.drafts,
          favorites: counts.favorites,
          expiring: counts.expiring,
          shared: counts.shared,
          mine: counts.mine,
        }
      : null,
    folders: counts
      ? {
          documents: counts.all,
          archive: counts.archived,
          templates: counts.templates,
          trash: counts.trashed,
        }
      : null,
    /* The sidebar used to list *teams* here while "New folder" created a
       *folder*, so a new folder never appeared and every team row filtered the
       library by an id that is not a folder. Both now come from the folder
       tree. */
    userFolders: foldersResult.ok ? flattenFolders(foldersResult.data) : [],
    quota: envelopes ? { used: envelopes.used, limit: envelopes.limit, pct: envelopes.pct } : null,
    invoiceCount: invoicesResult.ok ? invoicesResult.data.length : null,
    logCount: logsResult.ok ? logsResult.data.total : null,
    /* The design badges "My tickets" with everything unresolved. */
    openTicketCount: ticketCounts
      ? ticketCounts.open + ticketCounts.pending + ticketCounts.escalated
      : null,
    notifications: notificationsResult.ok ? notificationsResult.data : null,
  };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  const clientSession: ClientSession = {
    userId: session.userId,
    name: session.name,
    email: session.email,
    role: session.role,
    organizationId: session.organizationId,
    organizationName: (session as { organizationName?: string }).organizationName ?? '',
    isPlatformAdmin: session.isPlatformAdmin,
  };

  const shellData = await loadShellData();

  return (
    <SessionProvider session={clientSession}>
      <Shell data={shellData}>{children}</Shell>
      <Modals />
      <Tour />
    </SessionProvider>
  );
}
