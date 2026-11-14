# 2D CAD v Mnástrojárna CAD – návrh architektury a smlouvy balíků (vlna 9)

Zadání (vlastník): „Umí CAD přesně pracovat i s DWG, DXF a STL? Ve 2D hlavně s měřítky, hladinami atd. – prostě
plnohodnotný 2D CAD, včetně textového modelování pro agenty.“

Cíl celé vlny: 2D CAD uvnitř stávající aplikace na úrovni AutoCAD LT / DraftSight pro běžnou 2D práci, ovladatelný myší
**i úplně textem / API** (AI agenti), s věrným přenosem DWG / DXF. Fáze A (tento dokument + jádro) staví architekturu
a jádro; fáze B = 4 souběžné balíky: **1 edit** (úpravy), **2 annot** (text, kóty, odkazy, šrafy), **3 layout**
(bloky, rozvržení, výřezy v měřítku, tisk PDF), **4 io** (plný DWG / DXF import a export).

STL zůstává 3D formát (síť trojúhelníků – import jako sešité těleso, export); ve 2D výkresu se nepoužívá.

---

## 1. Stav po fázi A (co už funguje)

| Oblast | Hotovo | Soubory |
|---|---|---|
| Druh dokumentu | `CadDoc.kind = "draft"`, model v `CadDoc.draft`; záložky, .mncad, automatické ukládání, nedávné soubory, sdílený odkaz, zpět / znovu (1 příkaz = 1 krok) | `cad/types.ts` (2 řádky), `cad/draft/doc.ts`, `components/cad/cad-app.tsx` |
| Model | jednotky, přesnost, proměnné výkresu, hladiny, typy čar, textové styly, entity se stabilním id `eN`, prostory (model / rozvržení / blok), sloty `ext` pro DWG | `cad/draft/model.ts` |
| Entity jádra | bod, úsečka, přímka, polopřímka, křivka (vydutí, šířky), kružnice, oblouk, elipsa / eliptický oblouk, spline (proložení / řídicí body, NURBS), jednořádkový text | `cad/draft/kinds-core.ts` |
| Geometrie | přesné průsečíky (analyticky úsečka / oblouk, Newton pro elipsu a spline), kolmice, tečny, nejbližší bod, délky, NURBS (de Boor + derivace), interpolace splajnu, afinní transformace (zrcadlení textu MIRRTEXT) | `cad/draft/geom.ts`, `cad/draft/curves.ts` |
| Hladiny, čáry, barvy | správce hladin (nová, přejmenovat, smazat s přesunem, aktuální, barva ACI / pravá, typ čáry, tloušťka, zap / vyp, zmrazit, zamknout, tisk, popis), knihovna typů čar acadiso (9 + varianty 2 / X2), LTSCALE / CELTSCALE, LWDISPLAY, ByLayer / ByBlock | `cad/draft/layers.ts`, `linetypes.ts`, `colors.ts` |
| Příkazy | registr CZ / EN / DE + zkratky AutoCADu; ČÁRA, KŘIVKA, KRUŽNICE (střed, průměr, 3B, 2B, TTP), OBLOUK (11 variant), OBDÉLNÍK, MNOHOÚHELNÍK, ELIPSA, SPLINE, PŘÍMKA, POLOPŘÍMKA, BOD, TEXT; SMAZAT, VYBER, HLADINA, TYPČÁRY, MĚŘÍTKOČAR, TLOUŠŤKY, VLASTNOSTI, NASTAVIT, PROMĚNNÁ, JEDNOTKY, VZDÁLENOST, PLOCHA, SOUŘADNICE, VÝPIS, STAV, ROZSAH, ZOOM, NÁPOVĚDA, EXPORT, IMPORT | `cad/draft/commands.ts`, `cmd-draw.ts`, `cmd-core.ts`, `io/index.ts` |
| Zadání | `x,y`, `@dx,dy`, `@d<a`, `d<a`, `#x,y`, `@`, přímá vzdálenost, výrazy; body entit `e3.end` … `x(e1,e2)`, `per()`, `tan()`, `nea()` | `cad/draft/coords.ts` |
| Uchopení | koncový bod, polovina, střed, kvadrant, průsečík, kolmo, tečně, nejbližší, uzel, bod vložení + značky; ORTHO, polární trasování, krok mřížky | `cad/draft/snap.ts` |
| Výběr | klik, okno, křížení, Shift = odebrat, Ctrl+A, textem (id, vše, poslední, předchozí, okno, křížení, hladina, typ, barva, odebrat / přidat) | `cad/draft/select.ts` |
| Vykreslení | Canvas 2D, dvojitá přesnost v JS, prostorový index (packed R-strom), dávky podle stylu, přesné vzory čar, tloušťky, výběr + úchopy, mřížka, ikona USS, ořez výřezů | `cad/draft/render.ts`, `spatial.ts` |
| GUI | vlastní pás (Kreslení · Úpravy · Hladiny · Poznámky · Bloky · Rozvržení · Výstup), příkazový řádek (psaní kamkoli, mezera = Enter, Esc, historie, doplňování), panel Vlastnosti / Hladiny, stavový řádek (MŘÍŽKA, KROK, ORTHO, POLÁRNÍ, UCHOP, TLOUŠŤKY, pozadí) | `components/cad/draft/*` |
| Agenti | `2d …` (EN `draft …`, DE `zeichnen …`), `window.mncad.draft(text)`, `window.mncad.draftImport(file)`, oddíl v návodu pro AI | `cad/draft/agent.ts`, `prefix.ts`, `cad/agent.ts`, `cad/agent-guide.ts` |
| DWG / DXF (základ) | export a import přes acad-ts: hlavička, hladiny, typy čar, textové styly, entity jádra (vč. vydutí, šířek, NURBS, zarovnání textu); oprava čtení vypnutých hladin a UTF-8 v DXF R2007+ | `cad/draft/io/basic.ts` |
| Testy | 71 vitest (geometrie, příkazy CZ/EN/DE, hladiny, uchopení, výběr, DXF/DWG tam a zpět, 20 000 entit), e2e `e2e/cad-w9-core.e2e.cjs` | `cad/draft/*.test.ts` |

