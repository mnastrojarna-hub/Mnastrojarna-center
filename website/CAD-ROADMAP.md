# Mnástrojárna CAD – plán a stav vývoje

Cíl zadavatele: **profesionální parametrický 3D/2D CAD v prohlížeči** (díly, sestavy, výkresy, formy, knihovna normálií),
UI/UX a ovládání co nejblíže **ZW3D** (ribbon, správce historie, formulář prvku s OK/Storno, řádek výzev, ViewCube,
kontextové nabídky podle entity, výběrový filtr prvek/plocha/hrana/bod/těleso/komponenta/podsestava).
Není to beta pro amatéry – každý nástroj musí být hotový, otestovaný a proklikaný.

Tento soubor je **předávací dokument**: kdokoli (i jiná relace Claude) má z něj pokračovat bez ztráty práce.
Pravidla: po každém hotovém kusu `npm run typecheck && npm run lint && npm test && npm run build`, commit + push na
`claude/cnc-sales-os-ai-cbR2f`. Nikdy nenechávat rozdělané bez WIP commitu.

## Architektura (website/src)

| Oblast | Soubory | Poznámka |
| --- | --- | --- |
| Datový model | `cad/types.ts` | `CadDoc` (díl = historie `Feature[]`, sestava = `components[]`), skica (`SketchEntity`, `SketchConstraint`, `SketchDim`), proměnné/vazby/stavy |
| Jádro (OCCT/replicad, běží ve web workeru) | `cad/build.ts`, `cad/cad.worker.ts`, `cad/client.ts` | `buildShape/buildDoc`, všechny prvky, `faceInfo`; worker op: build/face/export/drawing/asmParts/asmFace/interference + inspekční op (worker M) |
| Parametry | `cad/params.ts` | bezpečný výrazový parser, `resolveDoc` (proměnné, vazby `featureId:cesta`, stavy) |
| Skica | `cad/sketch.ts`, `cad/sketch-solver.ts`, `cad/sketch-ops.ts`, `components/cad/sketcher.tsx` | profily/smyčky, DXF, řešič vazeb a kót (LM), trim/offset/zaoblení…, přichytávání |
| Formáty | `cad/formats/*` | import STEP/BREP/IGES/STL/OBJ/3MF/glTF/PLY/OFF/DXF, export STEP/BREP/STL/3MF/OBJ/GLB/WRL; nativní formáty → návod |
| Výkresy | `cad/drawing.ts`, `cad/pdf.ts`, `components/cad/drawing-workspace.tsx` | pohledy ISO E/A, řez A–A, osy, kóty, razítko, kusovník ISO 7573, PDF (jsPDF + Roboto), DXF R12, SVG |
| Sestavy | `cad/assembly.ts`, `cad/asm-kernel.ts`, `components/cad/asm-panel.tsx` | umístění, vazby (Kontakt/Zarovnat/Vystředit), podsestavy (`flattenAssembly`), kusovník, kolize, rozložený pohled, generátor rámu formy, normálie forem |
| Formy | `cad/mold.ts`, `components/cad/mold-panel.tsx` | analýza úkosů (barevná mapa), smrštění, dělicí rovina, návrh vyhazovačů, chladicí okruh |
| Knihovna normálií | `cad/library/*`, `components/cad/library-dialog.tsx`, `components/cad/mini-viewport.tsx` | textové vyhledávání („M8x30“, „IPE 200“, „ložisko 6205“, „kolo m2 z24“…), rodiny s tabulkami rozměrů |
| UI | `components/cad/cad-app.tsx` (hlavní), `ribbon.tsx`, `manager.tsx`, `props.tsx`, `viewport.tsx`, `ui.tsx`, `command-palette.tsx`, `settings-dialog.tsx`, `start-screen.tsx`, `cad-icons.tsx` | ribbon, správce, formuláře, 3D okno (ViewCube, styly, řez, měření, výběrový filtr, gizmo), paleta příkazů Ctrl+K, nastavení, úvodní obrazovka |
| Nastavení | `cad/settings.ts` | `Settings`, zkratky, jednotky mm/in, nedávné soubory |
| Stránka | `app/(cs)/cad/page.tsx`, `components/cad/cad-loader.tsx` | `/cad` (jen česky), SEO |

Testy: `src/cad/**/*.test.ts` (vitest, OCCT se inicializuje v Node). E2E: `e2e/cad.e2e.cjs` (Playwright, server :3100).

## Stav (aktualizovat při každém commitu)

