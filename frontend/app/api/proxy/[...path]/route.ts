/**
 * Session proxy: `/api/proxy/<rest>` → `<BACKEND_URL>/api/<rest>`.
 *
 * The browser cannot read the httpOnly `sf_session` cookie, so client
 * components call here and this handler attaches the bearer token. Method,
 * query string, request body, status code and response body pass straight
 * through; only `/api/*` targets on the backend are reachable.
 *
 * The response is streamed back byte-for-byte, so a PDF, a zip
 * (`/api/documents/bulk-download`), an invoice PDF/receipt or a report CSV
 * survives the hop intact — `content-type` and `content-disposition` are
 * preserved. `content-length`/`content-encoding` are deliberately dropped:
 * `fetch` transparently decompresses, so the upstream values no longer
 * describe the bytes we are re-emitting.
 */

import { NextResponse } from 'next/server';
import { backendUrl, getSession } from '@/lib/auth/session';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];

/**
 * Response headers copied from upstream. Everything else (hop-by-hop headers,
 * upstream cookies) is dropped.
 */
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'etag',
  'last-modified',
];

function unauthorized() {
  return NextResponse.json({ detail: 'Your session has expired.' }, { status: 401 });
}

/** Reject traversal and anything that would land outside `/api/` upstream. */
function backendPath(segments: string[]): string | null {
  if (!segments.length) return null;
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) return null;
  const path = `/api/${segments.map(encodeURIComponent).join('/')}`;
  if (!path.startsWith('/api/')) return null;
  return path;
}

async function forward(request: Request, segments: string[]): Promise<Response> {
  const path = backendPath(segments);
  if (!path) return NextResponse.json({ detail: 'Unsupported proxy path.' }, { status: 400 });

  const session = await getSession();
  if (!session) return unauthorized();

  const incoming = new URL(request.url);
  const target = `${backendUrl()}${path}${incoming.search}`;

  const headers = new Headers({ authorization: `Bearer ${session.token}` });
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const method = request.method.toUpperCase();
  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE') {
    // Bytes, not text: an upload body must not be decoded/re-encoded.
    const raw = await request.arrayBuffer();
    if (raw.byteLength) body = raw;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, { method, headers, body, cache: 'no-store' });
  } catch {
    return NextResponse.json(
      { detail: `Cannot reach the SignForge API at ${target}.` },
      { status: 503 },
    );
  }

  if (upstream.status === 204 || upstream.status === 304) {
    return new NextResponse(null, { status: upstream.status });
  }

  const responseHeaders = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (!responseHeaders.has('content-type')) responseHeaders.set('content-type', 'application/json');

  // Stream the body through untouched — `upstream.text()` would corrupt any
  // non-UTF-8 payload (PDF, zip, xlsx) and re-encode CSV/BOM bytes.
  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function POST(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function PATCH(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function PUT(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: Ctx) {
  return forward(request, (await ctx.params).path);
}