Výkon (sdílený stroj, Chromium): 20 000 úseček – vykreslení celého výkresu 42 ms, snímek po zoomu kolečkem 12 ms,
20 000 příkazů skriptem přes `window.mncad.draft` 2,3 s, výběr oknem + uchopení < 5 ms.

---

## 2. Vrstvy a tok dat

```
GUI  components/cad/draft/   draft-workspace.tsx ─ pás, panely, stavový řádek, klávesy, UI_EXTS (balíky)
                             draft-canvas.tsx    ─ myš / dotyk, uchopení, gumová čára, okno výběru → CmdRun
                             draft-cmdline.tsx   ─ výzvy, volby, historie, doplňování
                             draft-panels.tsx    ─ správce hladin, vlastnosti, výběr barvy
Agent  cad/draft/agent.ts ─ `2d …`, window.mncad.draft  → runScriptAsync (bez GUI)
Jádro  commands.ts (registr + CmdRun + skript) ─ coords.ts ─ select.ts ─ snap.ts
       tx.ts (transakce = 1 krok historie)   status.ts   render.ts (Canvas 2D)
       kinds.ts (registr druhů entit) ← kinds-core.ts (+ balíky)   layers.ts linetypes.ts colors.ts units.ts
       curves.ts geom.ts (přesná geometrie)   spatial.ts (R-strom)
Data   model.ts (DraftModel – čistý JSON v CadDoc.draft)   doc.ts (dokument, normalizace)
I/O    io/index.ts (EXPORT, IMPORT, draftExport, draftImport) → io/basic.ts (acad-ts, líně)
```

Pravidla:
- **Model je neměnný JSON.** Každá změna = nový objekt (entity, pole, tabulky). Geometrické mezipaměti (`entityCurves`,
  `entityPrims`, `entityBox`, prostorový index) jsou podle identity objektu (WeakMap) – po změně stylů / bloků volat
  `invalidateGeometry()` (kinds.ts).
- **Každý příkaz běží v `DraftTx`** (tx.ts): `add / put / update / remove / setModel / setVars`; na konci `tx.model`
  = nový model. GUI ho zapíše `commit` (1 krok historie), skript ho předá dál. Zamčená hladina = chyba při `put / remove`
  (výjimka `force`). `tx.created / changed / deleted` = výsledek pro agenty.
- **Žádný kód mimo kinds-*.ts nerozlišuje druhy entit `switch (e.type)`** – vše přes registr `kindOf(e)`.
- **Jednotky**: souřadnice ve výkresových jednotkách (`vars.units`, INSUNITS), dvojitá přesnost; úhly v modelu ve
  stupních proti směru hodin od +X (jako DXF), uvnitř geometrie v radiánech.

## 3. Dokument a ukládání

- `CadDoc.kind = "draft"`, `CadDoc.features = []`, `CadDoc.draft: DraftModel`. Nový: `emptyDraftDoc(name, { units })`.
- Otevření .mncad / JSON od agenta prochází `normalizeDraftDoc` (doplní hladinu 0, typy čar, id a čítač entit).
- Záložka druhu `"draft"` (ikona křivky), `docTabKind`, `docHasContent` (sdílení, nedávné soubory, varování při zavření).
- Úvodní obrazovka a Soubor → „Nový 2D výkres“; text `2d nový [název] [mm|cm|m|in]`.
- Jádro OCCT 2D výkres nestaví (textové příkazy přeskočí ověřovací stavbu).
- Relace (výběr, předchozí výběr, poslední vytvořené, poslední bod, prostor, požadavek na pohled) se neukládá –
  `sessionFor(model)` (session.ts), klíč `DraftModel.id`.

