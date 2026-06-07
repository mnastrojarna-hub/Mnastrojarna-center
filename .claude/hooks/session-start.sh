#!/bin/bash
# SessionStart hook — připraví projekt, aby šel hned testovat a spustit.
# Nainstaluje závislosti (idempotentní, využívá cache kontejneru).
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

echo "[session-start] Instaluji npm závislosti…"
npm install --no-audit --no-fund

# Lokální .env.local vytvoříme z příkladu, pokud chybí (app jinak běží na demo datech).
if [ ! -f .env.local ]; then
  echo "[session-start] Vytvářím .env.local z .env.example (doplň tajné klíče)."
  cp .env.example .env.local || true
fi

echo "[session-start] Hotovo. Spusť 'npm run dev' (nebo ./start.sh) a otevři http://localhost:3000"
