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
| 14. 11. 19:20 | Úkol D1 částečně rozjet dřív (nezávisí na B): agent dokumentace dopisuje vlnu 15, převodník a vlnu 17 do `cad-docs.ts` ve worktree `w18-docs2`, výstup `S/w18/docs2.patch` (zdroje `S/w18/docs-round2-sources.md`). Místa o fázi A nechává beze změny – přepíšou se až po B. |
| 14. 11. 19:30 | Úkol B2 rozjet souběžně s akceptací: zkušební nanesení `bint.patch` na dnešní větev = 15 souborů s konflikty (největší `cad-app.tsx` – stará smyčka 378 řádků vs. volání enginu). Spuštěn workflow `wf_d020a109-e6f` (integrace → nezávislá kontrola ztracených změn → opravy), worktree `w14-int2` ze `4ceb0e7`, zadání `S/w14/int2/brief.md`, výstup `S/w14/int2/int2.patch` + `audit.md`. Až doběhne i akceptace (`w14-b6`), přenes její rozdíl `git -C .claude/worktrees/w14-b6 diff 7b86184 HEAD` na `w14-int2` (nebo do hlavní větve po int2). |
| 14. 11. 19:45 | Dokumentace 2. kolo hotová a nanesena na větev (vlna 15, převodník, vlna 17; `S/w18/docs2.patch`). Do PR půjde spolu s opravami e2e po doběhnutí průchodu a ověření na novém buildu. Agent dokumentace zjistil 2 mezery → úkol E6 a E7. |
| 14. 11. 19:55 | NOVÝ požadavek majitele: výběr myší oknem (více prvků naráz) ve 3D i 2D → vlna 20 (kapitola 7b). Spuštěn workflow `wf_533a7c7c-a4a` (balíky `3d` a `2d` souběžně, každý implementace → kontrola → opravy), základ `210a1e8`, zadání `S/w20/brief.md`. Průchod e2e: 35/49, dosud jen zastaralá očekávání (`cad-big-step` – vkládání do sestavy přes vstup Vložit – opraveno). |
| 14. 11. 19:49 | **Sloučeno PR #98** (`12e7108`): dokumentace 2. kolo + oprava 6 zastaralých e2e + návod „Příklad F“. Úplný průchod 49 e2e sad hotov: žádná chyba v CADu; po opravě všech 6 sad zelených, `cad-w9-core` 2× zelený (závod výběru ve 2D se neopakuje – follow-up uzavřen, pravděpodobně vyřešeno čekáním na usazení UI z vlny 15). Běží workflow: B akceptace (`w14-b6`), B integrace (`w14-int2`), kola (`w19:core`), výběr oknem (`w20-3d`, `w20-2d`). |
| 14. 11. 19:58 | **POZASTAVENO na přání majitele** (šetří se limit; majitel teď sám nasadí `main` a testuje). Zastaveny všechny 4 workflow a jejich procesy. Statický export `npm run build:ftp` na `main` (`12e7108`) ověřen: prošel. Postup obnovení viz kapitola 0a. |
| 14. 11. 20:25 | Majitel hlásí: „Online CAD neumí pružiny, ani pro simulaci pohybu.“ Živý web běží na STARÉ verzi (bez vlny 15 – pružina mezi díly tam není; `cad/share/?ping` vrací chybovou stránku = nenasazena ani vlna 16). V `main` pružiny jsou, ale jen jako šroubovice se stálým stoupáním, bez výpočtu a bez dynamiky. → vlna 21 (kapitola 7c), workflow `wf_1e1ed70b-b6a`. Obnoven workflow integrace fáze B `wf_d020a109-e6f` (do zadání doplněna poznámka o obnovení a o rozdílu akceptace `S/w14/acceptance-delta.patch`). G a F zatím pozastaveny (šetří se stroj: běží 2 workflow). |
| 14. 11. 22:16 | Integrace fáze B na main HOTOVÁ (agent): commit `75e90ed` ve `w14-int2`, patch `S/w14/int2/int2.patch` (330 souborů), audit `S/w14/int2/audit.md` – všech 182 kusů main nalezeno. Kontroly agenta: celý `src/cad` 2862 testů zelených, build, 28 e2e sad zelených. **Akceptační brána na skutečném skriptu 959: PASS** – 70 komponent, 53/53 vazeb, Σ 5241,733 cm³, 27 kolizí jen závit, STEP ok, odkaz 35 znaků, protokol 1641 B, 29,9 s. Běží nezávislá kontrola `verify:int2`. Pružiny (vlna 21) dál rozpracované. |
| 14. 11. 23:50 | Fáze B dokončena agenty i po opravách 3 nálezů kontroly (`w14-int2` commit `5ca5da6`, 25 e2e sad zelených). **Nanesena na větev bez konfliktů** jako commit `e0b08dd` (patch `S/w14/int2/int2.patch`; kontrola NDA čistá; typy, lint 5, překlady 0/0). GitHub Actions `cad-acceptance.yml` omezen na PR do main + ruční spuštění (šetří minuty). BĚŽÍ: testy + build + 14 e2e sad na :3199 (`S/vitest-b-main.log`, `S/build-b-main.log`, pak `S/e2e/*.log`). Po zelené: PR „CAD bez prohlížeče – fáze B“ (zmínit i PR #99 aplikace Sales OS, který je na větvi) → sloučit → smazat `w14-*`. Pružiny: oba balíky v opravách po kontrole. |
| 15. 11. 00:45 | **Úkol B HOTOV: fáze B sloučena do `main` (PR #100, `e27ff86`)** – s ní i PR #99 aplikace Sales OS, který byl na větvi. Po nanesení: 520 testů, build, 14 e2e sad 0 FAIL. Worktree `w14-*` smazány. Dál: pružiny (H) dobíhají opravy; pak E1 (NDA přejmenování zkušebního nástroje – teď je to možné), D1/D3 dokumentace a PDF příručka, G a F obnovit. |
| 15. 11. 00:55 | E1 hotov: zkušební nástroj přejmenován na „900-01-00“ (číslo zákazníka z dílů i ze souborů pryč), `synth-959.txt` → `synth-tool.txt`, `expected.json` přegenerován jádrem (gravírovaný text se změnil: objem −0,001 cm³). |
| 15. 11. 01:00 | Úkol G (výběr oknem) obnoven na novém základu `69f3f58` (main s fází B): workflow `wf_533a7c7c-a4a`, zadání `S/w20/brief.md` s poznámkou o obnovení. Pozor – chyba integrátora: při smazání starých worktree `w20-3d`/`w20-2d` se ztratily rozpracované soubory agenta (`box-select-3d.ts`, `box-select-2d.ts`, test) – agent je napíše znovu. Pravidlo: před `git worktree remove` vždy zálohovat `git status --short` soubory. Běží 2 workflow (H pružiny, G výběr oknem); F kola čeká. |
| 15. 11. 01:15 | Pružiny (H) hotové v obou balících i po opravách kontroly: `part` commit `bde7eb5` (`S/w21/part.patch`, 11 nálezů opraveno), `motion` commit `359f515` (`S/w21/motion.patch`, 8 nálezů opraveno – dynamika teď přesná na všech krocích, energie drží). Oba proti `fd8a05e` (bez fáze B). Spuštěna integrace na main s enginem: workflow `wf_60b96c19-df2`, zadání `S/w21/int-brief.md`, worktree `w21-int`, výstup `S/w21/int.patch` + `int-audit.md`. Běží: G (výběr oknem) + integrace H. F (kola) čeká. |
| 15. 11. 02:56 | **G1 hotov**: výběr oknem dokončen v obou balících i po opravách kontroly (`w20-3d` `5812746`, 5 nálezů; `w20-2d` `c6cb7f5`, 4 nálezy). G2 BĚŽÍ: `S/w20/3d.patch` + `2d.patch` naneseny na větev bez konfliktů (index, necommitnuto), NDA čisté, překlady 0/0, typy, lint 5. Běží vitest (`S/w20/vitest-int.log`, končí `exit=`), pak build + e2e na :3199. Pružiny: workflow `wf_60b96c19-df2` je v kroku `fix:w21int` (5 nálezů kontroly). |
| 15. 11. 03:01 | G2: na větvi (necommitnuto) vitest 55 souborů 849/849, produkční build prošel; dokumentace výběru oknem dopsána do `cad-docs.ts` (kap. 3, 5, 13, 14, 19, 21, 26 + FAQ) = G4 text hotový. BĚŽÍ e2e 16 sad na :3199 (`S/w20/int-e2e.summary`, končí `done`; logy `S/w20/int-e2e/`), pak vlastní zkouška `node S/w20/own-probe.cjs` (G3). Tělo PR připraveno `S/w20/pr-body.md` (doplnit tabulku e2e). |
| 15. 11. 03:18 | **G2 + G3 + G4 (text) hotovo**: commit `851273d` na větvi. e2e 17 sad 872 ok / 0 FAIL (logy `S/w20/int-e2e/`), vlastní zkouška tažením 13/13 (`S/w20/own-probe.cjs` + `own-probe2.cjs`; pozor: s vybranými komponentami je uprostřed gizmo a okno na něm záměrně nezačne). Zakládám PR do `main` (tělo `S/w20/pr-body.md`), po sloučení smazat `w20-*`. Pružiny: `fix:w21int` stále běží. |
| 15. 11. 03:23 | **Úkol G HOTOV: výběr oknem sloučen do `main` (PR #101, `31bf0c7`)**; GitHub kontrola `acceptance (22)` zelená, lokální akceptační brána PASS (100 ok, 0 FAIL, 178 s; 4 nálezy ke třídění = známé ⚠ ze skriptu 959: kolize pružina × deska v pohybu, starší zápis řezu, ruční úprava kóty – řeší vlna 21 / E6). Worktree `w20-*` smazány (zbytky `S/w20/w20-*-final-wip.patch`). Dál: H2 – až doběhne `fix:w21int`, nanést `S/w21/int.patch` (základ `87ca363`) na nový `main`; překryv s vlnou 20 v 9 souborech (`cad-app.tsx`, `agent-guide.ts`, `agent-api.ts`, `agent-api-host.ts`, `doc-script.ts`, `drawing.ts`, `drawing-workspace.tsx`, `tips-manifest.ts`, `schema-pro-ai.md`). |
| 15. 11. 03:27 | Úkol F (kola) OBNOVEN na základu `3814b85` (main + vlna 20): nový workflow `wf_fe2fa9ab-38a` (skript `…/workflows/scripts/cad-wave19-gears-resume-wf_fe2fa9ab-38a.js`), návrh `S/w19/NAVRH.md` hotový se nepřepisuje; balík core ve worktree `w19-core2` začne nanesením `S/w19/core-wip-snapshot.patch`, pak `w19-ui2` + `w19-text2`; patche `S/w19/{core,ui,text}.patch`. Do zadání `S/w19/brief.md` doplněna kapitola RESUME NOTE (engine, CLI, pružiny). Starý worktree `w19-core` je jen záloha – smazat až po sloučení F. Původní workflow `wf_a5f62aa9-09a` NEobnovovat. |

## 0a. Obnovení po pozastavení (14. 11. 19:58)

Stav zastavené práce (nic není ztraceno – rozpracované soubory zůstaly ve worktree a jsou zálohované ve scratchpadu):

| Úkol | Workflow | Kde to stojí | Obnovení |
| --- | --- | --- | --- |
| B – fáze B, akceptace | `wf_0a444c37-b25` | `w14-b6` commit `7a77f53` (brána hotovosti hotová); stála kontrola `verify:acceptance` | `Workflow({ scriptPath: ".../cad-wave14-phase-b-wf_0a444c37-b25.js", resumeFromRunId: "wf_0a444c37-b25" })` – hotoví agenti se vrátí z mezipaměti, znovu poběží jen kontrola a opravy |
| B – převzetí na main | `wf_d020a109-e6f` | `w14-int2`: patch nanesen, konflikty bez značek, NEcommitnuto, testy neproběhly; záloha `S/w14/int2/wip-snapshot.patch` (proti `4ceb0e7`) | obnov `resumeFromRunId: "wf_d020a109-e6f"`; agent integrace začne znovu – řekni mu (do zadání `S/w14/int2/brief.md` přidej odstavec), že worktree už existuje a rozpracovaný stav je v něm / v záloze |
| F – kola | `wf_a5f62aa9-09a` | návrh `S/w19/NAVRH.md` hotový; `w19-core` jen začátek (9 souborů), záloha `S/w19/core-wip-snapshot.patch` | `resumeFromRunId: "wf_a5f62aa9-09a"` (návrh z mezipaměti) |
| G – výběr oknem | `wf_533a7c7c-a4a` | `w20-3d`, `w20-2d`: hotový jen rozbor dnešních chyb (`S/w20/repro-3d-base.txt`, `S/w20/2d-repro-notes.txt`) | `resumeFromRunId: "wf_533a7c7c-a4a"` |

Před obnovením: zkontroluj paměť a disk (pravidlo 7), spouštěj nejvýš 2 workflow naráz (stroj má 4 CPU) – pořadí B → G → F.
Hlášení majitele z jeho testování nasazené verze má přednost: každou chybu nejdřív zopakuj, pak oprav (malá vlna s testem).

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
| `main` | `e27ff86` (PR #100 fáze B + PR #99 Sales OS; PR #98 dokumentace; PR #97 střižnice; PR #96 vlna 15; PR #95 převodník) |
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

1. `cd /home/user/Mnastrojarna-center && git status --short` (čisto) `&& git pull -q origin main && git pull -q --no-rebase origin claude/cnc-sales-os-ai-cbR2f`.
   Pozor: do této větve slučuje i JINÉ sezení (aplikace CNC Sales OS v kořeni `src/`, např. PR #99 – kontakty, prohlížeč
   výkresů). Před každým push si větev stáhni; jejich změny nech být a v PR do `main` je zmiň jedním řádkem.
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
11. Smaž sloučené worktree: `git worktree remove --force .claude/worktrees/<název>`. U NEsloučeného worktree nejdřív zálohuj
    rozpracované soubory (`git -C <wt> add -A && git -C <wt> diff --cached --binary <základ> > S/<…>-wip.patch`) – `remove --force`
    smaže i nesledované soubory.

Poučení z vlny 15: před sloučením VŽDY pusť i `src/cad/cli/*.test.ts` (hlídá, že jádro pro příkazovou řádku zná každou
operaci klienta) a e2e sady, které sahají na změněné GUI / texty, i když nejsou v patchi (`grep -l "<starý text>" e2e/`).

Známé nestabilní testy (nejsou chybou vlny, při selhání pusť znovu samostatně):
- `e2e/cad-asm-mates`: 1 FAIL „najetí na řádek seznamu zvýrazní plochu“ (WebGL hover) – selhává i na `main`.
- `e2e/cad-impeller`: „Zrušit během přepočtu … do 2 s“ při zátěži stroje (samostatně prochází).
- `e2e/cad-cli`: 2 časové kontroly hlídacího psa při zátěži stroje.
- `e2e/cad-w15-asm`: při zátěži občas vyprší 300 s u výkresu sestavy.
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

- [x] B1. Počkej na oznámení o dokončení workflow. Kdyby workflow neběželo (restart), obnov ho:
      `Workflow({ scriptPath: "<cesta ke skriptu výše>", resumeFromRunId: "wf_0a444c37-b25" })` – hotoví agenti se vrátí
      z mezipaměti. Zprávu integrace najdeš v deníku (`journal.jsonl`, záznam `result` se štítkem `w14:integrate`).
- [x] B2. (BĚŽÍ jako workflow `wf_d020a109-e6f`, viz Průběžný stav) Aplikuj `S/w14/bint.patch` na aktuální `main` (po úkolu A). Čekej konflikty v `src/components/cad/cad-app.tsx`,
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
- [x] B3. Ověř, že každý z těch přenesených příkazů běží v prohlížeči i v CLI: po buildu
      `node public/cad/cli/<verze>/mncad.mjs run <skript> --out <složka>` se skriptem, který obsahuje `díra … v x y`,
      `vložit "Díl" jako "K1"`, `sestava pružina …`, `výkres … řez XZ odsazení N`, `export skript`, `předloha stav`.
      Žádný řádek nesmí skončit `host.app-only`, pokud ho návrh nevyhrazuje prohlížeči (seznam v
      `S/w14/CAD-HEADLESS-NAVRH.md`, kap. 15).
- [x] B4. Kontroly podle kapitoly 2. E2e navíc: `cad-cli cad-agent-out cad-agent-api cad-agent-journey cad-agent-asm
      cad-w13-docs cad-w15-* cad-doc2text` a všechny nové sady z patche (`git diff --cached --name-only | grep e2e/`).
      Testy harness: `node --test scripts/cad-harness/harness.test.mjs` (s `CAD_HARNESS_KERNEL=1` i velký běh).
- [x] B5. **Akceptační test na skutečném skriptu** (jen lokálně, nic z toho necommituj):
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
- [x] B6. PR „CAD bez prohlížeče – fáze B“ → sloučit. Smaž worktree `w14-*`.

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

- [x] D0. (naneseno 19:45, PR spolu s opravami e2e) Převzít `S/w18/docs2.patch` (vlna 15, převodník, vlna 17 – agent dokumentace, worktree `w18-docs2`) podle
      kapitoly 2 (stačí tsc, lint, `docs:text`), commit, PR, sloučit.
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

- [x] E1. (hotovo 15. 11. 00:55: díly „900-01-00-NN“, skript `synth-tool.txt`, podklady přegenerovány, testy harness 18/18, engine/cli 383/383) NDA úklid: zkušební (syntetický) nástroj v `scripts/cad-harness/` (`synth-spec.mjs`, `synth-959.txt`,
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
- [ ] E6. Převodník dokument → skript nepřenáší nic z vlny 15 kromě třídy ISO 2768 a NEHLÁSÍ to: šablona a další pole
      razítka (logo, zákazník, polotovar…), tabulka nepředepsaných tolerancí podle desetinných míst, funkční rozměry
      (`kótovat chytře funkční …`), režim poloh děr (`kótovat … díry tabulka|souřadnicově`), přezdívky komponent
      (`vložit … jako`), pružiny (`sestava pružina …`). Doplň vyhrazené příkazy do `src/cad/doc-script.ts` (a do
      ověření řádku), jinak aspoň poznámku ℹ; test tam a zpět pro každý bod (`doc-script.roundtrip.test.ts`). Po úkolu B
      (patch B na doc-script nesahá, ale ověř).
- [ ] E7. `stav` ve stejném běhu `window.mncad.run`, který sestavu teprve založil, nevypíše přesnou obálku („tělesa
      komponent se stavějí zvlášť“); samostatné `stav` ji vypíše. Po úkolu B ověř v enginu (asynchronní stav sestavy)
      a oprav, aby obálka byla i v témže běhu (nebo to jasně řekni v protokolu).
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

- [ ] F1. (BĚŽÍ od 15. 11. 03:27 nový workflow `wf_fe2fa9ab-38a`, worktree `w19-core2`/`w19-ui2`/`w19-text2`, základ `3814b85`) Počkej na dokončení (při restartu obnov `resumeFromRunId: "wf_fe2fa9ab-38a"` se skriptem výše). Přečti zprávy v deníku.
- [ ] F2. Aplikuj postupně `core.patch`, `ui.patch`, `text.patch` na `main` podle kapitoly 2 (po úkolech A–C; s úkolem B
      se potká jen v `agent.ts`, `agent-guide.ts`, `cad-app.tsx` – malé kusy). Kontrola NDA není potřeba (žádná data
      zákazníka), ale zkontroluj, že patch neobsahuje nic z `website/.local/`.
- [ ] F3. Vlastní zkouška „extra snadno“ v prohlížeči (Playwright, produkční build): nový díl → Kola a ozubení → čelní →
      zadat jen modul a počet zubů → Vytvořit → těleso platné, Ø hlavové = m·(z+2); změna z v historii přestaví kolo;
      soukolí → sestava s vazbou; `kolo tabulka` vypíše míru přes zuby; výkres s tabulkou ozubení do PDF. Totéž
      textem v CLI (`mncad run`), až bude sloučen úkol B.
- [ ] F4. Dokumentace (nová podkapitola v kapitole Prvky / Knihovna + FAQ „Jak udělám ozubené kolo?“), PR, sloučení,
      smazat worktree `w19-*`.

## 7b. Úkol G – vlna 20: výběr oknem (tažením obdélníku) ve 3D, ve skice, ve 2D výkresu a ve výkresu dílu

Zadání majitele: „Mnástrojárna CAD 3D a 2D neumí vybrat jednoduše myší oknem, tedy více prvků naráz.“
Očekávání (jako AutoCAD / SolidWorks): tažení levým tlačítkem = obdélník; zleva doprava = okno (jen celé uvnitř),
zprava doleva = křížení (i dotčené); bez klávesy nahradí výběr, Ctrl/Shift přidá, Ctrl+Shift/Alt ubere; Esc zruší;
ve 3D jen viditelné (volba „i skryté“), podle filtru výběru; funguje i ve výběrech formulářů (hrany zaoblení),
v měření, v sestavě (komponenty), bez WebGL; ve skice (mazání, vazby na vícenásobném výběru), ve 2D výkresu
(i uvnitř příkazů „Vyberte objekty“) a ve výkresu dílu (kóty, poznámky). Pro agenty `window.mncad.selectBox(...)`.
Úplné zadání `S/w20/brief.md`.

Workflow `wf_533a7c7c-a4a` (skript `…/workflows/scripts/cad-wave20-box-select-wf_533a7c7c-a4a.js`): balíky `3d`
(worktree `w20-3d`, patch `S/w20/3d.patch`) a `2d` (`w20-2d`, `S/w20/2d.patch`), oba proti `210a1e8`.

- [x] G1. (hotovo 15. 11. 02:56; obnoveno 01:00 na základu `69f3f58`) Počkej na dokončení (při restartu obnov `resumeFromRunId: "wf_533a7c7c-a4a"`), přečti zprávy v deníku.
- [x] G2. (hotovo 15. 11. 03:18, commit `851273d`) Aplikuj `3d.patch` a `2d.patch` podle kapitoly 2 (s úkolem B se potkají v `cad-app.tsx`, `agent-api-host.ts`
      – malé kusy; je-li B už sloučen, nanes na nový `main`).
- [x] G3. (hotovo 15. 11. 03:18, 13/13) Vlastní zkouška v prohlížeči (Playwright, produkční build, skutečné tažení myší): 3D díl – okno přes horní
      plochy vybere jen viditelné plochy; křížení vybere i dotčené; Ctrl přidá; zaoblení – hrany oknem; sestava –
      komponenty oknem; skica – smazat více entit; 2D – MOVE s výběrem oknem; výkres dílu – smazat více kót.
- [x] G4. (hotovo 15. 11. 03:23, PR #101) Dokumentace (kapitola 3 Obrazovka, 5 Skica, 14 2D CAD, 13 Výkresy + mikronávody), PR, sloučení, smazat `w20-*`.

## 7c. Úkol H – vlna 21: pružiny (tabulka → správná pružina; pružiny v pohybu i v dynamické simulaci)

Zadání majitele: „Online CAD neumí pružiny a to ani pro simulaci pohybu.“ Úplné zadání `S/w21/brief.md`.
- Balík `part` (worktree `w21-part`, patch `S/w21/part.patch`): jeden vstup „Pružina“ → galerie → tabulka (tlačná, tažná,
  zkrutná, talířová) s výpočtem podle EN 13906-1 (tuhost, délka na doraz, napětí s korekcí, vzpěr, frekvence, hmotnost),
  skutečná geometrie (přiložené a broušené konce, očka, ramena), jeden parametrický prvek historie, text `pružina tlačná …`,
  `pružina tabulka`, tabulka pružiny na výkrese, převodník dokument → skript.
- Balík `motion` (worktree `w21-motion`, patch `S/w21/motion.patch`): „Pružina mezi díly“ na klik (i do všech děr vzoru),
  skutečný tvar pružiny při přehrávání pohybu (drát zůstane kulatý), **dynamická pohybová studie** (hmotnosti, gravitace,
  síly pružin, tlumení, dorazy) s grafem a CSV; příklad: stírací deska střihadla na pružinách.
- [x] H1. (hotovo 15. 11. 01:15) Počkej na `wf_1e1ed70b-b6a` (obnova `resumeFromRunId`), přečti zprávy.
- [ ] H2. (BĚŽÍ workflow `wf_60b96c19-df2` → `S/w21/int.patch`) Převzít `part.patch` a pak `motion.patch` podle kapitoly 2 (oba proti `fd8a05e`).
- [ ] H3. Vlastní zkouška v prohlížeči: tabulka → tlačná pružina d 2 De 20 L0 50 n 8 broušená (L0 a De změřit na tělese,
      tuhost ručně ověřit); sestava se 4 pružinami pod stírací deskou → dynamika → deska se vrátí na doraz, graf, CSV.
- [ ] H4. Dokumentace (kapitola Prvky – pružiny, Sestavy – pohyb a dynamika, FAQ „Jak udělám pružinu?“), PR, sloučit,
      smazat `w21-*`.

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