## 4. Datový model (model.ts)

`DraftModel = { v, id, seq, vars, layers, linetypes, textStyles, entities (modelový prostor), dimStyles?, blocks?, layouts?, ext? }`

Společné vlastnosti entity (`DraftBase`): `id` („e12“), `layer`, `color?` (`"ByLayer"` | `"ByBlock"` | ACI 1–255 |
`"#rrggbb"`; chybí = ByLayer), `linetype?` (název | ByLayer | ByBlock), `lineweight?` (mm | ByLayer | ByBlock | Default),
`ltscale?` (CELTSCALE entity), `transparency?`, `ext?` (handle, XDATA – balík 4).

Entity jádra: `point {p}`, `line {a,b}`, `xline {p,dir}`, `ray {p,dir}`, `polyline {pts, bulges?, widths?, width?, closed?}`,
`circle {c,r}`, `arc {c,r,a0,a1}` (°, proti směru hodin), `ellipse {c, major, ratio, t0?, t1?}` (parametr °),
`spline {degree, ctrl, knots, weights?, fit?, closed?}`, `text {p, h, s, rot?, style?, halign?, valign?, p2?, wf?, oblique?}`.

Prostory: `DraftSpace = "model" | "layout:<id>" | "block:<název>"` – `spaceEntities / withSpaceEntities / allEntityLists /
mapAllEntities` (přejmenování hladin, počty, čištění prochází všechny prostory). `DraftTx(model, space)` pracuje
s entitami zvoleného prostoru; GUI zobrazuje `session.space`.

**Rozšiřování bez úpravy jádra:** `DraftEntityMap`, `DraftVars`, `DraftModel`, `DraftBlock`, `DraftLayout`, `DraftDimStyle`,
`DraftTextStyle`, `DraftDocExt`, `DraftEntityExt` jsou `interface` → balík je doplní ve svém souboru:

```ts
declare module "../model" {
  interface DraftEntityMap { mtext: DMText }
  interface DraftVars { dimstyle?: string }
}
```

Smluvní tvar entit balíků 2 a 3 je **už nyní** v `cad/draft/annot/types.ts` (mtext, dimension, leader, hatch, tolerance,
kótovací styl) a `cad/draft/layout/types.ts` (insert + atributy, attdef, viewport, pole bloku a rozvržení), aby balík 4
mohl převádět DWG / DXF souběžně. Balíky smí **přidávat volitelná pole**; přejmenování / odebrání jen po dohodě s balíkem 4.

## 5. Hladiny, typy čar, tloušťky, barvy

- Hladina 0 vždy existuje (nelze přejmenovat / smazat), Defpoints se netiskne. Aktuální hladinu nelze zmrazit ani smazat,
  zmrazená nemůže být aktuální. Smazání hladiny s entitami jen s `přesunout-na X` nebo `i-s-entitami`. Název bez
  `< > / \ " : ; ? * | = \``, nejvýš 255 znaků, bez ohledu na velikost písmen jedinečný.
- `resolveStyle(model, e, byBlock?)`: ByLayer → hladina, ByBlock → vlastnosti vložení (`ByBlockStyle`), Default → LWDEFAULT;
  měřítko čáry = `ltscale entity × LTSCALE`.
- Typy čar: vzor v jednotkách výkresu (+ čára, − mezera, 0 tečka); knihovna acadiso / acad (MEASUREMENT); načtení
  z knihovny automaticky, když ho hladina / entita / CELTYPE použije; `parseLin` čte .lin (bez vložených tvarů);
  `dashPolyline` = přesný rozklad pro tisk / PDF (balík 3), obrazovka používá stejné délky přes `setLineDash`.
- Tloušťky: standardní hodnoty DWG (0–2,11 mm), `snapLineweight`; zobrazení LWDISPLAY (0,25 mm ≈ 1 px).
- Barvy: ACI tabulka (1–9, 10–249 odstín × jas × sytost, 250–255 šedé), ACI 7 bílá / černá podle pozadí, pravé barvy.

## 6. Registr druhů entit (kinds.ts)

```ts
interface DraftKind<E> {
  type; label();
  curves(e, ctx): Curve[];          // výpočty: uchopení, průsečíky, výběr, ořezávání (balík 1)
  prims(e, ctx): Prim[];            // kreslení: path | fill | text | mark | inf | sub (vnořené entity s transformací a ořezem)
  bbox(e, ctx): Box | null;         // null = nekonečná
  snaps(e, ctx): SnapPt[];          // end, mid, cen, qua, nod, ins
  grips(e, ctx): Vec2[];  moveGrip?(e, i, p, ctx);
  transform(e, m: Affine, ctx): DraftEntity | null;   // posun, otočení, měřítko, zrcadlení
  info(e, ctx, fmt): InfoRow[];  fields(e, ctx, fmt): DraftField[];  setField(e, key, raw, ctx): E;
  measure?(e, ctx); hitDist?(e, p, ctx); explode?(e, ctx): NewEntity[] | null;
}
registerKind<"mtext">({ … })   // balík ve svém souboru
```

