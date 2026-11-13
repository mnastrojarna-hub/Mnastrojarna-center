# Mnástrojárna CAD – analýza nástrojů a způsobů jejich zadání

Stav podle kódu v `website/src` (listopad 2026). Rozhoduje kód, ne dokumentace; u každého tvrzení je odkaz na soubor a řádek
(cesty jsou relativní k `website/src`, u komponent k `components/cad/`, u jádra k `cad/`). Kde se dokumentace
(`content/cad-docs.ts`) nebo plány (`CAD-PLAN-ZADANI.md`, `CAD-ROADMAP.md`) liší od kódu, je to uvedeno v oddílu 4.

## 1. Shrnutí

- Program má **10 karet pásu** (`cad-app.tsx:2530`): Tvorba / Sestava (podle druhu dokumentu), Plochy, Plech, Svařence, Skica (jen při otevřené skice), Nástroje, Zobrazení, Výkres, Data. Dohromady jde o cca **210 tlačítek**: Skica 64 položek (19 kreslicích, 16 úprav, 13 vazeb, kóta, 4 nástroje, 11 přepínačů uchopení), Tvorba 34 vestavěných + 15 rozšiřujících, Plochy 19, Plech 12, Svařence 10, Nástroje 11, Zobrazení 19, Výkres 1 (+ 7 nástrojů ve výkresovém prostředí), Data 9 (s 19 položkami nabídek), Sestava 18. **59 prvků rozšíření** vzniká z registru (`ext/registry.ts:94`), jejich formulář se generuje automaticky z `params`.
- Hlavní způsoby zadání: (1) **klik v 3D** s filtrem výběru a uchopením na hranách (`viewport.tsx:633–760`), (2) **číselná pole** s výrazy a vazbou na proměnné (`props.tsx:60`), (3) **referenční pole** bod / směr / rovina / osa / ukončení s nabídkou pravého tlačítka, psaním souřadnic a výběrem ze seznamu (`ref-field.tsx:76`), (4) **číselné zadání u kurzoru** ve skice s Tab/Enter (`sketcher.tsx:1959`), (5) **textové příkazy a JSON** v konzoli, paletě a přes `window.mncad` (`agent.ts:208`, `cad-app.tsx:713`), (6) **paleta příkazů** Ctrl+K s fuzzy hledáním přes všechna tlačítka (`cad-app.tsx:2645`), (7) **popisky F1/E2/V3 a P1/O** pro agenty a dotyk (`viewport.tsx:196`, `sketcher.tsx:744`).
- **Nejsilnější místa:** referenční vrstva (14 voleb bodu, 8 směrů, 12 rovin, 10 os, 8 ukončení – `refs.ts`), vysunutí / díra / zaoblení / sražení / pole / tažení / šablonování s plnými formuláři 5. vlny, skicář s číselným zadáním u kurzoru pro každý nástroj (`sketch-tools.ts:615`) a textové rozhraní s pravidly výběru hran/ploch (`agent.ts:597`).
- **Slabá místa:** (a) textové příkazy pokrývají jen 25 příkazů; 59 prvků rozšíření, přímé úpravy, pomocná geometrie, transformace a celé sestavy/výkresy jdou textem jen přes JSON; (b) tři typy prvků pro více těles (`combine`, `splitBodies`, `copyBody`) nemají vůbec žádné tlačítko ani formulář; (c) několik dialogů používá `window.prompt` (odsazené roviny skici, hodnoty v nabídce bodu, název listu); (d) nejednotné zadání plochy/hrany u prvků rozšíření a přímých úprav – jen klik v modelu, bez „Vybrat ze seznamu“ a bez odkazů s otiskem; (e) skica nemá textový příkaz pro vazby, kóty a oblouky; (f) vazby sestav jen klikem na plochy, bez výběru z nabídky komponent; (g) výkresové kóty jen 2 body + umístění, bez výběru hrany/kružnice.

## 2. Způsoby zadání napříč programem

| Způsob | Kde a jak funguje | Kód |
| --- | --- | --- |
| **Myš v 3D okně** | Levý klik vybere entitu podle filtru (Vše / Prvek / Plocha / Hrana / Bod / Těleso, v sestavě Komponenta / Podsestava). Ctrl/Shift/Meta+klik přidává do výběru. Pravý klik = kontextová nabídka podle entity (skica na ploše, vytáhnout, zaoblit hranu, měřit, barva…). Jediný klik bez Ctrl zobrazí plovoucí mini lištu (HudBar) se stejnými příkazy (jen v dílu). Filtr se mění na kartě Nástroje → Filtr, v patičce (select) nebo v pravém kliku do prázdna. | `viewport.tsx:707` (pickSel), `:822` (onUp, additive), `cad-app.tsx:1253` (onPick), `:1443` (entityMenu), `:2590` (vpContext), `:3354` (select filtru), `selection.ts:8` |
| **Uchopovací body na hranách** | Při měření nebo při čekajícím poli bodu se po najetí na hranu nabídnou začátek, konec, střed délky a střed kružnice (modré kuličky, do 12 px). | `viewport.tsx:633` (snapCandidates), `:678` (pickSnap); zapíná `snapPoints` v `cad-app.tsx` u `<Viewport>` |
| **Výběr v režimu prvku** | U zaoblení/sražení se klikem přidávají/odebírají hrany, u skořepiny/díry/úkosu/přímých úprav plochy (`pickMode` edges/faces). Model se u těchto prvků zobrazuje „před prvkem“ (rollback) kvůli stabilním indexům. | `cad-app.tsx:1721` (pickMode), `:1758` (onPickEdge), `:1770` (onPickFace), `:107` (PICK_TYPES), `ext/registry.ts:83` (`rollback`) |
| **Číselná pole formuláře** | Komponenta `Num`: přijímá výrazy (`25/2`, `10+5*2`, funkce sin/cos/tan/asin/acos/atan/sqrt/abs/min/max/round/floor/ceil, konstanta `pi`, desetinná čárka i tečka), šipky ↑/↓ mění hodnotu o krok (Shift = 10×), průběžné potvrzení po 450 ms, Enter/blur potvrdí. S `bind` lze napsat `=d*2` nebo název proměnné → vazba parametru (modré pole ƒx, kliknutím se zruší). `Vec` = tři/dvě `Num` pro X/Y/Z. | `props.tsx:60` (Num), `:186` (šipky), `:200` (Vec), `params.ts:11` (FUNCS), `:34` (desetinná čárka), `:85` (evalExpr) |
| **Proměnné a stavy** | Levý panel → záložka Proměnné (název, výraz, hodnota, „+ Přidat proměnnou“, seznam vazeb parametrů s možností zrušit) a Stavy (varianty hodnot proměnných + potlačené prvky, přepínání radiem). | `manager.tsx:255` (Variables), `:359` (Configs) |
| **Referenční pole (bod)** | `RefField want="point"`: klik na pole → čeká na klik v modelu (filtr se přepne na Vše, zapnou se uchopovací body); tlačítko `xyz` → psaní `X; Y; Z` (oddělovač `;`, `,` nebo mezera) nebo `@dx; dy; dz` relativně od posledního bodu; tlačítko `⋯` / pravé tlačítko / dlouhý stisk (450 ms) → 14 voleb: vrchol, střed/začátek/konec hrany, střed kružnice, střed plochy, bod v % délky hrany, střed mezi 2 body, mezi body v poměru, odsazený podél hrany, průmět na plochu, průsečík hrany s plochou, počátek, souřadnice; dále „Vybrat ze seznamu…“, „Použít aktuální výběr“, „Vymazat“. Hodnoty u voleb (%, poměr, mm) se zadávají přes `window.prompt`. Odkaz dostane otisk entity (typ, střed, velikost), takže přežije přečíslování indexů. | `ref-field.tsx:76`, `:61` (parseXyz), `:154–160` (window.prompt), `:178` (entries), `:223` (dlouhý stisk), `refs.ts:175` (POINT_OPTIONS), `cad-app.tsx:1300` (deliverRef s otiskem) |
| **Referenční pole (plocha / hrana / osa)** | `want="face"|"plane"|"edge"|"axis"`: klik v modelu s automaticky přepnutým filtrem; nabídka obsahuje „Vybrat plochu/hranu klikem“, „Vybrat ze seznamu…“, „Použít aktuální výběr“, „Vymazat“. Souřadnice psát nelze. | `ref-field.tsx:178–191`, `cad-app.tsx:1317` (refFilter) |
| **Výběr ze seznamu** | Modální seznam ploch / hran / vrcholů tělesa s filtrem typu (rovinná, válcová, kuželová, kulová, toroidní; úsečka, kružnice) a textovým hledáním (číslo, typ, souřadnice); max. 300 položek, stránky po 40; u kruhové hrany tlačítko „střed kružnice“. Pracuje jen s aktivním dílem (ne s komponentami sestavy). | `pick-list.tsx:59`, `:22` (LIMIT), `:51` (kindsFor), `:81` (refInfo na dílu) |
| **Směr** (8) | `DirectionField`: normála, osa X/Y/Z (tlačítka), podél hrany / osy válce (RefField axis), dvěma body (2× RefField), normála plochy, vektor (3× Num), úhel od normály, tečna křivky. | `ref-field.tsx:333`, `refs.ts:54`, `:119` |
| **Rovina** (12) | `PlaneDefField`: základní + odsazení, rovnoběžně s plochou (+ odsazení, obrátit), třemi body, bodem a přímkou, bodem a normálou, pod úhlem k ploše kolem hrany, střední mezi dvěma plochami, tečně k válci, kolmo na křivku v bodě, dvěma hranami, pomocná rovina (+ odsazení), vlastní (9 čísel). Používá se u skici, pomocné roviny, zrcadlení, rozříznutí, úkosu a textu. | `ref-field.tsx:545`, `refs.ts:86`, `:157` |
| **Osa** (10) | `AxisField` (rotace): osa Y/X skici, čára ve skici (select úseček), hrana, válcová plocha, dva body, globální osa, pomocná rovina, průsečnice dvou rovin, pomocná osa / CSYS. `AxisDefField` (transformace, pomocná osa, kruhové pole) bez os skici. | `ref-field.tsx:449`, `more-forms.tsx:99`, `refs.ts:71`, `:144` |
| **Ukončení** (8) | `ExtentField`: na vzdálenost, skrz vše, k dalšímu, k vrcholu (RefField bod), k ploše (+ odsazení), odsazeně od plochy, k tělesu, střední rovina. Díra má podmnožinu (blind, throughAll, toNext, toFace), Vytáhnout/Zatlačit (blind, toVertex, toFace, offsetFromFace). | `ref-field.tsx:299`, `refs.ts:41`, `:108`, `props.tsx:831`, `more-forms.tsx:330` |
| **Začátek a tenká stěna** | `StartField`: rovina skici, odsazení, od plochy, od vrcholu. `ThinField`: ven / dovnitř / na střed / dvě tloušťky. | `ref-field.tsx:395`, `:423` |
| **Seznam odkazů** | `RefListField`: „+ Přidat body klikem“ (smyčka, Esc ukončí), „+ XYZ“, „+ výběr“; každá položka je kompaktní RefField. Používá se u více poloh díry, ploch zaoblení plocha–plocha, vrcholů sražení. | `ref-field.tsx:691`, `:738` |
| **Výběr skici / prvku** | `<select>` ze skic (resp. prvků s nástrojovým tělesem) **před** editovaným prvkem; u šablonování seřaditelný seznam; u pole zaškrtávací seznam více zdrojů. | `props.tsx:842` (SketchPick), `pattern-form.tsx:112` (SourcePick), `props.tsx:1033`/`:1074` (ExtForm) |
| **Zadání u kurzoru ve skice** | Pro každý nástroj a krok je definována sada polí (`dynSpec`): X;Y, Délka/Úhel, Šířka/Výška, Poloměr/Průměr, Stran, Úhel oblouku, Vzdálenost odsazení, Měřítko… Psaní čísel/`;`/`@`/`<`/výrazů přímo bez kliknutí do pole; **Tab** (nebo `x`) přepne na další pole a zamkne hodnotu, **Enter** potvrdí (bod se dopočítá z poslední polohy kurzoru), **Esc** smaže. Formáty: `60;40`, `@10;0`, `50<45` (polární), `60x40`. Hodnoty zadané číslem vloží řídicí kótu („Kótovat při kreslení“). | `sketcher.tsx:1959–1999` (klávesy), `:1146` (confirmDyn), `:2583` (náhled), `sketch-tools.ts:59` (parseInput), `:615` (dynSpec), `sketcher.tsx:2517` (autoDim) |
| **Zadání hodnoty u kurzoru (AskBox)** | Malý box u kurzoru pro hodnotu kóty, poloměr zaoblení rohu, počet kusů pole; přijímá výrazy (`evalExpr`), Enter/Esc. | `sketcher.tsx:2857` |
| **Výzva (prompt line)** | Řádek příkazů v patičce 3D okna popisuje očekávaný krok (co vybrat, Enter/Esc); ve skice modrý štítek vpravo dole s textem podle nástroje a kroku. | `cad-app.tsx:2544`, `sketcher.tsx:2671` (promptFor) |
| **Textové příkazy** | Konzole (Ctrl+Shift+K): řádkové příkazy česky/anglicky nebo JSON (celý dokument / pole prvků / jeden prvek); Ctrl+Enter provede; protokol ✓/⚠/✗ + textový stav. Pravidla pro výběr hran: vše, horní, spodní, ±X/Y/Z, svislé, vodorovné, kruhové, rovné, poloměr N, delší/kratší N; ploch: ±X/Y/Z, horní, spodní, boční, válcové, rovinné, největší. Podrobně oddíl 3.12. | `agent.ts:208` (parser), `:468` (entity), `:529` (JSON), `:597`/`:616` (pravidla), `:726` (AGENT_COMMANDS), `cad-app.tsx:408` (vykonání), `agent-console.tsx:30` |
| **JSON** | Formát `.mncad`; `sketchId`/`featureId` může být `$last`; `mode` se doplní (`$auto`); id/název se dogenerují; jednořádkový JSON lze míchat s textovými příkazy. Přístup ke **všem 36 typům prvků** včetně `ext` a sestav. Podrobně oddíl 3.14. | `agent.ts:548` (normalizeFeatures), `:223` (JSON na řádku), `cad-app.tsx:420` (prepare) |
| **JavaScript API** | `window.mncad` – podrobně oddíl 3.13. | `cad-app.tsx:713–745`, `agent.ts:756` |
| **Paleta příkazů** | Ctrl+K: fuzzy hledání přes všechna tlačítka a položky nabídek všech karet (včetně právě skrytých karet), + položky Program (knihovna, nastavení, úvodní obrazovka, nápověda, dokumentace, PDF, sdílení, textové příkazy, popisky, poptávka); zapsaný platný textový příkaz nabídne „Provést příkaz“. Šipky, Enter. | `command-palette.tsx:42`, `cad-app.tsx:2645` (buildCommands), `:3521` (extra) |
| **Klávesové zkratky** | Viz tabulka 2.1. | `cad-app.tsx:1955–2050`, `settings.ts:50`, `sketcher.tsx:238`, `drawing-workspace.tsx:337` |
| **Dotyk / mobil** | 3D: dlouhý stisk prstem (550 ms) = kontextová nabídka; nabídky pásu a ContextMenu se pod 640 px otevírají jako spodní list; pravý panel formuláře se na úzké obrazovce stane spodním listem; pole odkazu reaguje na dlouhý stisk (450 ms). Skicář nemá speciální dotykové chování (jen pointer events, pan prostředním/pravým tlačítkem). | `viewport.tsx:806–815`, `ribbon.tsx:169–203`, `cad-app.tsx:3241`, `:3282` (max-sm třídy), `ref-field.tsx:223` |
| **Popisky pro agenty** | Ctrl+Shift+L: štítky F1 (plochy, modré), E2 (hrany, zelené), V3 (vrcholy, fialové) na viditelných entitách, `title` s popisem (rovinná/zakřivená, normála, délka, souřadnice); limity 300 ploch / 400 hran / 200 vrcholů. Ve skice P1…, O (počátek) s popisem bodu. `window.mncad.hints()` vrátí seznam, `clickHint("F3")` klikne syntetickou událostí. | `viewport.tsx:196–300`, `:1481–1500`, `:1526`, `sketcher.tsx:744–790` |
| **Drag & drop / soubor** | Přetažení souboru kamkoli do okna (STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, OFF, DXF, .mncad), v sestavě se vloží jako komponenta; DXF se otevře jako skica. | `cad-app.tsx:1846` (openFile), `:1916` (onDrop), `formats/import.ts:19` |

