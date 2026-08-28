/**
 * Session proxy: `/api/proxy/<rest>` → `<BACKEND_URL>/api/<rest>`.
 *
 * The browser cannot read the httpOnly `sf_session` cookie, so client
 * components call here and this handler attaches the bearer token. Method,
 * query string, JSON body, status code and JSON response pass straight
 * through; only `/api/*` targets on the backend are reachable.
 */

import { NextResponse } from 'next/server';
import { backendUrl, getSession } from '@/lib/auth/session';

const FORWARDED_REQUEST_HEADERS = ['content-type', 'accept', 'idempotency-key'];

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
    const raw = await request.text();
    if (raw) body = raw;
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

  if (upstream.status === 204) return new NextResponse(null, { status: 204 });

  const text = await upstream.text();
  const contentType = upstream.headers.get('content-type') ?? 'application/json';
  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  });
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
