/**
 * Public PDF passthrough for a signing session.
 *
 * `GET /api/sign/{token}/pdf` streams a file, so it cannot go through
 * `lib/api/*` (JSON only) nor `/api/proxy` (which demands an `sf_session` the
 * recipient does not have). The signing token in the path *is* the credential,
 * and the backend re-checks it — plus OTP and consent — on every request; this
 * handler only forwards bytes and never sees a session token.
 */

import { backendUrl } from '@/lib/auth/session';

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params;
  if (!token || token.includes('/') || token.includes('..')) {
    return new Response('Not found', { status: 404 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/api/sign/${encodeURIComponent(token)}/pdf`, { cache: 'no-store' });
  } catch {
    return new Response('The signing service is unreachable.', { status: 502 });
  }

  if (!upstream.ok) {
    return new Response('This document is not available for download.', { status: upstream.status });
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': upstream.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'no-store',
    },
  });
}