### 2.1 Klávesové zkratky podle kontextu

| Kontext | Klávesy | Kód | Poznámka |
| --- | --- | --- | --- |
| 3D – pohledy a kamera | 0 izometrie, 1 přední, 2 horní, 3 pravý, 4 zadní, 5 spodní, 6 levý, F přizpůsobit, P perspektiva/pravoúhlá | `settings.ts:50–59`, `cad-app.tsx:2039–2040` | přemapovatelné (Nastavení → Klávesové zkratky, `settings-dialog.tsx:272–291`) |
| 3D – nástroje a prvky | M měřit, X řez, E vysunutí, H díra, B zaoblení, N sražení, S nová skica XY | `settings.ts:60–66`, `cad-app.tsx:2041–2048` | B/N/S ignorují aktuální výběr hran/ploch (volají `addFeature`, ne `addWithEdges`) |
| 3D – obecné | Enter OK, Esc Storno / zrušit výběr / zavřít dialogy, Delete / Backspace smazat, G gizmo komponenty (sestava), R přepne posun/otočení gizma, Ctrl+klik přidat do výběru | `cad-app.tsx:2013–2033`, `:2049–2050` | Esc nejdřív opustí textové pole (`:1961`) |
| Program | Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) zpět/znovu, Ctrl+S uložit, Ctrl+O otevřít, Ctrl+K paleta, Ctrl+, nastavení, Ctrl+L knihovna, Ctrl+Shift+K textové příkazy, Ctrl+Shift+L popisky | `cad-app.tsx:1966–2012` | Ctrl+… fungují i ve skice (kontrola `mod` před `sketchId`) |
| Skica – nástroje | V výběr, L úsečka, K lomená čára, X osa, R obdélník, C kružnice, A oblouk, E elipsa, N spline, B bod, P mnohoúhelník, S drážka, T oříznout, O odsadit, D kóta, M měřit | `sketcher.tsx:238` (KEYS), `:2055` | nejsou přemapovatelné v Nastavení |
| Skica – obecné | F zobrazit vše, G mřížka, H vodorovně na výběr, D nad vybranou entitou = kóta hned, Ctrl+A vybrat vše, Enter dokončit lomenou čáru / potvrdit fázi výběru, Esc zrušit krok → nástroj → výběr, Delete smazat | `sketcher.tsx:2000–2057` | |
| Skica – číselné zadání | číslice `. , ; @ < + * / ( ) -` píší do aktivního pole, Tab / `x` další pole (zámek), Backspace, Enter potvrdí, Esc smaže | `sketcher.tsx:1959–1999` | jen bez Ctrl/Alt |
| Výkres | D kóta, N poznámka, R drsnost, G geom. tolerance, B základna, T text, L detail, F celý list, Esc zruší nástroj / zavře, Delete smaže poslední kótu | `drawing-workspace.tsx:42–50`, `:337–360` | |
| Deklarované, ale neobsloužené | Shift+F (ohyb z hrany), Shift+W (konstrukční profil) | `ext/sheetmetal.ts:256`, `ext/weld.ts:137` | zobrazují se v pásu i dokumentaci, handler je nezná (oddíl 4, bod 10) |

## 3. Karty pásu a nástroje

Sloupec „Alternativy“ uvádí klávesovou zkratku (Zk), textový příkaz (Txt), JSON typ (JSON) a pravé tlačítko (PT). Všechny položky pásu jsou automaticky v paletě Ctrl+K, proto se paleta neopakuje.

### 3.1 Skica (`sketcher.tsx:249` – `sketchRibbon`)

Skica se zakládá kartou Tvorba → Skica (rovina XY/XZ/YZ, rovinná plocha modelu klikem, XY/XZ/YZ s odsazením přes `window.prompt`, rovnoběžně s vybranou plochou (+ prompt), střední rovina mezi 2 vybranými plochami, třemi vybranými vrcholy, pomocné roviny) – `cad-app.tsx:2167`. Zkratka S založí skicu XY bez dotazu (`cad-app.tsx:2045`). Textově: `skica XY|XZ|YZ [odsazení N]: entita; …` (`agent.ts:233`). Dokončení: tlačítko „Dokončit skicu“ (u nepoužité skici hned nabídne vysunutí, `cad-app.tsx:1639`); Esc ve skice jen ruší krok / nástroj / výběr (`sketcher.tsx:2000`), skicu nezavírá.

**Kreslení** (skupina Kreslení, `sketcher.tsx:269–293`)

