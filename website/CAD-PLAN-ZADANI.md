# Plán: možnosti zadání prvků – cesta k nejkomplexnějšímu CADu na trhu

Datum: 2. 11. 2026 · navazuje na `CAD-ROADMAP.md` (architektura, stav vln 1–4). Tento dokument řeší **jednu věc**: každý
prvek a každý nástroj musí mít stejně bohaté (nebo bohatší) **způsoby zadání** jako špičkové CADy – ne jen „jedno číslo
a jedno zaškrtávátko". Je to přímá reakce na výtku: *„každý prvek má strašně malé množství možností zadání – kam táhnout,
odkud, do bodu, do roviny, na délku, v plusu/minusu, podél úhlu… ve standardním CADu je jich stovka a ty to máš osekané".*

---

## 1. Shrnutí – kde jsme a kde je špička

| Oblast | Náš stav (listopad 2026) | Špička (ZW3D / SolidWorks / NX / Creo / Inventor / Fusion / Onshape) | Cíl |
| --- | --- | --- | --- |
| Zadání **bodu** | číslo XYZ, nebo klik na plochu (jen u díry) | 15–20 způsobů v každém vstupním poli (pravé tlačítko): koncový bod, střed, těžiště, průsečík, kolmo, tečně, podél směru, odsazení, mezi body, % křivky, projekce, z jiného CSYS… | ≥ 18 způsobů, **v každém poli bodu** |
| Zadání **směru/osy** | osa X/Y/Z (výčet) | hrana, dvě body, normála plochy, osa válce, pomocná osa, osa CSYS, čára skici, vektor, úhel v rovině, tečna křivky, obrácení | ≥ 11 způsobů, v každém poli směru |
| Zadání **roviny** | XY/XZ/YZ, rovinná plocha, pomocná rovina, nově: odsazení, rovnoběžně s plochou, střední, 3 body | + bod+čára, úhel k ploše kolem hrany, tečně k válci, kolmo na křivku v bodě, rovnoběžně s obrazovkou, procházející 2 hranami, souřadný systém | 15 způsobů |
| **Vysunutí** – ukončení | 1 (na vzdálenost, ± symetricky) | 9: slepé, skrz vše, k dalšímu, k vrcholu, k ploše, odsazeně od plochy, k tělesu, střední rovina, dva různé směry | 9 + nezávislý 2. směr + počátek |
| **Vysunutí** – ostatní | úkos, režim add/cut | tenká stěna (1 strana / 2 strany / střední), směr podle hrany/vektoru, počátek (rovina skici / plocha / vrchol / odsazení), výběr jen některých smyček, sloučit/nesloučit, rozsah těles, offset profilu (ZW3D: smrštit/rozšířit/zesílit), kroucení | vše |
| **Rotace** | úhel, osa X/Y skici, režim | osa = libovolná čára skici / hrana / pomocná osa / 2 body / osa válce, 1 směr / 2 směry / střední, k vrcholu / k ploše, tenká stěna | vše |
| **Díra** | průměr, hloubka/skrz, zahloubení, kuželové, závit; pozice číslem nebo klikem | typy (jednoduchá, zahloubená, kuželová, závitová, kuželový závit, drážka), normy (ISO/DIN/ANSI/JIS), typ a velikost spojovacího prvku, uložení (těsné/normální/volné), ukončení (slepá/skrz/k dalšímu/k ploše/odsazeně), úhel špičky, hloubka závitu, kosmetický závit, **více poloh naráz** z bodů skici / vrcholů / soustředně s hranou | vše |
| **Zaoblení** | konstantní poloměr | proměnný poloměr (řídicí body), šířka tětivy, asymetrické (2 vzdálenosti), zaoblení plocha–plocha, plné zaoblení, kuželovitost (rho), zpětné hrany (setback), udržet hranu / převalit, šíření po tečných hranách, více sad poloměrů v jednom prvku | vše |
| **Zkosení** | jedna vzdálenost | 2 vzdálenosti, vzdálenost + úhel, zkosení vrcholu (3 vzdálenosti), plocha–plocha, odsazení plochy, udržet prvky, tečné šíření | vše |
| **Pole** | lineární (2 směry) a kruhové | přeskočení instancí, směr podle hrany/osy/kóty, „až k referenci", střídavé, obousměrné, po křivce, podle bodů skici, z tabulky, výplňové, variabilní (změna kót instance), pole těl/ploch/prvků | vše |
| **Zrcadlení** | základní rovina ± odsazení | libovolná rovina / rovinná plocha / pomocná rovina, zrcadlení prvků / ploch / těl, sloučit | vše |
| **Úkos** | neutrální = základní rovina | neutrální rovina/plocha, dělicí křivka (parting line), stupňový úkos, úhel per sada ploch, směr tahu, tečné šíření | vše |
| **Skořepina** | 1 tloušťka, odebrané plochy | různé tloušťky pro vybrané plochy, směr ven | vše |
| **Tažení** | profil + dráha, Frenet | vodicí křivky, kroucení (úhel / otáčky / podle křivky), zachovat normálu / sledovat dráhu, tenká stěna, kruhový profil bez skici, zarovnání s koncovými plochami, sloučit tečné plochy | vše |
| **Šablonování** | 2+ skici, přímkové | okrajové podmínky (normála, směr, tečně/křivostně k ploše), vodicí křivky, osová křivka, uzavřené, párování vrcholů, tenká stěna | vše |
| **Skica – vazby** | základ (LM řešič: shodné, vodorovné, svislé, rovnoběžné, kolmé, tečné, rovné, soustředné, pevné, symetrické…) | + střed, průsečík, body na křivce, stejná křivost, kolineární, koradiální, zámek, poměr; **automatické vazby při kreslení** s náhledem, odvozené/zamčené kóty, kóty jako rovnice | vše + auto-vazby |
| **Skica – zadání** | klik, uchopení (koncový, střed, průsečík, mřížka), čísla ve vstupu | polární/kartézské, relativní (@dx,dy), zamknuté souřadnice (Tab), délka+úhel, vložit kótu hned při kreslení, konstrukční přepínač, „Ready sketch" tvary, odsazení, projekce hran, převod entit, ořez výkonný, prodloužit, rozdělit, zaoblit/zkosit skicu | vše |
| **Sestavy – vazby** | shodné / rovnoběžné / soustředné / vzdálenost / úhel (W4) + automatické pro normálie | + tečné, zámek, šířka, limitní (rozsah), dráha, lineární spřažení, symetrické, vačka, ozubené, hřeben–pastorek, šroub, kloub, pant, drážka | vše |
| **Výkresy** | 3 pohledy + iso, řez, detail, kóty, drsnosti, GD&T, kusovník, pozice | pomocný pohled, odsazený/zalomený/vynesený řez, částečný řez (break-out), přerušený, oříznutý, alternativní poloha, rozložený; kóty řetězové, od základny, souřadnicové, zkosení, popis díry; tolerance symetrické/oboustranné/mezní/uložení | vše |

