#!/usr/bin/env bash
# Zastaví stack a smaže všechna lokální data (DB, storage, logy, env). Stažené binárky (bin/) zůstanou.
#   tools/local-supabase/reset.sh           # jen smaže
#   tools/local-supabase/reset.sh --start   # smaže a znovu spustí (+ seed uživatelů)
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

"$TOOLS_DIR/stop.sh"
log "mažu data v $LS_DIR (kromě bin/) …"
rm -rf "$PGDATA" "$STORAGE_DIR" "$LOG_DIR" "$RUN_DIR" "$ENV_FILE" "$LS_DIR/tmp" "$LS_DIR/.pwfile"
log "reset hotov"
if [ "${1:-}" = "--start" ]; then
  "$TOOLS_DIR/start.sh"
  node "$TOOLS_DIR/seed-users.mjs"
fi
