# shellcheck shell=bash
# Společná konfigurace lokálního Supabase stacku (sourcuje se ze všech skriptů).

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$TOOLS_DIR/../.." && pwd)"
LS_DIR="${LOCAL_SUPABASE_DIR:-$REPO_ROOT/.local-supabase}"

BIN_DIR="$LS_DIR/bin"
PGDATA="$LS_DIR/pgdata"
LOG_DIR="$LS_DIR/logs"
RUN_DIR="$LS_DIR/run"
STORAGE_DIR="$LS_DIR/storage"
ENV_FILE="$LS_DIR/env"

# ── Verze image z ghcr.io ────────────────────────────────────
POSTGREST_TAG="${POSTGREST_TAG:-v12.2.12}"
GOTRUE_TAG="${GOTRUE_TAG:-v2.180.0}"
STORAGE_TAG="${STORAGE_TAG:-v1.84.17}"

# ── Porty ────────────────────────────────────────────────────
GATEWAY_PORT=54321
PG_PORT=54322
MAIL_HTTP_PORT=54324
MAIL_SMTP_PORT=54325
POSTGREST_PORT=54330
GOTRUE_PORT=54331
STORAGE_PORT=54332

# ── Tajemství (jen lokální vývoj!) ───────────────────────────
JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
PG_PASSWORD="postgres"

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PSQL="$PG_BIN/psql"
[ -x "$PSQL" ] || PSQL="$(command -v psql)"

export PGHOST=127.0.0.1 PGPORT=$PG_PORT PGUSER=postgres PGPASSWORD=$PG_PASSWORD PGDATABASE=postgres

log()  { printf '\033[1;34m[local-supabase]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[local-supabase] VAROVÁNÍ:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[local-supabase] CHYBA:\033[0m %s\n' "$*" >&2; exit 1; }

# Spuštění příkazu jako uživatel "postgres" (initdb/pg_ctl odmítají běžet pod rootem).
PG_OS_USER="${PG_OS_USER:-postgres}"
as_pg() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u "$PG_OS_USER" -- "$@"
  else
    "$@"
  fi
}

pid_alive() { # pid_alive <name>
  local f="$RUN_DIR/$1.pid"
  [ -f "$f" ] && kill -0 "$(cat "$f")" 2>/dev/null
}

# Spustí proces na pozadí (nový session, log do logs/<name>.log, pid do run/<name>.pid).
start_bg() { # start_bg <name> <cmd...>
  local name="$1"; shift
  mkdir -p "$LOG_DIR" "$RUN_DIR"
  setsid "$@" >>"$LOG_DIR/$name.log" 2>&1 </dev/null &
  echo $! >"$RUN_DIR/$name.pid"
}

wait_http() { # wait_http <name> <url> [timeout_s]
  local name="$1" url="$2" timeout="${3:-60}" i=0
  while [ "$i" -lt "$((timeout * 4))" ]; do
    if curl -fsS -o /dev/null --max-time 2 "$url" 2>/dev/null; then return 0; fi
    if [ -f "$RUN_DIR/$name.pid" ] && ! pid_alive "$name"; then
      tail -n 40 "$LOG_DIR/$name.log" >&2 || true
      die "$name se ukončil při startu (log: $LOG_DIR/$name.log)"
    fi
    sleep 0.25; i=$((i + 1))
  done
  tail -n 40 "$LOG_DIR/$name.log" >&2 || true
  die "$name neodpovídá na $url do ${timeout}s (log: $LOG_DIR/$name.log)"
}

psql_q() { PGOPTIONS="-c client_min_messages=warning" "$PSQL" -X -v ON_ERROR_STOP=1 -qAt "$@"; }
