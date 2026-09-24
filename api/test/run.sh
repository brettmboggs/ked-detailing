#!/usr/bin/env bash
# Runs the API tests against a real local Worker with a throwaway D1.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${PORT:-8799}
STATE=$(mktemp -d)
# Kill the whole process group: killing npx alone leaves wrangler and workerd
# running on the port with their database deleted.
trap 'kill -- -$WORKER 2>/dev/null || true; rm -rf "$STATE"' EXIT

npx wrangler d1 migrations apply ked --local --persist-to "$STATE" >/dev/null
# Own inspector port too, so this runs alongside a `wrangler dev` already open.
setsid npx wrangler dev --port "$PORT" --inspector-port "$((PORT + 1))" --persist-to "$STATE" \
  --var ADMIN_TOKEN:test-admin --var "EXPO_PUSH_URL:http://localhost:$((PORT + 2))/push" --show-interactive-dev-session=false >"$STATE/worker.log" 2>&1 &
WORKER=$!

ready=
for _ in $(seq 60); do
  curl -sf "http://localhost:$PORT/v1/pricing" >/dev/null && { ready=1; break; }
  sleep 0.5
done
[ -n "$ready" ] || { echo 'Worker did not start:'; tail -40 "$STATE/worker.log"; exit 1; }

API="http://localhost:$PORT" ADMIN_TOKEN=test-admin PUSH_PORT=$((PORT + 2)) \
  node --experimental-strip-types --no-warnings --test --test-concurrency=1 'test/**/*.test.ts' \
  || { echo '--- worker log ---'; tail -40 "$STATE/worker.log"; exit 1; }