**Závěr:** geometrické jádro (OCCT) umí vše potřebné; chybí **vrstva zadání** – univerzální referenční systém + výčty
ukončení/směrů + UI pole, které umí „klikni / napiš / vyber z nabídky pravým tlačítkem". To je přesně to, co dělá rozdíl
mezi „betou" a profesionálním modelářem. Plán níže ji buduje jednou, pro všechny prvky.

---

## 2. Jak to dělají ostatní (analýza)

### ZW3D (vzor pro UI/UX)
- Každé vstupní pole (bod, směr, plocha, křivka, číslo) je **chytré**: přijme klik v 3D, napsanou hodnotu/výraz, nebo
  **pravým tlačítkem** nabídne volby bodu (*Critical point, Middle, Center, Intersection, Along direction, Offset,
  Between, On curve %, Projection, From CSYS*) a volby směru (*Edge, Two points, Face normal, Axis, CSYS X/Y/Z, Angle*).
- Vysunutí: *Start S / End E* (hodnota, Through all, To face, To point), *Direction*, *Flip*, *Boolean (Base/Add/Remove/
  Intersect)*, *Draft (úhel, typ, přemostění)*, *Offset (None / Shrink-Expand / Thicken / Uniform)*, *Twist*.
- Inteligentní výběr: filtr entit, řetězec, tečný řetězec, smyčka, plochy prvku, barva, okno/laso, *Pick from list*.
- Historie + přímé úpravy (hybrid), stavy, výkresy s plnou sadou pohledů.

### SolidWorks
- Vysunutí: *Blind, Through All, Through All Both, Up To Next, Up To Vertex, Up To Surface, Offset From Surface, Up To
  Body, Mid Plane*; nezávislý Direction 2; Draft (in/out); Thin Feature (1 dir / mid / 2 dir); Selected Contours;
  Direction of Extrusion (hrana/vektor); Merge; Feature Scope; From (Sketch Plane / Surface / Vertex / Offset).
