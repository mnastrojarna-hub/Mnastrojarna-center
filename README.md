# CNC Sales OS — Mnástrojárna

AI asistovaná kancelář nástrojárny a kooperací: **Kniha zakázek** jako jediná pracovní plocha
pro všechny, k ní pošta, zákazníci, dodavatelé, doklady (PDF), provize a AI, která čte vyfocené
doklady a učí se z ručních oprav.

> Vize a specifikace: [`CLAUDE.md`](./CLAUDE.md) · Návod pro uživatele: [`docs/kniha-zakazek.md`](./docs/kniha-zakazek.md)
> · Supabase a nasazení: [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md)

## Co aplikace dělá

- **Kniha zakázek** (`/orders`, výchozí stránka po přihlášení) — jedna zakázka = jeden řádek
  (Z-2026-001). Záložky **Objednávky** (výchozí: objednávka → potvrzeno → ve výrobě → dodáno k nám
  → na skladě → montáž → dodáno zákazníkovi → vyfakturováno, + pozastaveno / reklamace),
  **Poptávky & nabídky** (předobjednávková fáze), Dokončené, Nerealizované & zrušené, Vše.
  Každý stav má svou barvu (`src/lib/jobs/stages.ts`), filtry podle stavu, termínu, obchodníka,
  zákazníka, výroby a platby; řádky i tabule (kanban).
- **Karta zakázky** — zákazník (+ naše číslo zákazníka), číslo objednávky a poptávky zákazníka,
  všechny termíny (poptávka, objednávka, požadovaný, potvrzený, předpokládaný, slíbený dodavatelem,
  max. tolerovaný), lidé (obchodník, zadal, zpracovává, nacenil, schválil), položky, **více nabídek**
  s verzemi a archivem, dokumenty s verzemi, výroba, nákup & marže, historie změn.
- **📷 Vyfotit doklad** — fotka / PDF → AI pozná druh dokladu a vystavitele (poptávka zákazníka,
  naše nabídka, nabídka dodavatele, objednávka zákazníka, naše potvrzení, dodací list, faktura…),
  přečte údaje, spáruje zakázku a zákazníka (nového založí), posune stav **jen dopředu** a ukáže
  **kontrolní formulář** před uložením. Bez AI oprávnění stejný postup s ručním vyplněním.
- **+ Nová zakázka** — kompletní ruční formulář; vše jde upravit i dodatečně (s historií).
- **Doklady (PDF)** — nabídka, potvrzení objednávky, dodací list, faktura, objednávka dodavateli;
  odeslání e-mailem z aplikace.
- **Pošta** — Outlook (Graph) / IMAP+SMTP (hosting90); AI třídí kategorie, každý vidí svou
  schránku, super admin všechny; zakázka z e-mailu jedním klikem.
- **Zákazníci** (`/customers`) a **Dodavatelé** (`/suppliers`) — pro všechny: číslo zákazníka
  (ZK0001, přiděluje DB), IČO/DIČ, adresy, kontaktní osoby, splatnost, naše číslo dodavatele
  u zákazníka; dodavatelé s technologiemi, materiály, certifikacemi, lhůtou a hodnocením.
  **Vyplnit z dokladu** v okně Nový zákazník / Nový dodavatel: vyfoť nebo nahraj cokoli (screenshot
  e-mailu, objednávku, fakturu, vizitku, PDF, `.eml` / `.msg`) nebo vlož text či screenshot (Ctrl+V) →
  AI vytáhne **jen firmu** (kontakty, e-maily podle účelu, u dodavatele i technologie) a IČO ověří
  v **ARES** (název, DIČ, sídlo z registru; bez IČO hledá podle názvu). Nezakládá se žádná zakázka —
  formulář se jen předvyplní a uloží až uživatel. Stačí i jen napsat IČO — tlačítko **ARES** doplní zbytek.
- **Provize** — obchodník vidí jen svoje, super admin všechny (smlouvy, pásma, vyúčtování).
- **Super admin navíc**: AI přehled (fronta schvalování, AI pošta, rozložení zakázek), AI asistent,
  znalostní DB (historie cen), archiv výkresů, ladění AI (pravidla, korekce, automatika),
  nastavení, uživatelé.
- **Hledání ⌘K** — zakázky (číslo, název, zákazník, č. objednávky zákazníka, výkres), zákazníci,
  dodavatelé, nabídky, výkresy (jen s právem) + rychlé akce.
