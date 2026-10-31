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
- **201 unikátních příkazů/voleb** v UI (pás karet, nabídky, kontextová menu, skicář, výkres), **32 typů prvků** v jádře, **46 rodin normálií**, 6 formátů výkresů/exportu 2D, 8 formátů 3D exportu, 11 importních formátů.
- ZW3D Standard/Professional má řádově **600–900 příkazů** (včetně ploch, plechů, CAM, PMI, pokročilých sestav). Náš CAD pokrývá jádro práce nástrojárny (díly, sestavy, výkresy, formy, normálie); chybí především plošné modelování, plech, CAM, trvalé vazby sestav a pokročilé výkresové pohledy – viz etapy níže.

## Známá omezení (říkat zákazníkovi na rovinu)
- Nativní formáty SolidWorks/Inventor/ZW3D/CATIA/NX/Creo nelze číst (uzavřené formáty) – návod na STEP.
- DWG se nezapisuje (DXF ano).
- Modelovaný závit = soustředné drážky, ne šroubovice.
- Vazby sestavy se zatím aplikují jednorázově (neudržují se při změně).
- Obrovské sestavy (tisíce dílů) jsou v prohlížeči pomalejší než v desktopu; opakované díly se sdílejí.
