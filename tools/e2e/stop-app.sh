#!/bin/bash
# Zastaví aplikaci spuštěnou přes run-app.sh (next start/dev a jeho podprocesy).
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${E2E_PORT:-3100}"
if [ -f "$ROOT/.local-supabase/app.pid" ]; then
  kill "$(cat "$ROOT/.local-supabase/app.pid")" 2>/dev/null || true
  rm -f "$ROOT/.local-supabase/app.pid"
fi
# next start spouští proces „next-server" — lsof/ss ho v kontejneru nemusí vidět, proto podle jména
pkill -f "next start -p $PORT" 2>/dev/null || true
pkill -f "next dev -p $PORT" 2>/dev/null || true
pkill -x "next-server" 2>/dev/null || pkill -f "^next-server" 2>/dev/null || true
for i in $(seq 1 20); do
  curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/login" || exit 0
  sleep 0.5
done
exit 0
