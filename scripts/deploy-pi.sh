#!/usr/bin/env bash
set -euo pipefail

# Pumpscan Pi deploy script
# Usage: ./scripts/deploy-pi.sh [host]

HOST="${1:-yojinbot@100.109.137.47}"
REMOTE_DIR="/home/yojinbot/pumpscan"

cd "$(dirname "$0")/.."

echo ">> Building standalone bundle..."
npm run build >/dev/null

echo ">> Preparing deploy payload..."
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp -R .next/standalone/. "$STAGE/"
mkdir -p "$STAGE/.next"
cp -R .next/static "$STAGE/.next/static"
if [[ -d public ]]; then
    cp -R public "$STAGE/public"
fi

echo ">> Building alert scanner bundle..."
npx --yes esbuild scripts/scanner-runner.ts \
    --bundle \
    --platform=node \
    --format=esm \
    --target=node20 \
    --outfile="$STAGE/scanner-runner.mjs" >/dev/null

echo ">> Ensuring remote dir exists..."
ssh "$HOST" "mkdir -p '$REMOTE_DIR'"

echo ">> Rsync to $HOST:$REMOTE_DIR ..."
rsync -az --delete \
    --exclude '.env.local' \
    --exclude 'data/' \
    "$STAGE/" "$HOST:$REMOTE_DIR/"

if [[ "${SYNC_ENV:-0}" == "1" ]]; then
    if [[ ! -f .env.local ]]; then
        echo "ERROR: SYNC_ENV=1 was set but .env.local does not exist locally."
        exit 1
    fi
    echo ">> Backing up and syncing .env.local..."
    ssh "$HOST" "if [[ -f '$REMOTE_DIR/.env.local' ]]; then cp '$REMOTE_DIR/.env.local' '$REMOTE_DIR/.env.local.bak.\$(date +%Y%m%d%H%M%S)'; fi"
    rsync -az .env.local "$HOST:$REMOTE_DIR/.env.local"
else
    echo ">> Preserving remote .env.local (set SYNC_ENV=1 to overwrite from local)"
fi

echo ">> Installing systemd unit..."
scp -q deploy/pumpscan.service "$HOST:/tmp/pumpscan.service"
scp -q deploy/pumpscan-scanner.service "$HOST:/tmp/pumpscan-scanner.service"
ssh "$HOST" "sudo mv /tmp/pumpscan.service /etc/systemd/system/pumpscan.service && sudo mv /tmp/pumpscan-scanner.service /etc/systemd/system/pumpscan-scanner.service && sudo systemctl daemon-reload && sudo systemctl enable pumpscan pumpscan-scanner >/dev/null 2>&1"

echo ">> Restarting services..."
ssh "$HOST" "sudo systemctl restart pumpscan && sleep 3 && sudo systemctl is-active pumpscan"
ssh "$HOST" "sudo systemctl restart pumpscan-scanner && sleep 3 && sudo systemctl is-active pumpscan-scanner"

echo ">> Health check via loopback on Pi..."
ssh "$HOST" "curl -sf -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3030/ || (echo 'health check failed'; sudo journalctl -u pumpscan -n 30 --no-pager; exit 1)"

echo ""
echo "OK - deploy complete."
echo "  Web service:     sudo systemctl status pumpscan"
echo "  Scanner service: sudo systemctl status pumpscan-scanner"
echo "  Web logs:        sudo journalctl -u pumpscan -f"
echo "  Scanner logs:    sudo journalctl -u pumpscan-scanner -f"
