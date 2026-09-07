#
# Production image for the SignForge FastAPI backend.
#
# Two stages, so the compiler toolchain (build-essential) needed to build wheels
# never reaches the final image. The runtime stage is non-root, runs gunicorn
# supervising uvicorn workers, declares a HEALTHCHECK, and migrates the database
# under a Postgres advisory lock before serving (see docker-entrypoint.sh).

ARG PYTHON_VERSION=3.12

# ---------------------------------------------------------------- builder
FROM python:${PYTHON_VERSION}-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

# Build into a self-contained virtualenv that the runtime stage copies wholesale.
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
# gunicorn is a deployment concern, not an application dependency, so it is
# installed here rather than in requirements.txt (shared with tests and local
# dev). Pinned for reproducibility.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir "gunicorn==23.0.0"

# ---------------------------------------------------------------- runtime
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    UPLOAD_DIR=/app/uploads \
    PORT=8000 \
    WEB_CONCURRENCY=4

# curl is for the HEALTHCHECK only. Migrations talk to Postgres through psycopg
# from the venv, so no postgresql-client is needed. libreoffice-core plus the
# writer/calc/impress filters convert uploaded Office documents to PDF
# (conversion_service); without them those uploads are refused at upload time
# rather than failing later.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        libreoffice-writer \
        libreoffice-calc \
        libreoffice-impress \
        fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 signforge \
    && useradd --system --uid 1001 --gid signforge --create-home signforge

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv

COPY --chown=signforge:signforge app ./app
COPY --chown=signforge:signforge scripts ./scripts
COPY --chown=signforge:signforge alembic.ini ./alembic.ini
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY migrate.py /usr/local/bin/migrate.py

RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh /usr/local/bin/migrate.py \
    && mkdir -p /app/uploads \
    && chown -R signforge:signforge /app/uploads

USER signforge

EXPOSE 8000

# LIVENESS, deliberately -- not /api/health/ready.
#
# A failed Docker HEALTHCHECK is a *restart* signal (Swarm replaces the task;
# `docker run --restart` and most supervisors act the same way). Readiness
# asks "should this replica receive traffic", and its answer depends on shared
# dependencies: one Postgres failover would fail /api/health/ready on every
# replica simultaneously and roll the entire fleet, turning a 5-second blip
# into an outage. So the container-level probe stays on the cheap,
# dependency-free liveness endpoint, which only fails when this process is
# genuinely wedged.
#
# The readiness endpoint is used where readiness is what is actually being
# asked: the compose healthcheck that gates `depends_on: service_healthy` for
# the frontend and the scheduler containers (see docker-compose.prod.yml), and
# your load balancer's target-group health check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]

# gunicorn supervises WEB_CONCURRENCY uvicorn workers: a crashed worker is
# replaced instead of taking the whole container down, and SIGTERM drains
# in-flight requests instead of severing them.
CMD ["sh", "-c", "exec gunicorn app.main:app --worker-class uvicorn.workers.UvicornWorker --workers ${WEB_CONCURRENCY} --bind 0.0.0.0:${PORT} --timeout 60 --graceful-timeout 30 --keep-alive 5 --access-logfile - --error-logfile -"]