- **Prohlížeč dokumentů a 3D modelů** — klik na dokument kdekoli v aplikaci (Dokumenty, karta
  zakázky, archiv výkresů, přílohy pošty) ho otevře přes celou obrazovku ve stejné kartě; velké
  **Zpět** i systémové zpět na telefonu vrací přesně tam, kde uživatel byl. PDF (pdf.js, i na
  Androidu / iOS), fotky s přiblížením, **3D modely bez instalace**: STEP (AP203/214/242), IGES,
  BREP (OpenCascade ve WebAssembly), STL, OBJ, PLY, 3MF, glTF a **3D PDF** (U3D / PRC).
  Ovládání jako ZW3D (kolečko = zoom ke kurzoru, prostřední/levé = otáčení kolem bodu, Shift/Ctrl
  nebo pravé = posun, dotyk: 1 prst otáčí, 2 prsty posun + zoom), orientační kostka a standardní
  pohledy, strom sestavy, mazání / izolace dílů i celých podsestav se **zpět / vpřed (Ctrl+Z / Ctrl+Y)**,
  **výběrový filtr** (lišta i pravé tlačítko: tvar, díl, sestava, plocha, hrana, bod/roh, střed
  křivosti, střed hrany), **řez** rovinou XY / XZ / YZ nebo plochou (posuvník, otočení, šrafovaná
  plocha řezu, měření na řezu), měření vzdálenosti s uchopením (roh, střed díry, střed hrany, hrana,
  plocha; rovnoběžné plochy, rozteč os), průměr / poloměr, úhel, rozměry / objem dílu, **hmotnost dílu a polotovaru** podle materiálu
  z Nacenění (přířez / kulatina s přídavky jako v kalkulaci, polotovar nakreslený v 3D), barvy dílů
  a ploch. **2D výkresy DXF a DWG** ve stejném prohlížeči: hladiny jako díly (seznam hladin, skrýt /
  izolovat / barva, vypnuté hladiny skryté, zpět / vpřed), barvy z výkresu (černá ↔ bílá podle pozadí),
  texty a MTEXT (čeština i ze starších výkresů v kódové stránce 1250), bloky, kóty, polyčáry
  s oblouky, spliny, elipsy; posun / zoom bez otáčení, měření s uchopením rohů, středů kružnic
  a polovin čar, průměr / poloměr, úhel. DXF čte `dxf-parser` (MIT), DWG (R13–2018) **LibreDWG**
  ve WebAssembly (`@mlightcad/libredwg-web`, licence **GPL-3.0** — v pořádku pro interní provoz
  firmy; při distribuci aplikace třetím stranám nutno řešit licenci). Kód: `src/components/viewer3d`,
  `src/components/file-viewer`, `src/lib/viewer3d` (OpenCascade a LibreDWG se kopírují do
  `public/vendor` skriptem `tools/vendor-occt.mjs` při instalaci a buildu).

### Role a oprávnění

Zdroj pravdy: `src/lib/auth/permissions.ts` (`can(subject, feature, ctx)`). Data se na serveru čtou
**servisním klíčem** (obchází RLS), proto **každá stránka, server action i API route** kontroluje
oprávnění sama (`requireFeature` / `checkFeature` / `apiRequire` v `src/lib/auth/session.ts`).
Nacenění dělá člověk — AI se zatím jen učí (`ai_pricing` je jen pro super admina).

### Role a viditelnost

**Kniha zakázek** = výroba a celý život zakázky — vidí ji každý (všechny zakázky, detail, zákazníci,
dodavatelé). **Obchodní tok** (Poptávky, Nabídky, Potvrzení objednávek, Objednávky dodavatelům,
Dokumenty) = práce z pošty — ne-admin vidí jen „svoje", super admin vše (s přepínačem „Všichni / Jen moje",
`?kdo=moje`, cookie `flow_kdo`).

