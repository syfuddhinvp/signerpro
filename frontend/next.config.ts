import type { NextConfig } from "next";

/**
 * pdf.js notes (see `components/sf/pdf/pdfjs.ts`):
 *
 * - The worker is referenced as `new URL('pdfjs-dist/build/pdf.worker.min.mjs',
 *   import.meta.url)`, which both webpack and Turbopack turn into an emitted,
 *   same-origin asset. Nothing is fetched from a CDN, and the worker build
 *   always matches the API build — a mismatch makes pdf.js refuse to render.
 * - `canvas` is pdf.js's optional *Node* backend. It is never used in the
 *   browser, and resolving it would drag a native module into the bundle, so it
 *   is aliased away.
 */

const isDev = process.env.NODE_ENV !== "production";

/**
 * Origins permitted to frame the signing surface.
 *
 * Framing is a real product requirement — the embed flow puts the signing page
 * inside a customer's own application — but it is also the clickjacking
 * vector, and this is e-signature software: a signing page that any site can
 * frame invisibly can be tricked into producing a *signature*. So the default
 * is `'none'` and framing is opt-in per deployment.
 *
 * `EMBED_FRAME_ANCESTORS` is a space-separated CSP source list, e.g.
 * `"https://app.customer.com https://*.partner.io"`. It is read at **build**
 * time, not at runtime: `headers()` is resolved during `next build` and baked
 * into `routes-manifest.json`, so it must be passed as a Docker build arg, not
 * a container env var. Note that per-tenant
 * `organizations.allowed_origins` cannot be expressed here at all — a static
 * config cannot know the tenant.
 *
 * This env var therefore governs `/sign/*` only. Per-tenant framing lives on
 * `/embed/*`, where `middleware.ts` computes `frame-ancestors` from the embed
 * session's own allowlist and sets the header on the response, overriding the
 * static one below for that path.
 */
const embedFrameAncestors = (process.env.EMBED_FRAME_ANCESTORS ?? "").trim();
const signingFrameAncestors = embedFrameAncestors || "'none'";

/**
 * `unsafe-inline` on `script-src` is required by the App Router: Next inlines
 * its bootstrap and flight-payload scripts. Removing it means adopting
 * nonce-based CSP, which needs a nonce minted per request in middleware and
 * threaded into the document — worth doing, and deliberately out of scope
 * here rather than silently half-applied.
 *
 * `unsafe-eval` is dev-only (React Refresh); production never gets it.
 */
/** Stripe's documented CSP origins for Checkout / Elements. */
const STRIPE_SCRIPT_ORIGIN = "https://js.stripe.com";
const STRIPE_FRAME_ORIGINS = "https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com";
const STRIPE_CONNECT_ORIGINS = "https://api.stripe.com https://maps.stripe.com https://js.stripe.com";