| Nástroj | Co dělá | Povinné vstupy | Jak se zadávají | Alternativy | Poznámky a omezení |
| --- | --- | --- | --- | --- | --- |
| Výběr | výběr entit, úchyty, tažení, box (zleva = celé, zprava = křížící) | – | klik, Shift/Ctrl+klik, tažení rámu; dvojklik na kótu = hodnota | Zk V; Ctrl+A vše | `sketcher.tsx:1706–1857` |
| Úsečka | řetěz úseček | 2 body | klik se snapem; u kurzoru X;Y / Délka Tab Úhel / `50<45` / `@dx;dy`; auto vazby H/V/∥/⊥/tečně s náhledem | Zk L; Txt `úsečka x1 y1 x2 y2`; PT ukončí řetěz | zavření řetězu klikem na 1. bod (`:1256`) |
| Obdélník | rohem | 2 rohy | klik; u kurzoru `60 Tab 40` nebo `60;40` / `60x40` | Zk R; Txt `obdélník W H [v x y] / roh x y [zaoblení-rohů r]` | zaoblení rohů jen z panelu vlastností (`props.tsx:935`) |
| Kružnice | středem | střed + bod | klik; u kurzoru Ø (nebo R – přepínač Ø/R) | Zk C; Txt `kružnice D [v x y]` / `poloměr r` | |
| Oblouk 3 body | začátek, konec, bod | 3 body | klik; 2. krok Délka/Úhel, 3. krok Poloměr | Zk A | textový příkaz pro oblouk neexistuje (`agent.ts:468` ENTITY) |
| Lomená čára | polyline | ≥2 body | klik; Enter/dvojklik ukončí; klik na 1. bod uzavře | Zk K; Txt `čára x1 y1 … [uzavřít]` | |
| Osa | pomocná úsečka | 2 body | jako úsečka | Zk X | vzniká `construction: true` |
| Bod | bod | 1 bod | klik / X;Y | Zk B; Txt `bod x y` | |
| Obdélník ze středu | střed + roh | 2 body | klik; `šířka Tab výška` | – | |
| Kružnice 3 body | 3 body | 3 body | klik | – | bez číselného zadání kromě X;Y |
| Mnohoúhelník | N-úhelník | střed + vrchol/střed strany | klik; `poloměr Tab počet stran`; přepínač vepsaný/opsaný, počet stran (3–64) | Zk P; Txt `mnohoúhelník N D [v x y]` | |
| Oblouk středem | střed, začátek, konec | 3 body | klik; Poloměr, Úhel | – | |
| Tečný oblouk | navazuje na konec úsečky/oblouku | konec + koncový bod | klik na konec existující entity; Poloměr | – | |
| Drážka | 2 středy + šířka | 3 kroky | klik; Délka Tab Úhel, Šířka | Zk S; Txt `drážka L W [v x y] [úhel a]` | |
| Elipsa | střed, poloosy | 3 kroky | klik; Poloosa a / Úhel, Poloosa b | Zk E; Txt `elipsa rx ry` | |
| Spline | interpolační | ≥2 body | klik; Enter ukončí | Zk N | bez tečen (roadmap: nejde) |
| Obdélník 3 body | natočený | 2 rohy + výška | klik; Šířka/Úhel, Výška | – | |
| Kružnice 2 body | průměrem | 2 body | klik; Průměr | – | |
| Drážka obloukem | střed, začátek, konec osy, šířka | 4 kroky | klik; Poloměr osy, Úhel, Šířka | – | |

**Úpravy** (`sketcher.tsx:294–315`)

| Nástroj | Co dělá | Vstupy | Jak se zadávají | Alternativy | Poznámky |
| --- | --- | --- | --- | --- | --- |
| Oříznout | ořez úseku; tažením „výkonný ořez“ přes víc úseků | klik na úsek nebo tažení | myš | Zk T | kružnice potřebuje 2 průsečíky (`:1432`) |
| Odsadit | entita / řetězec; strana myší, vzdálenost z kurzoru nebo číslem | entita + strana | klik entity → klik strany nebo `d` + Enter; přepínač „Řetězec“ | Zk O; PT na entitě „Odsadit…“ | chyba „větší než poloměr oblouku“ (`:1402–1421`) |
| Prodloužit | prodloužení úsečky k nejbližší | klik u konce | myš | – | jen úsečky (`:1439`) |
| Rozdělit | úsečka/oblouk v bodě, kružnice 2 body | klik | myš se snapem | PT „Rozdělit v bodě…“ | tvary nejdřív rozložit |
| Promítnout hrany | hrany modelu do roviny skici | – | panel vpravo nahoře: jen v rovině / všechny, jako pomocná; tlačítko Promítnout | – | vloží pevné (plně určené) úsečky (`:2549`, `:2070`) |
| Zaoblit roh / Srazit roh | 2 úsečky + hodnota | 2 kliky | AskBox hodnota (výraz) | – | nahradí vazby rohu (`:1457–1500`) |
| Přesunout / Kopírovat | podle 2 bodů | výběr → Enter/PT → 2 body | klik; Délka Tab Úhel; Shift u kopie = opakovat | PT na výběru | fáze výběru → Enter (`:1525`) |
| Otočit / Měřítko | střed, ref. bod, cíl | 3 kliky | klik; Úhel / Měřítko číslem | PT | |
| Zrcadlit | podle úsečky | výběr + klik na osu | myš | PT | bez vazby symetrie (`:1542`) |
| Lineární / kruhové pole | kopie entit | výběr + krok/střed | klik; AskBox počet | – | |
| Rozložit | tvar → úsečky/oblouky | výběr | provede se hned | PT | |
| Pomocná geometrie | přepne construction | výběr | hned | PT; panel vlastností | |

**Vazby** (`sketcher.tsx:316`, 13 druhů): vodorovně, svisle, totožnost, rovnoběžně, kolmo, tečně, stejná velikost, soustředně, ve středu, bod na křivce, symetrie, kolineárně, pevně. Zadání: aktivní nástroj → klikání na entity/body podle nápovědy (`matchConstraint` `:462`), nebo nejdřív výběr a pak vazba (aplikuje se hned, `:996`), nebo PT na výběru (nabídne jen použitelné). H na výběru = vodorovně. Automatické vazby při kreslení (8 druhů s náhledem) lze vypnout („AV“). Stav určenosti barvami (modrá/černá/červená) a DOF v patičce (`sketch-solver.ts`). **Žádný textový příkaz pro vazby** (JSON `constraints` ano).

**Kóty** (`sketcher.tsx:320`): nástroj Kóta (D) – inteligentní: 1 úsečka = délka, kružnice = Ø, oblouk = R, 2 úsečky = úhel/vzdálenost, 2 body = vodorovná/svislá/šikmá podle polohy kurzoru, bod + úsečka = vzdálenost (`dimFromPicks` `:1604`); umístění klikem, pak AskBox s hodnotou (výraz). Kóta délky oblouku přes PT. D nad vybranou entitou = kóta hned (`:2040`). Dvojklik / PT „Upravit hodnotu“, přepnutí řídicí/referenční; přeurčení → zůstane referenční (`:1026`). Popisek kóty lze tahat. **Bez textového příkazu**; JSON `dims`.

**Nástroje a uchopení** (`sketcher.tsx:322–331`, `:153–180`)

| Nástroj | Co dělá | Zadání | Alternativy |
| --- | --- | --- | --- |
| Měřit | bod (X, Y), úsečka (délka, úhel), kružnice (R, Ø, obvod, střed), 2 body, 2 úsečky (úhel, vzdálenost rovnoběžných), bod–entita, 2 kružnice | klik na 1–2 entity, panel vpravo nahoře | Zk M |
| Přichytit k mřížce | krok mřížky automaticky / z Nastavení | přepínač | Zk G; PT do prázdna |
| Export skici DXF / Import DXF… | DXF ↔ entity skici | tlačítko / souborový dialog | – |
| Uchopení: Koncový bod, Střed úsečky, Střed křivky, Kvadrant, Průsečík, Na křivce, Kolmo, Tečně, Počátek | OSNAP jako v ZW3D, s glyfem a popiskem u kurzoru | přepínače v pásu, v liště skicáře a v PT do prázdna; uloženo v localStorage | – |
| Zarovnání (vodítka), Automatické vazby | odvozené H/V/∥/⊥/tečně a vazby při kreslení | přepínače | – |
| Kóty (Kótovat při kreslení), Ø/R, Vepsaný/Opsaný, počet stran, Řetězec | volby kreslení pro aktuální nástroj | lišta skicáře (`:2517–2545`) | – |

Panel vlastností entity (pravý panel, `props.tsx:874`): souřadnice bodů, délka/úhel úsečky, průměr, rozměry obdélníku, počet stran, rozměr přes plochy atd. – každá entita jde dodatečně zadat číselně.

### 3.2 Tvorba (`cad-app.tsx:2230–2311` + rozšíření `ext/advanced.ts`)

