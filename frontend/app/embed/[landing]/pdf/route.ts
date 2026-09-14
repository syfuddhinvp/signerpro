/**
 * PDF passthrough for a framed embed session.
 *
 * The same shape as `app/sign/[token]/pdf/route.ts`, and for the same reason:
 * a stream cannot go through `lib/api/*` (JSON only) or `/api/proxy` (which
 * demands an `sf_session` the framed page does not have). The embed token is
 * the credential; the backend re-checks it, and this handler only forwards
 * bytes.
 */

import { backendUrl } from '@/lib/auth/session';

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('session');
  if (!token || token.length < 10) return new Response('Not found', { status: 404 });

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/api/embed/pdf?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
  } catch {
    return new Response('The embed service is unreachable.', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response('This document is not available.', { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': 'inline',
      'cache-control': 'no-store',
    },
  });
}
