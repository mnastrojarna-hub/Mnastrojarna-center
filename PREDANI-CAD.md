# Předání rozdělané práce na Mnástrojárna CAD (založeno 14. 11. 2026, 18:00)

Tento soubor je **závazný plán pro pokračování**. Pracuj přesně podle něj, krok po kroku, v uvedeném pořadí.
Po dokončení každého úkolu ho zde odškrtni (`[x]`) a commitni. Až bude vše hotové, soubor smaž a odstraň odkaz v `CLAUDE.md`.

## Průběžný stav (aktualizuj po každém kroku: čas, co je hotové, co právě běží)

| Čas | Stav |
| --- | --- |
| 14. 11. 18:00 | Vlna 15 na větvi (`29b31a5`), plán pushnut (`277a6bd`). Produkční build vlny 15 prošel (`S/build-w15.log`, `exit=0`). |
| 14. 11. 18:01 | BĚŽÍ na pozadí: opakované testy (`S/vitest-w15c.log`, čekej na řádek `exit=`) a e2e 18 sad na portu 3199 (`S/e2e-w15.log`, končí řádkem `done`; server `next start -p 3199` běží – po e2e ho zastav a smaž `.next`). |
| 14. 11. 18:01 | BĚŽÍ workflow: `wf_0a444c37-b25` (fáze B – integrace hotová, `S/w14/bint.patch`; následuje akceptace) a `wf_1fd5cfa9-922` (`fix:geom`). |
| 14. 11. 18:08 | Opakované testy vlny 15 prošly: 6 souborů, 97 / 97 (převodník, přehrání zkušebního i skutečného nástroje, výkres). E2e běží; `cad-w15-drawing` měl 2 FAIL kvůli staršímu zápisu řezu – sada upravena (−80 = mimo těleso, −20 = `⚠` starší zápis), po doběhnutí dávky ji pusť znovu samostatně. |
| 14. 11. 18:13 | NOVÝ požadavek majitele: kola „vyplním tabulku a mám díl, extra snadno“ → vlna 19 (kapitola 7a). Spuštěn workflow `wf_a5f62aa9-09a` (návrh → jádro → průvodce + text), základ `3bb04d9`. |
| 14. 11. 18:17 | Workflow `wf_1fd5cfa9-922` DOKONČEN: střižnice (geom) hotová vč. oprav 8 nálezů kontroly – commit `5b303bc` ve worktree `w17-geom`, patch `S/w17/geom.patch` (základ `bf91b0b`, 10 souborů). Výsledek agenta: 27/27 dílů platných, Σ 5241,7333 cm³, střižnice 450,46 cm³. Úkol C1 hotov, zbývá C2–C4. |
| 14. 11. 18:30 | **Úkol A HOTOV**: vlna 15 sloučena do `main` (PR #96, `23c34b0`); e2e 18 sad bez nových selhání; worktree `w15-*` smazány. Začíná úkol C2 (střižnice) – patch `S/w17/geom.patch` jde na `main` nanést čistě. |
| 14. 11. 18:52 | **Úkol C HOTOV**: střižnice sloučena do `main` (PR #97, `aa4300e`). Celý strom `src/cad` 2621 testů prošel (1 selhání `node-shims` po vlně 15 opraveno), skutečný nástroj 27/27 platných, Σ 5241,734 cm³. Dvě e2e sady měly po vlně 15 zastaralá očekávání (`cad-plate-roundtrip`, `cad-fixes`) – opraveno. BĚŽÍ úplný průchod zbylých e2e sad (`S/e2e-sweep.log`, končí `done`) – selhání roztřiď: zastaralé očekávání po vlně 15 / 17 (uprav test), zátěž (pusť znovu samostatně), skutečná chyba (oprav). |
| 14. 11. 19:12 | Průchod e2e 19/49: zastaralá očekávání po vlně 15 opravena v `cad-agent-drawing` (dva „Příklad D“ v návodu → nový je „Příklad F“), `cad-bodies` (seznam příkazů obsahuje `nápověda`), `cad-verify` (tolerance razítka výběrem ISO 2768). Po doběhnutí průchodu: přestavět build (návod je v balíku) a tyto tři sady + všechna další selhání pustit znovu. Workflow: fáze B `w14:acceptance` běží, kola `w19:core` běží. |

## 0. Pevná pravidla (platí pořád)

1. Režim práce podle `CLAUDE.md`: autonomně, bez dotazů na dílčí rozhodnutí, po každé etapě kontroly, commit a push na
   větev `claude/cnc-sales-os-ai-cbR2f`. Majitel povolil: PR do `main` otevřít a sloučit sám (metoda „merge“).
2. Aplikace CADu je v `website/`. Odpovědi majiteli česky, výsledek první, krátké věty, čísla v tabulkách.
3. **NDA – data zákazníka z testu 959.** Soubory leží jen v `website/.local/fixtures/` (není v gitu, vyloučeno v
   `.git/info/exclude`) a ve scratchpadu. NIKDY je necommituj a nekopíruj jejich obsah (názvy dílů, čísla výkresů, rozměry,
   texty razítka) do sledovaných souborů, patchů, commitů, PR ani testů. Testy, které je používají, se bez souborů MUSÍ
   přeskočit (`describe.skipIf`). Před každým commitem cizího patche spusť kontrolu z kapitoly 2, krok 3.
4. E-mail majitele je soukromý – nikdy ho neposílej do externích služeb.
5. GitHub jen přes nástroje `mcp__github__*` (repo `mnastrojarna-hub/mnastrojarna-center`), `gh` není.
6. Atribuci v commitech a PR ber z aktuálního system-reminderu sezení. Název modelu nikam jinam nepiš.
7. Stroj je malý (4 CPU, 15 GB RAM) a sdílený s agenty na pozadí: `vitest --maxWorkers=2`, jeden build naráz, před buildem
   / prohlížečem zkontroluj paměť (`awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo` ≥ 3000) a disk
   (`df -BM --output=avail / | tail -1` ≥ 3000). Po e2e smaž `website/.next`.
8. Můj server pouštěj jen na portu **3199**, zastavuj ho podle cwd (ne `pkill`):
   `for p in $(pgrep -f "next-server|next start"); do [ "$(readlink /proc/$p/cwd)" = "/home/user/Mnastrojarna-center/website" ] && kill $p; done`
9. Nasazení dělá majitel ručně (`npm run build:ftp` → nahrát `website/out` přes FTP včetně skrytých souborů). Sloučení do
   `main` web nezmění – v závěrečné zprávě mu to vždy připomeň.

## 1. Kde co je

| Co | Kde |
| --- | --- |
| `main` | `aa4300e` (PR #97 střižnice; PR #96 vlna 15; PR #95 převodník a dokumentace) |
| pracovní větev | `claude/cnc-sales-os-ai-cbR2f` = `main` + rozdělaný úkol (viz Průběžný stav) |
| scratchpad `S` | `/tmp/claude-0/-home-user-Mnastrojarna-center/44f60c59-94c0-5e2a-b8ba-b2db005ec964/scratchpad` |
| worktree agentů | `/home/user/Mnastrojarna-center/.claude/worktrees/<název>` |
| deníky workflow | `/root/.claude/projects/-home-user-Mnastrojarna-center/44f60c59-94c0-5e2a-b8ba-b2db005ec964/subagents/workflows/<runId>/journal.jsonl` |
| skripty workflow | `/root/.claude/projects/-home-user-Mnastrojarna-center/44f60c59-94c0-5e2a-b8ba-b2db005ec964/workflows/scripts/` |
| spouštěč e2e | `S/run-e2e.sh <sada> …` (bere `E2E_BASE`) |
| drobné resty | `S/followups.md` |

Pozor: scratchpad, worktree a deníky jsou jen na tomto stroji. Kdyby byl kontejner mezitím zrušen a soubory zmizely,
postupuj podle kapitoly 9.

## 2. Jednotný postup převzetí patche (každá vlna stejně)

1. `cd /home/user/Mnastrojarna-center && git status --short` (čisto) `&& git pull -q origin main`.
2. `git apply -3 --index <patch>`; konflikty vyřeš ručně – zásada: **ponechat obě strany** (importy, větve `switch`,
   členy union typů – hlídej středníky). Stejná funkce dvakrát = sjednotit na jednu implementaci.
3. Kontrola NDA nad patchem (nesmí nic vypsat kromě obecných slov jako „stopka“, „zdvih“):
   projdi řetězce z `website/.local/fixtures/959-dokument.json` (pole `name`, `number`, `title`, `author`, `customer`,
   `project`, `note`, `text`) a hledej je v patchi; navíc `grep -n -i "strihadl\|striznic\|959-01-00_12\|ZAKLADOVA" <patch>`.
   Nález nahraď neutrální hodnotou stejné délky.
4. `cd website && node scripts/cad-i18n-build.mjs --check` → musí být `chybí 0, nespárováno 0`; pak bez `--check`.
   Nové české texty jdou přes `tr()` a mají řádky v `scripts/i18n/{en,de}/NN-*.tsv`.
5. `npm run -s docs:text` (přegeneruje `public/cad/schema-pro-ai.md`, `dokumentace.md`, `llms.txt`).
6. `npx tsc --noEmit -p .` → čisté. `npx next lint` → přesně 5 varování (výchozí stav), žádná chyba.
7. `npx vitest run --maxWorkers=2 <všechny testy z patche + sousedé>`; vždy přidej `src/cad/i18n/i18n.test.ts`,
   `src/cad/help/tips.test.ts`, `src/cad/agent.test.ts`, `src/cad/doc-script*.test.ts`.
8. `NODE_OPTIONS=--max-old-space-size=4096 npm run build` (prebuild staví i balík CLI).
9. `npx next start -p 3199` na pozadí, pak `E2E_BASE=http://localhost:3199 bash S/run-e2e.sh <sady>`.
   Dlouhé sady pouštěj na pozadí s limitem ≥ 30 min (sada `cad-tips` sama trvá přes 10 min).
10. Zastav server (pravidlo 8), smaž `.next`, commit (česká zpráva, co a proč), push, PR přes
    `mcp__github__create_pull_request` (tabulka kontrol v těle), sloučení `mcp__github__merge_pull_request`
    (`merge_method: "merge"`), `git pull -q origin main`, `git push`.
11. Smaž sloučené worktree: `git worktree remove --force .claude/worktrees/<název>`.

Poučení z vlny 15: před sloučením VŽDY pusť i `src/cad/cli/*.test.ts` (hlídá, že jádro pro příkazovou řádku zná každou
operaci klienta) a e2e sady, které sahají na změněné GUI / texty, i když nejsou v patchi (`grep -l "<starý text>" e2e/`).

Známé nestabilní testy (nejsou chybou vlny, při selhání pusť znovu samostatně):
- `e2e/cad-asm-mates`: 1 FAIL „najetí na řádek seznamu zvýrazní plochu“ (WebGL hover) – selhává i na `main`.
- `e2e/cad-impeller`: „Zrušit během přepočtu … do 2 s“ při zátěži stroje (samostatně prochází).
- `e2e/cad-cli`: 2 časové kontroly hlídacího psa při zátěži stroje.
- `e2e/cad-w15-asm`: při zátěži občas vyprší 300 s u výkresu sestavy.
- `e2e/cad-w9-core` řádek 128 (výběr v 2D, 1 ze 4 běhů) – viz `S/followups.md`.
- `src/cad/soft-render.test.ts`, `share-self.test.ts`, `drawing.test.ts` „výkon“ – citlivé na zátěž.

## 3. Úkol A – dokončit a sloučit vlnu 15 (test 959: díry, výkres, sestava, razítko, předloha)

Stav: patch `S/w15/int.patch` je aplikovaný a commitnutý na větvi (`29b31a5`). Typy čisté, lint 5 varování, překlady 0/0.
První běh testů: 467 z 470; 3 selhání způsobila změna znaménka odsazení řezu a jsou opravena v tomtéž commitu:
- `src/cad/doc-script.ts` píše a porovnává řez v konvenci skici (`sectionToSketchConvention`, `secNorm`),
- `scripts/cad-harness/synth-spec.mjs` + `synth-959.txt` řádek 369: `výkres řez XZ odsazení -110 celý`,
- `src/cad/drawing-agent.ts` případ `"set"`: starý zápis (číslo jako souřadnice osy) se vyloží postaru s řádkem `⚠`
  a uloží v nové konvenci (druh hlášení `section-legacy`; překlad v `scripts/i18n/{en,de}/26-int15.tsv`),
- `src/cad/drawing-w15.test.ts`: test „mimo těleso“ používá −80, nový test staršího zápisu.

Zbývá:
- [x] A1. (build hotov, testy běží) Přečti výsledek opakovaných testů `S/vitest-w15c.log` (poslední řádek `exit=0`?) a buildu `S/build-w15.log`.
      Nejsou-li, pusť znovu: testy `src/cad/doc-script.test.ts doc-script.roundtrip.test.ts doc-script.review.test.ts
      drawing-w15.test.ts drawing-w15-int.test.ts i18n/i18n.test.ts` a pak celou sadu z patche
      (`git show --name-only 29b31a5 | grep "\.test\.ts$"`). Všechno musí projít.
- [x] A2. Build + e2e na portu 3199, sady: `cad-w15-hole cad-w15-drawing cad-w15-asm cad-w15-titleblock cad-w15-reference
      cad-drawing-smart cad-drawing-dims cad-w13-docs cad-asm-mates cad-agent-asm cad-w12-parts cad-forms cad-doc2text
      cad-agent-out cad-agent-journey cad cad-agent cad-tips`. Očekávání: 0 FAIL kromě známého u `cad-asm-mates`.
- [x] A3. PR „CAD: test 959 – díry, výkres, sestava, razítko a předloha (vlna 15)“ → sloučit → `git pull`.
- [x] A4. Smaž worktree `w15-hole w15-drawing w15-asm w15-titleblock w15-reference w15-int`.

Co vlna 15 přináší (pro zprávu majiteli) je v těle commitu `29b31a5`.

## 4. Úkol B – vlna 14 fáze B: CAD bez prohlížeče provádí textové příkazy (největší kus)

Cíl: `mncad run skript.txt` provede celý textový skript (modelování, sestava, výkres, měření, pohyb) v Node bez
prohlížeče, zapíše výstupy (STEP, PDF všech listů, odkaz), protokol MNCAD/1 do 2 kB, přísný režim (`--strict`),
příkazy `kontrola …` a `porovnat step …`. Dnes na `main` CLI příkazy skriptu neprovádí (řádky končí
`host.app-only`) – to řeší právě fáze B.

Stav workflow: běh `wf_0a444c37-b25`, skript `…/workflows/scripts/cad-wave14-phase-b-wf_0a444c37-b25.js`.
Hotové a ověřené balíky (základ `0bd472e`): kernel-client, engine (smyčka operací přesunutá z `cad-app.tsx` do
`src/cad/engine/`), outputs, strict-silent, check-compare, drawing-perf – každý prošel protistrannou kontrolou a opravami.
Běží: `w14:integrate` (worktree `w14-bint`, výstup `S/w14/bint.patch` = diff proti `0bd472e`), po něm akceptace `w14-b6`.

- [ ] B1. Počkej na oznámení o dokončení workflow. Kdyby workflow neběželo (restart), obnov ho:
      `Workflow({ scriptPath: "<cesta ke skriptu výše>", resumeFromRunId: "wf_0a444c37-b25" })` – hotoví agenti se vrátí
      z mezipaměti. Zprávu integrace najdeš v deníku (`journal.jsonl`, záznam `result` se štítkem `w14:integrate`).
- [ ] B2. Aplikuj `S/w14/bint.patch` na aktuální `main` (po úkolu A). Čekej konflikty v `src/components/cad/cad-app.tsx`,
      `src/cad/agent.ts`, `src/cad/agent-out.ts`, `src/components/cad/agent-out-host.ts`, `agent-api-host.ts`,
      `agent-guide.ts`, `scripts/cad-harness/*`, `e2e/cad-cli.e2e.cjs`. Zásada: **smyčka operací žije v enginu**
      (`src/cad/engine/ops/*`), `cad-app.tsx` ji jen volá. Co mezitím přibylo do staré smyčky v `cad-app.tsx`, přenes
      do enginu:
  - z vlny 15 (pět míst, doslova v deníku `wf_5f997da2-2d8`, záznam `w15:integrate`, pole `not_done`):
    1. díry: `fillHoleTops(f, op.fillPoints, (u, v) => topAt(r.mesh, f.axis, u, v), r.metrics.bbox, op.line)` z
       `@/cad/agent-hole` místo vloženého kódu ve větvi `case "feature"`,
    2. vložení komponenty: `insertExtras(d, op)` jako třetí argument `partComponent(…)` a `insertNote(op)` v řádku
       protokolu (`@/cad/agent-asm`),
    3. nový `case "reference"` → `runReferenceOp(op.cmd, d)` z `components/cad/reference-host` (vrací `newDoc` / `doc` / `log`),
    4. stav sestavy je asynchronní (`await asmStatusRef.current(d)`; přesná obálka z jádra) – engine potřebuje
       asynchronního poskytovatele stavu sestavy; i ve zrušení běhu a na konci běhu,
    5. konec běhu: po `openDocInTab(d)` / `commit(d)` počkat na usazení UI (`settleUi`),
  - z převodníku (PR #95): výstupní příkaz `script` v `runOutCmd` (`exportScriptFile`), `window.mncad.script()`,
    položka nabídky Data ▸ Export ▸ Textový skript (`exportScript` v `cad-app.tsx`), `stripLineComment` v `parseAgentText`,
  - z integrace vlny 15: hlášení výkresu druhu `section-legacy` – v přísném režimu ho ber jako chybu (automatický
    výklad vstupu) a doplň o tom větu do návodu pro AI u odsazení řezu (hledej „dnes pište“ v `agent-guide.ts`).
- [ ] B3. Ověř, že každý z těch přenesených příkazů běží v prohlížeči i v CLI: po buildu
      `node public/cad/cli/<verze>/mncad.mjs run <skript> --out <složka>` se skriptem, který obsahuje `díra … v x y`,
      `vložit "Díl" jako "K1"`, `sestava pružina …`, `výkres … řez XZ odsazení N`, `export skript`, `předloha stav`.
      Žádný řádek nesmí skončit `host.app-only`, pokud ho návrh nevyhrazuje prohlížeči (seznam v
      `S/w14/CAD-HEADLESS-NAVRH.md`, kap. 15).
- [ ] B4. Kontroly podle kapitoly 2. E2e navíc: `cad-cli cad-agent-out cad-agent-api cad-agent-journey cad-agent-asm
      cad-w13-docs cad-w15-* cad-doc2text` a všechny nové sady z patche (`git diff --cached --name-only | grep e2e/`).
      Testy harness: `node --test scripts/cad-harness/harness.test.mjs` (s `CAD_HARNESS_KERNEL=1` i velký běh).
- [ ] B5. **Akceptační test na skutečném skriptu** (jen lokálně, nic z toho necommituj):
      `node public/cad/cli/<verze>/mncad.mjs run website/.local/fixtures/959-skript.txt --out S/accept --formats step,pdf`
      (+ přepínač sdílení podle nápovědy CLI). Musí platit:

      | Kritérium | Hodnota |
      | --- | --- |
      | komponenty / díly | 70 / 27 |
      | vazby | 53 / 53 v pořádku |
      | objem Σ | 5241,73 cm³ |
      | kolize | jen šroub × závit (27 dvojic) |
      | výstupy | STEP sestavy, PDF výkresů (všechny listy), krátký odkaz |
      | protokol | ≤ 2 kB |
      | čas | < 2 minuty |

      Řádek `výkres … řez XZ odsazení -57` má dát `⚠` (starší zápis), ne `✗`. Nesplněné kritérium = oprav příčinu
      (workflow: najít → opravit → protistranně ověřit), ne test.
- [ ] B6. PR „CAD bez prohlížeče – fáze B“ → sloučit. Smaž worktree `w14-*`.

## 5. Úkol C – vlna 17, střižnice: neplatná geometrie a pozdní hlášení

Stav: běh `wf_1fd5cfa9-922` (skript `…/workflows/scripts/` – soubor s `wf_1fd5cfa9-922` v názvu), balík `geom`
(worktree `w17-geom`, patch `S/w17/geom.patch`, základ `bf91b0b`) je implementovaný a zkontrolovaný; běží `fix:geom`
(opravy nálezů kontroly). Zadání: `S/w17/brief.md`, „Package geom“.

- [x] C1. (hotovo 14. 11. 18:17) Počkej na dokončení (případně obnov `resumeFromRunId: "wf_1fd5cfa9-922"`), přečti zprávu `fix:geom` v deníku.
- [x] C2. Aplikuj `S/w17/geom.patch` na `main` (po úkolu B; když B ještě běží, klidně před ním – patch sahá hlavně do
      `src/cad/build.ts` a jádra). Kontroly podle kapitoly 2 + `e2e/cad-w17-geom` + sady `cad cad-agent cad-w12-parts
      cad-impeller` (regrese objemů).
- [x] C3. Lokálně ověř na skutečném dokumentu (test se bez souboru přeskočí): 27 z 27 dílů platných, Σ 5241,734 cm³
      ± 0,01, díl střižnice 450,460 cm³ ± 0,001, čas stavby dílu se nezhoršil (dnes 6,0 s). Neplatnost se musí hlásit
      u PRVNÍHO prvku, který ji způsobí.
- [x] C4. PR „CAD: platná geometrie řezů na natočené rovině a včasné hlášení neplatnosti“ → sloučit. Smaž `w17-geom`.

## 6. Úkol D – dokumentace a příručka po sloučení B a C

- [ ] D1. `website/src/content/cad-docs.ts`: přepiš místa o fázi A (hledej „fáze A“, „host.app-only“; v
      `src/views/cad-docs-intl.tsx` „phase A“ / „Phase A“) podle toho, co CLI po fázi B skutečně umí (ověř spuštěním).
      Doplň: vlna 15 (odstavec je v deníku `wf_5f997da2-2d8`, `w15:integrate`, pole `docs_cs`), převodník `export skript`,
      vlna 17, `kontrola`, `porovnat`, přísný režim. Řádky do historie verzí, FAQ, slovníček, `CAD_DOCS_META.updated`.
      Piš jen to, co jsi ověřil v kódu nebo spuštěním.
- [ ] D2. Zastaralé obrázky: `public/cad/docs/ribbon-svarence.webp` (ukazuje 10 příkazů, je jich 13), `start.webp`
      (3 šablony, jsou 4); `sdileni.webp` + `sdileni-print.jpg` už nikdo nepoužívá (smazat). Nové snímky: Playwright
      1440×900, deviceScaleFactor 2, `.webp` ≤ 150 kB + `-print.jpg` (tisková verze je potřebuje).
- [ ] D3. `npm run -s docs:text`, pak přegeneruj PDF příručku `npm run docs:pdf` (přečti si hlavičku
      `scripts/cad-docs-pdf.mjs` – potřebuje běžící server) a zkontroluj, že kapitola „Časté otázky“ má správné číslo.
- [ ] D4. Commit, PR, sloučení.

## 7. Úkol E – úklid a zbývající body hlášení agenta

- [ ] E1. NDA úklid: zkušební (syntetický) nástroj v `scripts/cad-harness/` (`synth-spec.mjs`, `synth-959.txt`,
      `expected.json`), `src/cad/engine/protocol.test.ts`, `host.test.ts` a e2e pojmenovává díly „959-01-00-NN …“ –
      to je číslo nástroje zákazníka. Přejmenuj na neutrální (např. „900-01-00-NN“; soubor `synth-959.txt` →
      `synth-tool.txt`) jedním commitem AŽ PO sloučení úkolu B (patch B sahá do stejných souborů). Geometrie je syntetická.
- [ ] E2. Položky v `S/followups.md` (závod ve výběru 2D `window.mncad.draft` status.selection; přísný režim a
      `section-legacy`).
- [ ] E3. Z hlášení „Kde CAD stojí dnes“ zkontroluj, co fáze B nedodala, a doplň (každé jako malý balík s testy):
  - P2-10: hledání v nápovědě textem (`nápověda <slovo>`) a tahák pro agenty ≤ 5 kB (návrh `S/w14/tahak-navrh.md`),
  - odkazy na soubory pro agenty v cloudovém prohlížeči (`… odkaz` / `base64` u výstupních příkazů),
  - opakovaný běh téhož skriptu bez duplicit (idempotence: druhé spuštění nesmí založit „Díl 2“),
  - tichý (stručný) protokol i v konzoli prohlížeče,
  - vícedokumentové běhy: ✓ jen u dokumentů, které se skutečně postavily (dřív se stavěl jen poslední),
  - B1 / B2 z hlášení (prázdná sestava se počítá jako prázdná záložka; závod evidence záložek).
- [ ] E4. Hostovaný koncový bod (HTTP služba pro agenty bez Node) je rozhodnutí majitele – nenasazuj, jen se v závěrečné
      zprávě zeptej, zda ho chce (je to jediná povolená otázka).
- [ ] E5. Smaž zbylé worktree (`w18-docs`), tento soubor a odkaz v `CLAUDE.md`. Závěrečná zpráva majiteli.

## 7a. Úkol F – vlna 19: „Kola a ozubení“ – vyplním tabulku a mám kolo (nový požadavek majitele)

Zadání majitele: „CAD by měl umět extra snadno modelovat kola pomocí vyplněné tabulky: ozubená, lineární (hřeben),
hypoidní, šikmá, evolventní či cykloidní i řetězová – prostě vyplním tabulku a mám polotovar.“

Dnes: kola jsou jen rodiny v knihovně (`src/cad/library/gears.ts`, `gears2.ts`) – vznikne dokument z obyčejných prvků,
kolo nejde později upravit „jako kolo“, chybí soukolí, tabulka ozubení, cykloidní a hypoidní ozubení.

Co má vlna dodat (úplné zadání `S/w19/brief.md`, návrh `S/w19/NAVRH.md`):
1. Jeden vstup „Kola a ozubení“ (pás Tvorba, knihovna, paleta, úvodní obrazovka): galerie druhů → JEDNA tabulka s málo
   povinnými řádky, výchozími hodnotami, nápovědou a živým náhledem profilu; dopočtené hodnoty ve stejné tabulce.
   Výsledek je JEDEN parametrický prvek historie, jehož úprava je táž tabulka. Cíl: správné kolo na 3 kliknutí a 2 čísla.
2. Druhy: čelní přímé, šikmé, šípové, vnitřní, hřeben přímý i šikmý, kuželové přímé / spirální / hypoidní, šnek a šnekové
   kolo, cykloidní (epi / hypocykloida, hodinové, kotouč cykloidní převodovky s čepy), řetězová ISO 606 (1–3 řady),
   řemenice, případně rohatka. Společné volby: šířka, díra, drážka pro pero, náboj, odlehčení, vůle;
   výstup = hotové kolo | jen polotovar (bez zubů) | zuby vyříznuté do aktivního tělesa.
3. Soukolí: z1, z2, modul, osová vzdálenost, korekce, vůle → převod, součinitel záběru, varování (podřezání, špičatý
   zub) → sestava dvou kol s vazbou ozubení.
4. Tabulka ozubení (modul, z, úhel záběru, sklon, korekce, Ø roztečný / základní / hlavový / patní, míra přes zuby W,
   míra přes kuličky M …): v průvodci, textem `kolo tabulka`, na výkrese `výkres tabulka ozubení ano`.
5. Přesná evolventa (chyba < 0,001 mm), patní přechod, platná tělesa, z = 200 do 5 s.
6. Textem pro agenty: `kolo čelní m 2 z 24 b 20 …`, `kolo hřeben …`, `kolo řetězové 08B z 19`, `kolo cykloidní …`,
   `soukolí čelní m 2 z1 20 z2 60 …`, `kolo nápověda`; česky / anglicky / německy; BEZ nové větve ve smyčce operací
   (příkaz se převede na existující operaci prvku jako `svar …`).

Workflow `wf_a5f62aa9-09a` (skript `…/workflows/scripts/cad-wave19-gears-wf_a5f62aa9-09a.js`): návrh → balík `core`
(worktree `w19-core`, patch `S/w19/core.patch` proti `3bb04d9`) → souběžně `ui` (`w19-ui`) a `text` (`w19-text`), jejich
patche jsou proti poslednímu commitu `w19-core`. Každý balík: implementace → protistranná kontrola → opravy.

- [ ] F1. Počkej na dokončení workflow (při restartu obnov `resumeFromRunId: "wf_a5f62aa9-09a"`). Přečti zprávy v deníku.
- [ ] F2. Aplikuj postupně `core.patch`, `ui.patch`, `text.patch` na `main` podle kapitoly 2 (po úkolech A–C; s úkolem B
      se potká jen v `agent.ts`, `agent-guide.ts`, `cad-app.tsx` – malé kusy). Kontrola NDA není potřeba (žádná data
      zákazníka), ale zkontroluj, že patch neobsahuje nic z `website/.local/`.
- [ ] F3. Vlastní zkouška „extra snadno“ v prohlížeči (Playwright, produkční build): nový díl → Kola a ozubení → čelní →
      zadat jen modul a počet zubů → Vytvořit → těleso platné, Ø hlavové = m·(z+2); změna z v historii přestaví kolo;
      soukolí → sestava s vazbou; `kolo tabulka` vypíše míru přes zuby; výkres s tabulkou ozubení do PDF. Totéž
      textem v CLI (`mncad run`), až bude sloučen úkol B.
- [ ] F4. Dokumentace (nová podkapitola v kapitole Prvky / Knihovna + FAQ „Jak udělám ozubené kolo?“), PR, sloučení,
      smazat worktree `w19-*`.

## 8. Co říct majiteli o nasazení (po každém sloučení)

`cd website && npm run build:ftp` → nahrát celý `out/` včetně `out/cad/share/` (PHP úložiště odkazů), `.htaccess`
(přesměrování `/s`) a `out/cad/cli/` (balík `mncad`). Kontrola: `https://www.mnastrojarna.cz/cad/share/?ping` vrací
`"v":2`; nový odkaz má tvar `https://mnastrojarna.cz/s#KÓD` (36 znaků).

## 9. Když zmizí scratchpad nebo worktree (zrušený kontejner)

Sloučená práce je v `main`, vlna 15 na větvi. Ztratily by se jen nedokončené vlny 14 B a 17 (geom) a data zákazníka.
Pak:
1. Požádej majitele o tři soubory testu 959 (dokument JSON, DWG, skript) a ulož je do `website/.local/fixtures/`
   jako `959-dokument.json`, `959-sestava_a_dily.dwg`, `959-skript.txt`; do `.git/info/exclude` přidej `website/.local/`.
2. Vlnu 14 B udělej znovu podle stavu kódu: engine a CLI fáze A jsou v `src/cad/engine/`, `src/cad/cli/`; chybí
   registrace operací (`src/cad/engine/ops/registry.ts` je prázdný) – přesuň smyčku operací z `runAgentText` v
   `cad-app.tsx` do `engine/ops/*`, hostitele (prohlížeč / Node) odděl rozhraním z `engine/host.ts`. Pracuj workflow:
   implementace → protistranná kontrola → opravy → integrace → akceptace (kapitola 4, B5).
3. Vlnu 17 geom udělej znovu podle kapitoly 5 (zadání je tam shrnuté: rozbor prvku po prvku nástrojem
   `BRepCheck_Analyzer`, oprava příčiny v jádře, hlášení u prvního vadného prvku, syntetické regresní testy).
