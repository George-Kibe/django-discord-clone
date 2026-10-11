# syntax=docker/dockerfile:1.7
ARG PYTHON_VERSION=3.14
ARG UV_VERSION=0.13.0

FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv

# ---------------------------------------------------------------------------- base
FROM python:${PYTHON_VERSION}-slim-trixie AS base
ARG UID=1000
ARG GID=1000
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"
COPY --from=uv /uv /uvx /usr/local/bin/
# uv manages packages; drop pip (and its vendored urllib3/msgpack/setuptools) from the image.
RUN python -m pip uninstall -y -q pip \
 && rm -f /usr/local/lib/python*/ensurepip/_bundled/*.whl
RUN groupadd --system --gid ${GID} app \
 && useradd --system --uid ${UID} --gid app --create-home --home-dir /home/app app \
 && mkdir -p /app /opt/venv \
 && chown app:app /app /opt/venv
WORKDIR /app
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]
EXPOSE 8000

# ---------------------------------------------------------------------------- dev
# Source is bind-mounted over /app; the venv lives in /opt/venv so the mount doesn't hide it.
FROM base AS dev
USER app
RUN --mount=type=cache,target=/home/app/.cache/uv,uid=${UID},gid=${GID} \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    uv sync --locked
ENV DJANGO_SETTINGS_MODULE=config.settings.dev
CMD ["api"]

# ---------------------------------------------------------------------------- builder
FROM base AS builder
USER app
RUN --mount=type=cache,target=/home/app/.cache/uv,uid=${UID},gid=${GID} \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    uv sync --locked --no-dev

# ---------------------------------------------------------------------------- prod
FROM base AS prod
ARG GIT_SHA=unknown
ENV DJANGO_SETTINGS_MODULE=config.settings.prod \
    GIT_SHA=${GIT_SHA}
COPY --from=builder --chown=app:app /opt/venv /opt/venv
COPY --chown=app:app . /app
USER app
# collectstatic needs settings to import; these placeholders never reach runtime.
RUN DJANGO_SECRET_KEY=build-only DATABASE_URL=postgres://build@localhost/build \
    python manage.py collectstatic --noinput
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://localhost:8000/api/health/live', timeout=4).status != 200)"
CMD ["api"]