### Hotovo a ověřeno (testy + proklik v prohlížeči)
- Historie prvků: skica, vysunutí (+úkos), rotace, tažení, šablonování, primitiva, díra (průvodce: vrtaná/zahloubení/kuželové/závit), zaoblení, sražení, skořepina, úkos, rozříznutí, transformace, pole (lineární/mřížka/kruhové), zrcadlení, pomocná rovina, text, závit, import.
- Proměnné, vazby parametrů, stavy (konfigurace).
- Sestavy: komponenty, vazby ploch, úprava dílu v kontextu, rozložený pohled, kolize, kusovník + CSV, rám formy (26 komponent), normálie forem.
- Výkresy A4–A0 s řezem, kótami, razítkem a kusovníkem; PDF/DXF/SVG.
- Import/export formátů (viz výše).
- UI: ribbon, správce (historie/proměnné/stavy), formulář prvku OK/Storno, ViewCube, osový kříž, styly zobrazení, perspektiva/pravoúhlá, řez s barevnou řeznou plochou, měření 2 bodů, hmotnostní vlastnosti, schémata myši ZW3D/SolidWorks/touchpad, kontextové menu, klávesové zkratky.

### Dokončeno v 2. vlně (listopad 2026) – vše zapojeno, 196 testů
- **S – skicář**: ✅ přichytávání (10 druhů + inference), 13 vazeb a řídicí kóty s řešičem LM, nástroje Oříznout/Prodloužit/Odsadit/Zaoblit/Srazit/Zrcadlit/Přesunout/Kopírovat/Otočit/Měřítko/Pole/Rozložit, elipsa, spline, bod, pomocná geometrie, box-select, kontextová menu, stav určenosti skici.
- **M – 3D interakce**: ✅ výběrový filtr, inspektor entit, měření mezi entitami, kontextové nabídky podle entity, gizmo (G/R), barvy ploch, podsestavy (vytvořit/rozpustit/otevřít v kontextu), strukturovaný kusovník.
- **F – jádro 2**: ✅ pushPull, offsetFace, deleteFace, žebro, pružina, zesílení; `BuildResult.vertices`; podsestavy v jádře; normálie ISO 7089/4032/8734, pružina.
- **L – knihovna normálií**: ✅ 46 rodin v 9 skupinách (ISO 4762/4017/4014/7380/10642/4026/4029/4032/4035/7089, DIN 9021/975, ISO 8734/2338/8752, DIN 6885, DIN 471/472, ložiska 60xx/62xx/63xx/608, evolventní ozubená kola + věnec + hřeben, řetězová kola ISO 606, řemenice HTD a klínové, IPE/HEA/HEB/UPN/L/RHS/SHS/CHS/tyče, O-kroužky, pružiny, normálie forem), textový parser („M8x30“, „IPE 200 L=1500“, „ložisko 6205“, „kolo m2 z24“, „řetězka 08B z19“, „jäkl 40x40x3“), dialog s 3D náhledem, oblíbené a nedávné; Ctrl+L. TODO seznam v `cad/library/index.ts`.
- **Vedoucí**: ✅ formařské nástroje, nastavení, paleta příkazů, úvodní obrazovka s náhledy, knihovna zapojena; SEO analýza `SEO-ANALYZA.md`, nová služba Výroba přípravků, Lighthouse (mobil úvod 54→72, desktop 99, SEO 100); e2e `e2e/cad.e2e.cjs` přepsán na nové UI.
- **M – 3D interakce**: **hotovo** (filtr výběru, inspektor, měření entit, kontextová menu, gizmo, barvy ploch, podsestavy, 127 testů).
- **F – jádro 2**: **hotovo** (pushPull/offsetFace/deleteFace/rib/spring/thicken, podsestavy, normálie).
- **D – DWG export**: ✅ `cad/formats/dwg.ts` (acad-ts, R2000–R2018, vrstvy/typy čar ISO 128, round-trip testy); tlačítko DWG + volba verze ve výkresu. **Ověřit v reálném AutoCAD/ZWCAD** (knihovna je mladá).

### Ověření (poslední stav)
- `npm run typecheck`, `npm run lint`: čisté. `npm test`: 199 testů. `npm run build`: OK (`/cad` 1,5 kB + 105 kB sdílené; jádro, knihovna, DWG a PDF se načítají líně).
- E2E `e2e/cad.e2e.cjs` (16 kroků): úvodní obrazovka → ukázka → skica + vysunutí → paleta → měření → knihovna M8×30 → výkres DXF/DWG R2018/SVG/PDF → rám formy → kusovník → STEP; bez JS chyb.
- Snímky všech nástrojů: `/tmp/claude-0/cadshots/tools.cjs` (28 snímků) + ruční kóty/poznámky ověřeny v prohlížeči (kóta, poznámka, drsnost, tolerance, základna).

