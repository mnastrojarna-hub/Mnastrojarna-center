#!/usr/bin/env bash
# Zastaví všechny procesy lokálního Supabase stacku a Postgres (data zůstávají).
set -uo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

stop_proc() { # stop_proc <name>
  local name="$1" f="$RUN_DIR/$1.pid" pid
  [ -f "$f" ] || return 0
  pid=$(cat "$f")
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    if kill -0 "$pid" 2>/dev/null; then
      warn "$name ($pid) nereaguje na TERM → KILL"; kill -KILL "$pid" 2>/dev/null || true
    fi
    log "zastaven $name ($pid)"
  fi
  rm -f "$f"
}

for name in gateway postgrest storage gotrue mailcatcher; do stop_proc "$name"; done

# Pojistka: osiřelé procesy z našich binárek/skriptů (např. po smazaném pid souboru)
pkill -TERM -f "^$BIN_DIR/" 2>/dev/null && sleep 0.5 || true
pkill -TERM -f "$TOOLS_DIR/(gateway|mailcatcher)\.mjs" 2>/dev/null || true

if [ -s "$PGDATA/PG_VERSION" ] && as_pg "$PG_BIN/pg_ctl" status -D "$PGDATA" >/dev/null 2>&1; then
  as_pg "$PG_BIN/pg_ctl" stop -D "$PGDATA" -m fast -w -t 60 -s && log "zastaven Postgres"
fi
log "stack zastaven"