- Hole Wizard: typy, normy, velikost, uložení, ukončení, více poloh ze skici bodů.
- Fillet: constant, variable, face, full round, setback, asymmetric, conic rho, hold line.
- Patterns: linear (skip instances, vary sketch, up to reference), circular (equal/symmetric), curve-driven,
  sketch-driven, table-driven, fill, variable.
- Reference geometry: Plane (3 reference se zvolenou vazbou: parallel/perpendicular/coincident/angle/distance/mid-plane/
  tangent/project), Axis (6 způsobů), Point (7), CSYS.

### NX
- Limits: *Value, Symmetric, Until Next, Until Selected, Until Extended, Through All*; Boolean *Inferred*; Draft (6 typů
  vč. asymetrického a z průřezu); Offset (single/two-sided/symmetric); Body type Solid/Sheet; Synchronous modeling
  (move face, offset region, replace face, resize blend, delete face – máme část).

### Creo / Inventor / Fusion / Onshape
- Creo: *Blind, Symmetric, To Next, Through All, Through Until, To Selected* + dvě nezávislé strany, Thicken sketch.
- Inventor: *Distance, To, To Next, Through All, Between (From–To)*, Asymmetric, Match shape, New solid.
- Fusion: Extent *Distance / To Object / All*; Start *Profile plane / Offset / Object*; Thin; New Body / New Component.
- Onshape: *Blind, Symmetric, Up to next, Up to face, Up to part, Up to vertex, Through all*, second end, merge scope;
  vynikající **In-context** a **Mate connectors** (jeden „standard mate" s omezením stupňů volnosti).

### Co z toho plyne
1. Rozdíl není v počtu příkazů, ale v **počtu způsobů, jak každý příkaz nakrmit**. Vysunutí je 1 příkaz, ale 9 × 2 směry
   × 3 počátky × tenká stěna × směr × rozsah = stovky kombinací.
2. Všichni mají **jednotný referenční systém**: hodnoty v prvku nejsou čísla, ale odkazy na geometrii (vrchol, hrana,
   plocha, rovina, osa, bod skici), které se přepočítají při změně historie. To my dnes nemáme – máme čísla a indexy.
3. Všichni mají **pravé tlačítko ve vstupním poli** s volbami bodu/směru a **pick-from-list** při nejednoznačnosti.

---

## 3. Návrh architektury „vrstvy zadání" (udělat jednou, použít všude)

### 3.1 Reference (`cad/refs.ts`)
```ts
export type Ref =
  | { kind: "xyz"; p: Vec3 }                                   // napsané souřadnice
  | { kind: "vertex"; index: number; sig?: Sig }               // vrchol tělesa
  | { kind: "edge"; index: number; at?: "start" | "end" | "mid" | "center" | { t: number }; sig?: Sig }
  | { kind: "face"; index: number; sig?: Sig }                 // plocha (rovina, válec = osa, koule = střed)
  | { kind: "sketchPt"; sketchId: string; entityId: string; which: "start" | "end" | "center" | "mid" }
  | { kind: "datum"; featureId: string }                       // pomocná rovina/osa/bod/CSYS
  | { kind: "csys"; axis?: "x" | "y" | "z"; origin?: boolean }
  | { kind: "derived"; op: "mid" | "intersect" | "offset" | "along" | "project" | "between" | "percent"; args: Ref[]; v?: number };

export type NumRef = number | { expr: string } | { measure: [Ref, Ref] };      // číslo, výraz, nebo změřená vzdálenost
export type Extent =
  | { kind: "blind"; d: NumRef } | { kind: "throughAll" } | { kind: "toNext" } | { kind: "toVertex"; ref: Ref }
  | { kind: "toFace"; ref: Ref; offset?: NumRef } | { kind: "offsetFromFace"; ref: Ref; d: NumRef; translate?: boolean }
  | { kind: "toBody"; ref: Ref } | { kind: "midPlane"; d: NumRef };
export type Direction =
  | { kind: "normal" } | { kind: "axis"; axis: "X" | "Y" | "Z" } | { kind: "edge"; ref: Ref } | { kind: "twoPoints"; a: Ref; b: Ref }
  | { kind: "faceNormal"; ref: Ref } | { kind: "vector"; v: Vec3 } | { kind: "angle"; plane: Ref; deg: number } | { kind: "tangent"; ref: Ref };
export type PlaneDef =   // 15 způsobů zadání roviny
  | { kind: "base"; name: PlaneName; offset: NumRef } | { kind: "face"; ref: Ref; offset?: NumRef } | { kind: "threePoints"; a: Ref; b: Ref; c: Ref }
  | { kind: "pointLine"; p: Ref; line: Ref } | { kind: "angle"; face: Ref; edge: Ref; deg: NumRef } | { kind: "mid"; a: Ref; b: Ref }
  | { kind: "tangentCyl"; face: Ref; through: Ref } | { kind: "normalToCurve"; curve: Ref; at: Ref } | { kind: "screen" } | { kind: "twoEdges"; a: Ref; b: Ref }
  | { kind: "datum"; featureId: string } | { kind: "custom"; origin: Vec3; normal: Vec3; xDir: Vec3 };
```
- **Řešič referencí v jádře** (`cad/ref-resolve.ts`, běží ve workeru): `resolve(ctx, ref) → { point?, dir?, plane?, face?, edge? }`.
  Každý prvek si před stavbou nechá vyřešit své `Ref`/`Extent`/`Direction` a dál pracuje s čistou geometrií.
- **Stabilní pojmenování topologie (`Sig`)**: k indexu plochy/hrany/vrcholu ukládáme otisk (typ, těžiště, plocha/délka,
  normála). Po změně historie se reference znovu najde podle otisku, ne podle indexu → prvky se nerozbijí při editaci
  dřívějšího prvku. (Dnes největší skrytá slabina – indexy se po změně posunou.)
- **Výrazy** (`NumRef.expr`): už máme proměnné a konfigurace (`params.ts`); výraz se vyhodnotí tamtéž.

### 3.2 UI: pole reference (`components/cad/ref-field.tsx`)
- Jedno pole pro bod / směr / rovinu / plochu / hranu / číslo. Stav: *prázdné → aktivní (čeká klik) → vyplněné*.
- Ovládání jako v ZW3D: **klik v 3D** vyplní; **psaní** vyplní číslem/výrazem/souřadnicemi (`10,20,0`, `@5,0,0`,
  `L=30<45`); **pravé tlačítko** (na mobilu dlouhý stisk) otevře volby bodu/směru (odst. 1); **Tab** skočí na další pole;
  **Enter** potvrdí prvek (jako dnes). Nad polem se zobrazuje nápověda stavového řádku („Vyberte vrchol nebo zadejte X,Y,Z").
- Při nejednoznačném kliku **Pick from list** (seznam kandidátů pod kurzorem: vrchol / hrana / plocha / těleso).
- Náhled: prvek se přepočítá živě po každém vyplnění (už máme `live`), šipky/táhla (gizmo) pro vzdálenost a úhel.
- Mobil: pole se otevírají ve spodním listu, výběr v 3D dotykem, dlouhý stisk = pravé tlačítko, cíle ≥ 44 px.

### 3.3 Formuláře prvků
Dnešní `props.tsx` + `ExtForm` zůstávají; přibývá typ parametru `point | direction | plane | extent | refs` → automaticky
vykreslí `RefField`. Moduly rozšíření (`cad/ext/*`) tak dostanou bohaté zadání **zdarma** změnou typu parametru.

---

## 4. Plán po etapách (každá etapa = zelený build, testy, e2e, screenshoty, zápis sem)

### Etapa A – referenční systém a vysunutí/rotace/díra (základ všeho)
1. `refs.ts`, `ref-resolve.ts`, `Sig` otisky, migrace starých dokumentů (`number` → `{kind:"blind", d}` atd.).
2. `RefField` + volby bodu (18) a směru (11) + pick-from-list + nápověda ve stavovém řádku + mobilní spodní list.
3. **Vysunutí**: 9 ukončení × 2 nezávislé směry, počátek (rovina skici / plocha / vrchol / odsazení), směr (normála /
   hrana / vektor / úhel), tenká stěna (1 / 2 / střed, s automatickým zaoblením), výběr smyček profilu, úkos ± s
   přemostěním, sloučit/nové těleso, rozsah těles, offset profilu (smrštit/rozšířit/zesílit).
4. **Rotace**: osa 6 způsoby, 1 směr / 2 směry / střední, k vrcholu / k ploše, tenká stěna.
5. **Díra**: ukončení 5 způsobů, polohy z bodů skici / vrcholů / soustředně s hranou (více děr jedním prvkem), normy
   ISO/DIN/ANSI, uložení, úhel špičky, kosmetický vs. modelovaný závit (už máme), drážka.
6. **Roviny**: 15 způsobů (7 už hotovo v menu skici – převést na `PlaneDef`), osy (6), body (7), CSYS.
7. **Zrcadlení / rozdělení / úkos**: libovolná rovina/plocha přes `PlaneDef`.
   *Měřítko hotovo:* vysunutí ≥ 60 kombinací zadání; všechny staré dokumenty se otevřou beze změny geometrie.

### Etapa B – zaoblení, zkosení, pole, skořepina, tažení, šablonování
1. Zaoblení: proměnné (řídicí body na hraně), asymetrické, tětiva, plocha–plocha, plné, setback, rho, tečné šíření,
   více sad v jednom prvku. 2. Zkosení: D–D, D–úhel, vrchol, plocha–plocha, tečné šíření.
3. Pole: přeskočení instancí, směr podle hrany/osy/kóty, „až k referenci", po křivce, podle bodů skici, výplňové,
   tabulkové, variabilní; pole těles i ploch. 4. Skořepina: více tlouštěk. 5. Tažení: vodicí křivky, kroucení, tenká
   stěna, kruhový profil bez skici. 6. Šablonování: okrajové podmínky, vodicí křivky, osová křivka, párování vrcholů.

### Etapa C – skica na úrovni špičky
1. Zadání při kreslení: polární/kartézské/relativní, zámky (Tab), délka+úhel, kóta ihned při kreslení.
2. **Automatické vazby s náhledem** (vodorovně/svisle/tečně/kolmo/shodně/střed) + volitelně vypnout; doplnit vazby
   (střed, průsečík, kolineární, koradiální, poměr, zámek, stejná křivost); kóty jako rovnice; stav skici
   (nedourčená / plně určená / přeurčená) barevně, diagnostika konfliktů.
3. Nástroje: odsazení, projekce hran, převod entit, výkonný ořez/prodloužení/rozdělení, zaoblení/zkosení skici,
   „Ready sketch" (drážka, polygon, obdélník ze středu/3 body, oblouk 3 způsoby, elipsa, spline s řídicími body a
   tangentami, text). 4. Uchopení: + kolmo, tečně, čtvrtbod, nejbližší, průsečík zdánlivý; nastavení priorit uchopení.

### Etapa D – sestavy a výkresy
1. Vazby: tečná, zámek, šířka, limitní, dráha, symetrická, lineární spřažení, vačka, ozubení, hřeben, šroub, kloub,
   pant, drážka; **mate connector** (jedna vazba s omezením DOF); stavy sestavy; rozložené pohledy s kroky.
2. Výkresy: pomocný, odsazený/zalomený/vynesený řez, částečný řez, přerušený, oříznutý, alternativní poloha, rozložený;
   kóty řetězové/od základny/souřadnicové/zkosení/popis díry; tolerance (symetrická, oboustranná, mezní, uložení H7/g6),
   tabulky děr, revizní tabulka, svarové značky.

### Etapa E – dotyk a mobil (průřezově, začít už v A)
- Nabídky jako spodní list (hotovo pro pás), tlačítka ≥ 44 px, 1 prst = otočit, 2 prsty = posun/zoom, dlouhý stisk =
  pravé tlačítko, plovoucí tlačítko „Potvrdit/Storno", skryté panely přes záložky dole, výběr s lupou.

---

## 5. Měřítka (abychom se „neošulili")
| Měřítko | Dnes | Po etapě A | Cíl (špička) |
| --- | --- | --- | --- |
| Způsoby zadání bodu v libovolném poli | 2 | 18 | 15–20 |
| Způsoby zadání směru | 1 (výčet os) | 11 | 10–12 |
| Způsoby zadání roviny skici | 11 (po dnešku) | 15 | 12–15 |
| Ukončení vysunutí | 1 | 9 (+ 2 směry, počátek, tenká stěna) | 9 |
| Varianty zaoblení | 1 | 1 | 8 (etapa B) |
| Typy pole | 2 | 2 | 8 (etapa B) |
| Vazby skici | 12 | 12 | 20 + automatické (etapa C) |
| Vazby sestavy | 5 (+ auto) | 5 | 18 (etapa D) |
| Typy pohledů výkresu | 6 | 6 | 13 (etapa D) |

Každá etapa končí snímky obrazovky všech nových dialogů a aktualizací této tabulky skutečnými čísly.

---

## 6. Co bylo uděláno hned (2. 11. 2026)
- Rozbalovací nabídky pásu karet se vykreslují **v portálu**: na počítači vždy uvnitř okna (i když je pás posunutý nebo
  oříznutý), na mobilu jako **spodní list** přes celou šířku s velkými cíli – řeší „nabídka Skica se rozbalí mimo".
- Nabídka **Skica** má nově: XY/XZ/YZ s odsazením, rovnoběžně s vybranou plochou s odsazením, střední rovina mezi
  2 plochami (u různoběžných půlicí), rovina třemi vybranými vrcholy; dále na rovinné ploše a pomocné roviny jako dříve.
