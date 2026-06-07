#!/bin/bash
# Lokální spuštění CNC Sales OS jedním příkazem: ./start.sh
# - vytvoří .env.local z příkladu (pokud chybí)
# - nainstaluje závislosti (pokud chybí)
# - spustí vývojový server na http://localhost:3000
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env.local ]; then
  echo "→ Vytvářím .env.local z .env.example (doplň tajné klíče: ANTHROPIC_API_KEY, SUPABASE_SECRET_KEY…)"
  cp .env.example .env.local
fi

# Vždy doinstaluj závislosti (idempotentní — rychlé když je vše aktuální,
# doinstaluje nově přidané balíčky po stažení změn).
echo "→ Instaluji / aktualizuji závislosti…"
npm install --no-audit --no-fund

echo "→ Spouštím vývojový server… (Ctrl+C pro ukončení)"
echo "→ Otevři: http://localhost:3000"
exec npm run dev
