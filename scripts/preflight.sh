#!/usr/bin/env bash
# Preflight for a SignForge production deploy.
#
# Every check here corresponds to a failure that is otherwise silent, delayed,
# or actively misleading -- a stack that comes up "healthy" and is wrong. Run it
# against the env file you are about to deploy with:
#
#     scripts/preflight.sh .env.prod
#
# Exits non-zero on the first hard failure; warnings do not block.
set -uo pipefail

ENV_FILE="${1:-.env.prod}"
fail=0
red()  { printf '\033[31mFAIL\033[0m  %s\n' "$1"; fail=1; }
warn() { printf '\033[33mWARN\033[0m  %s\n' "$1"; }
ok()   { printf '\033[32mok\033[0m    %s\n' "$1"; }

[ -f "$ENV_FILE" ] || { red "$ENV_FILE does not exist"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$ENV_FILE"; set +a

req() {
  local name="$1" min="${2:-1}" value="${!1:-}"
  if [ -z "$value" ]; then red "$name is unset or empty"; return; fi
  if [ "${#value}" -lt "$min" ]; then red "$name is shorter than $min characters"; return; fi
  ok "$name set"
}

echo "== Required secrets =="
# 32 chars is the floor the backend's own startup guard enforces; failing here
# is far cheaper than failing after the image is deployed.
req POSTGRES_PASSWORD 16
req JWT_SECRET 32
req SECRET_ENCRYPTION_KEY 32
# Also 32-char guarded, in billing_service.InsecureBillingWebhookSecret. This
# one is easy to miss: .env.prod.example does not mark it REQUIRED, and the
# failure lands as a worker-boot loop inside a lifespan traceback rather than
# as a config error -- the stack simply reports the backend "unhealthy".
req BILLING_WEBHOOK_SECRET 32

echo
echo "== Secrets must not be the published defaults =="
for var in JWT_SECRET SECRET_ENCRYPTION_KEY POSTGRES_PASSWORD BILLING_WEBHOOK_SECRET; do
  case "${!var:-}" in
    *change-me*|*changeme*|*ci-placeholder*|*not-a-real-secret*|signforge|postgres|secret)
      red "$var looks like a placeholder, not a generated secret (openssl rand -base64 32)" ;;
  esac
done

echo
echo "== URLs =="
req APP_BASE_URL 8
req CORS_ORIGINS 8
req NEXT_PUBLIC_API_URL 8
case "${APP_BASE_URL:-}" in
  https://*) ok "APP_BASE_URL is https" ;;
  *) red "APP_BASE_URL must be https -- session cookies are Secure and will not be sent over http" ;;
esac
case "${CORS_ORIGINS:-}" in
  *"*"*) red "CORS_ORIGINS contains '*'; the API is credentialed and rejects a wildcard" ;;
  *) ok "CORS_ORIGINS has no wildcard" ;;
esac

echo
echo "== Billing =="
# The backend's startup guard rejects BILLING_PROVIDER=null outright, so the
# stack would crashloop rather than run unbilled.
case "${BILLING_PROVIDER:-}" in
  stripe)
    ok "BILLING_PROVIDER=stripe"
    req STRIPE_SECRET_KEY 10
    req STRIPE_WEBHOOK_SECRET 10
    [ -n "${NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:-}" ] \
      || warn "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is empty -- payments cannot be collected in the UI"
    case "${STRIPE_SECRET_KEY:-}" in
      sk_test_*) warn "STRIPE_SECRET_KEY is a TEST key; this deploy will not take real payments" ;;
      sk_live_*) ok "STRIPE_SECRET_KEY is a live key" ;;
      *) red "STRIPE_SECRET_KEY does not look like a Stripe secret key" ;;
    esac ;;
  ""|null) red "BILLING_PROVIDER must be 'stripe'; the backend refuses to start on null" ;;
  *) red "BILLING_PROVIDER='${BILLING_PROVIDER}' is not a supported provider" ;;
esac

echo
echo "== Build-time values (changing these needs an image rebuild, not a restart) =="
# next.config.ts#headers() runs during `next build`, so the CSP is baked into
# routes-manifest.json. Setting it at runtime looks like it worked and does not.
warn "EMBED_FRAME_ANCESTORS='${EMBED_FRAME_ANCESTORS:-}' and NEXT_PUBLIC_* are baked into the frontend image at build time"

echo
echo "== Compose validation =="
if command -v docker >/dev/null 2>&1; then
  if docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" config -q 2>/dev/null; then
    ok "docker-compose.prod.yml resolves against $ENV_FILE"
  else
    red "docker-compose.prod.yml failed to resolve -- a required variable is missing"
  fi
else
  warn "docker not on PATH; skipped compose validation"
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "preflight FAILED -- do not deploy"; exit 1
fi
echo "preflight passed"
