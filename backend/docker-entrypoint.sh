#!/bin/sh
# Single image, several roles: api | worker | beat | migrate | <any command>.
set -eu

case "${1:-api}" in
  api)
    if [ "${DJANGO_SETTINGS_MODULE:-}" = "config.settings.dev" ]; then
      python manage.py migrate --noinput
      exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 \
        --reload --reload-dir /app --proxy-headers --forwarded-allow-ips='*'
    fi
    exec uvicorn config.asgi:application --host 0.0.0.0 --port 8000 \
      --workers "${UVICORN_WORKERS:-2}" --proxy-headers --forwarded-allow-ips='*' \
      --no-server-header
    ;;
  worker)
    if [ "${DJANGO_SETTINGS_MODULE:-}" = "config.settings.dev" ]; then
      exec watchfiles --filter python \
        "celery -A config worker --loglevel=${LOG_LEVEL:-INFO} --concurrency=${CELERY_CONCURRENCY:-2} -Q default,heavy" /app
    fi
    exec celery -A config worker --loglevel="${LOG_LEVEL:-INFO}" \
      --concurrency="${CELERY_CONCURRENCY:-2}" -Q default,heavy
    ;;
  beat)
    exec celery -A config beat --loglevel="${LOG_LEVEL:-INFO}" \
      --schedule=/tmp/celerybeat-schedule
    ;;
  migrate)
    exec python manage.py migrate --noinput
    ;;
  *)
    exec "$@"
    ;;
esac
