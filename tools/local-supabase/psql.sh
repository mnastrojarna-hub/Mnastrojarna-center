#!/usr/bin/env bash
# Otevře psql do lokální DB (jako postgres). Další argumenty se předají psql, např.:
#   tools/local-supabase/psql.sh -c "select * from profiles"
#   tools/local-supabase/psql.sh -U authenticator      (heslo: postgres)
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
exec "$PSQL" -h 127.0.0.1 -p "$PG_PORT" -U postgres -d postgres "$@"
