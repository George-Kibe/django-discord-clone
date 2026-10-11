#!/usr/bin/env bash
# Production rehearsal: exercises the real deploy tooling against locally built production images.
#
#   ./infra/scripts/rehearse-production.sh          # build, deploy, verify, backup+restore, rollback, tear down
#   KEEP=1 ./infra/scripts/rehearse-production.sh   # leave the stack running on https://localhost:8443
#
# It mirrors the server layout (/srv/app = compose files + infra/ + .env) in .prod-rehearsal/,
# generates throwaway secrets and an age key pair, and never touches the dev stack or real services.
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
work="${repo}/.prod-rehearsal"
project=dcrehearsal
tag="rehearsal-$(git -C "$repo" rev-parse --short HEAD)"
broken_tag="${tag}-broken"
base="https://localhost:8443"
registry=ghcr.io/george-kibe/discord-clone

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$*"; exit 1; }
# Same wrapper operators use on the server (pinned to .current_tag), plus the rehearsal overrides.
dc() { (cd "$work" && COMPOSE_EXTRA_ARGS="-p ${project} -f compose.rehearsal.yaml" ./infra/scripts/dc "$@"); }
deploy() {
  (cd "$work" && IMAGE_TAG="$1" SKIP_PULL=1 SMOKE_URL="$base" SMOKE_CURL_ARGS=-k \
    COMPOSE_EXTRA_ARGS="-p ${project} -f compose.rehearsal.yaml" ./infra/scripts/deploy.sh)
}
teardown() {
  if [ "${KEEP:-0}" = 1 ]; then
    echo "Stack left running on ${base} (project ${project}). Tear down: KEEP=0 $0 --down"
    return
  fi
  IMAGE_TAG="$tag" dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
}

if [ "${1:-}" = --down ]; then teardown; exit 0; fi

step "Building production images (${tag})"
docker build -q --target prod --build-arg GIT_SHA="$tag" -t "${registry}-api:${tag}" "${repo}/backend" >/dev/null
docker build -q --target prod -t "${registry}-web:${tag}" "${repo}/frontend" >/dev/null
docker build -q -t "${registry}-backup:${tag}" "${repo}/infra/backup" >/dev/null
pass "api, web, backup built"

step "Preparing server layout in ${work}"
rm -rf "$work" && mkdir -p "$work/infra"
cp "$repo/compose.yaml" "$repo/compose.prod.yaml" "$repo/infra/rehearsal/compose.rehearsal.yaml" "$work/"
cp -r "$repo/infra/caddy" "$repo/infra/scripts" "$work/infra/"
keyfile="$work/backup-key.txt"
docker run --rm --entrypoint age-keygen "${registry}-backup:${tag}" > "$keyfile" 2>/dev/null
recipient="$(grep -o 'age1[0-9a-z]*' "$keyfile" | head -n1)"
secret() { openssl rand -hex 24; }
pg_password="$(secret)"
cat > "$work/.env" <<ENV
ENVIRONMENT=production
DOMAIN=localhost:8443
NEXT_PUBLIC_SITE_URL=${base}
DJANGO_SECRET_KEY=$(secret)$(secret)
DJANGO_DEBUG=false
DJANGO_ALLOWED_HOSTS=localhost,api
DJANGO_CSRF_TRUSTED_ORIGINS=${base}
POSTGRES_DB=app
POSTGRES_USER=app
POSTGRES_PASSWORD=${pg_password}
DATABASE_URL=postgres://app:${pg_password}@db:5432/app
REDIS_URL=redis://redis:6379
CLOUDINARY_FOLDER_PREFIX=rehearsal
EMAIL_URL=smtp://localhost:25
INTERNAL_API_URL=http://api:8000
UVICORN_WORKERS=2
CELERY_CONCURRENCY=1
BACKUP_AGE_RECIPIENT=${recipient}
BACKUP_REMOTE=:s3:backups/discord-clone
RCLONE_S3_PROVIDER=Rclone
RCLONE_S3_ENDPOINT=http://s3:9000
RCLONE_S3_ACCESS_KEY_ID=rehearsal
RCLONE_S3_SECRET_ACCESS_KEY=rehearsal-secret
ENV
chmod 600 "$work/.env" "$keyfile"
pass "deployment files, .env with generated secrets, age key pair"

trap 'echo; echo "rehearsal FAILED, logs:"; IMAGE_TAG="$tag" dc logs --no-color --tail=40 || true; teardown' ERR

step "First deploy via infra/scripts/deploy.sh"
deploy "$tag"
[ "$(cat "$work/.current_tag")" = "$tag" ] && pass "deployed ${tag}, all services healthy, smoke test passed"
dc ps --format '  {{.Service}}: {{.Status}}'