function contentSecurityPolicy(frameAncestors: string): string {
  return [
    "default-src 'self'",
    // js.stripe.com is Stripe.js itself, which mounts the embedded Checkout
    // iframe. It is the one third-party script this app loads, and it is what
    // keeps card data out of our own DOM (see components/sf/StripeCheckout).
    `script-src 'self' 'unsafe-inline' ${STRIPE_SCRIPT_ORIGIN}${isDev ? " 'unsafe-eval'" : ""}`,
    // Tailwind/inline styles.
    "style-src 'self' 'unsafe-inline'",
    // `data:` for inline icons, `blob:` for pdf.js canvas output and signature
    // images drawn client-side.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Same-origin only: the browser reaches the API through /api/proxy, never
    // directly. In dev the websocket is Next's HMR channel.
    `connect-src 'self' ${STRIPE_CONNECT_ORIGINS}${isDev ? " ws: wss:" : ""}`,
    // pdf.js runs its parser in a worker created from a bundled asset.
    "worker-src 'self' blob:",
    // No plugins, no <base> hijacking, no cross-origin form posts.
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Frames this page is allowed to *embed*. Without it `default-src 'self'`
    // applies and Stripe's Checkout iframe is blocked outright.
    `frame-src 'self' ${STRIPE_FRAME_ORIGINS}`,
    `frame-ancestors ${frameAncestors}`,
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Headers every route gets, framing aside. */
const baseSecurityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Send the origin cross-site, the full URL same-origin. Signing URLs carry a
  // bearer token in the path, so leaking a full Referer off-site would leak
  // the ability to sign.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here uses these; deny them rather than inherit browser defaults.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  // HSTS is only meaningful over TLS, and pinning it in local development
  // would poison `http://localhost` for two years.
  ...(isDev
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emits `.next/standalone` containing only the files actually imported,
  // instead of shipping all of node_modules: 572 MB of dependencies becomes a
  // 187 MB self-contained tree.
  //
  // NOTE: `frontend/Dockerfile` does not yet consume this -- its runner still
  // copies the full node_modules and runs `next start`. Enabling it here is the
  // prerequisite; the image only shrinks once that runner copies
  // `.next/standalone` + `.next/static` and runs `node server.js`.
  output: "standalone",
  // Without this, Next walks up past the repo root looking for a lockfile and
  // nests the output at `.next/standalone/<absolute/build/path>/server.js`,
  // which no Dockerfile can predict. Pin the trace root to this project so
  // `server.js` lands at `.next/standalone/server.js`.
  outputFileTracingRoot: process.cwd(),
  turbopack: {
    resolveAlias: { canvas: './components/sf/pdf/empty.js' },
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = { ...(config.resolve.alias ?? {}), canvas: false };
    return config;
  },
  /**
   * Routes that moved. Billing is an account section now (`/account/billing`),
   * and Invoices, Subscription and Payment services were folded into Billing &
   * plan rather than kept as three more pages saying the same thing. Bookmarks and any
   * `?next=` still in flight land on the screen that owns the content.
   */
  async redirects() {
    return [
      { source: "/billing", destination: "/account/billing", permanent: true },
      { source: "/billing/invoices", destination: "/account/billing", permanent: true },
      { source: "/account/invoices", destination: "/account/billing", permanent: true },
      { source: "/account/subscription", destination: "/account/billing", permanent: true },
      { source: "/account/payment", destination: "/account/billing", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // The signing surface: framing allowed only where explicitly configured.
        source: "/sign/:path*",
        headers: [
          ...baseSecurityHeaders,
          { key: "Content-Security-Policy", value: contentSecurityPolicy(signingFrameAncestors) },
          // Legacy fallback for browsers predating frame-ancestors. It has no
          // allowlist form, so it is only emitted when framing is fully denied.
          ...(signingFrameAncestors === "'none'"
            ? [{ key: "X-Frame-Options", value: "DENY" }]
            : []),
        ],
      },
      {
        // The mail outbox's message preview. It exists *only* to be framed by
        // the reading pane, so the blanket `frame-ancestors 'none'` below would
        // stop it rendering at all — which is also why the obvious
        // `<iframe srcDoc>` shows nothing here: a srcdoc frame inherits the
        // framing page's policy, including its refusal to be framed.
        //
        // No CSP is emitted for it here: the route handler serves its own,
        // much tighter one (`default-src 'none'`, images only as data: URIs),
        // and two policies on one response would be intersected into something
        // neither of them describes.
        source: "/platform/mail/:id/preview",
        headers: [
          ...baseSecurityHeaders,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // Everything else — the authenticated application — is never framed.
        // The preview above is excluded by path rather than by being listed
        // first: Next applies every matching rule, so a later catch-all would
        // otherwise re-add the `DENY` this one is here to avoid.
        source: "/((?!platform/mail/[^/]+/preview$).*)",
        headers: [
          ...baseSecurityHeaders,
          { key: "Content-Security-Policy", value: contentSecurityPolicy("'none'") },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