`Prim.sub = { entities, xf, byBlock?, clip? }` vykreslí renderer rekurzivně (bloky – balík 3), s `clip` jako výřez
(ořez polygonem + výběr entit prostorovým indexem seznamu, typicky `model.entities`).

## 7. Příkazy, výzvy, příkazový řádek (commands.ts)

```ts
registerCommand({ id: "MOVE", names: { cs: ["posun"], en: ["move"], de: ["schieben"] }, alias: ["M"], group: "modify",
  desc: () => tr("…"), usage: () => tr("…"), pickfirst: true,
  run: function* (c) { const s = yield { k: "select", msg: tr("Vyberte objekty") }; … } });
```

- Příkaz s výzvami = generátor `yield Prompt → Input`. Výzvy: `point` (base, kw, none, preview, dir), `dist`
  (číslo nebo bod; `pt` = předat bod), `angle`, `int`, `kw`, `text`, `select` (PICKFIRST přeskočí, je-li výběr),
  `entity` (id `e3` / `e3@x,y`, klik). Volby `kw(id, cs, en, de)` – shoda celým slovem v libovolném jazyce, `_id`,
  jednoznačným začátkem (nejdřív v jazyce rozhraní).
- Řádkový příkaz `line(c, args)`; asynchronní `async(c, args)` (soubory, líně načítané knihovny).
- `CmdCtx`: `tx`, `session`, `log`, `out(key, data)` (strukturovaný výsledek), `fmt`, `kctx()`, `setLast`, `parsePoint`,
  `interactive`, `ui` (openPanel, flash, download, pickFile, docName – v textu chybí).
- Skript: `runCommandLine` – tokeny = zadání výzev v pořadí, konec řádku = Enter, **atomicky** (chyba = žádná změna,
  důvod v `error`), nadbytečné zadání = chyba. `runScript(Async)` – řádky a „;“, každý příkaz zvlášť.
- GUI: psaní kamkoli jde do příkazového řádku, mezera = Enter (kromě textu a řádkových příkazů), Enter na prázdném řádku
  zopakuje poslední příkaz, Esc ukončí (nakreslené zůstane), Ctrl+Z / Ctrl+Y = historie dokumentu, F3 UCHOP, F7 MŘÍŽKA,
  F8 ORTHO, F9 KROK, F10 POLÁRNÍ, F2 historie příkazového řádku, Delete = SMAZAT výběr, Ctrl+A vše.
- Názvy jsou globální: `registerCommand` vyhodí chybu při kolizi názvu / zkratky (test „každý příkaz…“ to odhalí).

## 8. Text pro agenty a API

- `2d <příkaz> …` (cs), `draft …` (en; „draft 3 faces …“ zůstává 3D úkos), `zeichnen …` (de); `2d zpět [n]`, `2d znovu`.
  Navazující řádky `2d` jsou jeden běh; `2d nový` založí novou záložku. Návod: `cad/agent-guide.ts` oddíl „2D výkres“.
- `window.mncad.draft(text) → { ok, log, results[{ cmd, input, ok, error?, log, created, changed, deleted, data? }], status, doc }`.
- `window.mncad.draftImport({ name, base64 | text }) → { ok, note, status }` (nová záložka).
- Pohled pro klikání: `[data-draft-canvas]` atribut `data-view` (`cx, cy, scale, w, h, ms, drawn`).
- Stav: `draftStatus(model, session)` – jednotky, rozsah, počty podle druhu, hladiny s počty, typy čar, výběr.

## 9. DWG / DXF (plán pro balík 4)

Základ (fáze A, `io/basic.ts`): `draftToCad(model, version)` → acad-ts `CadDocument` → `DxfWriter` / `DwgWriter`;
`cadToDraft(doc)` ← `DxfReader` / `DwgReader`. Pokryto: hlavička ($INSUNITS, $LTSCALE, $CLAYER, $LUPREC, $AUPREC,
$PDMODE, $PDSIZE, $MIRRTEXT, $LWDISPLAY, $CELTSCALE, $MEASUREMENT), LAYER (barva ACI / pravá, typ, tloušťka, zap, zmrazení,
zámek, tisk), LTYPE (vzory), STYLE, POINT, LINE, XLINE, RAY, LWPOLYLINE (vydutí, šířky, konstantní šířka), CIRCLE, ARC,
ELLIPSE, SPLINE (řídicí body, uzly, váhy, body proložení), TEXT (zarovnání 10/11, šířkový faktor, sklon, \U+ a %%d/c/p).
Ostatní entity se jen spočítají v poznámce importu. Zjištěné vady acad-ts 3.7.0 (obejité): vypnutá hladina (záporná 62)
se čte jako zapnutá barvy 7 → `dxfOffLayers`; DXF R2007+ se čte podle $DWGCODEPAGE místo UTF-8 → přepis na utf-8.

