#!/usr/bin/env bash
# Stáhne binárky lokálního Supabase stacku z ghcr.io (bez Dockeru) do .local-supabase/bin.
# Idempotentní: co už je stažené ve správné verzi, přeskočí.
#
#   tools/local-supabase/download.sh            # stáhne vše, co chybí
#   FORCE=1 tools/local-supabase/download.sh    # stáhne znovu
#   QUIET=1 …                                   # nevypisuje, co už je stažené
#
# Volitelný "seed" adresář s již rozbalenými image (ušetří stahování):
#   LOCAL_SUPABASE_SEED_DIR=/tmp/claude-0/stack/dl  (výchozí, pokud existuje)
#   očekává <seed>/postgrest, <seed>/gotrue, <seed>/storage (rozbalený rootfs).
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

SEED_DIR="${LOCAL_SUPABASE_SEED_DIR:-/tmp/claude-0/stack/dl}"
REGISTRY="https://ghcr.io"
mkdir -p "$BIN_DIR"

command -v curl >/dev/null || die "chybí curl"
command -v python3 >/dev/null || die "chybí python3"

# pull_image <repo> <tag> <outdir> — stáhne a rozbalí vrstvy image (linux/amd64) přes Registry API.
pull_image() {
  local repo="$1" tag="$2" out="$3"
  local accept='application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json,application/vnd.docker.distribution.manifest.v2+json,application/vnd.oci.image.manifest.v1+json'
  rm -rf "$out"; mkdir -p "$out"
  log "stahuji ghcr.io/$repo:$tag …"
  local token man digest
  token=$(curl -fsS --retry 3 "$REGISTRY/token?scope=repository:$repo:pull" |
    python3 -I -c 'import sys,json;print(json.load(sys.stdin)["token"])')
  man=$(curl -fsS --retry 3 -H "Authorization: Bearer $token" -H "Accept: $accept" "$REGISTRY/v2/$repo/manifests/$tag")
  digest=$(printf '%s' "$man" | python3 -I -c '
import sys, json
m = json.load(sys.stdin)
for x in m.get("manifests", []):
    p = x.get("platform", {})
    if p.get("architecture") == "amd64" and p.get("os") == "linux":
        print(x["digest"]); break')
  if [ -n "$digest" ]; then
    man=$(curl -fsS --retry 3 -H "Authorization: Bearer $token" -H "Accept: $accept" "$REGISTRY/v2/$repo/manifests/$digest")
  fi
  printf '%s' "$man" >"$out/.manifest.json"
  local layers
  layers=$(printf '%s' "$man" | python3 -I -c 'import sys,json;[print(l["digest"]) for l in json.load(sys.stdin)["layers"]]')
  [ -n "$layers" ] || die "manifest $repo:$tag neobsahuje vrstvy"
  local n=0 total
  total=$(printf '%s\n' "$layers" | wc -l)
  while read -r layer; do
    n=$((n + 1))
    local f="$out/.layer.tar"
    curl -fsSL --retry 5 --retry-all-errors -H "Authorization: Bearer $token" "$REGISTRY/v2/$repo/blobs/$layer" -o "$f"
    local sum
    sum="sha256:$(sha256sum "$f" | cut -d' ' -f1)"
    [ "$sum" = "$layer" ] || die "kontrolní součet vrstvy $layer nesedí ($sum)"
    # Vrstvy jsou tar+gzip (případně čistý tar); zařízení v /dev přeskočíme.
    if ! tar -xzf "$f" -C "$out" --no-same-owner --exclude='dev/*' --exclude='./dev/*' 2>/dev/null; then
      tar -xf "$f" -C "$out" --no-same-owner --exclude='dev/*' --exclude='./dev/*' 2>/dev/null ||
        warn "vrstva $n/$total ($layer) se nerozbalila úplně"
    fi
    rm -f "$f"
    printf '  vrstva %d/%d OK\n' "$n" "$total"
  done <<<"$layers"
  echo "$repo:$tag" >"$out/.image-ref"
}

quiet_log() { [ -n "${QUIET:-}" ] || log "$@"; }

have_version() { [ -f "$BIN_DIR/$1.version" ] && [ "$(cat "$BIN_DIR/$1.version")" = "$2" ] && [ -z "${FORCE:-}" ]; }

# ── PostgREST ────────────────────────────────────────────────
install_postgrest() {
  if have_version postgrest "$POSTGREST_TAG" && [ -x "$BIN_DIR/postgrest" ]; then
    quiet_log "PostgREST $POSTGREST_TAG už je stažen"; return
  fi
  local want="${POSTGREST_TAG#v}" src=""
  if [ -x "$SEED_DIR/postgrest/bin/postgrest" ] &&
    "$SEED_DIR/postgrest/bin/postgrest" --version 2>/dev/null | grep -q "PostgREST $want\$"; then
    src="$SEED_DIR/postgrest"; log "PostgREST: používám seed $src"
  else
    src="$LS_DIR/tmp/postgrest"; pull_image supabase/postgrest "$POSTGREST_TAG" "$src"
  fi
  install -m 0755 "$src/bin/postgrest" "$BIN_DIR/postgrest"
  echo "$POSTGREST_TAG" >"$BIN_DIR/postgrest.version"
  [ "$src" = "$LS_DIR/tmp/postgrest" ] && rm -rf "$src"
  log "PostgREST: $("$BIN_DIR/postgrest" --version)"
}

# ── GoTrue (supabase/auth) ───────────────────────────────────
install_gotrue() {
  if have_version gotrue "$GOTRUE_TAG" && [ -x "$BIN_DIR/auth" ] && [ -d "$BIN_DIR/auth-migrations" ]; then
    quiet_log "GoTrue $GOTRUE_TAG už je stažen"; return
  fi
  local src=""
  if [ -x "$SEED_DIR/gotrue/usr/local/bin/auth" ] &&
    "$SEED_DIR/gotrue/usr/local/bin/auth" version 2>/dev/null | grep -q "^$GOTRUE_TAG\$"; then
    src="$SEED_DIR/gotrue"; log "GoTrue: používám seed $src"
  else
    src="$LS_DIR/tmp/gotrue"; pull_image supabase/gotrue "$GOTRUE_TAG" "$src"
  fi
  install -m 0755 "$src/usr/local/bin/auth" "$BIN_DIR/auth"
  rm -rf "$BIN_DIR/auth-migrations"
  cp -r "$src/usr/local/etc/auth/migrations" "$BIN_DIR/auth-migrations"
  echo "$GOTRUE_TAG" >"$BIN_DIR/gotrue.version"
  [ "$src" = "$LS_DIR/tmp/gotrue" ] && rm -rf "$src"
  log "GoTrue: $("$BIN_DIR/auth" version 2>/dev/null | head -n1)"
}

# ── Storage API (Node app z Alpine image + vlastní musl runtime) ─
install_storage() {
  local dst="$BIN_DIR/storage"
  if have_version storage "$STORAGE_TAG" && [ -f "$dst/app/dist/start/server.js" ] && [ -x "$dst/rt/node" ]; then
    quiet_log "storage-api $STORAGE_TAG už je stažen"; return
  fi
  local src=""
  if [ -f "$SEED_DIR/storage/.image-ref" ] &&
    [ "$(cat "$SEED_DIR/storage/.image-ref")" = "supabase/storage-api:$STORAGE_TAG" ]; then
    src="$SEED_DIR/storage"; log "storage-api: používám seed $src"
  else
    src="$LS_DIR/tmp/storage"; pull_image supabase/storage-api "$STORAGE_TAG" "$src"
  fi
  rm -rf "$dst"; mkdir -p "$dst/rt"
  log "storage-api: kopíruji aplikaci (~600 MB) …"
  cp -a "$src/app" "$dst/app"
  # Image je Alpine (musl). Node + nativní moduly (fs-xattr) spouštíme přes musl loader z image,
  # takže není potřeba nic kompilovat ani instalovat do systému.
  cp -L "$src/lib/ld-musl-x86_64.so.1" "$dst/rt/ld-musl-x86_64.so.1"
  ln -sf ld-musl-x86_64.so.1 "$dst/rt/libc.musl-x86_64.so.1"
  cp -L "$src/usr/lib/libstdc++.so.6" "$dst/rt/libstdc++.so.6"
  cp -L "$src/usr/lib/libgcc_s.so.1" "$dst/rt/libgcc_s.so.1"
  cp -L "$src/usr/local/bin/node" "$dst/rt/node.bin"
  cat >"$dst/rt/node" <<'EOF'
#!/bin/sh
# Wrapper: spustí Alpine (musl) build Node.js přes přibalený musl loader.
RT="$(cd "$(dirname "$0")" && pwd)"
exec "$RT/ld-musl-x86_64.so.1" --library-path "$RT" "$RT/node.bin" "$@"
EOF
  chmod 0755 "$dst/rt/node" "$dst/rt/node.bin" "$dst/rt/ld-musl-x86_64.so.1"
  echo "$STORAGE_TAG" >"$BIN_DIR/storage.version"
  [ "$src" = "$LS_DIR/tmp/storage" ] && rm -rf "$src"
  log "storage-api: node $("$dst/rt/node" --version)"
}

install_postgrest
install_gotrue
install_storage
rmdir "$LS_DIR/tmp" 2>/dev/null || true
quiet_log "binárky jsou v $BIN_DIR"
