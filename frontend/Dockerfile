#
# Production image for the SignForge Next.js frontend.
#
# Three stages: deps -> build -> runner. The runner carries no source, no dev
# dependencies, no package manager and no node_modules, and runs as non-root.
#
# The runner consumes Next's `output: 'standalone'` build (set in
# next.config.ts): `.next/standalone` is a self-contained tree holding only the
# modules the server actually imports, so the runner copies ~187 MB instead of
# the ~572 MB full node_modules and starts `node server.js` directly rather
# than shelling out to the `next` CLI. If you ever remove `output: 'standalone'`
# from next.config.ts this build FAILS at the COPY below rather than silently
# producing a broken image -- which is the intent.

ARG NODE_VERSION=22.19.0

# ---------------------------------------------------------------- deps
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app

# pnpm is pinned by the `packageManager` field and activated via corepack, so
# the image cannot drift onto a different pnpm than local development uses.
RUN corepack enable

# pnpm-workspace.yaml is REQUIRED here, not optional: pnpm 11 reads `overrides`
# from it (it no longer reads package.json's `pnpm` field), and those overrides
# are what force Next's vendored postcss onto a patched version. Omit this file
# and the image builds cleanly while carrying 4 known advisories.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# `--frozen-lockfile` (pnpm's equivalent of `npm ci`): fails if package.json and
# the lockfile disagree, so the image is built from exactly the pinned graph.
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------- build
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
# Production build: enables `secure` cookies, disables the dev error overlay.
ENV NODE_ENV=production

# pnpm's node_modules is a symlink farm into node_modules/.pnpm; copying the
# directory wholesale preserves those links, and Next's output-file tracing
# resolves through them when producing the standalone tree.
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so they must be present here.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Stripe's *publishable* key. Safe in the image and in the bundle by design --
# that is what publishable means. The secret key belongs only to the backend.
# Like every NEXT_PUBLIC_* value it is inlined here, so changing it needs a
# rebuild; passing it at runtime does nothing.
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=""
ENV NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY}

# Origins permitted to frame /sign/* (the embed flow), as a space-separated CSP
# source list, e.g. "https://app.customer.com https://*.partner.io". Empty ->
# `frame-ancestors 'none'`, which is the safe default for e-signature software.
#
# This is a BUILD ARG and not a runtime environment variable, and it cannot be
# made one: next.config.ts#headers() is evaluated during `next build` and its
# result is baked into `.next/routes-manifest.json`. A container that receives
# EMBED_FRAME_ANCESTORS at runtime serves whatever value was present at build
# time and reports no error -- so passing it to `docker run`/compose
# `environment:` silently does nothing. Changing the allowlist means rebuilding
# the image.
ARG EMBED_FRAME_ANCESTORS=""
ENV EMBED_FRAME_ANCESTORS=${EMBED_FRAME_ANCESTORS}

RUN corepack enable && pnpm build

# ---------------------------------------------------------------- runner
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN apk add --no-cache curl \
    && addgroup -g 1001 -S nodejs \
    && adduser -u 1001 -S nextjs -G nodejs

# Static assets and anything under public/ are NOT included in the standalone
# tree -- Next expects them to be copied alongside it.
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

# Liveness for this container: /login is a real rendered route, so a wedged
# Node process fails it. It touches no backend dependency, so a database blip
# does not restart every frontend replica.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/login" >/dev/null || exit 1

# The standalone server: a plain Node process, no `next` CLI, no npm in the
# image at all. Honours PORT/HOSTNAME from the environment above.
CMD ["node", "server.js"]