Plán balíku 4: mapovací tabulka entit (POLYLINE 2D/3D → polyline, MTEXT, DIMENSION všech druhů + ARC_DIMENSION,
LEADER, MULTILEADER, HATCH (cesty polyline i hrany – originál v `ext`), TOLERANCE, INSERT / MINSERT + ATTRIB, ATTDEF,
BLOCK_RECORD → blocks, LAYOUT + VIEWPORT → layouts, SOLID / TRACE → polyline s výplní, WIPEOUT, IMAGE (odkaz), REGION /
3DSOLID → zachovat v `ext.raw`), tabulky DIMSTYLE / MLEADERSTYLE / TEXTSTYLE, XDATA a handle v `ext`, anonymní bloky kót,
verze R12 (vlastní zapisovač, acad-ts R12 neumí) až R2018, kódové stránky, binární DXF, testy tam a zpět na sadě souborů.

## 10. Výkonové cíle

≥ 20 000 entit interaktivně (posun / zoom < 50 ms na snímek), 100 000 entit použitelně (< 300 ms); import 10 MB DXF
< 5 s. Prostředky: R-strom (`spatialIndex` podle identity pole), dávky podle stylu, mezipaměti geometrie, text menší
než 1,2 px se nekreslí, vzor čáry kratší než 3 px = plná čára, dvě vrstvy canvasu (entity / kurzor).

---

## 11. Smlouvy balíků fáze B

Společná pravidla pro všechny balíky:
1. Pracujete z lokálního commitu fáze A. **Vlastní soubory** = jen vaše adresáře / soubory níže. Soubory jádra
   (`cad/draft/*.ts` mimo vaše adresáře, `components/cad/draft/draft-*.tsx`, `ui-ext.ts`, `ui-exts.ts`, `index.ts`)
   **neměnit**; potřebujete-li v jádře změnu, napište ji do reportu jako požadavek (integrátor ji udělá), nebo použijte
   povolené výjimky uvedené u balíku.
2. Vstupní bod: `cad/draft/<balík>/index.ts` (jádro ho už importuje z `cad/draft/index.ts`) – z něj importujte své moduly
   (registrace druhů entit a příkazů). GUI: `components/cad/draft/ui-<balík>.tsx` (už zařazený v `UI_EXTS`).
3. Překlady: `scripts/i18n/{en,de}/17-draft2d-<balík>.tsv` (edit, annot, layout, io). Každý `tr()` text přeložit.
4. Testy: `cad/draft/<balík>/*.test.ts` (vitest), e2e `e2e/cad-w9-<balík>.e2e.cjs` (vzor: `e2e/cad-w9-core.e2e.cjs`,
   pohled přes `data-view`). Udržet zelené: `src/cad/draft/*.test.ts`, `e2e/cad-w9-core.e2e.cjs`, `e2e/cad.e2e.cjs`.
5. Textové příkazy: každý nový příkaz má názvy cs / en / de, zkratku AutoCADu, `desc`, `usage` a funguje v GUI
   i v textu (`2d …`); doplňte řádky do tabulky v `cad/agent-guide.ts` oddílu „2D výkres“ (jen přidat řádky – 3 balíky
   ji mění souběžně, ať se patche spojí).
6. Názvy příkazů a zkratky jsou rozdělené níže – jiné bez dohody nepoužívat (registr hlásí kolizi).

### Balík 1 – edit (úpravy)

- **Soubory:** `src/cad/draft/edit/**`, `src/components/cad/draft/ui-edit.tsx`, `scripts/i18n/*/17-draft2d-edit.tsv`,
  `e2e/cad-w9-edit.e2e.cjs`.
