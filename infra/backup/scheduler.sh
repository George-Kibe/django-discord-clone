#!/usr/bin/env bash
# Runs backup.sh daily at BACKUP_TIME_UTC (HH:MM, default 03:00). "run-once" runs immediately.
set -uo pipefail

if [ "${1:-}" = run-once ]; then
  exec backup.sh
fi
if [ "${1:-}" != "" ]; then
  exec "$@"  # e.g. restore.sh …
fi

at="${BACKUP_TIME_UTC:-03:00}"
echo "backup scheduler: daily at ${at} UTC"
while true; do
  touch /tmp/scheduler.alive
  now=$(date -u +%s)
  next=$(date -u -d "today ${at}" +%s)
  [ "$next" -le "$now" ] && next=$(date -u -d "tomorrow ${at}" +%s)
  # Sleep in short steps so the liveness file stays fresh.
  while [ "$(date -u +%s)" -lt "$next" ]; do
    sleep 60
    touch /tmp/scheduler.alive
  done
  backup.sh || echo "backup run failed (reported via heartbeat)" >&2
done