| Nástroj | Co dělá | Povinné vstupy | Jak se zadávají | Alternativy | Poznámky a omezení |
| --- | --- | --- | --- | --- | --- |
| Skica ▼ | nová skica na rovině | rovina | nabídka 11 položek (viz 3.1); plocha klikem (`planePick`); odsazení přes `window.prompt`; 3 body / 2 plochy / 1 plocha vyžadují předchozí výběr s filtrem | Zk S (XY); Txt `skica XY…`; PT na ploše „Nová skica na ploše“ | položky „Rovnoběžně“, „Střední“, „3 body“ jsou disabled bez správného výběru (`:2177–2179`) |
| Vysunout | vysune skicu | skica, ukončení | select skici (výchozí poslední), ExtentField (8 druhů, odkaz na vrchol/plochu), Opačný směr, Druhý směr (vlastní ukončení), Začátek (4), Směr (8), Tenká stěna, Úkos (±44°), Kroucení, Měřítko konce, Jen vnější obrys, Operace | Zk E; Txt `vysunout H [symetricky] [skrz] [odebrat…] [obráceně] [úkos a]`; JSON `extrude` | bez skici hlásí „Nejdřív nakreslete skicu“ (`:1610`); úkos jen kolmo a bez tenké stěny (`build.ts:474–476`) |
| Rotovat | rotace skici | skica, osa, úhel | select skici, AxisField (10 druhů), Úhel (≤360), Směr: jeden / střední rovina / dva (Úhel 2), Tenká stěna, Operace | Txt `rotovat [úhel] [osa X|Y|Z]`; JSON `revolve` | textově jen globální osy X/Y/Z nebo osa Y skici |
| Tažení | profil po dráze | profil (skica nebo kruh Ø), dráha | selecty skic, Orientace (dráha/Frenet/pevná), rozbalit: vodicí křivka, kroucení (°/otáčky), měřítko konce, přechod v rozích, tenká stěna, Operace | JSON `sweep` | potřebuje 2 skici (`:1613`); profil kolmo na začátek dráhy; chyby `feat/sweep-loft.ts:243–251` |
| Šablonovat | mezi profily | ≥2 skici (nebo 1 + bod) | seřaditelný seznam skic, Přímkové, Uzavřené, Začátek/Konec v bodě (RefField) nebo okrajová podmínka (kolmo/směr + délka), osová a vodicí křivka, tenká stěna | JSON `loft` | kombinace bod × uzavřené × osová křivka zakázané (`feat/sweep-loft.ts:300–333`) |
| Text | reliéf/gravírování | text, výška, hloubka | textové pole (max 120 zn.), Num, Gravírovat/Vystoupit, PlaneDefField nebo základní rovina + odsazení, střed odkazem (RefField bod) nebo Vec, natočení | Txt `text "ABC" výška H hloubka D v x y [z] [gravírovat]`; JSON `text` | písmo se stahuje ze sítě (`build.ts:316`) |
| Kvádr | primitivum | rozměry X×Y×Z | Vec s vazbami; poloha odkazem (RefField bod, 14 voleb) nebo čísly; střed/roh; osa Z libovolným směrem (DirectionField); Operace | Txt `kvádr X Y Z [střed] [v x y z] [odebrat]`; JSON `box` | textově nelze polohu odkazem ani obecný směr |
| Válec | primitivum | Ø, výška | Num ×2, osa X/Y/Z nebo směr, poloha odkazem/čísly, Operace | Txt `válec D H [osa] [v x y z]`; JSON `cylinder` | |
| Trubka | primitivum | Ø vnější, Ø vnitřní, délka | Num ×3, osa/směr, poloha, Operace | Txt `trubka D d H [osa]`; JSON `tube` | Ø vnější > vnitřní (`build.ts:620`) |
| Kužel | primitivum | Ø dole, Ø nahoře, výška | Num ×3, osa/směr, poloha, Operace | Txt `kužel D1 D2 H [osa]`; JSON `cone` | |
| Koule | primitivum | Ø | Num, střed odkazem/čísly, Operace | Txt `koule D [v x y z]`; JSON `sphere` | |
| Díra | průvodce dírou | průměr, poloha | Typ (vrtaná / válc. zahl. / kuž. zahl. / závit), Pro šroub (select ISO 273 + řada jemná/střední/hrubá), závit select + text („M18×1,5“), hloubka závitu, Ukončení (4), úhel špičky, Bod na povrchu (Vec) **nebo** Polohy děr (RefListField, více naráz), Osa díry (DirectionField), Vrtat v kladném směru. Klik na plochu v modelu doplní bod i osu (`:1779`) | Zk H; Txt `díra D [hloubka H|skrz] v x y [z] [osa] [zahloubení D2 H2] [kuželové D2] [závit M8]` (bez z = na povrch podle sítě); JSON `hole` | chyby zahloubení/hloubky `build.ts:336–353`; toFace vyžaduje rovinnou plochu (`:391`) |
| Závit | kosmetický / modelovaný | označení, délka, poloha | select M2–M48 + text, vnitřní, délka, osa / směr, začátek odkazem nebo čísly, modelovat | Txt `závit M18×1,5 délka L [v x y z] [osa] [vnitřní] [modelovat]`; JSON `thread` | modelované drážky „bez stoupání“; skutečná šroubovice = Plochy → Tažení po šroubovici |
| Rozříznout | odřízne stranu roviny | rovina | PlaneDefField (12) nebo základní rovina + poloha; Ponechat ±/normála | JSON `split` | bez textového příkazu; `faceRef` (řez plochou) v typu existuje, ve formuláři není (`types.ts:164`, `props.tsx:596`) |
| Žebro | z otevřené skici | skica, tloušťka | select, Num, směr kolmo/v rovině, obrátit | JSON `rib` | |
| Pružina | šroubovice s drátem | Ø, drát, stoupání, závity | Num ×4, osa/směr, poloha odkazem/čísly, Operace | JSON `spring` | |
| Zaoblit | hrany | hrany + R | Druh: konstantní / R1→R2 / tabulka (R na hranu) / plocha–plocha (2× RefListField) / plný (3× RefListField); hrany klikem v modelu nebo „Všechny“; tečné řetězení. S předvybranými hranami vznikne prvek rovnou s nimi | Zk B (jen bez výběru); Txt `zaoblit R [hrany pravidlo] [poloměr N] [delší N] [kratší N]`; PT na hraně; JSON `fillet` | hrany nelze vybrat ze seznamu ani odkazem (jen indexy `edges`); „Vyberte hrany v modelu“ (`feat/fillet.ts:76`) |
| Srazit | hrany | hrany + D | Druh: stejné / D1×D2 / D×úhel (+ referenční plocha RefField) / vrchol (3 vzdálenosti + vrcholy RefListField) | Zk N; Txt `srazit C [hrany …]`; PT; JSON `chamfer` | referenční plocha musí sousedit se všemi hranami (`feat/fillet.ts:270`) |
| Úkos | naklopení ploch | plochy, úhel | Num (±44°), neutrální rovina PlaneDefField nebo základní, směr tahu DirectionField, tečné řetězení; plochy klikem | PT na ploše; JSON `draft` | plochy jen klikem; dělicí křivka a stupňovitý úkos chybí (formulář to píše, `pattern-form.tsx:342`) |
| Skořepina | vydlabání | tloušťka, otevřené plochy | Num, Zesílit ven, plochy klikem, jiná tloušťka vybraných stěn (RefField plocha) | Txt `skořepina T [otevřít pravidlo]`; PT; JSON `shell` | OCCT neotevře zaoblené plochy (`build.ts:697`) |
| Vytáhnout / Zatlačit | posun rovinných ploch | plochy, vzdálenost | Ukončení (na vzdálenost / k vrcholu / k ploše / odsazeně) + RefField; plochy klikem | PT „Vytáhnout / Zatlačit“; JSON `pushPull` | jen rovinné plochy (`feat/refs-more.ts:242`) |
| Odsadit plochu | offset ploch | plochy, vzdálenost | Num (± ven/dovnitř); plochy klikem | PT; JSON `offsetFace` | funguje i na zakřivené |
| Odstranit plochu | zacelí těleso | plochy | plochy klikem | PT; Del na vybrané ploše (`:1690`); JSON `deleteFace` | |
| Zesílit | plochy → skořepina | plochy, tloušťka | Num, Operace; plochy klikem | PT; JSON `thicken` | |
| Barva plochy ▼ | vzhled | vybrané plochy | nabídka 5 barev + výchozí | PT na ploše | disabled bez výběru |
| Pole | opakování prvků | zdroj, druh | zaškrtávací seznam zdrojů; Lineární (počet, rozteč/celková délka, směr čísly nebo odkazem, 2. směr, střídavé, mřížka vynechání klikem), Kruhové (počet, úhel, rovnoměrně, symetricky, natáčet, osa čísly nebo AxisField, vynechat kusy čipy), Po křivce (skica, rozteč, natočení), Podle skici (body), Výplň (obrys, rozložení, rozteč, okraj); Pokročilé: jedna booleovská operace | Txt `pole N rozteč P [směr] [N2 rozteč P2 směr Y]`, `pole kruhové N [úhel] [osa] [v cx cy cz]`; JSON `pattern` | tlačítko vyžaduje existující tvarový prvek (`:1625`); max. 400 kusů (`feat/pattern.ts:67`); textově jen lineární/kruhové |
| Zrcadlit | těleso podle roviny | rovina | PlaneDefField nebo základní + posun; ponechat originál | Txt `zrcadlit XY|XZ|YZ [odsazení N]`; JSON `mirror` | `featureIds` v typu, ve formuláři ne (zrcadlení prvků řeší ext „Zrcadlit prvky“) |
| Přesunout / otočit | transformace tělesa | – | gizmo (posun 1 mm, otočení 15°, R přepíná) + formulář: posunutí Vec, z bodu do bodu (2× RefField), otočení + měřítko, osa AxisDefField nebo globální, střed odkazem | PT na tělese; JSON `transform` | otočení kolem obecné osy gizmem nelze uložit (`:1420`) |
| Smazat | prvek / plocha / komponenta / těleso | výběr | Del | Zk Del/Backspace; Txt `smazat poslední` (jen poslední prvek) | potvrzení podle Nastavení (`:1667`) |
| Rovina | pomocná rovina | definice | PlaneDefField (12) + počátek / normála / tlačítka ⟂X ⟂Y ⟂Z, velikost zobrazení | JSON `datum` | bez textového příkazu |
| Osa | pomocná osa | definice | AxisDefField (7 bez os skici), délka zobrazení, živý popis vyřešené osy | JSON `datumAxis` | datum musí být v historii před použitím (`feat/refs-more.ts:42`) |
| Bod | pomocný bod | odkaz | RefField bod (14 voleb) | JSON `datumPoint` | |
| Souř. systém | CSYS | počátek, osa Z, osa X | RefField + 2× DirectionField, velikost | JSON `csys` | osa X se ortogonalizuje (`ref-resolve.ts:146`) |
| Normálie | knihovna | textový dotaz / parametry | viz 3.10 | Zk Ctrl+L | |

**Rozšíření na kartě Tvorba** (`ext/advanced.ts`; formulář automaticky z `params`, plochy/hrany jen klikem v modelu, u prvků s `pick` se model zobrazí před prvkem). Žádný z nich nemá textový příkaz – jen JSON `{ "type": "ext", "ext": "adv.…", "data": {…} }`.

| Skupina | Nástroj | Vstupy a zadání | Kód | Poznámky |
| --- | --- | --- | --- | --- |
| Pokročilé úpravy | Proměnné zaoblení | hrany klik, R1, R2 (Num) | `advanced.ts:107` | duplikuje R1→R2 vestavěného zaoblení |
| Pokročilé úpravy | Plné zaoblení | střední plocha klik, podíl šířky 0,5–0,995 | `:143` | duplikuje „Plný“ vestavěného zaoblení |
| Pokročilé úpravy | Zaoblení řetězce | výchozí hrany klik, R, tolerance tečnosti 0–45°, srazit místo zaoblit | `:203` | |
| Pokročilé úpravy | Sražení D1×D2 / D×úhel | hrany klik, zadání (Seg), D1, D2, úhel 1–89° | `:232` | duplikuje vestavěné sražení |
| Pokročilé úpravy | Úkos od dělicí roviny | úhel 0,1–45°, rovina XY/XZ/YZ (enum), odsazení, obrátit | `:644` | rovina jen základní, bez PlaneDefField |
| Pole a kopie | Zrcadlit prvky | vlastní formulář: všechny / zaškrtnout prvky, rovina XY/XZ/YZ, odsazení `<input type=number>` | `:286`, `advanced-ui.tsx:68` | odsazení nepřijímá výrazy ani proměnné |
| Pole a kopie | Pole podél křivky | prvek (select), dráha (skica), počet 1–500, rozteč (0 = rovnoměrně), natáčet | `:320` | duplikuje druh „Po křivce“ vestavěného pole |
| Pole a kopie | Výplňové pole | prvek, oblast (skica), dx, dy, odstup, střídavě | `:370` | duplikuje druh „Výplň“ |
| Pole a kopie | Měřítko v bodě | faktor, kolem těžiště (bool), bod Vec | `:778` | bod jen čísly |
| Pole a kopie | Znovu použít nástroj | prvek (select), operace, posun Vec | `:855` | |
| Pokročilé tvary | Zkrut | skica, výška, úhel zkrutu | `:449` | |
| Pokročilé tvary | Kopule | rovinná plocha klik, výška, poloměr (0 = vepsaný) | `:479` | |
| Pokročilé tvary | Text na válci | válcová plocha klik, text, výška, hloubka, směr (po obvodu / podél osy), natočení, posun, operace | `:563` | |
| Pokročilé tvary | Lem / drážka | rovinná plocha klik, druh, šířka, hloubka, odstup | `:692` | |
| Pokročilé tvary | Díry v bodech | skica s body/kružnicemi, Ø, hloubka (0 = skrz), zahloubení Ø/hloubka, obrátit | `:803` | duplikuje `hole.points` / pole „Podle skici“ |