- **Příkazy (id · cs · en · de · zkratky):** MOVE posun · move · schieben · M; COPY kopie · copy · kopieren · CO, CP;
  ROTATE otočit · rotate · drehen · RO; SCALE změnit-měřítko · scale · varia · SC; MIRROR zrcadlit · mirror · spiegeln · MI;
  OFFSET ekvidistanta · offset · versetz · O; TRIM oříznout · trim · stutzen · TR; EXTEND prodloužit · extend · dehnen · EX;
  FILLET zaoblit · fillet · abrunden · F; CHAMFER zkosit · chamfer · fase · CHA; BREAK přerušit · break · bruch · BR;
  BREAKATPOINT přerušit-v-bodě · breakatpoint · bruchpunkt; JOIN spojit · join · verbinden · J; EXPLODE rozložit ·
  explode · ursprung · X; STRETCH protáhnout · stretch · strecken · S; ARRAY pole · array · reihe · AR (+ ARRAYRECT,
  ARRAYPOLAR, ARRAYPATH); LENGTHEN prodloužení · lengthen · länge · LEN; ALIGN zarovnat-objekty · align · ausrichten · AL;
  PEDIT upravit-křivku · pedit · pedit · PE; SPLINEDIT upravit-spline · splinedit · splineedit · SPE; MATCHPROP
  přenést-vlastnosti · matchprop · eigübertrag · MA; DRAWORDER pořadí · draworder · zeichreihenf · DR; OVERKILL
  odstranit-duplicity · overkill · overkill.
  (Stejný název ve více jazycích u jednoho příkazu nevadí; klíčová slova voleb – např. „abrunden“ u OBDÉLNÍKU – s názvy
  příkazů nekolidují.)
- **Rozhraní jádra:** výzva `select` (+ PICKFIRST), `kindOf(e).transform(e, affine)` pro všechny druhy (i balíků 2 a 3),
  `entityCurves` + `cIntersect / cClosest / cPerpFrom / cTransform` pro ořez / prodloužení / ekvidistantu / zaoblení,
  `polylineCurves`, `bulgeArc / bulgeOf`, `kind.explode` (balíky 2 a 3) – křivky jádra rozkládá balík sám
  (`edit/explode.ts`), úchopy: `kind.grips / moveGrip` + `DraftUiExt.pointer` (táhnutí úchopu bez příkazu, Esc zruší).
  Skupiny pásu: karta `modify` (Upravit, Pole, Uspořádat) přes `editUi.ribbon`.
- **Výjimka v jádře:** žádná. Potřebujete-li „rozdělit entitu v parametru“ pro jiný druh než jádro, přidejte do
  `edit/` vlastní tabulku podle `e.type`; pro neznámé druhy použijte `explode` a pracujte s výsledkem.
- **Testy:** přesnost (ořez úsečky kružnicí, prodloužení k oblouku, ekvidistanta křivky s oblouky, zaoblení dvou úseček
  na přesný poloměr a tečnost, pole polární 6× = úhly 60°), zamčená hladina, PICKFIRST, text CZ / EN / DE.

### Balík 2 – annot (text, kóty, odkazy, šrafy)

- **Soubory:** `src/cad/draft/annot/**` (vč. `annot/types.ts` – smluvní tvar), `ui-annot.tsx`,
  `scripts/i18n/*/17-draft2d-annot.tsv`, `e2e/cad-w9-annot.e2e.cjs`.
- **Druhy entit:** `mtext`, `dimension` (linear, aligned, angular, angular3, radius, diameter, ordinate, arc), `leader`,
  `hatch`, `tolerance` – registrace `registerKind` (prims vč. šipek a textu, curves pro uchopení, transform, explode,
  fields / setField pro panel vlastností). Kóta je **asociativní na definiční body** (přepočet při změně, ne vazba
  na entity); naměřený text formátuje kótovací styl (DIMDEC, DIMZIN, DIMPOST, DIMLFAC, tolerance).
- **Tabulky:** `model.dimStyles` (ISO-25 výchozí, proměnné dle `DraftDimStyle`), `model.textStyles` (správa stylů –
  STYLE), `vars.dimstyle`, `vars.mleaderstyle`, vzory šraf (ANSI/ISO výběr, vlastní .pat – `annot/patterns.ts`).
- **Příkazy:** MTEXT mtext · mtext · mtext · MT, T; STYLE styl-textu · style · stil · ST; TEXTEDIT upravit-text ·
  textedit · textedit · ED; DIM kóta · dim · bem; DIMLINEAR kóta-lineární · dimlinear · bemlinear · DLI;
  DIMALIGNED kóta-zarovnaná · dimaligned · bemausg · DAL; DIMANGULAR kóta-úhlová · dimangular · bemwinkel · DAN;
  DIMRADIUS kóta-poloměr · dimradius · bemradius · DRA; DIMDIAMETER kóta-průměr · dimdiameter · bemdurchm · DDI;
  DIMARC kóta-oblouku · dimarc · bembogen · DAR; DIMORDINATE kóta-souřadnicová · dimordinate · bemordinate · DOR;
  DIMBASELINE kóta-základnicová · dimbaseline · bembasisl · DBA; DIMCONTINUE kóta-řetězová · dimcontinue · bemweiter · DCO;
  DIMSTYLE kótovací-styl · dimstyle · bemstil · D, DST; MLEADER odkaz · mleader · mführung · MLD, LE; HATCH šrafa ·
  hatch · schraff · H, BH; HATCHEDIT upravit-šrafu · hatchedit · schraffedit · HE; TOLERANCE tolerance · tolerance ·
  toleranz · TOL; CENTERMARK značka-středu · centermark · zentrumsmarke · CM.
