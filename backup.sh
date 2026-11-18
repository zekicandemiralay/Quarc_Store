#!/usr/bin/env bash
# ============================================================
#  Quarc Store — Data Backup
#  Run from the Quarc_Store directory:
#    bash backup.sh
#
#  Creates: ./backup_YYYYMMDD_HHMMSS/
#    auth.db        — the shared Quarc login: every user account
#                     and session, for the WHOLE suite
#    auth.env       — auth/.env (JWT_SECRET — keep it identical
#                     so nobody is logged out after a restore)
#    store.db       — the Store's catalog and release cache
#    .env           — Store config (optional)
# ============================================================
set -e
cd "$(dirname "$0")"

BACKUP_DIR="./backup_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "Backing up to $BACKUP_DIR ..."

# ── quarc-auth (most important: every Quarc account lives here) ──
if docker ps -q --filter "name=^quarc-auth$" | grep -q .; then
  echo "  · Checkpointing and exporting auth.db ..."
  docker exec quarc-auth node -e "require('/app/src/db').getDb().pragma('wal_checkpoint(TRUNCATE)')" 2>/dev/null || true
  docker cp quarc-auth:/app/data/auth.db "$BACKUP_DIR/auth.db"
  [ -f auth/.env ] && cp auth/.env "$BACKUP_DIR/auth.env"
else
  echo "  ! quarc-auth is not running — skipping auth.db (start it: bash deploy.sh auth)"
fi

# ── Store catalog ──
BACKEND=$(docker compose ps -q store-backend 2>/dev/null | head -1)
if [ -n "$BACKEND" ]; then
  echo "  · Checkpointing and exporting store.db ..."
  docker exec "$BACKEND" node -e "require('/app/src/db').getDb().pragma('wal_checkpoint(TRUNCATE)')" 2>/dev/null || true
  docker cp "$BACKEND:/app/data/store.db" "$BACKUP_DIR/store.db"
else
  echo "  ! store-backend is not running — skipping store.db"
fi
[ -f .env ] && cp .env "$BACKUP_DIR/.env"

echo ""
echo "Backup complete: $BACKUP_DIR"
ls -la "$BACKUP_DIR"
echo ""
echo "Next: copy this folder to the new server."
echo "  scp -r $BACKUP_DIR user@new-server:~/Quarc_Store/"
