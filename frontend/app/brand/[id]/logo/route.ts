/**
 * Public logo passthrough for a branding theme.
 *
 * This URL is embedded in invitation emails, so it is fetched by recipients'
 * mail clients — which have no session and cannot use `/api/proxy`. Same shape
 * as the signing PDF passthrough: forward bytes, never attach a session token.
 *
 * It lives on the frontend origin rather than the backend's because that is the
 * origin which is actually public; `app_base_url` is what the backend builds
 * the URL from.
 */

import { backendUrl } from '@/lib/auth/session';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  if (!id || id.includes('/') || id.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `${backendUrl()}/api/branding-themes/${encodeURIComponent(id)}/logo`,
      { cache: 'no-store' },
    );
  } catch {
    return new Response('The branding service is unreachable.', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response('No logo', { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'image/png',
      // The URL the backend hands out is cache-busted whenever the theme
      // changes, so this can be cached hard by mail clients and proxies.
      'cache-control': 'public, max-age=86400',
    },
  });
}
