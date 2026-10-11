#!/usr/bin/env bash
# Restore a backup. Decryption needs the age *private* key, which never lives on the server:
# mount it for the restore only (e.g. -v ./backup-key.txt:/key.txt:ro).
#
#   restore.sh list                         # show available backups
#   restore.sh latest|<object> [target_db]  # restore into target_db (default: $PGDATABASE)
#
# Env: like backup.sh, plus BACKUP_AGE_IDENTITY (path to the private key file).
# Restoring into the live database: stop api/worker/beat/web first (docs/DEPLOYMENT.md §6).
set -euo pipefail

remote="${BACKUP_REMOTE:?}"
remote="${remote%/}"
cmd="${1:?usage: restore.sh list | latest | <object> [target_db]}"

if [ "$cmd" = list ]; then
  rclone lsl "${remote}" | sort -k2,3
  exit 0
fi

object="$cmd"
if [ "$object" = latest ]; then
  object="daily/$(rclone lsf "${remote}/daily" | sort | tail -n 1)"
  [ "$object" != "daily/" ] || { echo "no backups found" >&2; exit 1; }
fi
target="${2:-$PGDATABASE}"
identity="${BACKUP_AGE_IDENTITY:?path to the age private key}"

if ! psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${target}'" | grep -q 1; then
  echo "creating database ${target}"
  createdb "$target"
fi

echo "restoring ${object} into ${target}"
rclone cat "${remote}/${object}" | age -d -i "$identity" \
  | pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error -d "$target"
echo "restore ok"