### 3.3 Plochy (`ext/surface.ts:271–953`; karta se zobrazí jen u dílu)

| Skupina | Nástroj | Vstupy (automatický formulář) | Kód | Poznámky a omezení |
| --- | --- | --- | --- | --- |
| Plochy | Plošné vysunutí | skica (i otevřená), vzdálenost, symetricky | `surface.ts:271` | bez směru/ukončení odkazem (na rozdíl od objemového vysunutí) |
| Plochy | Plošná rotace | skica, úhel 0,1–360, osa X/Y skici (enum) | `:307` | osa jen ve skice |
| Plochy | Rovinná plocha | uzavřená skica | `:333` | |
| Plochy | Tažení plochy | profil (skica), dráha (skica), Frenet | `:347` | |
| Plochy | Šablonování ploch | skici (zaškrtávací seznam), přímkové | `:373` | pořadí = pořadí v historii, nelze přeskládat |
| Úpravy ploch | Odsazená plocha | plochy klik (nic = všechny volné), vzdálenost | `:399` | „Tuto plochu se nepodařilo odsadit“ (`:427`) |
| Úpravy ploch | Prodloužit plochu | plochy klik, délka | `:437` | zakřivené plochy jiného typu nelze (`:482`) |
| Úpravy ploch | Oříznout rovinou | rovina XY/XZ/YZ, odsazení, strana ± | `:493` | rovina jen základní |
| Úpravy ploch | Oříznout skicou | uzavřená skica, vnitřek/vnějšek | `:519` | |
| Úpravy ploch | Sešít plochy | tolerance | `:550` | |
| Úpravy ploch | Záplata z hran | hrany klik (uzavřená smyčka) | `:694` | „netvoří souvislou uzavřenou smyčku“ (`:250`) |
| Těleso ↔ plocha | Uzavřít do tělesa | tolerance sešití, operace | `:568` | více skořepin → nejdřív sešít (`:78`) |
| Těleso ↔ plocha | Zesílit plochu | tloušťka, strana (po/proti normále), operace | `:604` | |
| Těleso ↔ plocha | Rozdělit těleso | rovina XY/XZ/YZ, odsazení, ponechat obě/+/− | `:643` | jediná GUI cesta k více tělesům |
| Těleso ↔ plocha | Nahradit plochu (posun) | plochy klik, posun | `:670` | |
| Křivky | Křivka průniku | rovina, odsazení | `:729` | |
| Křivky | Promítnout skicu na plochu | skica, cílové plochy klik | `:760` | |
| Křivky | Šroubovice | R, stoupání, závity, střed začátku Vec | `:805` | střed jen čísly |
| Křivky | Tažení po šroubovici | profil (kruh / závit 60° / skica), Ø drátu, hloubka závitu, vnější/vnitřní, náběh, skica profilu, R, stoupání, závity (≤200), střed Vec, osa, levotočivá, operace | `:833` | JSON příklad matice v `agent-guide.ts` („Závity“) |

### 3.4 Plech (`ext/sheetmetal.ts`)

| Skupina | Nástroj | Vstupy | Kód | Poznámky a omezení |
| --- | --- | --- | --- | --- |
| Plech | Parametry plechu | tloušťka t, vnitřní R ohybu, K-faktor 0–1 | `sheetmetal.ts:126` | prvek bez geometrie, platí pro další prvky |
| Plech | Základní plech | uzavřená skica, směr tloušťky (nad / pod / symetricky) | `:140` | „Skica obrysu plechu musí být uzavřená“ (`:163`) |
| Plech | Výřez | uzavřená skica na ploše plechu | `:366` | vyžaduje Základní plech (`:381`) |
| Plech | Rohová úleva | střed Vec, tvar kruhová/čtvercová, velikost, osa X/Y/Z | `:394` | střed jen čísly (bez RefField) |
| Plech | Prolis (žebro) | skica s osou (úsečka), šířka, výška | `:430` | osa musí ležet na ploše plechu (`:463`) |
| Ohyby | Ohyb z hrany | hrany klik (rovné hrany obrysu), délka, úhel 1–180°, R (0 = dle parametrů), obrátit, poloha materiálu (ohyb vně / materiál uvnitř), úleva (žádná/obdélník/oválná) + šířka/hloubka | `:247`, vlastní formulář `sheetmetal-ui.tsx:39` | formulář ukládá geometrii hran pro rozvin; popisek zkratky Shift+F není obsloužen |
| Ohyby | Lem | hrany klik, délka, typ (otevřený/uzavřený/kapka), R, obrátit | `:265` | |
| Ohyby | Ohyb podle čáry | skica s úsečkou, úhel 1–179°, R, ohýbaná strana (vlevo/vpravo), směr (k/od normály) | `:287` | čára musí procházet materiálem (`:327`, `:345`) |
| Rozvin | Rozvinout | bez parametrů | `:482` | plochý díl z historie ohybů; potlačením se vrátí ohnutý tvar |
| Rozvin | Rozvin → DXF / → SVG | akce bez prvku (tlačítko) | `:532–533`, `sheetmetal-ui.tsx:121–136` | obrys, díry, čáry ohybů, tabulka ohybů |
| Rozvin | Tabulka ohybů | akce → modal s textem | `:534` | |

### 3.5 Svařence (`ext/weld.ts`)

| Skupina | Nástroj | Vstupy | Kód | Poznámky a omezení |
| --- | --- | --- | --- | --- |
| Konstrukce | Konstrukční profil | vlastní formulář: skica s úsečkami (osy), profil jäkl čtv./obd., trubka, L, UPN, IPE, HEB, plochá, kulatina, čtyřhran + rozměry nebo velikost z tabulky, zarovnání (9 poloh), natočení, spoj v rohu (pokos/tupý/žádný), mezera, prodloužení začátku/konce, samostatná tělesa, operace | `weld.ts:128`, `weld-ui.tsx:75` | oblouky ve skice se ignorují (`weld.ts:159`); zkratka Shift+W jen popisek |
| Konstrukce | Rám z profilů | profil + rozměry X/Y/Z, rohy obdélníků, operace | `:174`, `weld-ui.tsx` FrameForm | |
| Konstrukce | Deska | rovina XY/XZ/YZ, odsazení, střed X/Y, šířka, výška, tloušťka, obrátit, díry v řadě/sloupci, Ø díry, odstup, operace | `:211` | rovina jen základní; střed jen čísly |
| Spoje | Ořezat rovinou | rovina, odsazení, ponechat stranu | `:266` | |
| Spoje | Víčko | čelní plochy klik, tloušťka, zmenšení od obrysu, R rohů, zapustit dovnitř | `:296` | jen rovinné čelní plochy (`:329`) |
| Spoje | Styčník | přesně 2 vnitřní plochy klik, ramena 1/2, tloušťka, sražení špiček | `:357` | „Vyberte přesně dvě rovinné plochy“ (`:381`) |
| Svary | Svarová housenka | hrany koutu klik (vnitřní, rovné), velikost a, přerušovaný (úsek, rozteč); vlastní formulář ukládá délky hran | `:425`, `weld-ui.tsx` BeadForm | jen rovná vnitřní hrana (`:455`, `:470`) |
| Svary | Značka svaru | typ, velikost, délka, rozteč, po obvodu, montážní, druhá strana, poznámka | `:488` | záznam k dílu bez vazby na hranu |
| Výstupy | Kusovník řezů | akce → modal + CSV | `:513` | |
| Výstupy | Tabulka svarů | akce → modal | `:514` | |

### 3.6 Nástroje (`cad-app.tsx:2392–2419` + `ext/advanced.ts:899–948`)

| Nástroj | Co dělá | Zadání | Alternativy | Poznámky |
| --- | --- | --- | --- | --- |
| Měřit | vzdálenost/úhel/poloměr mezi 1–2 entitami | plovoucí panel s filtrem (Vše/Bod/Hrana/Plocha/Těleso), klik na entity, uchopovací body na hranách, kopírování výsledků | Zk M; PT „Měřit“ na entitě (`:1443`) | ve skice vlastní měření (M) |
| Vlastnosti | inspektor vybrané entity | panel vpravo dole po kliknutí | PT „Vlastnosti“ | |
| Filtr ▼ | filtr výběru | nabídka, patička (select), PT do prázdna | – | |
| Hmotnost | objem, plocha, hmotnost, materiál + označení do razítka | modal; select materiálu, text | Txt `materiál …` nastaví třídu/označení | |
| Řez | řezná rovina X/Y/Z posuvníkem | panel: osa, range, otočit stranu | Zk X; PT „Řez“ | poloha jen posuvníkem (bez číselného pole) |
| Proměnné / Stavy dílu | otevře levý panel | – | – | jen přepnutí panelu |
| Formařské nástroje | plovoucí panel: Úkosy (barevná mapa, směr X/Y/Z, min. úkos, obrátit, dělicí rovina), Plochy (zebra, křivost, tloušťka stěn + limit), Smrštění (select materiálu / vlastní %), Vyhazovače (díry do dílu / vyhazovače do sestavy), Chlazení (Ø, hloubka, větve, přesah; vrtat do dílu / vložit do sestavy) | Num / Segmented / radio | – | směr vyhození jen osy X/Y/Z (`mold-panel.tsx:79`) |
| Kontrola geometrie | prvek v historii (BRepCheck) | bool „kontrolovat i plochy“ | JSON `ext adv.check` | chyby se zobrazí u prvku |
| Sjednotit plochy | prvek bez parametrů | – | JSON `ext adv.simplify` | |
| Tloušťka stěn | akce: vzorkování sítě, výsledek v modalu | – | – | |

### 3.7 Zobrazení (`cad-app.tsx:2420–2476`)

| Skupina | Nástroje | Zadání | Alternativy |
| --- | --- | --- | --- |
| Pohledy | Izometrie, Přední, Horní, Pravý, Zadní, Spodní, Levý | jeden klik | Zk 0–6; Txt `zobraz iso|přední|horní|…` (`agent.ts:442`); PT do prázdna (iso/přední/horní/pravý); ViewCube (`viewport.tsx:1543`) |
| Styl zobrazení | Stínovaný s hranami, Stínovaný, Drátový, Skryté hrany, Průhledný | jeden klik | PT do prázdna (3 z 5) |
| Kamera | Přizpůsobit, Perspektiva, Pravoúhlá, Mřížka a osy | jeden klik | Zk F, P |
| Vzhled | Barva tělesa ▼ (8 barev), Pozadí ▼ (4), Ovládání myši ▼ (ZW3D / SolidWorks / touchpad) | nabídka | Txt `barva #hex`; PT na tělese/ploše/komponentě (COLOR_MENU `:1438`) |

