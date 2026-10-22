#!/bin/bash
# Zastaví aplikaci spuštěnou přes run-app.sh — jen tu naši (podle pracovního adresáře),
# jiné Next.js servery na stroji nechá běžet.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${E2E_PORT:-3100}"
APP_DIR="$(cat "$ROOT/.local-supabase/app.dir" 2>/dev/null || true)"
if [ -f "$ROOT/.local-supabase/app.pid" ]; then
  kill "$(cat "$ROOT/.local-supabase/app.pid")" 2>/dev/null || true
  rm -f "$ROOT/.local-supabase/app.pid"
fi
# next start spouští proces „next-server" (lsof/ss ho v kontejneru nemusí vidět) → podle cwd
for pid in $(pgrep -x next-server 2>/dev/null) $(pgrep -f "next (start|dev) -p $PORT" 2>/dev/null); do
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  if [ -n "$APP_DIR" ] && [ "$cwd" = "$APP_DIR" ]; then kill "$pid" 2>/dev/null || true; fi
done
for i in $(seq 1 20); do
  curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/login" || exit 0
  sleep 0.5
done
exit 0
