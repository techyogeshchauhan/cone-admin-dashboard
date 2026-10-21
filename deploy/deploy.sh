#!/usr/bin/env bash
# Update the server to the latest commit on main, rebuild and restart.
# Run on the server as root:  /var/www/cone/deploy/deploy.sh
# Or from your machine:       ssh neelmani /var/www/cone/deploy/deploy.sh
set -euo pipefail

APP_DIR=/var/www/cone
BRANCH=${BRANCH:-main}
as_app() { sudo -u cone -H "$@"; }

cd "$APP_DIR"
echo "==> Fetching $BRANCH"
as_app git fetch --quiet origin "$BRANCH"
as_app git checkout --quiet "$BRANCH"
as_app git merge --ff-only "origin/$BRANCH"
echo "==> Now at $(as_app git log -1 --format='%h %s')"

echo "==> Installing dependencies"
as_app env npm_config_cache="$APP_DIR/.npm" PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  npm ci --no-audit --no-fund

echo "==> Building"
as_app npm run build

echo "==> Restarting services"
systemctl restart cone-api cone-worker
sleep 3
systemctl is-active cone-api cone-worker
curl -fsS http://127.0.0.1:8099/api/health && echo
echo "==> Deployed"
