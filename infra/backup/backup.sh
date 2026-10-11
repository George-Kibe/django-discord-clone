#!/usr/bin/env bash
# One backup run: pg_dump -> age (public-key encryption) -> S3 via rclone, then retention.
#
# Required env: PGHOST PGUSER PGPASSWORD PGDATABASE BACKUP_AGE_RECIPIENT BACKUP_REMOTE
#   BACKUP_REMOTE is an rclone path, e.g. ":s3:my-bucket/discord-clone" with the S3 backend
#   configured through RCLONE_S3_* variables (PROVIDER, ENDPOINT, ACCESS_KEY_ID, SECRET_ACCESS_KEY, REGION).
# Optional: BACKUP_HEARTBEAT_URL (healthchecks.io-style; "/fail" is appended on failure),
#   BACKUP_KEEP_DAILY_DAYS (8), BACKUP_KEEP_WEEKLY_DAYS (29), BACKUP_KEEP_MONTHLY_DAYS (93).
set -euo pipefail

: "${BACKUP_AGE_RECIPIENT:?}" "${BACKUP_REMOTE:?}" "${PGDATABASE:?}"
remote="${BACKUP_REMOTE%/}"
stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
name="${PGDATABASE}-${stamp}.dump.age"
file="/tmp/${name}"

ping() {
  [ -n "${BACKUP_HEARTBEAT_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 "${BACKUP_HEARTBEAT_URL%/}$1" >/dev/null || true
}
cleanup() { rm -f "$file"; }
on_error() { echo "backup FAILED" >&2; ping /fail; }
trap cleanup EXIT
trap on_error ERR

echo "dumping ${PGDATABASE}@${PGHOST}"
pg_dump --format=custom --no-owner --no-privileges | age -r "$BACKUP_AGE_RECIPIENT" > "$file"
[ -s "$file" ] || { echo "empty backup" >&2; false; }

rclone copyto --s3-no-check-bucket "$file" "${remote}/daily/${name}"
[ "$(date -u +%u)" = 7 ] && rclone copyto --s3-no-check-bucket "$file" "${remote}/weekly/${name}"
[ "$(date -u +%d)" = 01 ] && rclone copyto --s3-no-check-bucket "$file" "${remote}/monthly/${name}"

# Retention: 7 daily, 4 weekly, 3 monthly (NFR-REL-03), with a day of slack.
rclone delete --min-age "${BACKUP_KEEP_DAILY_DAYS:-8}d" "${remote}/daily" || true
rclone delete --min-age "${BACKUP_KEEP_WEEKLY_DAYS:-29}d" "${remote}/weekly" || true
rclone delete --min-age "${BACKUP_KEEP_MONTHLY_DAYS:-93}d" "${remote}/monthly" || true

echo "backup ok: ${remote}/daily/${name} ($(stat -c %s "$file") bytes)"
ping ""
