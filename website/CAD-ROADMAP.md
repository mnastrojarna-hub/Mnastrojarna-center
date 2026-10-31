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

### Rozpracováno (paralelní pracovníci, listopad 2026)
- **S – skicář**: přichytávání (koncový bod, střed, kvadrant, průsečík, kolmo, tečně…), inference, vazby (13 typů) a kóty s řešičem, nástroje Oříznout/Prodloužit/Odsadit/Zaoblit/Srazit/Zrcadlit/Přesunout/Otočit/Měřítko/Pole/Rozložit, elipsa, spline, bod, pomocná geometrie, kontextové menu skici.
- **M – 3D interakce**: výběrový filtr (vše/prvek/plocha/hrana/bod/těleso/komponenta/podsestava), inspektor entit, měření mezi entitami (bod–plocha, plocha–plocha, úhel…), kontextové nabídky podle entity, TransformControls gizmo, barvy ploch, podsestavy v UI, strukturovaný kusovník.
- **F – jádro 2**: pushPull, offsetFace, deleteFace, žebro, pružina, zesílení; `BuildResult.vertices`; `flattenAssembly`, `makeSubassembly`, `dissolveSubassembly`, strukturovaný kusovník; další normálie (ISO 7089, ISO 4032, ISO 8734).
- **L – knihovna normálií**: registr rodin + textový parser + dialog knihovny s 3D náhledem.
- **Vedoucí**: formařské nástroje (`mold.ts` hotovo s testy, `mold-panel.tsx` hotovo – čeká na zapojení), nastavení (`settings.ts`, `settings-dialog.tsx`), paleta příkazů, úvodní obrazovka, sdílené UI (`ui.tsx`) – vše čeká na zapojení do `cad-app.tsx` po dokončení M.

### Zapojení po dokončení pracovníků (checklist pro vedoucího / další relaci)
1. `cad-app.tsx`: nahradit lokální `loadPrefs/PREFS` modulem `cad/settings.ts` (`loadSettings/saveSettings`), přidat `SettingsDialog` (karta Data nebo ozubené kolo v titulní liště), `CommandPalette` (Ctrl+K; příkazy = zploštělé skupiny ribbonu + pohledy + soubor), `StartScreen` (při startu, pokud `settings.startScreen`; nedávné: `pushRecent` při uložení/otevření, thumbnail = `vp.current.snapshot()` zmenšený), `MoldPanel` (karta Nástroje → „Formy“; analýza úkosů = barvy vrcholů do viewportu – přidat prop `vertexColors?: Float32Array` do `viewport.tsx` a použít `MeshStandardMaterial({vertexColors:true})`), `LibraryDialog` (karta Tvorba/Sestava → „Knihovna normálií“ + Ctrl+L).
2. Používat `ui.tsx` (Modal/FloatPanel/Row/Btn/Toggle/Segmented/Kbd) místo lokálních kopií v `cad-app.tsx`.
3. Jednotky: `fmtLen` v stavových štítcích a inspektoru podle `settings.units`.
4. E2E `e2e/cad.e2e.cjs`: doplnit kroky vazby skici + kóty, výběr plochy → pushPull, knihovna „M8x30“ → vložit, formařská analýza.
5. Aktualizovat `README.md` (sekce CAD) a tento soubor.

### Další etapy (priorita shora)
1. **Asociativní výkresy**: výkres uložený v dokumentu (`doc.drawings[]`) s vlastními kótami (uživatel přidává kóty, poznámky, drsnosti, tolerance, GD&T rámečky), aktualizace po změně modelu, více listů, detailní pohled (kruh + zvětšení), částečný řez, přerušený pohled.
2. **Sestavy**: trvalé vazby (uložené v dokumentu, řešené při změně – začít jednoduchým sekvenčním řešením Kontakt/Souosost/Vzdálenost/Úhel), souosost válcových ploch, vzdálenostní vazba, pohyb (táhnout komponentu s respektem vazeb), zrcadlení komponent, pole komponent, závitové spoje jedním klikem (šroub + podložka + matice do díry).
3. **Skica**: řešič – přidat vazby stejná vzdálenost, úhlová kóta mezi křivkami, offset jako vazba; promítnutí hran modelu do skici (reference), text ve skice.
4. **Modelování**: proměnný poloměr zaoblení, plné zaoblení (full round), šroubovité vysunutí (twist – replicad `twistExtrude`), plochy (vysunutí plochy, ořez plochou, sešití, zacelení), booleovské operace mezi tělesy v jednom dílu (více těles), zrcadlení prvků (ne jen těles), knihovna prvků (uživatelské šablony).
5. **Formy**: dělení tvárník/tvárnice řezem po dělicí rovině, generátor čelistí, vtokový systém, rozmístění chlazení podle dutiny, export seznamu normálií do objednávky (HASCO/Meusburger čísla).
6. **Výkon**: progresivní síť (hrubá → jemná), cache meshů dílů v IndexedDB, OCCT v `SharedArrayBuffer` workerech (více jader) – vyžaduje COOP/COEP hlavičky.
7. **AI vrstva**: „nakresli přírubu DN80 se 6 dírami M16“ → historie prvků (Claude API, nástroje = `newFeature` schema), kontrola vyrobitelnosti (tenké stěny, hluboké kapsy, poloměry nástrojů), odhad technologie a času.
8. **Cloud**: ukládání projektů do Supabase (CNC Sales OS – zákazník má své modely u poptávky), sdílení odkazem, verze.

## Známá omezení (říkat zákazníkovi na rovinu)
- Nativní formáty SolidWorks/Inventor/ZW3D/CATIA/NX/Creo nelze číst (uzavřené formáty) – návod na STEP.
- DWG se nezapisuje (DXF ano).
- Modelovaný závit = soustředné drážky, ne šroubovice.
- Vazby sestavy se zatím aplikují jednorázově (neudržují se při změně).
- Obrovské sestavy (tisíce dílů) jsou v prohlížeči pomalejší než v desktopu; opakované díly se sdílejí.
