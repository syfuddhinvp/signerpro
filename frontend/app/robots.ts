/**
 * robots.txt.
 *
 * The marketing tree is open. Everything behind a session, every signing
 * surface and every embed is disallowed: a signing link is a bearer token in a
 * URL, and an indexed one is a signature anybody can forge. `/verify` stays
 * crawlable because a public verification page is the point.
 */
import type { MetadataRoute } from 'next';

const ORIGIN = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? '';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/sign/',      // tokenised signing links
          '/embed/',     // scoped embed sessions
          '/invite/',
          '/platform/',
          '/overview',
          '/documents',
          '/contacts',
          '/account',
          '/notifications',
          '/reports',
          '/support',
          // `/developer/*` is the signed-in console. `/developers` is the
          // public marketing page and must stay crawlable, so the rule carries
          // the trailing slash that separates them.
          '/developer/',
        ],
      },
    ],
    sitemap: ORIGIN ? `${ORIGIN}/sitemap.xml` : undefined,
  };
}
