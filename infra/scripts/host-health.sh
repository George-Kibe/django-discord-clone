#!/usr/bin/env bash
# Host resource check for cron (docs/DEPLOYMENT.md §7). Pings HOST_HEARTBEAT_URL on success and
# "<url>/fail" (with the reason as the body) when disk or memory crosses a threshold.
#
#   */10 * * * * /srv/app/infra/scripts/host-health.sh >/dev/null 2>&1
#
# Env (read from /srv/app/.env): HOST_HEARTBEAT_URL, DISK_ALERT_PERCENT (80), MEM_ALERT_PERCENT (90)
set -euo pipefail

cd "$(dirname "$0")/../.."
env_value() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
url="${HOST_HEARTBEAT_URL:-$(env_value HOST_HEARTBEAT_URL)}"
disk_limit="${DISK_ALERT_PERCENT:-$(env_value DISK_ALERT_PERCENT)}"
mem_limit="${MEM_ALERT_PERCENT:-$(env_value MEM_ALERT_PERCENT)}"
disk_limit="${disk_limit:-80}"
mem_limit="${mem_limit:-90}"

problems=()
disk_used="$(df --output=pcent / | tail -n1 | tr -dc '0-9')"
[ "$disk_used" -ge "$disk_limit" ] && problems+=("disk ${disk_used}% >= ${disk_limit}%")
mem_used="$(awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "%d", (t-a)*100/t}' /proc/meminfo)"
[ "$mem_used" -ge "$mem_limit" ] && problems+=("memory ${mem_used}% >= ${mem_limit}%")
unhealthy="$(docker ps --filter health=unhealthy --format '{{.Names}}' | paste -sd, -)"
[ -n "$unhealthy" ] && problems+=("unhealthy containers: ${unhealthy}")

report="disk ${disk_used}%, memory ${mem_used}%"
if [ ${#problems[@]} -gt 0 ]; then
  echo "ALERT: ${problems[*]}"
  [ -n "$url" ] && curl -fsS -m 10 --retry 3 --data-raw "${problems[*]}" "${url%/}/fail" >/dev/null || true
  exit 1
fi
echo "ok: ${report}"
[ -n "$url" ] && curl -fsS -m 10 --retry 3 --data-raw "$report" "$url" >/dev/null || true
