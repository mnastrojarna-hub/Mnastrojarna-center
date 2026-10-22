#!/usr/bin/env bash
# Spustí lokální Supabase-kompatibilní stack (bez Dockeru) a aplikuje migrace z supabase/migrations.
# Idempotentní: běžící služby nechá běžet, aplikuje jen nové migrace.
#
#   tools/local-supabase/start.sh
#   SKIP_FAILED_MIGRATIONS=1 tools/local-supabase/start.sh   # selhanou migraci přeskočí a pokračuje
#   STORAGE_FILE_SIZE_LIMIT=524288000 …                      # vyšší limit uploadu (výchozí 50 MB)
#   MIGRATIONS_DIR=/jiny/adresar …                           # jiný adresář s migracemi
#
# Porty: gateway 54321, Postgres 54322, mail HTTP 54324, SMTP 54325,
#        PostgREST 54330, GoTrue 54331, Storage 54332.
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

MIGRATIONS_DIR="${MIGRATIONS_DIR:-$REPO_ROOT/supabase/migrations}"
STORAGE_FILE_SIZE_LIMIT="${STORAGE_FILE_SIZE_LIMIT:-52428800}" # globální limit uploadu (B), Supabase default 50 MB
mkdir -p "$LS_DIR" "$LOG_DIR" "$RUN_DIR" "$STORAGE_DIR"

# ── 0. Binárky a Node závislosti ─────────────────────────────
QUIET=1 "$TOOLS_DIR/download.sh" || die "stažení binárek selhalo (download.sh)"
[ -x "$BIN_DIR/postgrest" ] && [ -x "$BIN_DIR/auth" ] || die "chybí binárky (spusť download.sh)"
[ -x "$BIN_DIR/storage/rt/node" ] && [ -f "$BIN_DIR/storage/app/dist/start/server.js" ] ||
  die "chybí supabase/storage-api (spusť download.sh)"
if [ ! -d "$TOOLS_DIR/node_modules/smtp-server" ] || [ ! -d "$TOOLS_DIR/node_modules/mailparser" ]; then
  log "instaluji Node závislosti nástrojů (smtp-server, mailparser) …"
  (cd "$TOOLS_DIR" && npm ci --no-audit --no-fund --silent)
fi
NODE_BIN="$(command -v node)" || die "chybí node"

eval "$(node "$TOOLS_DIR/keys.mjs")" # → ANON_KEY, SERVICE_ROLE_KEY

# ── 1. PostgreSQL ────────────────────────────────────────────
PG_SOCK_DIR="$RUN_DIR/pgsock"
if [ "$(id -u)" = "0" ]; then
  id "$PG_OS_USER" >/dev/null 2>&1 || die "uživatel '$PG_OS_USER' neexistuje (nastav PG_OS_USER=…)"
fi
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  log "initdb → $PGDATA"
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"
  pwfile="$LS_DIR/.pwfile"; printf '%s\n' "$PG_PASSWORD" >"$pwfile"
  if [ "$(id -u)" = "0" ]; then chown "$PG_OS_USER" "$PGDATA" "$pwfile"; fi
  chmod 700 "$PGDATA"
  locale_opt="--locale=C.UTF-8"; locale -a 2>/dev/null | grep -qi '^c\.utf-\?8$' || locale_opt="--no-locale"
  as_pg "$PG_BIN/initdb" -D "$PGDATA" -U postgres --pwfile="$pwfile" -A scram-sha-256 \
    --encoding=UTF8 $locale_opt >"$LOG_DIR/initdb.log" 2>&1 || { cat "$LOG_DIR/initdb.log" >&2; die "initdb selhal"; }
  rm -f "$pwfile"
  cat >>"$PGDATA/postgresql.conf" <<EOF

# ── local-supabase ──
port = $PG_PORT
listen_addresses = 'localhost'
unix_socket_directories = '$PG_SOCK_DIR'
max_connections = 200
wal_level = logical
timezone = 'UTC'
log_timezone = 'UTC'
# testovací DB — rychlost před odolností (při poškození: reset.sh)
fsync = off
synchronous_commit = off
full_page_writes = off
EOF
fi
mkdir -p "$PG_SOCK_DIR"; touch "$LOG_DIR/postgres.log"
if [ "$(id -u)" = "0" ]; then chown "$PG_OS_USER" "$PG_SOCK_DIR" "$LOG_DIR/postgres.log"; chown -R "$PG_OS_USER" "$PGDATA"; fi

if as_pg "$PG_BIN/pg_ctl" status -D "$PGDATA" >/dev/null 2>&1; then
  log "Postgres už běží (port $PG_PORT)"
