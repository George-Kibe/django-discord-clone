#!/usr/bin/env bash
# Zero-touch production deploy, run on the VPS by .github/workflows/deploy.yml (or by hand).
#
#   IMAGE_TAG=<git-sha|version> ./infra/scripts/deploy.sh
#
# Pulls the images, runs migrations, starts the new containers, waits for health checks and
# smoke-tests the public URL. On failure it rolls back to the previously deployed tag.
# Migrations must stay backwards-compatible with the previous release (docs/DEVELOPMENT.md).
set -euo pipefail

cd "$(dirname "$0")/../.."
: "${IMAGE_TAG:?set IMAGE_TAG}"
export IMAGE_TAG
COMPOSE=(docker compose -f compose.yaml -f compose.prod.yaml ${COMPOSE_EXTRA_ARGS:-})
STATE_FILE=.current_tag
PREVIOUS_TAG="$(cat "$STATE_FILE" 2>/dev/null || true)"
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
SMOKE_URL="${SMOKE_URL:-https://${DOMAIN}}"
APP_SERVICES=(api worker beat web backup)

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

rollback() {
  log "FAILED deploying ${IMAGE_TAG}"
  "${COMPOSE[@]}" logs --no-color --tail=50 api web || true
  if [ -n "$PREVIOUS_TAG" ] && [ "$PREVIOUS_TAG" != "$IMAGE_TAG" ]; then
    log "rolling back to ${PREVIOUS_TAG}"
    IMAGE_TAG="$PREVIOUS_TAG" "${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180 \
      "${APP_SERVICES[@]}" || log "rollback did not become healthy, intervene manually"
  fi
  exit 1
}

smoke() {
  local path ok
  for path in /api/health/ready /; do
    ok=false
    for _ in $(seq 1 10); do
      if curl -fsS -o /dev/null --max-time 10 ${SMOKE_CURL_ARGS:-} "${SMOKE_URL}${path}"; then
        ok=true
        break
      fi
      sleep 3
    done
    $ok || { log "smoke test failed: ${SMOKE_URL}${path}"; return 1; }
  done
}

log "deploying ${IMAGE_TAG} (previous: ${PREVIOUS_TAG:-none})"
if [ "${SKIP_PULL:-0}" != 1 ]; then
  "${COMPOSE[@]}" pull --quiet "${APP_SERVICES[@]}"
fi

# Database and cache first (no-op if already running), then migrate with the NEW image.
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 db redis
"${COMPOSE[@]}" run --rm --no-deps api migrate || rollback

"${COMPOSE[@]}" up -d --remove-orphans --wait --wait-timeout 180 || rollback
smoke || rollback

echo "$IMAGE_TAG" > "$STATE_FILE"
log "deployed ${IMAGE_TAG}"
docker image prune -f --filter "until=168h" >/dev/null || true
