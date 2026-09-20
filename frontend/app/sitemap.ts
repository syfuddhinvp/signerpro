/**
 * The sitemap.
 *
 * Generated from the same modules the pages are generated from, so a route
 * added to `competitors.ts`, `templates.ts` or `verticals.ts` is listed here
 * without anyone remembering. A generated page that is missing from the
 * sitemap and linked only from a deep footer column is a page that may never
 * be crawled, which would waste the whole acquisition tier.
 *
 * `NEXT_PUBLIC_SITE_URL` is the canonical origin. It has no sensible default —
 * guessing one emits absolute URLs pointing at somebody else's domain — so if
 * it is unset the sitemap is served empty and the omission is visible.
 */
import type { MetadataRoute } from 'next';
import { COMPETITORS } from '@/lib/marketing/competitors';
import { TEMPLATE_GUIDES } from '@/lib/marketing/templates';

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? '';

/** Routes that exist as files rather than as data. */
const STATIC_ROUTES: { path: string; priority: number; changeFrequency: 'weekly' | 'monthly' }[] = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/product', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/developers', priority: 0.8, changeFrequency: 'weekly' },
  { path: '/product/payments', priority: 0.8, changeFrequency: 'monthly' },
  { path: '/product/routing', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/product/audit-trail', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/product/templates', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/product/signing', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/product/branding', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/security', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/trust', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/legality', priority: 0.6, changeFrequency: 'monthly' },
  { path: '/templates', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/solutions', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/changelog', priority: 0.5, changeFrequency: 'weekly' },
];

/** Kept in step with `lib/marketing/verticals.ts`. */
const VERTICAL_SLUGS = [
  'real-estate',
  'mortgage',
  'property-management',
  'professional-services',
  'hr',
  'legal',
];

/** The competitors we publish a full round-up for, not just a comparison. */
const ROUNDUP_SLUGS = ['docusign', 'adobe-acrobat-sign', 'dropbox-sign'];

export default function sitemap(): MetadataRoute.Sitemap {
  if (!ORIGIN) return [];

  const now = new Date();
  const entry = (path: string, priority: number, changeFrequency: 'weekly' | 'monthly') => ({
    url: `${ORIGIN}${path}`,
    lastModified: now,
    changeFrequency,
    priority,
  });

  return [
    ...STATIC_ROUTES.map(route => entry(route.path, route.priority, route.changeFrequency)),
    ...COMPETITORS.map(competitor => entry(`/vs/${competitor.slug}`, 0.8, 'monthly' as const)),
    ...ROUNDUP_SLUGS.map(slug => entry(`/alternatives/${slug}`, 0.8, 'monthly' as const)),
    ...TEMPLATE_GUIDES.map(guide => entry(`/templates/${guide.slug}`, 0.6, 'monthly' as const)),
    ...VERTICAL_SLUGS.map(slug => entry(`/solutions/${slug}`, 0.7, 'monthly' as const)),
  ];
}
