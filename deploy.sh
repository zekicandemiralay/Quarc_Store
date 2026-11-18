#!/usr/bin/env bash
# Usage:
#   bash deploy.sh           — rebuild the Store (catalog backend + web front end)
#   bash deploy.sh auth      — rebuild the shared login service (quarc-auth)
#   bash deploy.sh all       — both: login service first, then the Store
#   bash deploy.sh backend   — Store backend only
#   bash deploy.sh frontend  — Store front end only

set -e
cd "$(dirname "$0")"

TARGET=${1:-store}

pull_latest() {
  echo "Pulling latest code..."
  git pull
}

ensure_network() {
  docker network inspect quarcnet-shared >/dev/null 2>&1 || {
    echo "Creating the shared Docker network quarcnet-shared..."
    docker network create quarcnet-shared
  }
}

build() {
  local svc=$1
  echo "Building $svc..."
  docker compose up -d --build --no-deps "$svc"
  echo "$svc updated."
}

deploy_auth() {
  [ -f auth/.env ] || { echo "auth/.env is missing — copy auth/.env.example and set the shared JWT_SECRET."; exit 1; }
  echo "Building quarc-auth..."
  (cd auth && docker compose up -d --build)
  echo "quarc-auth updated."
}

pull_latest
ensure_network

case "$TARGET" in
  store)    build store-backend; build store-frontend ;;
  backend)  build store-backend ;;
  frontend) build store-frontend ;;
  auth)     deploy_auth ;;
  all)      deploy_auth; build store-backend; build store-frontend ;;
  *)        echo "Usage: bash deploy.sh [store|auth|all|backend|frontend]"; exit 1 ;;
esac

echo "Done."
