#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f scripts/deploy.env ]; then
  echo "missing scripts/deploy.env — copy scripts/deploy.env.example and fill it in" >&2
  exit 1
fi
set -a; . scripts/deploy.env; set +a

# ssh program for transport + remote commands. Default plain ssh; in WSL set
# SSH_BIN=ssh.exe in deploy.env to reuse the Windows ssh config + agent.
SSH_BIN="${SSH_BIN:-ssh}"

# A non-interactive ssh command doesn't source the login profile, so nvm (node)
# and PNPM_HOME (pnpm, pm2) aren't on PATH. Prepend this to every remote command.
# Single-quoted on purpose: the $VARS must expand on the server, not locally.
REMOTE_PRELUDE='export PNPM_HOME="$HOME/.local/share/pnpm"; export PATH="$PNPM_HOME:$PATH"; export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'

# Push source tree to the server. .env.production is carried up (it's the
# source of truth for prod); every other .env* stays local. No --delete, so
# nothing on the box is removed by a deploy.
rsync_source() {
  rsync -az -e "$SSH_BIN" \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --include '.env.production' \
    --exclude '.env' \
    --exclude '.env.*' \
    --exclude 'clips' \
    --exclude 'db' \
    --exclude 'apps/client/dist' \
    --exclude 'apps/client/public' \
    ./ "$SSH_HOST:$REMOTE_ROOT/"
}

# Install, build shared + the given app, (re)start only its pm2 process.
remote_app() {
  local app="$1" proc="$2"
  "$SSH_BIN" "$SSH_HOST" "$REMOTE_PRELUDE; cd '$REMOTE_ROOT' \
    && pnpm install --frozen-lockfile \
    && pnpm --filter @neppie-clips/shared build \
    && pnpm --filter @neppie-clips/$app build \
    && pm2 startOrReload deploy/ecosystem.config.cjs --only '$proc' --update-env"
}

deploy_client() {
  pnpm --filter @neppie-clips/shared build
  pnpm --filter @neppie-clips/client build
  rsync -az --delete -e "$SSH_BIN" apps/client/dist/ "$SSH_HOST:$WEB_ROOT/"
  echo "✓ client → $WEB_ROOT (no services restarted)"
}

deploy_api() {
  rsync_source
  remote_app api "$PM2_API"
  echo "✓ api rebuilt and reloaded ($PM2_API)"
}

deploy_fetcher() {
  rsync_source
  remote_app fetcher "$PM2_FETCHER"
  echo "✓ fetcher rebuilt and reloaded ($PM2_FETCHER)"
}

deploy_all() {
  rsync_source
  "$SSH_BIN" "$SSH_HOST" "$REMOTE_PRELUDE; cd '$REMOTE_ROOT' \
    && pnpm install --frozen-lockfile \
    && pnpm --filter @neppie-clips/shared build \
    && pnpm --filter @neppie-clips/api build \
    && pnpm --filter @neppie-clips/fetcher build \
    && pm2 startOrReload deploy/ecosystem.config.cjs --update-env"
  deploy_client
  echo "✓ full deploy done"
}

case "${1:-}" in
  client)  deploy_client ;;
  api)     deploy_api ;;
  fetcher) deploy_fetcher ;;
  all)     deploy_all ;;
  *) echo "usage: $0 {client|api|fetcher|all}" >&2; exit 1 ;;
esac