### 3. vlna (listopad 2026) – modelovací schopnosti a počet příkazů
Zásuvná infrastruktura prvků rozšíření (`cad/ext/registry.ts` + `components/cad/ext/registry.tsx`): modul zaregistruje prvek (`registerExt`), jádro ho staví v `build.ts` (`type: "ext"`), UI vykreslí formulář z `params` (nebo vlastní `Form`), tlačítko na pásu (`tab`/`group`), výběr ploch/hran (`pick`), akce bez prvku (`action`). Moduly se importují v `cad/ext/index.ts` a `components/cad/ext/index.tsx`.
- **W1 Plochy** (`cad/ext/surface.ts`): ✅ 19 příkazů – plošné vysunutí/rotace/tažení/šablonování, rovinná a odsazená plocha, prodloužit, oříznout rovinou/skicou, sešít, záplata, uzavřít → těleso, zesílit, rozdělit, nahradit plochu (posun), křivka průniku, promítnutí skici, šroubovice, tažení po šroubovici. Plochy žijí vedle tělesa v compoundu; „nahradit plochu“ je posun rovinné plochy, prodloužení zakřivených ploch parametrické.
- **W2 Plech** (`cad/ext/sheetmetal.ts`, `sheetmetal-flat.ts`): ✅ 12 příkazů – parametry t/R/K, základní plech, ohyb z hrany (úlevy, materiál uvnitř/vně), lem, ohyb podle čáry, výřez, rohová úleva, prolis, rozvinout, rozvin → DXF/SVG s čarami ohybů a tabulkou, tabulka ohybů. BA = π/180·α·(R+K·t). Omezení: ohyb jen na celé rovné hraně, prolis se nerozvíjí.
- **W3 Pokročilé** (`cad/ext/advanced.ts`): ✅ 18 příkazů – proměnné/plné/řetězcové zaoblení, sražení D1×D2 a D×úhel, úkos od dělicí roviny, zkrut, kopule, text na válci, lem/drážka, díry v bodech skici, zrcadlení prvků, pole podél křivky, výplňové pole, měřítko v bodě, znovu použít nástroj, kontrola geometrie, sjednotit plochy, tloušťka stěn. Omezení: bez neuniformního měřítka a ShapeFix v tomto buildu OCCT.
- **W4 Sestavy a výkresy 2** (`cad/mates.ts`, `assembly.ts`, `drawing.ts`, `drawing-workspace.tsx`, `asm-panel.tsx`): ✅ trvalé vazby (kontakt/zarovnat/vystředit/souosost/vzdálenost/úhel/rovnoběžně) se sekvenčním řešičem, stavem ok/konflikt/chybí a přepočtem po posunu; pole a zrcadlení komponent; šroubový spoj do díry (ISO 4762 + 7089 + 4032 podle Ø díry); výkresy: balónky pozic, detailní pohled (L), více listů, tabulka děr, tabulka revizí. Omezení: řešič není simultánní, vazby odkazují na indexy ploch (po změně topologie „chybí“), zrcadlení jen polohy.
- **W5 Knihovna 2** (`cad/library/*`): ✅ **103 rodin** – šikmá/kuželová/šneková kola, kuželíková/axiální/jehlová ložiska, tělesa UCP, pouzdra ISO 4379, šrouby ISO 7045/7046, matice DIN 985/6923/315, podložky DIN 127/6798/7349, závrtné šrouby, nýty, kolíky ISO 2339, DIN 1473/1474, pera DIN 6888, čepy DIN 1443/1444, závlačky, tažné/zkrutné/talířové pružiny, plynové vzpěry, hliníkové T-profily + T-matice + úhelníky, lineární vedení HGR/HGH/HGW, kuličkové šrouby SFU, tyče W + SHF + LM + SC, pneumatika ISO 15552/6432 + šroubení, trubky EN 10255, příruby PN16, nátrubky, normálie HASCO Z00–Z170 a Meusburger E-řady; parser 70+ nových frází; 148 testů.
- **W6 Svařence** (`cad/ext/weld.ts`, `weld-layout.ts`): ✅ 10 příkazů – konstrukční profil po skice (jäkl, trubka, L, U, IPE/HEB, plochá, kulatina, čtyřhran; pokos/tupý/žádný roh, mezera, prodloužení), rám z profilů, deska s děrami, ořez rovinou, víčko, styčník, svarová housenka (souvislá/přerušovaná), značka svaru ISO 2553 (+ `weldSymbolGeometry` pro výkres), kusovník řezů CSV, tabulka svarů. Omezení: jen přímé profily, housenka jen na rovných vydutých hranách.
- **Vedoucí**: analýza ploch ve 3D (zebra, křivost, tloušťka stěn) ✅; karta Svařence ✅.
Hotovo: vše zapojeno přes registr; `tools.cjs` snímá karty Plochy/Plech/Svařence a analýzu ploch; `e2e/cad-modules.e2e.cjs` (svařence, plech → rozvin DXF, plochy, zkrut, knihovna 2, zebra); build OK; 361 testů.