- **GUI:** karta `annotate` (Text, Kóty, Odkazy, Šrafy, Styly) přes `annotUi.ribbon`, panel kótovacích stylů
  (`annotUi.panels`), poklepání na text / kótu = úprava (`dblclick`). Text jádra (TEXT) zůstává v jádře.
- **Výjimka v jádře:** žádná (styly jsou pole modelu; `invalidateGeometry()` po změně stylu).
- **Testy:** hodnoty kót (lineární 100,000 / úhlová 45° / Ø40 / R20 s přesností stylu), poloha textu, šrafa – plocha
  smyček a ostrovy, transformace kót (zrcadlení: text čitelný), text CZ / EN / DE.

### Balík 3 – layout (bloky, rozvržení, výřezy, tisk PDF)

- **Soubory:** `src/cad/draft/layout/**` (vč. `layout/types.ts`), `ui-layout.tsx`, `scripts/i18n/*/17-draft2d-layout.tsv`,
  `e2e/cad-w9-layout.e2e.cjs`.
- **Druhy entit:** `insert` (prims = `sub` s transformací a ByBlock; vrstva 0 uvnitř bloku → vrstva vložení; curves /
  snaps transformované; explode; atributy), `attdef`, `viewport` (prims = `sub` s `entities: model.entities`,
  `xf` model → papír, `clip`; v papírovém prostoru rám výřezu; zmrazení hladin ve výřezu přes vlastní filtr).
- **Prostory:** `model.blocks`, `model.layouts` (pole dle `layout/types.ts`), přepínání `api.setSpace("layout:<id>")`,
  úprava bloku `block:<název>` (BEDIT / BCLOSE), `session.space` (jádro ho respektuje ve výběru, uchopení, příkazech).
- **Příkazy:** BLOCK blok · block · block · B; INSERT vložit · insert · einfüge · I; BEDIT upravit-blok · bedit · bbearb
  · BE; BCLOSE zavřít-blok · bclose · bschließen; ATTDEF definice-atributu · attdef · attdef · ATT; ATTEDIT
  upravit-atributy · attedit · attedit · ATE; WBLOCK uložit-blok · wblock · wblock · W; PURGE vyčistit · purge ·
  bereinig · PU (bloky, hladiny, typy čar, styly); LAYOUT rozvržení · layout · layout · LO; PAGESETUP vzhled-stránky
  · pagesetup · seiteneinr; MVIEW výřez · mview · mansfen · MV; MSPACE modelový-prostor · mspace · mbereich · MS;
  PSPACE papírový-prostor · pspace · pbereich · PS; VPLAYER hladiny-výřezu · vplayer · afebene; PLOT tisk · plot ·
  plot · Ctrl+P (PDF); EXPORTPDF export-pdf · exportpdf · pdfexport.
- **GUI:** karty `blocks` a `layout` a `output` (Tisk PDF), záložky Model / Rozvržení ve stavovém řádku
  (`layoutUi.statusLeft`), papír a okraje (`underlay`), rám výřezu a jeho úprava (`overlay`, `pointer`), dvojklik
  do výřezu = MSPACE.
- **Tisk PDF:** vlastní zapisovač (vektorově, tloušťky v mm papíru, `dashPolyline` pro přesné čárkování, styly tisku
  monochrome / dle barvy), měřítko 1:1 na papír; náhled = `drawEntities` s `plotOnly`, `lwPxPerMm`, `mono`.
- **Výjimka v jádře:** může upravit `session.ts` jen přidáním polí (např. `vpActive`), ne změnou stávajících.
- **Testy:** blok s ByBlock / vrstvou 0, vnořené bloky, výřez 1:50 (rozměr na papíře), PDF – velikost stránky a tloušťky,
  text CZ / EN / DE.

### Balík 4 – io (DWG / DXF import a export)

- **Soubory:** `src/cad/draft/io/**` (převezme i `io/basic.ts` a `io/index.ts` – smí je přestavět při zachování
  exportů `draftExport`, `draftImport`, `fromB64`, `DRAFT_IMPORT_ACCEPT` a příkazů EXPORT / IMPORT), `ui-io.tsx`,
  `scripts/i18n/*/17-draft2d-io.tsv`, `e2e/cad-w9-io.e2e.cjs`, testovací soubory `src/cad/draft/io/__fixtures__/`.
