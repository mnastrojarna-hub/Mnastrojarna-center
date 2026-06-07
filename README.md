# CNC Sales OS — Mnástrojárna

AI asistovaná obchodní a e-mailová kancelář pro nástrojárnu — CRM + ERP + e-mailový klient + dokumentový systém + AI asistent v jedné moderní SaaS aplikaci.

> Kompletní vize a specifikace: viz [`CLAUDE.md`](./CLAUDE.md)

## Stack

| Vrstva | Technologie |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, ShadCN-style UI |
| Backend | Supabase (PostgreSQL + pgvector, Auth, Storage, Realtime, Edge Functions) |
| AI | Claude API (Anthropic, `claude-opus-4-8`) + embeddings/pgvector (RAG) |
| E-mail | Microsoft 365 / Outlook (Graph API), IMAP/SMTP (hosting90) |
| Nasazení | Vercel + Supabase (deploy migrací přes git, viz `SUPABASE_SETUP.md`) |

## Filozofie ovládání

**AI dělá vše automaticky, člověk pouze koriguje.** Každá automatizovaná akce běží v jednom ze dvou režimů — **Plná automatika (100 %)** nebo **Se schválením**. Přepíná se globálně (horní lišta) i per-modul (Nastavení).

## Co je hotové

**Frontend / UX**
- App shell: sidebar, topbar, command palette (⌘K), dark/light mode, responzivní + mobilní nav
- Moduly: Dashboard, AI Inbox, Nabídky, Objednávky, Zákazníci, Dodavatelé, Archiv výkresů, Znalostní DB, AI Asistent, Provize, Nastavení
- Branding dle logomanuálu (červená `#E03930`, antracit, šedá; font Roboto; logo frézy)
- Fronta ke schválení, AI confidence indikátory, přepínač režimu automatizace

**Backend (Supabase)**
- 20 tabulek (profiles+role, CRM, dodavatelé, výkresy+pgvector, nabídky/objednávky, e-maily, automatizace, fronta schvalování, provize, znalostní DB, audit log)
- RLS politiky dle rolí (super_admin / obchodnik / zamestnanec), RAG funkce `match_drawings` / `match_knowledge`, číslování dokladů
- Migrace ověřené na PG16 + pgvector; `supabase/seed.sql` pro lokální dev
- Datová vrstva s fallbackem na demo data (appka běží i bez živé DB)

**AI (Claude)**
- Kategorizace e-mailů, návrhy odpovědí, firemní asistent (`src/lib/ai/claude.ts`)
- API: `/api/assistant`, `/api/emails/categorize`, `/api/emails/sync`

**E-mail ingest**
- IMAP (hosting90) + Microsoft Graph (Outlook) → AI analýza → uložení + fronta ke schválení

**Auth**
- Supabase Auth (login `/login`, server actions, middleware pro session)

## Spuštění (lokálně)

```bash
cp .env.example .env.local   # doplň klíče (Supabase už předvyplněno v .env.local)
npm install
npm run dev                  # http://localhost:3000
```

## Co je potřeba doplnit pro plný provoz (secrets)

| Kde | Co | Proč |
| --- | --- | --- |
| `.env.local` / Vercel | `ANTHROPIC_API_KEY` | živá AI (jinak fallback) |
| `.env.local` / Vercel | `SUPABASE_SECRET_KEY` | serverový zápis (ingest pošty) |
| `.env.local` / Vercel | `IMAP_*` nebo `MS_GRAPH_*` | stahování pošty |
| GitHub Secrets | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` | automatický deploy migrací — viz `SUPABASE_SETUP.md` |

## Skripty

- `npm run dev` — vývoj · `npm run build` — produkční build · `npm run typecheck` · `npm run lint`
