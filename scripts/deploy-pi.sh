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

if [[ ! -f .env.local ]]; then
    echo "WARN: No .env.local found locally. HELIUS_API_KEY must already be on Pi."
fi

echo ">> Ensuring remote dir exists..."
ssh "$HOST" "mkdir -p '$REMOTE_DIR'"

echo ">> Rsync to $HOST:$REMOTE_DIR ..."
rsync -az --delete \
    --exclude '.env.local' \
    "$STAGE/" "$HOST:$REMOTE_DIR/"

if [[ -f .env.local ]]; then
    echo ">> Syncing .env.local..."
    rsync -az .env.local "$HOST:$REMOTE_DIR/.env.local"
fi

echo ">> Installing systemd unit..."
scp -q deploy/pumpscan.service "$HOST:/tmp/pumpscan.service"
ssh "$HOST" "sudo mv /tmp/pumpscan.service /etc/systemd/system/pumpscan.service && sudo systemctl daemon-reload && sudo systemctl enable pumpscan >/dev/null 2>&1"

echo ">> Restarting service..."
ssh "$HOST" "sudo systemctl restart pumpscan && sleep 3 && sudo systemctl is-active pumpscan"

echo ">> Health check via loopback on Pi..."
ssh "$HOST" "curl -sf -o /dev/null -w 'HTTP %{http_code}\n' http://127.0.0.1:3030/ || (echo 'health check failed'; sudo journalctl -u pumpscan -n 30 --no-pager; exit 1)"

echo ""
echo "OK - deploy complete."
echo "  Service: sudo systemctl status pumpscan"
echo "  Logs:    sudo journalctl -u pumpscan -f"