### 3.8 Výkres (`cad-app.tsx:2477`, prostředí `drawing-workspace.tsx`)

Karta má jediné tlačítko **Nový výkres** (disabled bez tělesa) – otevře se nová záložka. Ve výkresovém prostředí:

| Nástroj | Co dělá | Zadání | Zkratka | Poznámky |
| --- | --- | --- | --- | --- |
| Kóta | 2 body + umístění kótovací čáry; druh auto/šikmá/vodorovná/svislá (Seg) | klik na geometrii s přichycením k vrcholům do 10 px (`:375`), 3. klik odsazení | D | nelze vybrat hranu/kružnici jako celek, ani zadat hodnotu/odsazení číslem; přípona (H8, ±0,1) textem v seznamu (`:673`) |
| Poznámka | odkazová čára + text | 2 kliky → formulář u kurzoru (text) | N | |
| Drsnost | značka Ra | 1 klik → formulář (Ra 3,2) | R | |
| Geom. tolerance | rámeček ISO 1101 | 2 kliky → select charakteristiky, tolerance, základna | G | |
| Základna | A, B, C… | 1 klik, písmeno automaticky | B | |
| Text | volný text listu | 1 klik → text + výška | T | |
| Detail | detailní pohled | střed, poloměr, umístění; měřítko select v seznamu | L | |
| Listy | více listů, přejmenování | dvojklik → `window.prompt` (`:567`) | – | |
| Volby listu | formát, orientace, měřítko, ISO E/A, pohledy (7 zaškrtávátek), řez A–A (rovina + poloha Num), skryté hrany, osy, kóty žádné/celkové/auto, kusovník, balónky, tabulka děr, detaily | selecty / Seg / Check / NumInput | – | přední pohled nelze vypnout |
| Razítko / revize | název, číslo, kreslil, revize, datum, tolerance, hrany, poznámka, materiál; tabulka revizí; „Doplnit obvyklé“ | textová pole | – | číslo/autor/revize se ukládají do dokumentu (`:251`) |
| Kontrola kót | porovná kóty na listu s historií prvků | tlačítko | – | `dim-check.ts` |
| Export | PDF, DWG (verze select R2000–R2018+), DXF R12, SVG, Kusovník CSV, Tisk, Sdílet | tlačítka v hlavičce | Esc zavře | ukládání přes systémový dialog (lze vypnout v Nastavení → Soubory) |

Vše je jen myší + formuláře; výkres nemá textové příkazy ani JSON vstup v konzoli (anotace jsou v `doc.drawings` – `types.ts:340`, takže `setDocument` je umí nahrát).

### 3.9 Data (`cad-app.tsx:2480–2517`)

| Nástroj | Co dělá | Zadání | Alternativy |
| --- | --- | --- | --- |
| Nastavení | 7 záložek (Obecné, Zobrazení, Myš a ovládání, Skica, Výkres, Soubory, Klávesové zkratky), export/import JSON | dialog | Ctrl+, (`settings-dialog.tsx:50`) |
| Paleta příkazů | fuzzy hledání | dialog | Ctrl+K |
| Úvodní obrazovka | nový díl / sestava / výkres, nedávné, ukázky | dialog | nabídka Soubor |
| Otevřít / Import | STEP, IGES, BREP, STL, OBJ, 3MF, glTF, PLY, OFF, DXF, .mncad | souborový dialog | Ctrl+O; drag & drop; v sestavě → komponenta |
| Uložit projekt | .mncad; první uložení se ptá, další do téhož souboru (File System Access) | dialog | Ctrl+S (`:1818–1835`) |
| Uložit jako… | nový soubor | dialog | nabídka Soubor |
| Export ▼ | STEP, BREP, STL, 3MF, OBJ, GLB, WRL | nabídka → dialog uložení | `window.mncad.exportFile()` bez dialogu (`:70` EXPORTS) |
| Sestava ▼ | nová prázdná, z aktuálního dílu, rám vstřikovací formy | nabídka | Txt `nová sestava` |
| Ukázkové díly ▼ | 6 ukázek (příruba, hřídel, úhelník, madlo, čep M20, přechodový kus) | nabídka | úvodní obrazovka (`defaults.ts:475`) |
| Sdílet odkazem (titulní lišta / Soubor) | platnost (dny / bez omezení), heslo, odesílatel, režim odkaz / šifrované úložiště | dialog | – (`share-dialog.tsx:22–31`) |
| Poptat výrobu | STEP + e-mail | tlačítko | `:1924` |

Textově: `nový díl`, `nová sestava`, `název`, `materiál`, `barva`, `stav`, `smazat poslední`.

### 3.10 Knihovna normálií (`library-dialog.tsx`, `cad/library/*`)

Textové pole přijímá označení („M8x30“, „matice M10“, „ložisko 6205 2RS“, „IPE 200 L=1500“, „jäkl 40x40x3“, „pero 8x7x40“, „pružina d1.6 D12 L40 n10“) – každá rodina má vlastní parser (`parse-util.ts`: normalizace, čísla, `a x b x c`, `M8`, `L=`, `z24`), nejlepší shoda ≥ 0,3 se převezme (`library-dialog.tsx:56`); dále kategorie (13 skupin), oblíbené, nedávné, parametry (Num/select/toggle), tabulka rozměrů klikem, živý náhled s hmotností; Enter vloží. Vložit jako nový díl (nový tab) nebo do sestavy. Paleta Ctrl+K předává dotaz jako `initialQuery` (`cad-app.tsx:3469`). Bez textového příkazu v konzoli (není v `AGENT_COMMANDS`), ačkoli `makeFromText` existuje (`library/index.ts:92`).

### 3.11 Sestava (`cad-app.tsx:2312–2381`, `asm-panel.tsx`)

| Nástroj | Co dělá | Zadání | Alternativy | Poznámky |
| --- | --- | --- | --- | --- |
| Vložit díl / model | .mncad nebo STEP… jako komponenta | souborový dialog / drag&drop | Ctrl+O | importovaný soubor nelze upravovat historií (`:946`) |
| Knihovna normálií | vložit normálii | viz 3.10 | Ctrl+L | |
| Nový díl | prázdný díl + úprava v kontextu | hned | – | |
| Šroub ISO 4762 ▼ / Vodicí sloupek ▼ / Pouzdro ▼ / Vyhazovač ▼ / Středicí kroužek | rychlé normálie | pevné nabídky velikostí (M6–M16 × 20/40/60, Ø16–40, Ø3–10) | – | bez vlastních rozměrů (ty přes knihovnu) |
| Přesunout / otočit | gizmo komponenty | šipky/oblouky, R přepíná | Zk G; PT | ukotvená komponenta odmítne (`:1377`) |
| Odebrat | smazat komponenty | výběr (Ctrl+klik) | Del; PT | |
| Podsestava ▼ | vytvořit z vybraných / rozpustit / otevřít | výběr komponent filtrem Komponenta | PT | |
| Rám formy | průvodce: velikost (9 předvoleb), 11 rozměrů Num, dutina, materiál | modal | nabídka Soubor | `asm-panel.tsx:419` |
| Kontakt / Zarovnat / Vystředit (pás) + Souosost / Vzdálenost / Úhel / Rovnoběžně (pravý panel) | trvalé vazby | vybrat komponentu → typ → klik na plochu pohyblivé komponenty → klik na plochu cíle; hodnota vzdálenosti/úhlu Num v panelu; seznam vazeb: flip, potlačit, smazat, přepočítat | PT „Vazba Kontakt…“; JSON `mates` | jen rovinné / válcové plochy (`:1059–1061`); plochu nelze vybrat ze stromu ani ze seznamu |
| Pole komponenty / Zrcadlení komponenty | kopie komponent | pravý panel: lineární (počet, rozteč, směr Vec) / kruhové (počet, úhel, osa, střed Vec); rovina XY/XZ/YZ + odsazení | – | směr/osa jen čísly; zrcadlení nemění geometrii dílu |
| Šroubový spoj do díry | šroub + podložka (+ matice) | checkboxy → klik na válcovou plochu díry; závit podle Ø (ISO 273), délka automaticky, vazba Souosost | – | `:1097` |
| Poloha / Natočení | přesná poloha komponenty | Vec + tlačítka +90° | – | bez odkazu na geometrii (vazby to řeší) |
| Kolize | kontrola průniků | tlačítko; výsledek v panelu a stavu | Txt `kolize` | |
| Kusovník | tabulka plochá/strukturovaná, CSV, výkres s kusovníkem | modal | – | |
| Rozložit | rozložený pohled | posuvník 0–300 % | – | |
| Strom (levý panel) | skupiny, skrýt, ukotvit, přejmenovat; PT nabídka komponenty | – | – | |

### 3.12 Textové příkazy – mapování na nástroje (`agent.ts:726–752`, parser `:208–466`)