### 4. vlna (listopad 2026) – probíhá
- **X1 Skica 2** (`sketcher.tsx`, `sketch-ref.ts`): promítnutí hran modelu, obrys tělesa, průnik s rovinou jako uzamčené referenční entity, vazby a kóty k referencím, text ve skice (obrysy písma jako profil), offset od hran modelu.
- **X2 Více těles** (`build.ts`, `manager.tsx`, `viewport.tsx`, `props.tsx`): pojmenovaná tělesa v dílu, cílové těleso u prvků, sloučit/rozdělit těla, barvy a skrývání těles, export těla.
- **X3 Pohyb mechanismu** (`mates.ts`, `motion.ts`, `asm-panel.tsx`): živé řešení vazeb při tažení gizmem, stupně volnosti komponenty, omezený pohyb (otáčení kolem osy souososti), animace, úprava hodnot vazeb, hrubá kontrola kolizí při pohybu.
- **X4 Výkresy 3** (`drawing.ts`, `drawing-workspace.tsx`, `pdf.ts`): částečný řez, přerušený pohled, pomocný pohled, úhlové/poloměrové/průměrové/souřadnicové/sražené kóty, tolerance a uložení ISO 286, úprava a tažení kót, značky svarů, značky středů, drsnost celého dílu, varianty razítka, PDF všech listů.
- **X5 AI asistent** (`app/api/cad-ai/route.ts`, `cad/ai/*`, `ai-panel.tsx`): zadání textem → prvky (schéma z registru), vysvětlení chyb prvků, kontrola vyrobitelnosti; klíč `ANTHROPIC_API_KEY`.
- Vedoucí: po dokončení zapojit AI panel (tlačítko v hlavičce, Ctrl+J, paleta), build, e2e, snímky, přepočet příkazů.

### Zapojení po dokončení pracovníků (checklist pro vedoucího / další relaci)
1. ~~Settings/Palette/Start/MoldPanel/LibraryDialog/DWG/náhledy~~ – vše zapojeno.
2. Používat `ui.tsx` (Modal/FloatPanel/Row/Btn/Toggle/Segmented/Kbd) místo lokálních kopií v `cad-app.tsx` (kosmetika).
3. Jednotky: `fmtLen` ve stavových štítcích, inspektoru a formulářích podle `settings.units` (dnes jen uloženo v nastavení, UI stále mm).
4. E2E `e2e/cad.e2e.cjs`: doplnit kroky vazby skici + kóty, výběr plochy → pushPull, knihovna „M8x30“ → vložit, formařská analýza.
5. Aktualizovat `README.md` (sekce CAD) a tento soubor.