else
  log "startuji Postgres na portu $PG_PORT …"
  as_pg "$PG_BIN/pg_ctl" start -D "$PGDATA" -l "$LOG_DIR/postgres.log" -w -t 60 -s ||
    { tail -n 30 "$LOG_DIR/postgres.log" >&2; die "Postgres se nespustil"; }
fi
for _ in $(seq 1 120); do "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PG_PORT" && break; sleep 0.25; done
"$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PG_PORT" || die "Postgres nepřijímá spojení"

log "bootstrap DB (role, schémata, rozšíření, granty) …"
psql_q -v pw="$PG_PASSWORD" -f "$TOOLS_DIR/sql/bootstrap.sql" >/dev/null

# ── 2. Mail catcher (SMTP 54325 / HTTP 54324) ────────────────
if pid_alive mailcatcher; then log "mail catcher už běží"; else
  log "startuji mail catcher (SMTP $MAIL_SMTP_PORT, HTTP $MAIL_HTTP_PORT) …"
  start_bg mailcatcher env MAIL_SMTP_PORT="$MAIL_SMTP_PORT" MAIL_HTTP_PORT="$MAIL_HTTP_PORT" \
    "$NODE_BIN" "$TOOLS_DIR/mailcatcher.mjs"
fi
wait_http mailcatcher "http://127.0.0.1:$MAIL_HTTP_PORT/health" 30