| Příkaz (česky; anglické synonymum v `SYN`, `agent.ts:70–143`) | Nástroj GUI | Co textem nejde zadat |
| --- | --- | --- |
| `nový díl [název]` / `nová sestava [název]` | Data → Nový / Sestava | – |
| `název …`, `materiál …`, `barva #hex` | záložka, Hmotnost, Zobrazení | materiál: známá třída → hustota, jinak označení do razítka (`:275–277`) |
| `kvádr X Y Z [střed] [v x y z] [odebrat|průnik|nové]` | Kvádr | poloha odkazem, směr osy, název (`název` jde přes `name` volbu) |
| `válec D H [osa X|Y|Z] [v x y z] [odebrat]` | Válec | poloha odkazem, obecný směr |
| `koule D [v x y z]` · `kužel D1 D2 H [osa]` · `trubka D d H [osa]` | Koule / Kužel / Trubka | dtto |
| `skica XY|XZ|YZ [odsazení N]: entita; …` | Skica ▼ | rovina na ploše, `planeDef`, pojmenování roviny |
| `obdélník W H [v x y] / roh x y [zaoblení-rohů r] [úhel a]` | Obdélník | – |
| `kružnice D [v x y]` / `kružnice poloměr r` | Kružnice | – |
| `mnohoúhelník N D [v x y] [úhel a]` · `drážka L W [v x y] [úhel a]` | Mnohoúhelník / Drážka | – |
| `úsečka x1 y1 x2 y2` · `čára x1 y1 … [uzavřít]` · `bod x y` · `elipsa rx ry [v x y]` · předpona `pomocná` | Úsečka / Lomená / Bod / Elipsa / Osa | oblouk, spline, vazby, kóty |
| `vysunout H [symetricky] [skrz] [odebrat|přidat|průnik|nové] [obráceně] [úkos a]` | Vysunout | ukončení k ploše/vrcholu/k dalšímu, začátek, směr, tenká stěna, 2. směr, kroucení |
| `rotovat [úhel] [osa X|Y|Z]` | Rotovat | osa hranou/válcem/2 body, 2 směry, tenká stěna |
| `díra D [hloubka H|skrz] v x y [z] [osa] [zahloubení D2 H2] [kuželové D2 [úhel]] [závit M8] [obráceně]` | Díra | více poloh, poloha odkazem, ukončení k ploše, řada ISO 273, úhel špičky |
| `závit M18×1,5 délka L [v x y z] [osa] [vnitřní] [modelovat]` | Závit | poloha odkazem, směr |
| `zaoblit R [hrany pravidlo…] [poloměr N] [delší N] [kratší N]` | Zaoblit | R1→R2, tabulka, plocha–plocha, plný; indexy hran (jen JSON) |
| `srazit C [hrany …]` | Srazit | D1×D2, D×úhel, vrchol |
| `skořepina T [otevřít pravidlo…]` | Skořepina | zesílit ven, jiná tloušťka stěn |
| `pole N rozteč P [směr X|Y|Z|dx dy dz] [N2 rozteč P2 směr …]` · `pole kruhové N [úhel 360] [osa Z] [v cx cy cz]` | Pole | po křivce, podle skici, výplň, vynechané kusy, více zdrojů, osa odkazem |
| `zrcadlit XY|XZ|YZ [odsazení N]` | Zrcadlit | obecná rovina, zrcadlení prvků |
| `text "ABC" výška H hloubka D v x y [z] [gravírovat] [úhel a] [XZ|YZ]` | Text | rovina odkazem, střed odkazem |
| `smazat poslední` · `stav` · `zobraz iso|přední|…` · `kolize` | Smazat / Stav / Pohledy / Kolize | smazání konkrétního prvku, potlačení, přejmenování |
| `{ … }` / `[ … ]` JSON | vše | – (viz 3.14) |
| **chybí** | Tažení, Šablonovat, Žebro, Pružina, Rozříznout, Úkos, Vytáhnout/Odsadit/Odstranit/Zesílit, Přesunout/otočit, Rovina/Osa/Bod/CSYS, všech 59 prvků rozšíření, Knihovna, Vložit díl, Vazby, Pole komponent, Výkres, Export | jen JSON (nebo vůbec: výkres, export – ten přes `window.mncad.exportFile`) |

Chování vykonání (`cad-app.tsx:408–600`): příkazy se připojují k otevřenému dokumentu; `$last` = poslední skica/prvek; první tvarový prvek = `new`, další `add`; díra/text bez `z` se umístí na povrch podle sítě (`topAt`, `agent.ts:792`); pravidla hran/ploch se vyhodnocují na stavu **před** příkazem (`topology()` `:438`); výsledek každého přidaného prvku (✓/⚠/✗) se vypíše až po stavbě (`:589–595`); nakonec se vždy připojí textový stav (`docStatusText`, `agent.ts:691`).

### 3.13 JavaScript API `window.mncad` (`cad-app.tsx:713–745`, typ `agent.ts:756`)

| Funkce | Co dělá | Omezení |
| --- | --- | --- |
| `run(text)` | provede textové příkazy / JSON, vrátí protokol + stav | stejné možnosti jako konzole |
| `getDocument()` | kopie otevřeného dokumentu (.mncad) | – |
| `setDocument(docOrJson)` | nahradí / otevře dokument (nová záložka) | – |
| `status()` | textový stav (rozměry, objem, geometrie, prvky, sestava, kolize) | staví model znovu |
| `guide()` / `commands()` | návod (Markdown) / seznam příkazů | – |
| `openConsole()` | otevře konzoli | – |
| `hints(on?)` | zapne/vypne popisky F/E/V a vrátí seznam se souřadnicemi a `title` | jen 3D díl; ve skice se štítky P/O zobrazují, ale API je nevrací (`viewport.tsx:1481`) |
| `clickHint(id, additive?)` | klikne na entitu podle štítku syntetickou událostí | jen 3D (`viewport.tsx:1483`) |
| `exportFile(format)` | STEP/STL/BREP/OBJ/GLB/3MF/WRL/mncad jako base64 bez dialogu | výkres (PDF/DXF/DWG) nelze |

### 3.14 Typy prvků v JSON (36, `agent.ts:20`) a jejich dostupnost

| Typ | Tlačítko v pásu | Textový příkaz | Formulář |
| --- | --- | --- | --- |
| sketch, extrude, revolve, box, cylinder, sphere, cone, tube, hole, fillet, chamfer, shell, pattern (linear/circular), mirror, text, thread | ano | ano | ano |
| pattern (curve/sketch/fill) | ano (druh pole) | ne | ano |
| sweep, loft, draft, split, rib, spring, pushPull, deleteFace, offsetFace, thicken, transform, datum, datumAxis, datumPoint, csys | ano | ne | ano |
| import | Otevřít / drag&drop | ne (konzole nemá přístup k souborům; JSON s base64 ano) | jen informace |
| ext (59 modulů) | ano (karty Tvorba/Plochy/Plech/Svařence/Nástroje) | ne (jen jednořádkový JSON) | automatický nebo vlastní |
| **combine, splitBodies, copyBody** (více těles) | **ne** – žádné tlačítko (`cad-app.tsx` je nezná) | ne | **ne** – `props.tsx` nemá větev, zobrazí se jen název; stavitel existuje (`build.ts`, `defaults.ts:232–238`) |

## 4. Nedostatky a doporučení (seřazeno podle dopadu)