### Další etapy (priorita shora)
1. **Asociativní výkresy** – ✅ základ hotov: výkres uložený v dokumentu (`doc.drawings[]`: volby, razítko, poznámky), uživatelské kóty (šikmá/vodorovná/svislá, přichycení k vrcholům, hodnota v jednotkách modelu), poznámky s odkazem, drsnost ISO 1302, geometrické tolerance ISO 1101 (12 značek kreslených geometrií → fungují v PDF/DXF/DWG), základny, volný text; souřadnice v prostoru pohledu → drží se geometrie po změně modelu. **Zbývá:** více listů, detailní pohled (kruh + zvětšení), částečný řez, přerušený pohled, úprava/přesun existující kóty tažením, tolerance u kót (±, H7), kóty úhlu a poloměru ručně.
2. **Sestavy**: trvalé vazby (uložené v dokumentu, řešené při změně – začít jednoduchým sekvenčním řešením Kontakt/Souosost/Vzdálenost/Úhel), souosost válcových ploch, vzdálenostní vazba, pohyb (táhnout komponentu s respektem vazeb), zrcadlení komponent, pole komponent, závitové spoje jedním klikem (šroub + podložka + matice do díry).
3. **Skica**: řešič – přidat vazby stejná vzdálenost, úhlová kóta mezi křivkami, offset jako vazba; promítnutí hran modelu do skici (reference), text ve skice.
4. **Modelování**: proměnný poloměr zaoblení, plné zaoblení (full round), šroubovité vysunutí (twist – replicad `twistExtrude`), plochy (vysunutí plochy, ořez plochou, sešití, zacelení), booleovské operace mezi tělesy v jednom dílu (více těles), zrcadlení prvků (ne jen těles), knihovna prvků (uživatelské šablony).
5. **Formy**: dělení tvárník/tvárnice řezem po dělicí rovině, generátor čelistí, vtokový systém, rozmístění chlazení podle dutiny, export seznamu normálií do objednávky (HASCO/Meusburger čísla).
6. **Výkon**: progresivní síť (hrubá → jemná), cache meshů dílů v IndexedDB, OCCT v `SharedArrayBuffer` workerech (více jader) – vyžaduje COOP/COEP hlavičky.
7. **AI vrstva**: „nakresli přírubu DN80 se 6 dírami M16“ → historie prvků (Claude API, nástroje = `newFeature` schema), kontrola vyrobitelnosti (tenké stěny, hluboké kapsy, poloměry nástrojů), odhad technologie a času.
8. **Cloud**: ukládání projektů do Supabase (CNC Sales OS – zákazník má své modely u poptávky), sdílení odkazem, verze.


## Audit požadavků zadavatele (všechny zprávy od začátku projektu)

Legenda: ✅ splněno a ověřeno · 🟡 částečně / čeká na podklady · ❌ nesplněno (plán níže) · ⛔ nelze (technicky/licenčně) – říkáme na rovinu

### Web mnastrojarna.cz
| # | Požadavek | Stav | Poznámka / co zbývá |
| --- | --- | --- | --- |
| 1 | Nový web, výrazně lepší design, animace, konverze | ✅ | v3 (fotostěna, GSAP/Lenis, 3D příběh, případovky, video) |
| 2 | Slogan „Váš partner ve strojírenství“ | ✅ | všude vč. razítka výkresu |
| 3 | Logo zachovat, oživit (glow/animace) | ✅ | `components/logo.tsx` – animace pásů štítu |
| 4 | Obsah fakticky z původního webu, ale NE kopírovat (strojový park, služby přepsat) | ✅ | přepsáno; fráze „od polotovaru k protokolu“ se v textech už nevyskytuje (0×) |
| 5 | Noví kolegové Šponer (technolog) a Volný (obchod) | ✅ | Volný = primární kontakt, Semorád odstraněn |
| 6 | Jen B2B, min. 50 000 Kč, bez telefonátů obchodníků/důchodců | ✅ | štítek min. zakázky, texty cílí na firmy; formulář zrušen (e-mail Volnému) |
| 7 | Top SEO | 🟡 | metadata, JSON-LD, sitemap, hreflang ✅; SEO analýza + zacílení (údržba/vývoj/konsignace) ✅; Lighthouse: SEO 100, desktop 99, mobil úvod 72 (LCP = obrázek fotostěny přes `/_next/image` bez CDN – na Vercelu rychlejší). Zbývá: Google Business Profile, Search Console po nasazení, případovky s čísly |
| 8 | Ambice „největší nástrojárna v ČR“ v tónu webu | ✅ | manifest, claim „Vyrobíme, co ostatní odmítli“ – **čeká na vaše potvrzení claimu** |
| 9 | Fáze 2: online 3D/2D CAD | ✅→🚧 | existuje a rozšiřuje se na profesionální CAD (viz níže) |
| 10 | Navrhnout víc přidané hodnoty | ✅ | kalkulačka prostoje, kontrola obálky strojů, archiv zakázek, video dílna, CAD |
| 11 | Bílé pozadí, prémiový, nápaditý vzhled (ne tmavý) | ✅ | |
| 12 | EN + DE verze s referencemi | ✅ | `/en`, `/de`, logo wall ve všech jazycích |
| 13 | Žádný odhad ceny z historie, žádný zákaznický portál (zatím) | ✅ | nepřidáno |
| 14 | Použít stávající reference | ✅ | 16 klientů + 2 partneři z původního webu |
| 15 | Reálné fotky, YouTube kanál, galerie, historické zakázky, žádná fotobanka | ✅ | 5 videí, 10 případovek z vlastních fotek |
| 16 | Reálné popisy reálných zakázek | 🟡 | struktura připravena (`cases.ts`: brief/solution/result), **0 z 10 vyplněno – potřebuji vaše texty** |
| 17 | Fotky týmu | 🟡 | `public/team/` prázdné – **potřebuji fotky Volný, Šponer** |
| 18 | Potvrzení: jména klientů v hero (Bosch Powertrain, Rimowa, Valeo, Edscha), „platíte až při odběru“ u konsignace | 🟡 | **čeká na vaše ANO/NE** |
| 19 | Zrušit formulář, Volný primární kontakt, Semorád pryč, push | ✅ | |
| 20 | Náhled webu bez nasazení | ✅ | videa + snímky poslány; lokální spuštění popsáno |