# ── 3. GoTrue (auth) ─────────────────────────────────────────
TPL="http://127.0.0.1:$MAIL_HTTP_PORT/templates"
if pid_alive gotrue; then log "GoTrue už běží"; else
  log "startuji GoTrue na portu $GOTRUE_PORT (migrace do schématu auth) …"
  start_bg gotrue env \
    GOTRUE_API_HOST=127.0.0.1 GOTRUE_API_PORT="$GOTRUE_PORT" PORT="$GOTRUE_PORT" \
    API_EXTERNAL_URL="http://localhost:$GATEWAY_PORT/auth/v1" \
    GOTRUE_DB_DRIVER=postgres \
    GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PG_PASSWORD@127.0.0.1:$PG_PORT/postgres?sslmode=disable" \
    GOTRUE_DB_MIGRATIONS_PATH="$BIN_DIR/auth-migrations" \
    GOTRUE_DB_NAMESPACE=auth \
    GOTRUE_SITE_URL="${GOTRUE_SITE_URL:-http://localhost:3000}" \
    GOTRUE_URI_ALLOW_LIST="http://localhost:3000/**,http://127.0.0.1:3000/**,http://localhost:*/**" \
    GOTRUE_DISABLE_SIGNUP=false \
    GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
    GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    GOTRUE_JWT_ISSUER="http://localhost:$GATEWAY_PORT/auth/v1" \
    GOTRUE_EXTERNAL_EMAIL_ENABLED=true GOTRUE_EXTERNAL_PHONE_ENABLED=false \
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED=false \
    GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED=true \
    GOTRUE_MAILER_OTP_EXP=3600 GOTRUE_MAILER_OTP_LENGTH=6 \
    GOTRUE_MAILER_TEMPLATES_RECOVERY="$TPL/recovery.html" \
    GOTRUE_MAILER_TEMPLATES_CONFIRMATION="$TPL/confirmation.html" \
    GOTRUE_MAILER_TEMPLATES_INVITE="$TPL/invite.html" \
    GOTRUE_MAILER_TEMPLATES_MAGIC_LINK="$TPL/magic_link.html" \
    GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE="$TPL/email_change.html" \
    GOTRUE_MAILER_TEMPLATES_REAUTHENTICATION="$TPL/reauthentication.html" \
    GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT="$MAIL_SMTP_PORT" \
    GOTRUE_SMTP_USER="" GOTRUE_SMTP_PASS="" \
    GOTRUE_SMTP_ADMIN_EMAIL=auth@local.test GOTRUE_SMTP_SENDER_NAME="Mnastrojarna (local)" \
    GOTRUE_SMTP_MAX_FREQUENCY=1ns \
    GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 GOTRUE_RATE_LIMIT_SMS_SENT=1000 \
    GOTRUE_RATE_LIMIT_VERIFY=100000 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=100000 \
    GOTRUE_RATE_LIMIT_SSO=100000 GOTRUE_RATE_LIMIT_OTP=100000 \
    GOTRUE_RATE_LIMIT_ANONYMOUS_USERS=100000 GOTRUE_RATE_LIMIT_WEB3=100000 \
    GOTRUE_PASSWORD_MIN_LENGTH=6 \
    GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true \
    GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION=false \
    GOTRUE_LOG_LEVEL=info \
    "$BIN_DIR/auth"
fi
wait_http gotrue "http://127.0.0.1:$GOTRUE_PORT/health" 90
for _ in $(seq 1 120); do
  [ "$(psql_q -c "select to_regclass('auth.users') is not null" 2>/dev/null)" = "t" ] && break; sleep 0.25
done
[ "$(psql_q -c "select to_regclass('auth.users') is not null")" = "t" ] || die "GoTrue nevytvořil auth.users"
psql_q -f "$TOOLS_DIR/sql/post-auth.sql" >/dev/null

# ── 4. Storage API ───────────────────────────────────────────
if pid_alive storage; then log "storage už běží"; else
  log "startuji supabase/storage-api $(cat "$BIN_DIR/storage.version") na portu $STORAGE_PORT (migrace do schématu storage) …"
  start_bg storage env -C "$BIN_DIR/storage/app" \
    NODE_ENV=production \
    SERVER_HOST=127.0.0.1 SERVER_PORT="$STORAGE_PORT" \
    AUTH_JWT_SECRET="$JWT_SECRET" AUTH_JWT_ALGORITHM=HS256 \
    ANON_KEY="$ANON_KEY" SERVICE_KEY="$SERVICE_ROLE_KEY" \
    DATABASE_URL="postgres://supabase_storage_admin:$PG_PASSWORD@127.0.0.1:$PG_PORT/postgres" \
    DB_INSTALL_ROLES=false DB_SUPER_USER=postgres MULTI_TENANT=false \
    STORAGE_BACKEND=file STORAGE_FILE_BACKEND_PATH="$STORAGE_DIR" \
    STORAGE_S3_BUCKET=stub STORAGE_S3_REGION=local TENANT_ID=stub \
    UPLOAD_FILE_SIZE_LIMIT="$STORAGE_FILE_SIZE_LIMIT" UPLOAD_FILE_SIZE_LIMIT_STANDARD="$STORAGE_FILE_SIZE_LIMIT" \
    IMAGE_TRANSFORMATION_ENABLED=false PG_QUEUE_ENABLE=false S3_PROTOCOL_ENABLED=false \
    REQUEST_ALLOW_X_FORWARDED_PATH=true \
    STORAGE_PUBLIC_URL="http://localhost:$GATEWAY_PORT/storage/v1" \
    LOG_LEVEL=info \
    "$BIN_DIR/storage/rt/node" dist/start/server.js
fi
wait_http storage "http://127.0.0.1:$STORAGE_PORT/status" 120
for _ in $(seq 1 120); do
  [ "$(psql_q -c "select to_regclass('storage.objects') is not null" 2>/dev/null)" = "t" ] && break; sleep 0.25
done
[ "$(psql_q -c "select to_regclass('storage.buckets') is not null")" = "t" ] || die "storage nevytvořil storage.buckets"

# ── 5. Migrace aplikace (jako `supabase db push`) ────────────
apply_migrations() {
  local failed=() applied=0 skipped=0
  shopt -s nullglob
  local files=("$MIGRATIONS_DIR"/*.sql)
  shopt -u nullglob
  [ "${#files[@]}" -gt 0 ] || { warn "žádné migrace v $MIGRATIONS_DIR"; return 0; }
  local dup
  dup=$(for f in "${files[@]}"; do b=$(basename "$f"); echo "${b%%_*}"; done | sort | uniq -d | head -n1)
  [ -z "$dup" ] || die "duplicitní verze migrace '$dup' v $MIGRATIONS_DIR"

  local known
  known=$(psql_q -F '|' -c "select version, coalesce(checksum,'') from supabase_migrations.schema_migrations")
  for f in $(printf '%s\n' "${files[@]}" | LC_ALL=C sort); do
    local base version name sum
    base=$(basename "$f" .sql); version="${base%%_*}"; name="${base#*_}"
    sum=$(sha256sum "$f" | cut -d' ' -f1)
    local rec
    rec=$(printf '%s\n' "$known" | grep "^$version|" || true)
    if [ -n "$rec" ]; then
      [ "${rec#*|}" = "$sum" ] || warn "migrace $base.sql se po aplikaci změnila (lokálně se znovu neaplikuje; čistý stav: reset.sh)"
      skipped=$((skipped + 1)); continue
    fi
    local wrapper="$RUN_DIR/migration-wrapper.sql" out
    cat >"$wrapper" <<EOF
\\set ON_ERROR_STOP 1
\\i '$f'
insert into supabase_migrations.schema_migrations(version, name, checksum) values (:'v', :'n', :'c');
EOF
    if out=$("$PSQL" -X -q -1 -v ON_ERROR_STOP=1 -v v="$version" -v n="$name" -v c="$sum" -f "$wrapper" 2>&1); then
      applied=$((applied + 1)); log "  ✓ $base.sql"
    else
      printf '\n\033[1;31m[local-supabase] MIGRACE SELHALA: %s\033[0m\n%s\n\n' "$base.sql" "$out" >&2
      printf '%s\n%s\n' "$base.sql" "$out" >"$LOG_DIR/migration-failed-$base.log"
      if [ -n "${SKIP_FAILED_MIGRATIONS:-}" ]; then
        failed+=("$base.sql"); warn "SKIP_FAILED_MIGRATIONS=1 → pokračuji bez $base.sql"
      else
        die "migrace $base.sql selhala (viz výše; log: $LOG_DIR/migration-failed-$base.log). Opravený soubor se aplikuje při dalším start.sh; nebo SKIP_FAILED_MIGRATIONS=1."
      fi
    fi
  done
  log "migrace: $applied nových, $skipped už aplikovaných${failed:+, PŘESKOČENO: ${failed[*]}}"
  rm -f "$RUN_DIR/migration-wrapper.sql"
}
log "aplikuji migrace z ${MIGRATIONS_DIR#"$REPO_ROOT"/} …"
apply_migrations

# ── 6. PostgREST ─────────────────────────────────────────────
if pid_alive postgrest; then log "PostgREST už běží"; else
  log "startuji PostgREST na portu $POSTGREST_PORT …"
  start_bg postgrest env \
    PGRST_DB_URI="postgres://authenticator:$PG_PASSWORD@127.0.0.1:$PG_PORT/postgres" \
    PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
    PGRST_DB_EXTRA_SEARCH_PATH=public,extensions \
    PGRST_JWT_SECRET="$JWT_SECRET" \
    PGRST_DB_MAX_ROWS=1000 PGRST_DB_POOL=20 \
    PGRST_DB_CHANNEL_ENABLED=true PGRST_DB_CHANNEL=pgrst \
    PGRST_SERVER_HOST=127.0.0.1 PGRST_SERVER_PORT="$POSTGREST_PORT" \
    PGRST_OPENAPI_MODE=follow-privileges \
    PGRST_LOG_LEVEL=warn \
    "$BIN_DIR/postgrest"
fi
wait_http postgrest "http://127.0.0.1:$POSTGREST_PORT/" 60
psql_q -c "notify pgrst, 'reload schema'" >/dev/null

# ── 7. API gateway ───────────────────────────────────────────
if pid_alive gateway; then log "gateway už běží"; else
  log "startuji API gateway na portu $GATEWAY_PORT …"
  start_bg gateway env GATEWAY_PORT="$GATEWAY_PORT" POSTGREST_PORT="$POSTGREST_PORT" \
    GOTRUE_PORT="$GOTRUE_PORT" STORAGE_PORT="$STORAGE_PORT" "$NODE_BIN" "$TOOLS_DIR/gateway.mjs"
fi
wait_http gateway "http://127.0.0.1:$GATEWAY_PORT/health" 30
sleep 0.5 # PostgREST: dokončení reloadu schématu
curl -fsS -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" -H "apikey: $ANON_KEY" || warn "REST přes gateway zatím neodpovídá"

# ── 8. Výstup: proměnné prostředí ────────────────────────────
cat >"$ENV_FILE" <<EOF
NEXT_PUBLIC_SUPABASE_URL=http://localhost:$GATEWAY_PORT
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY
SUPABASE_SECRET_KEY=$SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET=$JWT_SECRET
SUPABASE_DB_URL=postgres://postgres:$PG_PASSWORD@127.0.0.1:$PG_PORT/postgres
LOCAL_MAIL_API=http://127.0.0.1:$MAIL_HTTP_PORT
SMTP_HOST=127.0.0.1
SMTP_PORT=$MAIL_SMTP_PORT
EOF

log "stack běží ✔  (logy: ${LOG_DIR#"$REPO_ROOT"/}/, env: ${ENV_FILE#"$REPO_ROOT"/})"
echo
echo "NEXT_PUBLIC_SUPABASE_URL=http://localhost:$GATEWAY_PORT"
echo "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$ANON_KEY"
echo "SUPABASE_SECRET_KEY=$SERVICE_ROLE_KEY"
echo
echo "# Postgres:   postgres://postgres:$PG_PASSWORD@127.0.0.1:$PG_PORT/postgres"
echo "# Mail (API): http://127.0.0.1:$MAIL_HTTP_PORT/messages   SMTP: 127.0.0.1:$MAIL_SMTP_PORT (bez TLS, libovolný login)"
echo "# Next.js:    set -a; source .local-supabase/env; set +a; npm run dev"