1. **Textové příkazy pokrývají jen zlomek nástrojů.** `AGENT_COMMANDS` (`agent.ts:726–752`) má 25 příkazů; chybí rotace kolem hrany, tažení, šablonování, žebro, pružina, úkos, rozříznout, přímé úpravy (vytáhnout/odsadit/odstranit plochu/zesílit), transformace, pomocná rovina/osa/bod/CSYS, všech 59 prvků rozšíření (plochy, plech, svařence, pokročilé), knihovna normálií, sestavy (vložit, vazby, pole), výkres. Vše jde jen přes JSON s ručně dopočítanými indexy ploch/hran – guide sám přiznává „Indexy ploch/hran získáte z textového stavu nebo zkouškou“ (`agent-guide.ts`, oddíl JSON). Doporučení: generovat příkazy z registru (`ext/registry.ts` má `params` s klíči a typy – lze z něj odvodit syntaxi `název-prvku klíč=hodnota …` automaticky), přidat pravidla výběru i pro `faces`/`edges` prvků rozšíření (dnes `select` jen pro fillet/chamfer/shell, `cad-app.tsx:531–547`), příkaz `normálie M8x30` (parser již existuje: `library/index.ts:92` `makeFromText`), `vlož díl`, `vazba`.
2. **Tři typy prvků nemají vůbec žádné GUI.** `combine`, `splitBodies`, `copyBody` (více těles) mají `newFeature` (`defaults.ts:232–238`), popisky (`defaults.ts:9–11`) a stavbu v `build.ts`, ale v `cad-app.tsx` není tlačítko, v `props.tsx` není větev formuláře (po načtení z JSON se v panelu zobrazí jen pole Název) a nejsou ani v textových příkazech. Doporučení: skupina „Více těles“ na kartě Tvorba (Sloučit / Rozdělit / Kopie tělesa) s výběrem tělesa ze seznamu `result.bodies` a formuláře přes `registerFeatureForm`.
3. **Odkaz na hrany u zaoblení/sražení/skořepiny/úkosu/přímých úprav je jen klik v modelu (indexy bez otisku).** `edges: number[]` a `faces: number[]` (`types.ts:120–124`) – žádné „Vybrat ze seznamu“, žádný `sig`, takže po změně historie se indexy rozbijí; u `RefField` to řešeno je (`cad-app.tsx:1300`). Formulář jen hlásí „Klikáním v modelu přidáváte / odebíráte“ (`props.tsx:857`). Doporučení: `PickInfo` doplnit tlačítkem „Vybrat ze seznamu…“ (`PickList` umí `want="edge"`), ukládat vedle indexů i otisky (`refs.ts:10` `Sig`) a při stavbě je znovu najít (`ref-resolve.ts:103–114` už to umí pro `Ref`).
4. **Prvky rozšíření mají chudší zadání než jádro.** Automatický formulář (`props.tsx:994`) zná jen `number/bool/enum/text/vec3/sketch/sketches/feature/faces/edges/mode` (`ext/registry.ts:40–55`) – chybí typ parametru pro `Ref`, `Direction`, `PlaneDef`, `AxisDef`, `Extent`. Důsledky: rovina u Oříznout rovinou / Rozdělit těleso / Křivka průniku / Úkos od dělicí roviny / Deska / Ořezat rovinou je jen XY/XZ/YZ + odsazení (`surface.ts:502`, `:652`, `:738`, `advanced.ts:655`, `weld.ts:222`, `:277`); poloha u Rohové úlevy, Šroubovice, Tažení po šroubovici, Měřítka v bodě jen `vec3` (`sheetmetal.ts:405`, `surface.ts:818`, `advanced.ts:790`). Doporučení: přidat `kind: "ref" | "direction" | "plane" | "axis"` do `ExtParam` a v `ExtForm` je vykreslit existujícími poli; stavitelům předat `resolveRef` z `ref-resolve.ts`.
5. **`window.prompt` místo vlastních polí.** Odsazené roviny skici (`cad-app.tsx:2114` `askNum` → `:2133`, `:2137`), hodnoty u voleb bodu (%, poměr, vzdálenost; `ref-field.tsx:157`), přejmenování listu výkresu (`drawing-workspace.tsx:567`). Blokuje automatizaci (agent musí obsloužit nativní dialog), nepřijímá výrazy ani proměnné, na mobilu je nepohodlné. Doporučení: použít `AskBox`-podobný box u kurzoru nebo pole ve formuláři (jako `NumIn` v `ref-field.tsx:279`).
6. **Skica: vazby a kóty nelze zadat textem; entity jen bez vazeb.** `parseEntity` (`agent.ts:468`) zná 8 entit (bez oblouku, spline, obdélníku 3 body); `constraints`/`dims` jde jen JSON. Pro agenty i rychlé zadání by pomohl příkaz `vazba vodorovně e1`, `kóta e1 60` a `oblouk x1 y1 x2 y2 x3 y3`. Dále `skica` textově umí jen základní rovinu + odsazení (`agent.ts:236`), ne skicu na ploše („plocha F3“) ani `planeDef`.
7. **Nejednotné zadání směru/osy/roviny mezi formuláři.** Vysunutí má `DirectionField`, pole lineární `DirSpec` (přepínač čísla ↔ odkaz, `pattern-form.tsx:92`), pole komponenty v sestavě jen `Vec` (`asm-panel.tsx:283`), chlazení/vyhazovače jen osy, úkos formy jen X/Y/Z (`mold-panel.tsx:79`), Rozříznout nemá `faceRef` ve formuláři ač je v typu (`types.ts:164`), Zrcadlit nemá `featureIds` ve formuláři ač je v typu (`types.ts:155`; duplicitně řeší ext `adv.mirrorFeatures`); pět prvků rozšíření duplikuje funkce vestavěného zaoblení/sražení/pole s chudším zadáním (3.2, tabulka rozšíření). Doporučení: jeden sdílený „DirSpec“ a „PlaneSpec“ s přepínačem čísla/odkaz všude; duplicitní ext prvky sloučit nebo skrýt.
8. **Vazby sestav jen klikem na plochu v 3D.** `onMateFace` (`cad-app.tsx:1048`) – nelze zvolit komponentu/plochu ze stromu ani ze seznamu (`PickList` pracuje jen s aktivním dílem, `pick-list.tsx:81`), hodnota vzdálenosti/úhlu se zadává před výběrem ploch (`asm-panel.tsx:260`), vazby nejde upravit po vytvoření (jen flip/potlačit/smazat, `:144–151`). Chybí vazba `fixed` v UI (typ existuje, `types.ts:352`) a výběr komponenty do pole. Doporučení: panel vazby s dvěma `RefField`-podobnými poli (komponenta + plocha) a editace hodnoty u existující vazby.
9. **Výkres: kóta jen 2 body + odsazení.** `onCanvasClick` (`drawing-workspace.tsx:409–430`) přichytává k vrcholům polygonů, ale nelze kótovat kružnici (Ø/R), hranu jako celek, úhel ani zadat hodnotu/odsazení číslem; tolerance se píše až v seznamu. Doporučení: typy kót podle vybraných entit (jako ve skice `dimFromPicks`, `sketcher.tsx:1604`), AskBox pro hodnotu/toleranci.
10. **Popisky zkratek, které nic nedělají.** `kbd: "Shift+F"` u ohybu z hrany (`ext/sheetmetal.ts:256`) a `"Shift+W"` u konstrukčního profilu (`ext/weld.ts:137`) se zobrazují v pásu, dokumentaci (`cad-docs.ts:579`) i paletě, ale obsluha kláves v `cad-app.tsx:1955–2050` je nezná. Buď doplnit do `DEFAULT_SHORTCUTS` + handleru, nebo popisek odstranit.
11. **Dokumentace vs. kód u zkratek.** Dokumentace (`cad-docs.ts:571–584`) uvádí B = zaoblení, N = sražení, S = skica, G/R gizmo; HELP v programu (`cad-app.tsx:3596–3609`) tyto zkratky neuvádí a nezmiňuje ani Ctrl+K, Ctrl+L, Ctrl+,, Ctrl+Shift+K/L; HELP píše „P mnohoúhelník“ (skica), zatímco ve 3D je P pravoúhlá/perspektiva (`settings.ts:59`) – správně, ale matoucí. Zkratky skici (`sketcher.tsx:238`) nejsou přemapovatelné v Nastavení (jen 21 akcí ve 3D, `settings.ts:50`). B/N/S volají `addFeature` a ignorují předvybrané hrany/plochy, zatímco tlačítka v pásu je použijí (`cad-app.tsx:2043–2045` vs. `:2269–2270`).
12. **Výzva (prompt) chybí u řady stavů.** `cad-app.tsx:2544–2585`: při čekajícím `refPick` je výzva správná, ale při aktivním prvku rozšíření s `pick` (plochy/hrany) říká jen „upravte parametry“ (`:2585`), u Vytáhnout/Odsadit/Zesílit/Zrcadlit/Pole totéž; po stisknutí „Pole“ bez tvarového prvku se objeví jen krátký toast (`:1625`). Doporučení: výzvu odvodit z `pickMode`/`ExtDef.pick` a `params[kind=faces|edges]`.
13. **Díra: `points` a `position` se vylučují bez vysvětlení; textově jen jedna díra.** `props.tsx:833` skryje Vec, jakmile je v seznamu bod; z textového příkazu nelze zadat více děr (`agent.ts:330`), ani `fit` řadu ISO 273, ani `points`. Doporučení: `díra … v x y; x2 y2` nebo `díra … body F3-střed, V7`.
14. **Řez modelem jen posuvníkem** (`cad-app.tsx:3072–3100`) – bez číselného pole a bez obecné roviny (jen X/Y/Z). Dělicí rovina formy (`:3138`) nastavuje řez jen v Z.
15. **Knihovna normálií není dostupná textem v konzoli** (chybí v `agent.ts`), ačkoli `makeFromText` existuje (`library/index.ts:92`); do sestavy ji agent vloží jen přes JSON celé komponenty. Jednoduchý příkaz `normálie M8x30 [v x y z]` by to vyřešil.
16. **Ukončení díry nemá všechny varianty vysunutí**: `HoleEnd` (`types.ts:20`) nezná `toVertex`/`offsetFromFace`/`toBody`; formulář díry nabízí jen 4 druhy (`props.tsx:831`). Sjednotit s `Extent` vysunutí.
17. **Formuláře přímých úprav nemají „Použít aktuální výběr“** – výběr se použije jen při spuštění příkazu (`cad-app.tsx:1333–1348`); je-li prvek už otevřený, musí se klikat znovu. Doplnit do `PickInfo` (`props.tsx:857`) tlačítko „+ výběr“ jako v `RefListField` (`ref-field.tsx:738`).
18. **Dotyk ve skicáři:** `sketcher.tsx` nemá dlouhý stisk pro kontextovou nabídku (jen `button === 2`, `:1815`) ani pinch-zoom; pan jen prostředním/pravým tlačítkem (`:1711`). Na mobilu je skica prakticky neovladatelná bez myši – dokumentace (`cad-docs.ts:590`) to u skici nepřiznává. Štítky P/O ve skice nejsou dostupné přes `window.mncad.hints()` (`viewport.tsx:1481` vrací jen 3D).
19. **Drobnosti:** u pole „Opakovaný prvek“ se ve vestavěné větvi (`props.tsx:670`, fallback bez registrace formuláře) nabízí jen lineární/kruhové, zatímco registrovaný `PatternForm` všech 5 – mrtvý kód, ale při výpadku registru by zmátl; `Text` ve vestavěné větvi (`props.tsx:647`) nemá `planeDef`/`positionRef`, registrovaný formulář ano – stejný případ. `AsmProps` název/číslo/skupina potvrzuje až na blur (bez Enter) (`asm-panel.tsx:223–232`). `Variables` neumí název potvrdit Enterem bez blur (`manager.tsx:278`). Šablonování ploch (`surface.ts:382`) má skici jako zaškrtávací seznam bez možnosti změnit pořadí, na rozdíl od objemového šablonování.

## 5. Stav po opravách (13. 11. 2026)

Opravy proběhly ve větvi `claude/cnc-sales-os-ai-cbR2f` (PR #82). Oprava k tvrzení v oddílu 3: stavba více těles (`combine`, `splitBodies`, `copyBody`) v jádře tehdy **nefungovala** – existovaly jen typy a popisky; jádro, tlačítka i formuláře vznikly až touto opravou.

| # | Nedostatek | Stav | Co je hotové |
| --- | --- | --- | --- |
| 1 | Textové příkazy jen pro zlomek nástrojů | hotovo | obecný příkaz `prvek <typ> klíč=hodnota` pro všechny prvky a 59 rozšíření, výběr hran/ploch pravidlem i u rozšíření, `normálie`, `vložit`, `těleso`/`rozdělit`/`kopie`/`sloučit`, `výkres`, `kótovat`, vazby a kóty skici; vazby sestav textem zatím jen JSON |
| 2 | Více těles bez GUI | hotovo | skupina Tělesa v pásu, formuláře Rozdělit / Kopie / Sloučit, režim Nové těleso, seznam těles ve správci |
| 3 | Indexy hran/ploch bez otisku | hotovo | otisky u zaoblení, sražení, skořepiny, úkosu, přímých úprav a rozšíření; znovunalezení po změně historie, ⚠ když se entita nenajde |
| 4 | Chudší zadání u rozšíření | hotovo | druhy parametrů rovina, bod, směr a osa (odkazem nebo číslem); druh „rozsah“ (k ploše / skrz) zatím nepřidán |
| 5 | `window.prompt` | hotovo | vlastní dotaz na hodnotu (výrazy, proměnné, mobil) |
| 6 | Vazby a kóty skici jen JSON | hotovo | `vazba …`, `kóta …`, id entit e1, e2…, `skica plocha F3`, `skica rovina "…"`, řešení skice a stav určenosti v protokolu |
| 7 | Nejednotné zadání směru | hotovo | sdílené pole směru u rozšíření, úkosů formy, vyhazovačů, chlazení a pole komponent; Rozříznout s plochou, Zrcadlit vybrané prvky; 6 duplicitních rozšíření skryto z pásu a palety (staré dokumenty fungují) |
| 8 | Vazby sestav jen klikem | hotovo | výběr komponenty a plochy ze seznamu, úprava hodnoty, vazba Pevně |
| 9 | Výkres: kóta jen 2 body | hotovo | kóty podle geometrie (Ø, R, délka hrany, úhel) a nově Chytré kóty podle prvků modelu (řetězové kóty, popisy děr ↧ ⌴ ⌵, závity) |
| 10 | Zkratky bez obsluhy | hotovo | Shift+F a Shift+W fungují |
| 11 | Dokumentace vs. kód u zkratek | hotovo | nápověda generovaná ze skutečných zkratek, B/N/S berou předvýběr, zkratky skici v Nastavení |
| 12 | Chybějící výzvy | hotovo | výzva podle druhu výběru u všech prvků |
| 13 | Díra: body a více děr | hotovo | více poloh jedním příkazem, šikmá díra (`směr`, `sklon`), řada ISO 273 |
| 14 | Řez jen posuvníkem | dokončuje se | číselná poloha, rovina z plochy a obecná normála – sloučí se s náhledem bez WebGL |
| 15 | Normálie textem | hotovo | `normálie M8x30 [v x y z]` |
| 16 | Ukončení díry | hotovo | k vrcholu, odsazeně od plochy, k tělesu |
| 17 | „Použít aktuální výběr“ | hotovo | tlačítko + výběr a výběr ze seznamu v každém formuláři s hranami/plochami |
| 18 | Dotyk ve skicáři | hotovo | dlouhý stisk = nabídka, pinch-zoom, posun dvěma prsty, štítky bodů skici pro `window.mncad.hints()` |
| 19 | Drobnosti | hotovo | mrtvé větve formulářů odstraněny, Enter u sestavy a proměnných, pořadí skic u šablonování ploch |