| Kde | Super admin | Obchodník | Zaměstnanec |
| --- | --- | --- | --- |
| Kniha zakázek (seznam, tabule, KPI), detail zakázky | vše | vše | vše |
| Prodejní ceny (hodnota zakázky, nabídky) | ✅ | ✅ | ✅ |
| Nákupní ceny, marže, záložka Nákup, ceny dodavatelů | ✅ | ✅ | ❌ |
| Provize zakázky | ✅ | jen na své zakázce | ❌ |
| Nákupní doklady (PO, nabídka / potvrzení / DL / faktura dodavatele) | otevřené | otevřené | řádek vidět, obsah zamčený |
| Obchodník zakázky (změna) | ✅ | ❌ (Zpracovává ano) | ❌ (Zpracovává ano) |
| Zákazníci (vč. cenového profilu), dodavatelé | vše | vše | vše (bez profilu) |
| Poptávky, Nabídky, Potvrzení objednávek | vše + přepínač | moje | moje |
| Nacenění (`/pricing`, „Nacenit", krok v proužku toku) | ✅ | ❌ | ❌ |
| Objednávky dodavatelům | vše + přepínač, ceny, akce | moje, ceny, akce | moje, bez cen, bez PDF a akcí |
| Dokumenty | vše + přepínač | moje | moje, nákupní doklady zamčené |
| Přijatá / odeslaná pošta | všech schránek | vlastní schránky | vlastní schránky |
| Odznaky v menu (postranní i mobilní „Menu") | vše | moje | moje |
| ⌘K: Zakázky (i podle čísla nabídky), Zákazníci, Dodavatelé | vše | vše | vše |
| ⌘K: Nabídky | vše | moje | moje |
| Vytvořit nabídku | bez schválení | → „Neschválená" | → „Neschválená" |
| Schválit / vrátit nabídku k přepracování | **jen on** | ❌ | ❌ |
| Odeslat nabídku zákazníkovi | ✅ | po schválení | po schválení (autor, obchodník nebo řešitel zakázky) |
| Vyfotit doklad (AI čtení) | ✅ | ✅ (výchozí) | ✅ (výchozí) |
| AI přehled, asistent, znalostní DB, výkresy, ladění AI | ✅ | ❌ | ❌ |
| Nastavení, uživatelé, mazání | ✅ | ❌ | ❌ |

**„Moje"** (jedna definice v TS `src/lib/auth/flow-scope.ts` → `isMineJob` a v SQL `flow_mine_job_ids`,
test parity hlídá shodu): zakázka je moje, když jsem její **Obchodník**, **Zpracovává** ji, **založil(a)**
jsem ji, přišla do **mé schránky** (e-mail zakázky nebo k ní připojený, i moje odeslaná pošta), nebo
jsem autor / obchodník některé její **nabídky**. „Moje" je filtr dotazů (`listJobs/listQuotes/listJobFiles/
listPurchaseOrders(…, { scope })`, počty `flow_counts(p_mine)`, odznaky `flow_badge_counts(p_mine)`),
**ne** RLS — Kniha potřebuje všechny řádky. Vlastník zákazníka do „moje" nepatří.

**Schvalování nabídek:** nabídka, kterou připraví (nebo před odesláním změní) kdokoli kromě super admina,
je **„Neschválená — čeká na schválení super admina"** (štítek v kartě nabídky, v řádku i kartě Knihy,
v hlavičce zakázky, na `/quotes`). Do schválení ji nejde odeslat (tlačítko zamčené, server i DB to
odmítnou); PDF náhled má vodoznak „NESCHVÁLENO — NEODESÍLAT". Super admin ji schválí jedním klikem
(AI přehled → „Nabídky ke schválení", `/quotes` → „Ke schválení"), rovnou „Schválit a odeslat", nebo
„Vrátit k přepracování…" s důvodem (autor ho uvidí v kartě nabídky a v odznaku „Nabídky"). Po schválení
„Připravil(a) P. Obchodník · Schválil J. Semorád · 23. 10. 2026" a odeslat ji může autor, obchodník nebo
řešitel zakázky. Jakákoli další změna ne-adminem schválení zruší; super admin nabídky schválení
nepotřebují. Limit částky schválení se už nepoužívá.

Migrace: `supabase/migrations/20261023155000_role_viditelnost.sql` (schvalování, RLS, ceny dokladů) a
`20261023157000_role_viditelnost_moje.sql` („moje", odznaky, obchodník zakázky jen super admin).
Zbytkové riziko: REST relace aktivního uživatele dál čte sloupce nákupních cen (aplikace je nepoužívá —
servisní klíč + maskování); zpřísnění přes sloupcová práva je další krok.

### AI a učení

- Čtení dokladů: `src/lib/ai/document-reader.ts` (Claude, obrázky i PDF). Každý uložený doklad
  (AI vyplnila / člověk opravil / člověk vyplnil) se uloží do `ai_training_examples` a nejnovější
  příklady jdou do promptu jako vzor. Opravy výstupů AI → `ai_corrections` (Ladění & korekce).
- Hlavní vypínač AI a „AI čtení pro všechny" je v Nastavení → AI přístup; per uživatel
  v Uživatelé. Bez Claude API klíče aplikace funguje ručně.

## Stack

| Vrstva | Technologie |
| --- | --- |
| Frontend | Next.js 15 (App Router), React 19, TypeScript (strict), Tailwind CSS, shadcn-style UI |
| Backend | Supabase (PostgreSQL + pgvector, Auth, Storage, RLS) + Next.js Server Actions / API routes |
| AI | Claude API (Anthropic) |
| E-mail | Microsoft 365 / Outlook (Graph API), IMAP/SMTP (hosting90) |
| Nasazení | Vercel + Supabase (migrace v `supabase/migrations/`, viz `SUPABASE_SETUP.md`) |

## Spuštění

```bash
cp .env.example .env.local   # doplň klíče
npm install
npm run dev                  # http://localhost:3000 → /login → /orders
```

První spuštění bez databáze otevře průvodce `/setup` (Supabase, AI klíč, firma, první super admin).

### Proměnné prostředí

| Proměnná | Povinná | K čemu |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ano | připojení k Supabase |
| `SUPABASE_SECRET_KEY` | ano | serverový přístup (jen server / Vercel, nikdy do klienta) |
| `NEXT_PUBLIC_APP_URL` | ano | veřejná adresa aplikace (odkazy v e-mailech, `/auth/callback`) |
| `ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`) | ne | AI čtení dokladů, třídění pošty, asistent (lze zadat i v Nastavení) |
| `IMAP_*`, `SMTP_*` nebo `MS_GRAPH_*` | ne | pošta (lze zadat i per schránka v Nastavení) |
| `CRON_SECRET` | ne | periodické stahování pošty přes `/api/cron/sync-mail` |

### Obnova hesla

`/forgot-password` → 6místný kód e-mailem (platnost 15 min, omezení pokusů), pak nové heslo.
S nastaveným SMTP posílá kód aplikace; bez SMTP použije e-mail Supabase (odkaz přes
`/auth/callback`, nebo kód `{{ .Token }}`, pokud ho šablona obsahuje — viz `SUPABASE_SETUP.md`).
Veřejná registrace je vypnutá — účty zakládá super admin (počáteční heslo, vynucená změna).

## Lokální vývoj s lokálním Supabase (bez Dockeru)

```bash
tools/local-supabase/start.sh             # PostgREST + GoTrue + Storage + PG16, aplikuje migrace
node tools/local-supabase/seed-users.mjs  # admin@local.test / Admin123!, obchod@local.test / Obchod123!,
                                          # dilna@local.test / Dilna123!
tools/local-supabase/psql.sh -f tools/e2e/seed-demo.sql   # demo data (zakázky ve všech stavech)
set -a; source .local-supabase/env; set +a; npm run dev
```

Podrobnosti (porty, mail catcher na `:54324`, reset): `tools/local-supabase/README.md`.

### Testy

```bash
npm run typecheck && npm run lint && npm test     # vitest (logika, mapování, vykreslení komponent)
tools/e2e/run-app.sh                              # build + start proti lokálnímu Supabase (port 3100)
node tools/e2e/tests/01-auth-users-mail.mjs       # E2E (Playwright): přihlášení, role, ochrana API…
tools/e2e/stop-app.sh
```

E2E běží s `AI_FAKE_CAPTURE` (fixture místo volání Claude), takže nepotřebují API klíč.
ARES (`ares.gov.cz`, veřejné API bez klíče) v E2E čte fixtures z `ARES_FAKE_DIR`
(`src/lib/ares/__fixtures__`); `ARES_API_URL` přepíše adresu API.

## Struktura

- `src/app/(app)/*` — stránky aplikace (layout vynucuje přihlášení)
- `src/app/actions/*` — server actions (každá kontroluje oprávnění)
- `src/app/api/*` — API routes (vyhledávání, AI, PDF, soubory zakázek, cron)
- `src/lib/jobs/*` — jádro Knihy zakázek (stavy, termíny, mapování, párování, čtení dokladů)
- `src/lib/data/*` — datová vrstva (server-only)
- `src/components/jobs/*` — kniha, karta zakázky, foto-capture; `src/components/customers|suppliers/*` — adresář
- `supabase/migrations/*` — schéma DB (RLS, číslování, triggery, úložiště `job-files`)

## Skripty

`npm run dev` · `npm run build` · `npm start` · `npm run typecheck` · `npm run lint` · `npm test`
