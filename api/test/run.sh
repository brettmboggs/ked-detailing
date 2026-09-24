#!/usr/bin/env bash
# Runs the API tests against a real local Worker with a throwaway D1.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8799}
STATE=$(mktemp -d)
trap 'kill $WORKER 2>/dev/null || true; rm -rf "$STATE"' EXIT

npx wrangler d1 migrations apply ked --local --persist-to "$STATE" >/dev/null
npx wrangler dev --port "$PORT" --persist-to "$STATE" --var ADMIN_TOKEN:test-admin \
  --show-interactive-dev-session=false >"$STATE/worker.log" 2>&1 &
WORKER=$!

for _ in $(seq 60); do
  curl -sf "http://localhost:$PORT/v1/pricing" >/dev/null && break
  sleep 0.5
done

API="http://localhost:$PORT" ADMIN_TOKEN=test-admin \
  node --experimental-strip-types --no-warnings --test 'test/**/*.test.ts' \
  || { echo '--- worker log ---'; tail -40 "$STATE/worker.log"; exit 1; }
