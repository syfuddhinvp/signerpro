/**
 * The stored body of one message, served as a document the reading pane frames.
 *
 * The obvious implementation — `<iframe srcDoc={row.body_html}>` — renders
 * blank here. A `srcdoc` frame inherits this app's page CSP, which is written
 * for the app (`default-src 'self'` against our own origin) and not for a mail
 * body, and the frame ends up with nothing it is allowed to be. Serving the
 * body from our own origin instead makes the frame an ordinary same-origin
 * document that `frame-src 'self'` plainly permits, and lets it carry a policy
 * of its own — which is the stricter arrangement anyway:
 *
 *   default-src 'none'  — no scripts, no fetches, no frames, nothing loads
 *   style-src 'unsafe-inline' — mail is inline styles or it is nothing
 *   img-src data:       — embedded images render; remote ones do not, so
 *                         opening a message cannot phone home to a tracking
 *                         pixel and tell a sender that an admin read it
 *
 * Guarded here in its own right: a route handler is not covered by the
 * platform layout's guard, and this returns another tenant's mail.
 */
import { NextResponse } from 'next/server';
import { requirePlatformSession } from '@/lib/auth/session';
import { serverCallerSoft } from '@/lib/api/client';
import { mail as mailApi } from '@/lib/api/resources';

const FRAME_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  /* Only this app may frame it; it is never a page on its own. */
  "frame-ancestors 'self'",
].join('; ');

/** What the frame shows when a message was stored without a body. */
const EMPTY = `<!doctype html><html><body style="margin:0;padding:18px;font:14px Helvetica,Arial,sans-serif;color:#5b6675;background:#fff;">This message has no HTML part.</body></html>`;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requirePlatformSession();
  const { id } = await params;

  const result = await mailApi.detail(serverCallerSoft(), id);
  if (!result.ok) {
    return new NextResponse('Message not found', { status: result.error.status === 404 ? 404 : 502 });
  }

  return new NextResponse(result.data.body_html || EMPTY, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': FRAME_POLICY,
      'X-Content-Type-Options': 'nosniff',
      /* A stored body is a record, and the record can be corrected (an erasure
         request redacts it). Never let a proxy or the browser keep a copy. */
      'Cache-Control': 'no-store',
    },
  });
}
