#!/bin/sh
# SignForge backend container entrypoint.
#
#   1. Wait for Postgres to accept connections.
#   2. Run `alembic upgrade head` under a Postgres advisory lock, so that when N
#      replicas start simultaneously exactly one migrates and the others block
#      until it finishes, then proceed. Without this, concurrent `alembic
#      upgrade` runs race on `alembic_version` and can deadlock or double-apply.
#   3. exec the CMD as PID 1, so SIGTERM reaches it directly and gunicorn can
#      drain gracefully.
#
# Env:
#   RUN_MIGRATIONS=0     skip migrations (use for worker/cron containers)
#   MIGRATION_LOCK_ID    advisory lock key; must be identical across replicas
#   DB_WAIT_TIMEOUT      seconds to wait for the database before failing
set -eu

: "${RUN_MIGRATIONS:=1}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "entrypoint: DATABASE_URL is unset; skipping wait and migrations" >&2
elif [ "$RUN_MIGRATIONS" = "1" ]; then
  python /usr/local/bin/migrate.py
else
  echo "entrypoint: RUN_MIGRATIONS=0; skipping migrations" >&2
fi

echo "entrypoint: starting: $*" >&2
exec "$@"
