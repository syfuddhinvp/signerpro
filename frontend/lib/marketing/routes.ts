/**
 * The marketing site's public route prefixes.
 *
 * `middleware.ts` treats everything as private unless it is listed here, which
 * is the right default for e-signature software but means a new marketing page
 * ships behind the login wall unless somebody remembers this file. That is
 * exactly what happened when the site grew from one page to thirty: `/pricing`,
 * `/trust` and every generated comparison page answered a redirect to `/login`
 * while building and type-checking perfectly.
 *
 * So the list is kept here beside the pages rather than inline in the
 * middleware, and `test/marketing-routes.test.ts` walks `app/(marketing)/` and
 * fails if a route directory is not covered. Adding a page and forgetting to
 * publish it is now a failing test rather than a silent redirect.
 *
 * Keep this module free of imports: it is pulled into the edge middleware
 * bundle.
 */
export const MARKETING_PUBLIC_PREFIXES = [
  '/product',
  '/pricing',
  '/developers',
  '/templates',
  '/solutions',
  '/vs',
  '/alternatives',
  '/security',
  '/trust',
  '/legality',
  '/changelog',
  '/legal',
] as const;