### Mnástrojárna CAD
| # | Požadavek | Stav | Poznámka / co zbývá |
| --- | --- | --- | --- |
| 21 | Plnohodnotný CAD jako ZW3D/Inventor, „nakreslit cokoli“, uložit do počítače | 🟡 | historie prvků 30+ typů, uložení .mncad/STEP; **chybí plošné modelování (surfacing), více těles v dílu, proměnné zaoblení** |
| 22 | Dramaticky lepší UI, barevné ikony, 1:1 ZW3D (UX, UI, grafika, ovládání) | 🟡 | ribbon, správce, formulář OK/Storno, ViewCube, schéma myši ZW3D hotovo; **dokončují se: výběrový filtr entit, kontextové nabídky dle entity, gizmo, inspektor** (pracovník M) |
| 23 | Import/export všech formátů, nejnovější i historické verze | 🟡/⛔ | STEP/IGES/BREP/STL/OBJ/3MF/glTF/PLY/OFF/DXF ✅. **⛔ nativní SLDPRT/IPT/Z3/CATPart/PRT/X_T – uzavřené formáty, bez licence ODA/Spatial nečitelné** → návod na STEP. **❌ JT (ISO 14306) a 3D PDF – otevřené, lze doplnit později** |
| 24 | Výkresy PDF, DXF, **DWG** | ✅ | PDF/DXF/SVG/**DWG R2000–R2018** (acad-ts, MIT). Ověřit otevření v reálném AutoCAD/ZWCAD |
| 25 | Stavy (konfigurace) | ✅ | |
| 26 | Složité sestavy forem obrovské velikosti, rychlost | 🟡 | sestavy, podsestavy, rám formy ✅; **výkon pro tisíce dílů ❌ (progresivní síť, IndexedDB cache, více workerů)** |
| 27 | Hlavičky (razítka) a kusovníky ve výkresech | ✅ | |
| 28 | Skica: práce s rovinami, zjištěné vzdálenosti, pravé tlačítko, uchopení rohu/hrany/křivky/středu | ✅ | přichytávání 10 druhů, vazby, kóty, řešič, měření, kontextová menu |
| 29 | Entity: prvek/plocha/hrana/bod/sestava/podsestava/tvar – otáčet, barvy, mazat, posouvat jednotlivé prvky/plochy/tvary | ✅ | filtr výběru, kontextová menu dle entity, pushPull/offset/delete plochy, barvy ploch, gizmo, podsestavy. Filtr „Prvek“ vybírá ve stromu (jádro neposílá původ ploch) |
| 30 | Snímky všech nástrojů + počet nástrojů vs. ZW3D | ❌ | udělat po zapojení (viz checklist); do zprávy uvést poctivé srovnání počtu příkazů |
| 31 | Top UI/UX vč. ikon, **nastavení** a používání | ✅ | Nastavení (7 karet, zkratky, jednotky, export/import), paleta příkazů Ctrl+K, úvodní obrazovka s nedávnými soubory – zapojeno |
| 32 | Obrovský adresář normalizovaných dílů „stačí napsat“: ozubená kola, řetězová kola, normálie, ocelové profily… | ✅ | 46 rodin, textový parser, dialog s 3D náhledem (Ctrl+L). Rozšiřování: TODO v `cad/library/index.ts` |
| 33 | Pracovat až do limitu, nic neztratit, předat dál | ✅ | WIP commity po každém kroku, tento dokument |
| 34 | AI vrstva (21. století) – zadání textem, kontrola vyrobitelnosti | ❌ | etapa 7 níže |

### Úkoly z auditu (doplnit do nejbližší etapy)
- [x] Lighthouse změřeno a opraveno (odložená inicializace animací, priorita fotek, kontrast, cíle dotyku, ARIA): mobil `/` 54→72, `/zakazky` 76, `/sluzby/*` 87, desktop 99, SEO 100. Zbývá: LCP mobilní úvodní stránky (hero fotky → menší WebP, text jako LCP), `td-has-header` v tabulce strojů, `color-contrast` u dekorativních slov manifestu.
- [x] DWG export – rozhodnuto: `@node-projects/acad-ts` (MIT, DwgWriter AC1015–AC1032). LibreDWG zapisuje spolehlivě jen R2000/R2004 a wasm balíček je bez zápisu; ODA File Converter nelze redistribuovat ani komerčně automatizovat (členství ODA od 3 000 USD/rok). Po dodání ověřit výstup v AutoCAD/ZWCAD (audit) – mladá knihovna.
- [ ] JT a 3D PDF export (otevřené formáty) – nízká priorita.
- [ ] Snímky všech nástrojů CAD + tabulka počtu příkazů (náš CAD vs. ZW3D Standard) do zprávy zadavateli.
- [ ] Vyžádat od zadavatele: texty k 10 zakázkám, fotky týmu, potvrzení claimu/klientů/konsignace.

## Rozsah (listopad 2026, poctivé srovnání)
- **261 příkazů** (202 v UI + 59 v modulech ploch/plechu/pokročilého modelování/svařenců), **32 typů prvků** v jádře + 59 modulových, **103 rodin normálií**, 6 formátů výkresů/exportu 2D (vč. DWG), 8 formátů 3D exportu, 11 importních formátů, **361 testů**.
- ZW3D Standard/Professional má řádově **600–900 příkazů** (včetně ploch, plechů, CAM, PMI, pokročilých sestav). Náš CAD pokrývá jádro práce nástrojárny (díly, sestavy, výkresy, formy, normálie); chybí především plošné modelování, plech, CAM, trvalé vazby sestav a pokročilé výkresové pohledy – viz etapy níže.

## Známá omezení (říkat zákazníkovi na rovinu)
- Nativní formáty SolidWorks/Inventor/ZW3D/CATIA/NX/Creo nelze číst (uzavřené formáty) – návod na STEP.
- DWG se nezapisuje (DXF ano).
- Modelovaný závit = soustředné drážky, ne šroubovice.
- Vazby sestavy se zatím aplikují jednorázově (neudržují se při změně).
- Obrovské sestavy (tisíce dílů) jsou v prohlížeči pomalejší než v desktopu; opakované díly se sdílejí.

## Stav k 2. 11. 2026 – přerušení 4. vlny (týdenní limit API)

- Všech 5 workerů 4. vlny (X1 reference ve skice, X2 více těles, X3 pohyb mechanismu, X4 výkresy 3, X5 AI asistent) skončilo na limitu **před odevzdáním**. Na disku zůstaly jen typy pro více těles (`cad/types.ts`: prvky `combine`, `splitBodies`, `copyBody`, `BodyMeta`, `BodyInfo`, `ExtBuildCtx.bodies`) a závislost `@anthropic-ai/sdk` v `package.json` (pro X5). Tyto typy mají zatím jen výchozí hodnoty a popisky v `cad/defaults.ts`; **stavba (`build.ts`), formuláře (`props.tsx`) a UI chybí** – navázat podle plánu 4. vlny výše.
- Web: opraven vlastní kurzor (po optimalizaci výkonu se GSAP navázal na ještě nevykreslené prvky → nativní myš skryta, vlastní neviditelná). Nově se nativní kurzor skrývá až po prvním pohybu myši a po opuštění okna se vrací.
- Web: přidána vstupní stránka **Pro údržbu** (`/pro-udrzbu`, `/en/for-maintenance`, `/de/fuer-instandhaltung`) – díl podle vzorku, audit kritických dílů, konsignace, kalkulačka prostojů, FAQ + JSON-LD, v sitemapě a patičce.
- **Plán zadávacích možností** (analýza ZW3D/SolidWorks/NX/Creo/Inventor/Fusion/Onshape, referenční systém `Ref`/`Extent`/`Direction`/`PlaneDef`, etapy A–E, měřítka): viz `CAD-PLAN-ZADANI.md`. Hotovo hned: nabídky pásu v portálu (mobil = spodní list), 7 nových způsobů zadání roviny skici.

## 5. vlna (2. 11. 2026) – „jak nakrmit příkazy“: hotovo

Referenční systém zadání (`cad/refs.ts`, `cad/ref-resolve.ts`, `components/cad/ref-field.tsx`) + registry stavitelů a formulářů
(`cad/feat/*`, `components/cad/forms/*`). Souhrn způsobů zadání je v tabulce v `CAD-PLAN-ZADANI.md` (oddíl 5).

- **Jádro (vedoucí):** odkazy s otiskem entity (přežijí změnu indexů), odvozené body, 8 směrů, 12 definic rovin (asociativní),
  vysunutí 8 ukončení + 2 směry + začátek + tenká stěna + kroucení + měřítko, rotace 10 os, díra více poloh / k dalšímu / k ploše,
  pole odkazu (klik, psaní, pravé tlačítko / dlouhý stisk), kontextová mini lišta, spodní listy na mobilu, 11 testů jádra.
- **W5-A zaoblení/zkosení** (`feat/fillet.ts`, 29 testů): konstantní, R1→R2, tabulka, plocha–plocha, plný rádius, tečné řetězení;
  zkosení stejné, D1×D2, D×úhel, vrchol, tečné. Nejde v OCCT: setback a eliptické (skutečně asymetrické) zaoblení.
- **W5-B pole/skořepina/úkos** (`feat/pattern.ts`, 20 testů): 5 druhů pole, vynechané kusy, celková délka, střídavé, symetrické,
  více zdrojů, jedna booleovská operace; skořepina ven (ostré hrany přes OCCT) + rozdílné tloušťky rovinných stěn; úkos se směrem
  tahu a tečným řetězením. Nejde: dělicí křivka / stupňovitý úkos.
- **W5-C tažení/šablonování** (`feat/sweep-loft.ts`, 25 testů): vodicí křivka, kroucení, měřítko, kruhový profil bez skici, tenká
  stěna, pevná orientace, 3 přechody; loft do bodu, uzavřený (C0 na švu), okrajové podmínky (aproximace pomocným řezem), osová
  a vodicí křivka (MakePipeShell), tenká stěna.
- **W5-E odkazy ve zbytku prvků + pomocná geometrie** (`feat/refs-more.ts`, 22 testů, `pick-list.tsx`): primitiva, pružina, závit,
  text, transformace, Vytáhnout/Zatlačit odkazem; pomocná osa (10 způsobů vč. průsečnice rovin), bod (14), souřadný systém;
  výběr entit ze seznamu s filtrem; vykreslení os/bodů/CSYS ve 3D okně a tlačítka v pásu Reference (vedoucí).
- **W5-D skica** (`sketcher.tsx`, `sketch-tools.ts`, `sketch-solver.ts`, 41 testů): číselné zadání u kurzoru pro všechny nástroje
  (X;Y, @dx;dy, délka + úhel, `50<45`, Ø/R, šířka×výška, výrazy; Tab = další pole a zámek, Enter), „Kótovat při kreslení“,
  automatické vazby s náhledem (8 druhů: vodorovně, svisle, rovnoběžně, kolmo, tečně, totožnost, bod na křivce, střed),
  stav určenosti po entitách (modrá/černá/červená + nadbytečné vazby a konflikty), výkonný ořez tažením, odsazení řetězce,
  rozdělit, promítnout hrany modelu, obdélník 3 body, kružnice 2 body, mnohoúhelník vepsaný/opsaný, drážka obloukem,
  kóta délky oblouku, klávesa D = kóta hned, přepínače uchopení v pásu. Nejde zatím: spline s tečnami (nový typ entity),
  prodloužení oblouků, vazba poměru.

Zbývá z plánu: vazby sestav (18 druhů + mate connector), výkresy (13 druhů pohledů, tolerance, tabulky), dělicí křivka úkosu,
setback zaoblení, zvýraznění indexů kusů pole ve 3D, šipka začátku hrany pro R1→R2.

## Dokumentace (2. 11. 2026)

Jeden zdroj `src/content/cad-docs.ts` (23 kapitol, 14 FAQ, ~8 000 slov, 29 snímků) → **web** `/cad/dokumentace`
(TechArticle + SoftwareApplication + HowTo + FAQ + Breadcrumb JSON-LD, OpenGraph, sitemapa, odkazy z patičky, úvodní obrazovky,
nabídky Soubor a palety CADu), **PDF** `public/cad/mnastrojarna-cad-prirucka.pdf` (tisková stránka `/cad/prirucka`, noindex,
Playwright) a **text pro AI** `public/cad/dokumentace.md` + `public/llms.txt`. Skripty: `docs:assets`, `docs:text`, `docs:pdf`.
Při změně funkcí aktualizovat obsah a znovu vygenerovat (PDF vyžaduje běžící server).