step "HTTPS, security headers and production settings"
headers="$(curl -ksSI "${base}/")"
grep -qi '^strict-transport-security: max-age=86400; includeSubDomains' <<<"$headers" && pass "HSTS on the frontend"
grep -qi '^x-content-type-options: nosniff' <<<"$headers" && pass "nosniff"
grep -qi '^server:' <<<"$headers" && fail "Server header leaked" || pass "no Server header"
grep -qi '^x-powered-by' <<<"$headers" && fail "X-Powered-By leaked" || pass "no X-Powered-By"
code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:8443/" || true)"
[ "$code" != 200 ] && pass "plain HTTP is not served on the TLS port (got ${code})"
case "$(curl -ks -o /dev/null -w '%{http_code}' "${base}/api/docs/")" in
  401 | 403) pass "Swagger UI is staff-only" ;;
  *) fail "Swagger UI is public in production" ;;
esac
dc exec -T api python manage.py check --deploy 2>&1 | grep -q "System check identified no issues" \
  && pass "manage.py check --deploy: no issues" || fail "check --deploy reported issues"

step "Auth flow against production settings (Secure cookies, CSRF)"
jar="$work/cookies.txt"
curl -ks -c "$jar" -b "$jar" "${base}/api/v1/auth/csrf" >/dev/null
csrf="$(awk '$6=="csrftoken"{print $7}' "$jar")"
email="rehearsal-$(date +%s)@example.com"
post() { curl -ks -c "$jar" -b "$jar" -H "X-CSRFToken: ${csrf}" -H "Referer: ${base}/" -H "Content-Type: application/json" -d "$2" -o /dev/null -w '%{http_code}' "${base}$1"; }
[ "$(post /api/v1/auth/register "{\"email\":\"${email}\",\"username\":\"reh$(date +%s)\",\"password\":\"a-long-rehearsal-pass\"}")" = 201 ] && pass "register"
[ "$(post /api/v1/auth/login "{\"email\":\"${email}\",\"password\":\"a-long-rehearsal-pass\"}")" = 200 ] && pass "login"
grep -E '\saccess\s' "$jar" | awk '{exit !($4=="TRUE")}' && pass "access cookie is Secure"
[ "$(curl -ks -b "$jar" -o /dev/null -w '%{http_code}' "${base}/api/v1/users/me")" = 200 ] && pass "authenticated request"
[ "$(curl -ks -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' "${base}/api/v1/auth/login")" = 403 ] && pass "CSRF enforced"

step "Encrypted backup to S3 and restore drill"
dc run --rm backup run-once | tail -n 1
objects="$(dc run --rm --entrypoint rclone backup lsf ':s3:backups/discord-clone/daily' 2>/dev/null)"
[ -n "$objects" ] && pass "backup uploaded: ${objects}"
dc run --rm --entrypoint sh backup -c 'rclone cat ":s3:backups/discord-clone/daily/$(rclone lsf :s3:backups/discord-clone/daily | tail -n1)" | head -c 21' | grep -q "age-encryption.org" \
  && pass "backup is age-encrypted at rest"
dc run --rm -v "${keyfile}:/key.txt:ro" -e BACKUP_AGE_IDENTITY=/key.txt backup restore.sh latest restore_drill | tail -n 1
live="$(dc exec -T db psql -U app -d app -tAc 'select count(*) from accounts_user')"
restored="$(dc exec -T db psql -U app -d restore_drill -tAc 'select count(*) from accounts_user')"
[ "$live" = "$restored" ] && [ "$live" -ge 1 ] && pass "restore drill: ${restored}/${live} users restored"

step "Automatic rollback of a broken release"
for app in web backup; do docker tag "${registry}-${app}:${tag}" "${registry}-${app}:${broken_tag}"; done
printf 'FROM %s\nUSER root\nRUN sed -i "s/--port 8000/--port 8001/" /usr/local/bin/docker-entrypoint.sh\nUSER app\n' \
  "${registry}-api:${tag}" | docker build -q -t "${registry}-api:${broken_tag}" - >/dev/null
if deploy "$broken_tag" > "$work/broken-deploy.log" 2>&1; then
  fail "broken release was accepted"
fi
grep -q "rolling back to ${tag}" "$work/broken-deploy.log" && pass "broken release rejected and rolled back"
[ "$(cat "$work/.current_tag")" = "$tag" ] && pass ".current_tag still ${tag}"
[ "$(curl -ks -o /dev/null -w '%{http_code}' "${base}/api/health/ready")" = 200 ] && pass "site healthy after rollback"

trap - ERR
step "Rehearsal passed"
teardown
docker image rm -f "${registry}-api:${broken_tag}" "${registry}-web:${broken_tag}" "${registry}-backup:${broken_tag}" >/dev/null 2>&1 || true
