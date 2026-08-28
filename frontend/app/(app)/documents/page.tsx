/**
 * Document library — server component.
 *
 * The library's filters live in `lib/sf/state.tsx` (ephemeral UI state), but
 * the *data* they select is fetched here. The screen mirrors every filter into
 * the URL (`?folder=archive&status=draft&q=nda…`) and Next re-runs this page,
 * so the query params, the selects and the rows can never disagree — and a
 * filtered library is a link you can share, bookmark and refresh.
 */

import type { Metadata } from 'next';
import Library from '@/components/sf/screens/Library';
import { serverCaller } from '@/lib/api/client';
import {
  documents as documentsApi,
  folders as foldersApi,
  templates as templatesApi,
} from '@/lib/api/resources';
import {
  libraryFiltersFromQuery,
  toFolderOptions,
  toLibraryParams,
  toLibraryRows,
  toTemplateParams,
  toTemplateRows,
} from '@/lib/sf/adapters';
import { DOCS, TEMPLATES } from '@/lib/sf/data';
import type { DocumentCounts, FolderTreeResponse } from '@/lib/api/types';

export const metadata: Metadata = { title: 'Documents · SignForge' };

/**
 * The design has no pager: it renders one screenful of rows. We keep exactly
 * that many, and surface the real `total` in the count label instead.
 */
const DOC_PAGE_SIZE = DOCS.length;
const TEMPLATE_PAGE_SIZE = TEMPLATES.length;

const EMPTY_COUNTS: DocumentCounts = {
  all: 0, action: 0, waiting: 0, completed: 0, draft: 0,
  voided: 0, archived: 0, trashed: 0, templates: 0,
};

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const filters = libraryFiltersFromQuery(key => {
    const value = sp[key];
    return Array.isArray(value) ? value[0] : value;
  });

  const api = serverCaller('/documents');
  const isTemplateFolder = filters.folder === 'templates';

  const [libraryResult, countsResult, templatesResult, treeResult] = await Promise.all([
    documentsApi.library(api, toLibraryParams(filters, DOC_PAGE_SIZE)),
    documentsApi.counts(api),
    templatesApi.list(api, toTemplateParams(filters, TEMPLATE_PAGE_SIZE)),
    foldersApi.tree(api),
  ]);

  const counts: DocumentCounts = countsResult.ok ? countsResult.data : EMPTY_COUNTS;
  const library = libraryResult.ok
    ? libraryResult.data
    // FALLBACK: the counts endpoint still tells us how big the folder is.
    : { items: [], total: counts.all, limit: DOC_PAGE_SIZE, offset: 0, counts };
  const templateList = templatesResult.ok ? templatesResult.data : { items: [], total: counts.templates };
  const tree: FolderTreeResponse | null = treeResult.ok ? treeResult.data : null;

  return (
    <Library
      rows={toLibraryRows(library.items)}
      total={library.total}
      templates={toTemplateRows(templateList.items)}
      templateTotal={isTemplateFolder ? templateList.total : counts.templates}
      folderOptions={toFolderOptions(tree)}
      initialFilters={filters}
    />
  );
}
