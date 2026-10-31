#!/bin/bash
# Spustí aplikaci proti lokálnímu Supabase stacku pro E2E testy.
#   tools/e2e/run-app.sh [adresář aplikace] [--dev | --start]
# Výchozí: produkční build + `next start` na portu 3100 (blíž Vercelu než dev server).
# --start: bez buildu — jen když existující .next postavil tento skript se stejným env
#          (NEXT_PUBLIC_* se zapékají do JS při buildu; build bez env = nefunkční nahrávání).
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
# ARES bez sítě: firmy z fixtures (src/lib/ares/__fixtures__/subjekt-<ičo>.json, vyhledat.json)
export ARES_FAKE_DIR="${ARES_FAKE_DIR:-$ROOT/src/lib/ares/__fixtures__}"
export NEXT_TELEMETRY_DISABLED=1

"$ROOT/tools/e2e/stop-app.sh" >/dev/null 2>&1 || true
cd "$APP_DIR"
pwd -P > "$ROOT/.local-supabase/app.dir"
if [ "$MODE" = "--dev" ]; then
  nohup npx next dev -p "$PORT" > "$LOG_DIR/app.log" 2>&1 &
elif [ "$MODE" = "--start" ] && [ -f .next/BUILD_ID ] && [ "$(cat .next/e2e-env 2>/dev/null)" = "$NEXT_PUBLIC_SUPABASE_URL|$PORT" ]; then
  nohup npx next start -p "$PORT" > "$LOG_DIR/app.log" 2>&1 &
else
  echo "[e2e] build…"
  npx next build > "$LOG_DIR/app-build.log" 2>&1 || { tail -40 "$LOG_DIR/app-build.log"; exit 1; }
  echo "$NEXT_PUBLIC_SUPABASE_URL|$PORT" > .next/e2e-env
  nohup npx next start -p "$PORT" > "$LOG_DIR/app.log" 2>&1 &
fi
echo $! > "$ROOT/.local-supabase/app.pid"
for i in $(seq 1 120); do
  if curl -s -o /dev/null "http://localhost:$PORT/login"; then echo "[e2e] aplikace běží na http://localhost:$PORT"; exit 0; fi
  sleep 1
done
echo "[e2e] aplikace nenaběhla"; tail -30 "$LOG_DIR/app.log"; exit 1
