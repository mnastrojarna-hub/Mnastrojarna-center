#!/bin/bash
# Spustí aplikaci proti lokálnímu Supabase stacku pro E2E testy.
#   tools/e2e/run-app.sh [adresář aplikace] [--dev]
# Výchozí: produkční build + `next start` na portu 3100 (blíž Vercelu než dev server).
# Zastavení: tools/e2e/stop-app.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="${1:-$ROOT}"
MODE="${2:-}"
PORT="${E2E_PORT:-3100}"
LOG_DIR="$ROOT/.local-supabase/logs"
mkdir -p "$LOG_DIR"

set -a
# shellcheck disable=SC1091
source "$ROOT/.local-supabase/env"
set +a
export NEXT_PUBLIC_APP_URL="http://localhost:$PORT"
export CRON_SECRET="${CRON_SECRET:-e2e-cron-secret}"
# AI bez klíče: čtení dokladu vrátí fixture (viz src/lib/ai/document-reader.ts)
export AI_FAKE_CAPTURE="${AI_FAKE_CAPTURE:-$ROOT/src/lib/jobs/__fixtures__/capture/objednavka-strojmetal.json}"
export NEXT_TELEMETRY_DISABLED=1

cd "$APP_DIR"
"$ROOT/tools/e2e/stop-app.sh" >/dev/null 2>&1 || true
if [ "$MODE" = "--dev" ]; then
  nohup npx next dev -p "$PORT" > "$LOG_DIR/app.log" 2>&1 &
else
  echo "[e2e] build…"
  npx next build > "$LOG_DIR/app-build.log" 2>&1 || { tail -40 "$LOG_DIR/app-build.log"; exit 1; }
  nohup npx next start -p "$PORT" > "$LOG_DIR/app.log" 2>&1 &
fi
echo $! > "$ROOT/.local-supabase/app.pid"
for i in $(seq 1 120); do
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then echo "[e2e] aplikace běží na http://localhost:$PORT"; exit 0; fi
  sleep 1
done
echo "[e2e] aplikace nenaběhla"; tail -30 "$LOG_DIR/app.log"; exit 1
