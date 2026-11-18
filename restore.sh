#!/usr/bin/env bash
# ============================================================
#  Quarc Store — Data Restore
#  Run on the target server from the Quarc_Store directory:
#    bash restore.sh ./backup_20240101_120000
#
#  Restores whatever the backup contains: auth.db (+ auth.env),
#  store.db (+ .env). Each service is stopped while its database
#  is replaced, then everything is started again.
# ============================================================
set -e
cd "$(dirname "$0")"

BACKUP_DIR="$1"
if [ -z "$BACKUP_DIR" ] || [ ! -d "$BACKUP_DIR" ]; then
  echo "Usage: bash restore.sh <backup-dir>"
  exit 1
fi
BACKUP_ABS="$(cd "$BACKUP_DIR" && pwd)"

docker network inspect quarcnet-shared >/dev/null 2>&1 || docker network create quarcnet-shared

# Copies a database file into a (stopped) container's /app/data volume.
# Also deletes any -wal/-shm left by the previous database: SQLite would
# otherwise try to replay that old write-ahead log onto the restored file.
restore_db() {
  local cid=$1 name=$2
  local vol
  vol=$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Name}}{{end}}{{end}}' "$cid")
  [ -n "$vol" ] || { echo "ERROR: no /app/data volume on container $cid"; exit 1; }
  docker run --rm -v "$vol:/data" -v "$BACKUP_ABS:/backup:ro" alpine \
    sh -c "rm -f /data/$name-wal /data/$name-shm && cp /backup/$name /data/$name"
}

if [ -f "$BACKUP_DIR/auth.db" ]; then
  echo "  · Restoring the shared login (auth.db) ..."
  [ -f "$BACKUP_DIR/auth.env" ] && cp "$BACKUP_DIR/auth.env" auth/.env
  [ -f auth/.env ] || { echo "ERROR: auth/.env missing and not in the backup"; exit 1; }
  (cd auth && docker compose build && docker compose up --no-start && docker compose stop)
  restore_db quarc-auth auth.db
  (cd auth && docker compose up -d)
fi

if [ -f "$BACKUP_DIR/store.db" ]; then
  echo "  · Restoring the Store catalog (store.db) ..."
  [ -f "$BACKUP_DIR/.env" ] && cp "$BACKUP_DIR/.env" .env
  docker compose build store-backend
  docker compose up --no-start store-backend
  docker compose stop store-backend
  restore_db "$(docker compose ps -aq store-backend | head -1)" store.db
fi

echo "  · Starting the Store ..."
docker compose up -d --build

echo ""
echo "Restore complete. Check status: bash check.sh"
