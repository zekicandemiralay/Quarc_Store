#!/usr/bin/env bash
# ============================================================
#  Quarc Store — Health check. Run from the Quarc_Store directory:
#    bash check.sh
# ============================================================
cd "$(dirname "$0")"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
FAIL=0
ok()   { printf "  ${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "  ${YELLOW}⚠${NC} %s\n" "$1"; }
fail() { printf "  ${RED}✗${NC} %s\n" "$1"; FAIL=$((FAIL+1)); }

BASE="https://localhost:4006"
printf "\n${BOLD}Quarc Store — diagnostic${NC}  $(date '+%Y-%m-%d %H:%M:%S')\n\n"
docker info &>/dev/null || { printf "  ${RED}✗ Docker not accessible (try sudo)${NC}\n"; exit 1; }

docker network inspect quarcnet-shared >/dev/null 2>&1 && ok "network quarcnet-shared exists" || fail "network quarcnet-shared missing (docker network create quarcnet-shared)"
for svc in store-backend store-frontend; do
  [ -n "$(docker compose ps -q $svc 2>/dev/null)" ] && ok "$svc: running" || fail "$svc: not running (bash deploy.sh)"
done
docker ps -q --filter "name=^quarc-auth$" | grep -q . && ok "quarc-auth: running" || fail "quarc-auth: not running (bash deploy.sh auth)"

AUTH_DIR=$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' quarc-auth 2>/dev/null)
case "$AUTH_DIR" in
  *Quarc_Store/auth) ;;
  "") ;;
  *) warn "quarc-auth was started from $AUTH_DIR (the old v1) — switch it over: see auth/README.md" ;;
esac

CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/" || echo 0)
[ "$CODE" = "200" ] && ok "HTTPS :4006 serves the Store" || fail "HTTPS :4006 returned ${CODE}"

CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/api/health" || echo 0)
[ "$CODE" = "200" ] && ok "Store backend reachable through nginx" || fail "/api/health returned ${CODE}"

BODY=$(curl -sk --max-time 5 "${BASE}/api/auth/health" || echo "")
echo "$BODY" | grep -q '"version":2' && ok "shared login is v2 (sessions + Store single sign-on)" || fail "/api/auth/health didn't report quarc-auth v2 — redeploy it: bash deploy.sh auth"

CODE=$(curl -sk -o /dev/null -w "%{http_code}" --max-time 5 "${BASE}/api/auth/me" || echo 0)
[ "$CODE" = "401" ] && ok "/api/auth/me → 401 when anonymous" || fail "/api/auth/me returned ${CODE} (expected 401)"

CAT=$(curl -sk --max-time 10 "${BASE}/api/store/catalog" || echo "")
APPS=$(echo "$CAT" | grep -o '"id":"[a-z0-9-]*"' | wc -l)
[ "$APPS" -gt 0 ] && ok "catalog lists ${APPS} app(s)" || fail "catalog is empty or unreachable"
echo "$CAT" | grep -q '"syncedAt":null' && warn "no successful GitHub sync yet (check: docker compose logs store-backend)"
LATEST=$(ls -d backups/nightly_* 2>/dev/null | sort | tail -1)
if [ -z "$LATEST" ]; then
  warn "no nightly backup yet (they start by themselves after deploying; look in backups/)"
elif [ ! -f "$LATEST/auth.db" ]; then
  fail "newest nightly backup ${LATEST#backups/} has no auth.db — check: docker logs quarc-auth"
else
  AGE_DAYS=$(( ( $(date +%s) - $(date -d "${LATEST#backups/nightly_}" +%s) ) / 86400 ))
  [ "$AGE_DAYS" -le 1 ] && ok "nightly backup: ${LATEST#backups/}" || warn "newest nightly backup is ${AGE_DAYS} days old (${LATEST#backups/})"
fi

SSO=$(echo "$CAT" | grep -o '"certSha256":\["[0-9a-f]\{64\}"' | wc -l)
[ "$SSO" -gt 0 ] && ok "${SSO} app(s) have a verified signing fingerprint (single sign-on ready)" || warn "no app has a signing fingerprint yet — single sign-on activates after the first sync"

echo
[ "$FAIL" -eq 0 ] && printf "${GREEN}${BOLD}All checks passed.${NC}\n" || { printf "${RED}${BOLD}${FAIL} check(s) failed.${NC}\n"; exit 1; }
