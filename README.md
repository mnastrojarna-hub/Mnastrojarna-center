# CNC Sales OS

AI asistovaná obchodní a e-mailová kancelář pro nástrojárnu — CRM + ERP + e-mailový klient + dokumentový systém + AI asistent v jedné moderní SaaS aplikaci.

> Kompletní vize a specifikace: viz [`CLAUDE.md`](./CLAUDE.md)

## Stack

| Vrstva | Technologie |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS, ShadCN-style UI |
| Backend | Supabase (PostgreSQL, Auth, Storage, Realtime, Edge Functions) |
| AI | Claude API (Anthropic) + Embeddings/pgvector (RAG) |
| E-mail | Microsoft 365 / Outlook (Graph API), IMAP/SMTP (hosting90) |
| Nasazení | Vercel |

## Filozofie ovládání

**AI dělá vše automaticky, člověk pouze koriguje.** Každá automatizovaná akce běží v jednom ze dvou režimů:

- **Plná automatika (100 %)** — AI provede akci sama.
- **Se schválením** — AI vše připraví, ty jedním klikem schválíš / upravíš / zamítneš.

Režim se přepíná globálně (horní lišta) i pro každý modul zvlášť (Nastavení).

## Stav: UI/UX prototyp

Aktuálně je hotová kompletní **UI/UX vrstva** s ukázkovými daty (`src/lib/mock-data.ts`):

- Dashboard, AI Inbox, Poptávky & Nabídky, Objednávky, Zákazníci (CRM), Dodavatelé,
  Archiv výkresů, Znalostní DB, AI Asistent, Provize, Nastavení
- Globální vyhledávání (⌘K, Raycast styl), dark/light mode, responzivní layout, fronta ke schválení

Další krok: návrh DB schématu v Supabase a napojení reálných dat + Claude API.

## Spuštění

```bash
cp .env.example .env.local   # doplň Supabase / Anthropic / e-mail klíče
npm install
npm run dev                  # http://localhost:3000
```

## Skripty

- `npm run dev` — vývojový server
- `npm run build` — produkční build
- `npm run typecheck` — kontrola typů
- `npm run lint` — ESLint