- **Rozsah:** viz kap. 9 – všechny entity jádra a balíků 2 a 3 podle smluvních typů (`annot/types.ts`,
  `layout/types.ts`; mapovat i tehdy, když balíky 2 / 3 ještě nemají vykreslení – entity se uloží a zpět zapíší),
  tabulky, XDATA a handle (`ext`), nepřevedené objekty uchovat v `ext` a zapsat zpět, R12–R2018, binární DXF,
  kódové stránky, varování v poznámce importu.
- **Výjimky v hot souborech (malé, přesně tyto):** `components/cad/cad-app.tsx` – v `openFile` směrovat `.dxf` / `.dwg`
  do 2D výkresu (`draftImport` + `openDocInTab`), DXF do skici jen volbou; `components/cad/agent-api-host.ts` –
  `importFile(file, { as: "draft" })`. Jiné změny jádra ne.
- **Testy:** tam a zpět model → DXF → model = beze ztráty (všechny druhy, hladiny, styly, bloky, rozvržení), DWG R2000 /
  R2018, sada reálných souborů (AutoCAD, DraftSight, LibreCAD) bez výjimky, výkon 10 MB DXF.

---

## 12. Otevřené body (mimo fázi A)

- UCS (uživatelský souřadný systém) – zatím jen WCS; dynamické zadání u kurzoru jen jako zobrazení vzdálenosti a úhlu.
- Trasování uchopení (OTRACK), prodloužení a zdánlivý průsečík jako režimy uchopení – připraveny názvy (`ext`, `app`).
- Písmo SHX se kreslí nejbližším webovým písmem (šířka podle písma prohlížeče); víceřádkový text = MTEXT (balík annot).
- ~~Otevření DXF tlačítkem Otevřít vede do skici 3D dílu~~ – hotovo (balík io): Ctrl+O / přetažení .dxf / .dwg = 2D výkres,
  3D skica volbou.

## 13. Integrace fáze B (balíky edit, annot, layout, io)

Změny jádra podle požadavků balíků (všechny pokryté testy `cad/draft/draft-int.test.ts`, `draft-tips.test.ts`
a e2e `e2e/cad-w9-2d.e2e.cjs` – přejímka „jako nástrojař“ v GUI i textem):

| Oblast | Změna | Soubor |
|---|---|---|
| Vykreslení | uzavřená cesta `lineTo` místo `closePath` (Chromium O(n²) na dávkové cestě; 20 MB DWG se otevře za 11 s), malý text < 4 px jako čárka („greeking“), texty jednou transformací, entity vrstvy 0 v blocích se stálou identitou (mezipaměti) | `render.ts` |
| Příkazy | `Kw.alias` – zkratky AutoCADu, které nejsou začátkem názvu (TRIM T / O / R / E, CHAMFER E / M); výchozí volba výzvy se ukazuje názvem (`promptDefault`); neúspěšný příkaz vrací i protokol; `CmdRun.feedSelection` – výběr textem i v zadání předem v GUI | `commands.ts` |
| Transakce | `DraftTx.restore(entita, index)` – vrácení smazané entity na místo (krok Zpět uvnitř příkazů balíku edit) | `tx.ts` |
| Proměnné | PSLTSCALE v PROMĚNNÁ (přepočte mezipaměti výřezů) | `cmd-core.ts` |
| Výběr | „alle“ (DE) = vše | `select.ts` |
| GUI | pás jádra jako čistá funkce `draftCoreRibbon` (test mikronávodů prochází všechna id); duplicitní Export DXF / DWG a Otevřít ve Výstupu odstraněny (skupina DWG / DXF balíku io); dlouhá výzva se zalamuje; zapsaný výkres platí hned (příkaz spuštěný tlačítkem během jiného příkazu pracuje s novým výkresem); klíč řádku vlastností | `components/cad/draft/*` |
| Mezi balíky | výřez kreslí a tiskne anotativní poznámky v měřítku výřezu (`vpDrawList` = `annoScaledList`); io: měřítko poznámek (CANNOSCALE), PSLTSCALE, DIMANNO stylu, příznak anotativní, směr osy souřadnicové kóty (51), poloha textu odkazu podle balíku annot, kótovací styly vždy úplné (metrický výkres = ISO-25 i bez kót), vlastní bod vložení každého bloku v DXF (oprava acad-ts) | `layout/kinds.ts`, `layout/plot.ts`, `io/to-cad.ts`, `io/from-cad.ts`, `io/acad-patch.ts` |
| Mikronávody | `help/tips/draft-core.{cs,en,de}.ts` pro tlačítka jádra (balíky mají `draft-<balík>.*`) | `cad/help/tips/` |

Zbývá (mimo integraci): NURBS `cClosest` a slučování
blízkých průsečíků v `curves.ts`; volby úprav (FILLETRAD, CHAMFER…) se neukládají do DWG; posun / zoom pohledu uvnitř
výřezu myší; výkon 20 000 entit se smíšenými texty (cíl < 50 ms na snímek) – viz report integrace.
