/**
 * Mnástrojárna CAD — parametrický dokument.
 * Model = historie prvků (feature tree); každá změna parametru přestaví model od začátku (jako Inventor/ZW3D).
 * Jednotky: milimetry, úhly ve stupních.
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type PlaneName = "XY" | "XZ" | "YZ";
/** Rovina skici: základní rovina s odsazením, nebo obecná rovina (např. z plochy modelu). */
export type SketchPlane =
  | { kind: "base"; name: PlaneName; offset: number }
  | { kind: "custom"; origin: Vec3; normal: Vec3; xDir: Vec3; label?: string };

import { tr } from "./i18n";
import type { AxisDef, Direction, Extent, PlaneDef, Ref, Sig, StartFrom, Thin } from "./refs";
export type { AxisDef, Direction, Extent, PlaneDef, Ref, StartFrom, Thin } from "./refs";

/** Ukončení díry. */
export type HoleEnd =
  | { kind: "blind" }
  | { kind: "throughAll" }
  | { kind: "toNext" }
  | { kind: "toFace"; ref: Ref; offset?: number }
  /** dno v úrovni bodu (vrchol, střed hrany, bod skici…) měřeno podél osy díry */
  | { kind: "toVertex"; ref: Ref }
  /** dno ve vzdálenosti `d` před plochou (totéž co „k ploše“ s odsazením – stejný zápis jako u vysunutí) */
  | { kind: "offsetFromFace"; ref: Ref; d: number }
  /** k tělesu: po první stěnu stávajícího tělesa ve směru vrtání (jako ukončení „k tělesu“ u vysunutí) */
  | { kind: "toBody" };
/** Řada průchozích děr ISO 273 (jemná / střední / hrubá). */
export type HoleFit = "fine" | "medium" | "coarse";

/** Entita skici. `construction` = pomocná geometrie (nevytváří profil). */
export type SketchEntity = { construction?: boolean } & (
  | { id: string; type: "rect"; cx: number; cy: number; w: number; h: number; r: number; angle: number }
  | { id: string; type: "circle"; cx: number; cy: number; r: number }
  | { id: string; type: "polygon"; cx: number; cy: number; r: number; sides: number; angle: number }
  | { id: string; type: "slot"; cx: number; cy: number; length: number; width: number; angle: number }
  | { id: string; type: "polyline"; points: Vec2[]; closed: boolean }
  | { id: string; type: "arc"; a: Vec2; b: Vec2; c: Vec2 } // oblouk třemi body (a → c přes b)
  | { id: string; type: "line"; a: Vec2; b: Vec2 }
  | { id: string; type: "point"; p: Vec2 }
  | { id: string; type: "ellipse"; cx: number; cy: number; rx: number; ry: number; angle: number }
  /** hladká křivka (interpolační spline přes body); `tangents[i]` = tečna v bodě i (°, null = volná), `weights[i]` = její velikost (1 = přirozená) – viz spline-tangent.ts */
  | { id: string; type: "spline"; points: Vec2[]; closed: boolean; tangents?: (number | null)[]; weights?: (number | null)[] }
);

/** Odkaz na charakteristický bod/část entity skici: „a“, „b“, „c“ (konce/body), „center“, „p3“ (bod lomené čáry), „self“ (celá entita). */
export type SketchRef = { e: string; k: string };

/** Geometrická vazba ve skice (řeší ji numerický řešič). */
export type SketchConstraint = {
  id: string;
  type: "horizontal" | "vertical" | "coincident" | "parallel" | "perpendicular" | "tangent" | "equal" | "fixed" | "concentric" | "midpoint" | "pointOnCurve" | "symmetric" | "collinear";
  refs: SketchRef[];
  /** cílové hodnoty u vazby „fixed“ (souřadnice bodu nebo parametry entity) */
  value?: number[];
};

/** Kóta ve skice. Řídicí (driving) kóta mění geometrii, referenční jen ukazuje hodnotu. */
export type SketchDim = {
  id: string;
  type: "distance" | "horizontal" | "vertical" | "radius" | "diameter" | "angle" | "length" | "arcLength";
  refs: SketchRef[];
  value: number;
  driving: boolean;
  /** posun popisku kóty od geometrie (mm ve skice) */
  offset?: Vec2;
};

export type BoolMode = "new" | "add" | "cut" | "intersect";
export type Axis = "X" | "Y" | "Z";

/** Typ díry (jako průvodce dírou v ZW3D/Inventoru). */
export type HoleKind = "simple" | "counterbore" | "countersink" | "tapped";

/** Formáty, které jádro umí načíst jako těleso (ostatní se před uložením převedou na STL). */
export type KernelImportFormat = "step" | "brep" | "stl";
/** Formáty 3D exportu. */
export type ExportFormat = "step" | "stl" | "brep" | "obj" | "glb" | "3mf" | "wrl";

/** Cílové těleso prvku (`body`): název tělesa v dílu; chybí-li, použije se aktivní (naposledy vytvořené/upravené) těleso. */
export type Feature = { id: string; name: string; suppressed?: boolean; body?: string } & (
  /** `planeDef` = asociativní definice roviny (15 způsobů); `plane` je její poslední vyřešená podoba (pro UI a stavbu bez tělesa). */
  | { type: "sketch"; plane: SketchPlane; entities: SketchEntity[]; constraints?: SketchConstraint[]; dims?: SketchDim[]; planeDef?: PlaneDef }
  /**
   * Vysunutí. Ukončení `extent` (slepé / skrz vše / k dalšímu / k vrcholu / k ploše / odsazeně / k tělesu / střední rovina),
   * nezávislý druhý směr `extent2`, začátek `from`, směr `dir`, tenká stěna `thin`, kroucení `twist` (°), změna měřítka na konci
   * `endScale` (ZW3D smrštit/rozšířit), `outerOnly` = ignorovat otvory profilu. Starší pole `distance/symmetric` platí, když `extent` chybí.
   */
  | { type: "extrude"; sketchId: string; distance: number; symmetric: boolean; reverse: boolean; mode: BoolMode; draftAngle?: number; extent?: Extent; extent2?: Extent; from?: StartFrom; dir?: Direction; thin?: Thin; twist?: number; endScale?: number; outerOnly?: boolean }
  /** Rotace. Osa `axisDef` (8 způsobů; starší `axis` = osa skici), druhý směr `angle2`, `symmetric` (střední rovina), tenká stěna. */
  | { type: "revolve"; sketchId: string; angle: number; axis: "x" | "y"; mode: BoolMode; axisDef?: AxisDef; angle2?: number; symmetric?: boolean; thin?: Thin }
  /** Primitiva: `positionRef` = poloha odkazem (má přednost před `position`), `dirDef` = osa libovolným směrem (má přednost před `axis`). */
  | { type: "box"; size: Vec3; position: Vec3; centered: boolean; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | { type: "cylinder"; radius: number; height: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | { type: "sphere"; radius: number; position: Vec3; mode: BoolMode; positionRef?: Ref }
  | { type: "cone"; radius1: number; radius2: number; height: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | { type: "tube"; outer: number; inner: number; height: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  | {
      type: "hole";
      position: Vec3;
      axis: Axis;
      flip: boolean;
      diameter: number;
      depth: number; // 0 = skrz
      /** díra „skrz“ vrtá od zadaného bodu jen ve směru vrtání; `bothWays` = oběma směry (skrz celé těleso) */
      bothWays?: boolean;
      cbDiameter: number; // 0 = bez zahloubení
      cbDepth: number;
      /** výchozí "simple" (nebo "counterbore", pokud cbDiameter > 0) */
      kind?: HoleKind;
      /** kuželové zahloubení: průměr a vrcholový úhel (90°) */
      csDiameter?: number;
      csAngle?: number;
      /** závit, např. "M8" (u kind = "tapped" se vrtá jádrový průměr) */
      thread?: string;
      threadDepth?: number;
      /** ukončení (chybí-li: depth > 0 = slepá, jinak skrz) */
      end?: HoleEnd;
      /** více poloh naráz (odkazy na vrcholy, středy kružnic, body skici…); chybí-li, platí `position` */
      points?: Ref[];
      /** osa díry libovolným směrem (chybí-li, platí `axis`) */
      dirDef?: Direction;
      /** úhel špičky vrtáku (°), výchozí 118 */
      tipAngle?: number;
      /** řada ISO 273 pro průchozí díru (informativní – průměr se dopočítá v UI) */
      fit?: HoleFit;
    }
  /**
   * Zaoblení: `kind` konstantní / asymetrické (r2) / proměnné (radii: poloměr podle indexu hrany) / plocha–plocha / plné /
   * setback (`setback` = vzdálenost od vrcholu, `setbacks` = jiná pro vrchol) / eliptické – kuželosečkové (D1 = radius, D2 = r2,
   * `rho`; plocha pro D1 = `faceRefs`); `tangentChain` = šířit po tečných hranách.
   */
  | { type: "fillet"; radius: number; edges: number[] | "all"; kind?: "constant" | "asymmetric" | "variable" | "faceFace" | "fullRound" | "setback" | "conic"; setbacks?: { at: Ref; d: number }[]; rho?: number; r2?: number; radii?: Record<string, number>; radii2?: Record<string, number>; faces?: number[]; faces2?: number[]; edgeSigs?: PickSigs; faceSigs?: PickSigs; faceSigs2?: PickSigs; faceRefs?: Ref[]; faceRefs2?: Ref[]; faceRefsMid?: Ref[]; tangentChain?: boolean; setback?: number }
  /** Zkosení: stejné vzdálenosti / dvě vzdálenosti (d2 + referenční plocha) / vzdálenost + úhel / vrchol (3 vzdálenosti). */
  | { type: "chamfer"; distance: number; edges: number[] | "all"; kind?: "equal" | "twoDistances" | "distanceAngle" | "vertex"; d2?: number; d3?: number; angle?: number; faceRef?: Ref; vertices?: number[]; vertexRefs?: Ref[]; tangentChain?: boolean; edgeSigs?: PickSigs; vertexSigs?: PickSigs }
  /** Skořepina: `thicknesses` = jiná tloušťka pro vybrané plochy (index → mm), `outward` = zesílit ven. */
  | { type: "shell"; thickness: number; faces: number[]; thicknesses?: Record<string, number>; outward?: boolean; faceSigs?: PickSigs }
  | {
      type: "pattern";
      featureId: string;
      kind: "linear";
      count: number;
      spacing: number;
      direction: Vec3;
      /** druhý směr (mřížka) */
      count2?: number;
      spacing2?: number;
      direction2?: Vec3;
      /** směr podle hrany / osy / dvou bodů (má přednost před `direction`) */
      dirDef?: Direction;
      dirDef2?: Direction;
      /** přeskočené instance (index a*count2+b) */
      skip?: number[];
      /** rozteč jako celková délka „až k referenci“ (místo kroku) */
      spacingMode?: "step" | "total";
      /** střídavé řady (každá druhá řada posunutá o půl kroku) */
      stagger?: boolean;
      /** opakovat jen zdrojové těleso (bez booleovské operace) – rychlejší náhled */
      geometryOnly?: boolean;
      /** více zdrojových prvků naráz */
      featureIds?: string[];
    }
  | { type: "pattern"; featureId: string; kind: "circular"; count: number; angle: number; axis: Axis; center: Vec3; axisDef?: AxisDef; skip?: number[]; symmetric?: boolean; equalSpacing?: boolean; radial?: boolean; featureIds?: string[]; geometryOnly?: boolean }
  /** Pole po křivce (skica s otevřenou/uzavřenou křivkou), podle bodů skici, nebo výplňové (plocha / skica obrysu). */
  | { type: "pattern"; featureId: string; kind: "curve"; count: number; sketchId: string; align: "tangent" | "fixed"; spacing?: number; skip?: number[]; featureIds?: string[]; geometryOnly?: boolean }
  | { type: "pattern"; featureId: string; kind: "sketch"; sketchId: string; skip?: number[]; featureIds?: string[]; geometryOnly?: boolean }
  | { type: "pattern"; featureId: string; kind: "fill"; sketchId: string; spacing: number; margin: number; layout: "grid" | "stagger" | "circular"; skip?: number[]; featureIds?: string[]; geometryOnly?: boolean }
  | { type: "mirror"; plane: PlaneName; offset: number; keepOriginal: boolean; planeDef?: PlaneDef; featureIds?: string[] }
  | { type: "import"; fileName: string; format: KernelImportFormat | "iges"; data: string /* base64 */ }
  /** Tažení profilu po křivce (profil = uzavřená skica, dráha = skica s otevřenou/uzavřenou křivkou). */
  | { type: "sweep"; profileId: string; pathId: string; mode: BoolMode; frenet: boolean; guideId?: string; twist?: number; twistTurns?: number; thin?: Thin; circleRadius?: number; keepNormal?: boolean; transition?: "right" | "round" | "transformed"; scaleEnd?: number }
  /** Šablonování mezi 2+ skicami (profily v různých rovinách). */
  /** `closed` + `smooth` = uzavřené hladce: periodická plocha přes všechny profily (C2 i ve švu) – feat/loft-smooth.ts */
  | { type: "loft"; sketchIds: string[]; ruled: boolean; mode: BoolMode; guideIds?: string[]; centerlineId?: string; closed?: boolean; smooth?: boolean; startCond?: "none" | "normal" | "direction"; endCond?: "none" | "normal" | "direction"; startDir?: Direction; endDir?: Direction; startLen?: number; endLen?: number; thin?: Thin; startPoint?: Ref; endPoint?: Ref }
  /** Úkos vybraných ploch vůči neutrální rovině (`planeDef` = libovolná rovina; `pull` = směr tahu; `partingSketchId` = dělicí křivka). */
  | { type: "draft"; angle: number; faces: number[]; plane: PlaneName; offset: number; planeDef?: PlaneDef; pull?: Direction; partingSketchId?: string; tangentChain?: boolean; step?: boolean; faceSigs?: PickSigs }
  /** Rozříznutí tělesa rovinou, ponechá se jedna strana (`planeDef` = libovolná rovina, `faceRef` = řez plochou). */
  | { type: "split"; plane: PlaneName; offset: number; keep: "positive" | "negative"; planeDef?: PlaneDef; faceRef?: Ref }
  /** Přesun / otočení / měřítko tělesa. */
  | { type: "transform"; translate: Vec3; rotateAxis: Axis; rotateAngle: number; scale: number; translateRef?: { a: Ref; b: Ref }; rotateAxisDef?: AxisDef; centerRef?: Ref }
  /** Pomocná (referenční) rovina – nevytváří geometrii, slouží pro skici. */
  | { type: "datum"; origin: Vec3; normal: Vec3; xDir: Vec3; size: number; planeDef?: PlaneDef }
  /** Text – vystouplý (add) nebo gravírovaný (cut) do tělesa. */
  | { type: "text"; text: string; height: number; depth: number; plane: SketchPlane; position: Vec2; angle: number; mode: "add" | "cut"; positionRef?: Ref; planeDef?: PlaneDef }
  /** Přímé úpravy: posunout (vytáhnout/zatlačit) vybrané plochy o vzdálenost podél normály (`extent` = k vrcholu / k ploše / odsazeně od plochy). */
  | { type: "pushPull"; faces: number[]; distance: number; extent?: Extent; faceSigs?: PickSigs }
  /** Přímé úpravy: odstranit plochy (např. zaoblení, díry) a zacelit těleso. */
  | { type: "deleteFace"; faces: number[]; faceSigs?: PickSigs }
  /** Přímé úpravy: odsadit plochy (offset) – kladně ven, záporně dovnitř. */
  | { type: "offsetFace"; faces: number[]; distance: number; faceSigs?: PickSigs }
  /** Žebro z otevřené skici (čára) s tloušťkou, dotažené k tělesu. */
  | { type: "rib"; sketchId: string; thickness: number; direction: "normal" | "inPlane"; flip: boolean }
  /** Šroubovice / pružina (tažení kruhového průřezu po šroubovici). */
  | { type: "spring"; radius: number; pitch: number; turns: number; wire: number; position: Vec3; axis: Axis; mode: BoolMode; positionRef?: Ref; dirDef?: Direction }
  /** Zesílení (thicken) vybraných ploch na skořepinu dané tloušťky. */
  | { type: "thicken"; faces: number[]; thickness: number; mode: BoolMode; faceSigs?: PickSigs }
  /** Vnější závit na válcové ploše (kosmetický = jen ve výkrese, modelovaný = šroubovice). */
  /** závit na válci (vnější) nebo v díře (`internal`); `modeled` = drážky v geometrii, jinak kosmetický (jen výkres); označení i s jemným stoupáním („M18×1,5“) */
  | { type: "thread"; designation: string; position: Vec3; axis: Axis; length: number; modeled: boolean; internal?: boolean; positionRef?: Ref; dirDef?: Direction }
  /** Prvek z modulu rozšíření (plochy, plech, pokročilé modelování…) – definice v `cad/ext/registry.ts`, data podle modulu. */
  | { type: "ext"; ext: string; data: Record<string, unknown> }
  /** Více těles: booleovská operace dvou těles dílu (výsledek do `target`, `tool` se volitelně ponechá). */
  | { type: "combine"; target: string; tool: string; op: "add" | "cut" | "intersect"; keepTool: boolean }
  /** Více těles: rozříznutí tělesa rovinou na dvě samostatná tělesa (kladná strana si nechá název, záporná = `nameB`). */
  | { type: "splitBodies"; plane: PlaneName; offset: number; nameB?: string; planeDef?: PlaneDef }
  /** Více těles: kopie tělesa jako nové těleso s posunutím. */
  | { type: "copyBody"; source: string; translate: Vec3; newName?: string }
  /** Pomocná osa – nevytváří geometrii; `def` = způsob zadání (hrana, válec, 2 body, globální osa, pomocná rovina, průsečnice dvou rovin…), `length` = délka zobrazení. */
  | { type: "datumAxis"; def: AxisDef; length: number }
  /** Pomocný bod – nevytváří geometrii; `ref` = libovolný způsob zadání bodu (vrchol, střed hrany, střed kružnice, průsečík…). */
  | { type: "datumPoint"; ref: Ref }
  /** Souřadný systém – počátek + směr X + směr Z (X se ortogonalizuje vůči Z); `size` = velikost zobrazení. */
  | { type: "csys"; origin: Ref; xDir: Direction; zDir: Direction; size?: number }
);

export type FeatureType = Feature["type"];

/**
 * Otisky výběru indexy: index (řetězec, jak je v poli indexů) → otisk entity tělesa před prvkem v okamžiku výběru. Volitelné u
 * zaoblení (`edgeSigs`, `faceSigs`, `faceSigs2`), sražení (`edgeSigs`, `vertexSigs`), skořepiny, úkosu a přímých úprav (`faceSigs`);
 * u rozšíření `data[klíč + "Sigs"]`. Při stavbě se podle nich indexy znovu najdou (pick-fields.ts, pick-sigs.ts).
 */
export type PickSigs = Record<string, Sig>;

/** Proměnná (rovnice) – výraz může odkazovat na jiné proměnné: „L = 2*d + 10“. */
export type Variable = { name: string; expr: string; note?: string };

/** Stav (konfigurace) dílu – přepíše hodnoty proměnných a potlačí vybrané prvky. */
export type Config = { id: string; name: string; values: Record<string, number>; suppressed: string[] };

export type CadDoc = {
  app: "mnastrojarna-cad";
  version: 1 | 2;
  name: string;
  /** třída materiálu (hustota) – id z tabulky MATERIALS (ocel, nerez, hlinik…) */
  material: string;
  /** označení materiálu do razítka (volný text, např. „ČSN 11 423“, „1.0503“, „EN AW-6082“) – nezávislé na hustotě */
  materialName?: string;
  features: Feature[];
  /** barva tělesa (#rrggbb) */
  color?: string;
  /** proměnné / rovnice */
  variables?: Variable[];
  /** vazby parametrů na výrazy: klíč „featureId:cesta“ (např. „x1:distance“, „b1:size.0“) → výraz */
  bindings?: Record<string, string>;
  /** stavy (konfigurace) */
  configs?: Config[];
  activeConfig?: string | null;
  /** popisové údaje (razítko výkresu) */
  props?: { number?: string; author?: string; revision?: string; note?: string };
  /** „part“ (výchozí) = díl z historie prvků; „assembly“ = sestava z komponent */
  kind?: "part" | "assembly";
  /** komponenty sestavy */
  components?: AsmComponent[];
  /** barvy jednotlivých ploch výsledného tělesa (index plochy → #rrggbb) */
  faceColors?: Record<number, string>;
  /** výkresy uložené v dokumentu (volby listu, razítko, uživatelské kóty a poznámky) – asociativní s modelem */
  drawings?: DrawingDoc[];
  /** trvalé vazby sestavy (řeší se při změně polohy komponent) */
  mates?: Mate[];
  /** pohybová studie sestavy (motory, kroky) – cad/motion.ts */
  motion?: MotionStudy;
  /** metadata těles dílu (barva, skrytí) – název = klíč tělesa z historie */
  bodies?: BodyMeta[];
  /** těleso, do kterého mají nové prvky směřovat (bez hodnoty = naposledy upravené) */
  activeBody?: string | null;
  /** podklady skic (obrázek / stránka PDF pod geometrií): id skici → podklad; mimo prvky, aby neměnily klíč mezipaměti stavby */
  underlays?: Record<string, SketchUnderlay>;
};

/**
 * Podklad skici: obrázek nebo stránka PDF zobrazená pod geometrií (obkreslování, převod čar PDF na entity).
 * Poloha: střed obrázku `x, y` [mm ve skice], měřítko `mmPerPx` (velikost pixelu bitmapy v mm – nastavuje kalibrace
 * dvěma body) a natočení `angle` [°, kladně proti směru hodin]. Matematika: cad/sketch-underlay.ts.
 */
export type SketchUnderlay = {
  id: string;
  /** obrázek jako data URL (PNG / JPEG; velké bitmapy se při vložení zmenší) */
  src: string;
  /** rozměr bitmapy [px] */
  w: number;
  h: number;
  /** název zdrojového souboru */
  name?: string;
  x: number;
  y: number;
  mmPerPx: number;
  angle: number;
  /** krytí 0–1 */
  opacity: number;
  hidden?: boolean;
  /** stránka PDF, ze které podklad vznikl (od 1), a počet stran dokumentu */
  page?: number;
  pages?: number;
  /** stránka PDF: pixelů bitmapy na 1 bod PDF (1/72″) – převod vektorových čar stránky do skici */
  pxPerPt?: number;
};

export type BodyMeta = { name: string; color?: string; hidden?: boolean };

/** Těleso ve výsledku stavby: indexy ploch/hran jsou globální (v pořadí těles ve složeném výsledku). */
export type BodyInfo = { name: string; active: boolean; faceStart: number; faceCount: number; edgeStart: number; edgeCount: number; volume: number };

/** Umístění komponenty: posun (mm) a natočení kolem os X, Y, Z (°, v tomto pořadí). */
export type Placement = { position: Vec3; rotation: Vec3 };

/** Zdroj komponenty: vložený parametrický díl, nebo importovaný soubor (STEP/BREP/STL). */
/** Zdroj komponenty: díl, importovaný soubor, nebo podsestava (vnořená sestava). */
export type ComponentSource = { kind: "part"; doc: CadDoc } | { kind: "file"; fileName: string; format: KernelImportFormat; data: string } | { kind: "asm"; doc: CadDoc };

export type AsmComponent = {
  id: string;
  name: string;
  /** číslo výkresu / normy (do kusovníku) */
  number?: string;
  source: ComponentSource;
  placement: Placement;
  color?: string;
  hidden?: boolean;
  /** ukotvená (nepohyblivá) komponenta */
  fixed?: boolean;
  /** materiál pro kusovník u importovaných souborů */
  material?: string;
  /** skupina v kusovníku (např. „Desky“, „Normálie“) */
  group?: string;
};

/**
 * Stav prvku po stavbě: `ok` = prvek se zpracoval; `warning` = zpracoval se, ale výsledek si zaslouží pozornost
 * (operace těleso nezměnila, geometrie po opravě stále není platná…) – v UI ⚠, v protokolu „⚠“.
 */
/** `ms` = doba výpočtu prvku (jen prvky, které se skutečně počítaly) */
export type FeatureStatus = { id: string; ok: boolean; error?: string; warning?: string; ms?: number; /** výsledek prvku pro stav (např. svarový kov) */ info?: string; /** strojově čitelný výsledek prvku (např. `weld`) */ data?: Record<string, unknown> };

export type MeshData = {
  vertices: Float32Array;
  normals: Float32Array;
  triangles: Uint32Array;
  /** [start, count, faceIndex] po trojicích (start/count v indexech trojúhelníků) */
  faceGroups: Int32Array;
  lines: Float32Array;
  /** [start, count, edgeIndex] po trojicích (start/count v bodech) */
  edgeGroups: Int32Array;
};

export type BuildResult = {
  status: FeatureStatus[];
  /** chyby proměnných / vazeb parametrů (z resolveDoc) */
  paramErrors?: string[];
  mesh: MeshData | null;
  metrics: {
    volume: number;
    area: number;
    bbox: [Vec3, Vec3];
    faces: number;
    edges: number;
    /** platnost výsledného tělesa (BRepCheck) – neplatné těleso může selhat při exportu STEP */
    valid?: boolean;
    /** počet objemových těles (0 = jen pláště / plochy) */
    solids?: number;
  } | null;
  /** polohy topologických vrcholů tělesa (x,y,z po trojicích) – pro výběr bodů */
  vertices?: Float32Array;
  /** tělesa dílu (více těles) s globálními indexy ploch a hran */
  bodies?: BodyInfo[];
  /** asociativně vyřešené roviny skic (`planeDef`) a pomocných rovin – UI je promítne do dokumentu */
  resolved?: { planes: Record<string, SketchPlane>; datums: Record<string, { origin: Vec3; normal: Vec3; xDir: Vec3 }> };
  ms: number;
};

export type FaceInfo = { index: number; planar: boolean; origin: Vec3; normal: Vec3; xDir: Vec3 };

export const emptyDoc = (name = tr("Nový díl")): CadDoc => ({ app: "mnastrojarna-cad", version: 2, name, material: "ocel", features: [] });

export const uid = () => Math.random().toString(36).slice(2, 9);

// ---------------- výkresy v dokumentu ----------------

/**
 * Uživatelská poznámka/kóta ve výkrese. Souřadnice jsou v souřadnicích promítnutého pohledu (`view` = klíč pohledu,
 * jednotky modelu, y dolů) – díky tomu po změně modelu zůstanou na stejném místě geometrie. `view: "sheet"` = mm listu.
 */
export type DrawingAnnotation = { id: string; view: string; /** vygenerovala „Chytré kóty“ (klíč významu kóty) – přegenerování nahradí jen tyto */ auto?: string; /** revize, ve které se údaj změnil (trojúhelník s písmenem) */ rev?: string; /** kóta s polem tolerance ISO 286: jen značka / + úchylky / + mezní rozměry (jinak podle listu) */ tolShow?: "code" | "dev" | "limits" } & (
  | { type: "dim"; a: Vec2; b: Vec2; kind: "aligned" | "horizontal" | "vertical"; offset: number; prefix?: string; suffix?: string; text?: string; /** kóta délky hrany – koncové body jsou konce hrany pohledu (dohledávají se v geometrii pohledu) */ edge?: boolean }
  /** průměr / poloměr kružnice nebo oblouku pohledu: střed `c` a poloměr `r` v souřadnicích pohledu, odkaz ve směru `ang` [°] o délce `offset` [mm listu] od kružnice */
  | { type: "dim"; kind: "diameter" | "radius"; c: Vec2; r: number; ang: number; offset: number; prefix?: string; suffix?: string; text?: string }
  /** úhel dvou hran pohledu (a–b, a2–b2): oblouk o poloměru `offset` [mm listu] v sektoru, kam míří směr `ang` [°] */
  | { type: "dim"; kind: "angle"; a: Vec2; b: Vec2; a2: Vec2; b2: Vec2; ang: number; offset: number; prefix?: string; suffix?: string; text?: string }
  | { type: "note"; at: Vec2; leader?: Vec2; text: string }
  | { type: "roughness"; at: Vec2; ra: string; leader?: Vec2 }
  | { type: "gdt"; at: Vec2; symbol: GdtSymbol; value: string; datum?: string; leader?: Vec2 }
  | { type: "datum"; at: Vec2; label: string }
  | { type: "text"; at: Vec2; text: string; size: number }
  /** popis s odkazovou čarou (díry, sražení, zaoblení, roztečná kružnice): šipka v `tip`, koleno v `at`, řádky textu (↧ ⌴ ⌵ se kreslí jako značky); `circle` = osová kružnice; `tol` = tolerance za prvním označením */
  | { type: "callout"; tip: Vec2; at: Vec2; lines: string[]; circle?: { c: Vec2; r: number }; tol?: string }
  /** osa souměrnosti (čerchovaná čára) – souměrné kótování roztečí od ní */
  | { type: "centerline"; a: Vec2; b: Vec2 }
);

export type GdtSymbol = "straight" | "flat" | "circ" | "cyl" | "prof" | "par" | "perp" | "angle" | "pos" | "conc" | "sym" | "runout";

export type DrawingDoc = {
  id: string;
  name: string;
  /** DrawingOptions (volně typované – definice je v cad/drawing.ts) */
  options: Record<string, unknown>;
  /** razítko: číslo, autor, revize… */
  meta: Record<string, unknown>;
  annotations: DrawingAnnotation[];
};

// ---------------- vazby sestavy ----------------

export type MateType = "mate" | "flush" | "concentric" | "distance" | "angle" | "parallel" | "fixed"
  // pokročilé a mechanické vazby (cad/mates-kin.ts) – řeší je i globální řešič stupňů volnosti
  | "perpendicular" | "tangent" | "coincident" | "symmetric" | "width" | "path" | "slot" | "hinge" | "lock" | "limitDistance" | "limitAngle"
  | "gear" | "rack" | "screw" | "cam" | "universal";
/**
 * Odkaz na plochu komponenty nejvyšší úrovně; `leaf` = cesta listu („a/b“) u podsestav, `face` = index plochy v dílu (−1 = doplní se automaticky podle `radius`).
 * `ent` = druh entity: bez hodnoty plocha, „edge“ = hrana (index hrany), „vertex“ = vrchol (index vrcholu).
 */
export type MateRef = { compId: string; leaf?: string; face: number; radius?: number; ent?: "edge" | "vertex" };
/**
 * Trvalá vazba sestavy – řeší se postupně při každé změně (viz cad/mates.ts). `a` = pohyblivá komponenta, `b` = cíl.
 * `c`, `d` = další odkazy (Symetricky: rovina souměrnosti; Šířka: druhá plocha jazýčku / drážky; Drážka: druhý konec; Závěs: dosedací roviny).
 * `value` = hodnota (Vzdálenost mm, Úhel °, Ozubení převodový poměr, Šroub stoupání mm, Hřeben dráha na otáčku mm, Drážka poloha mm);
 * `min` / `max` = meze; `phase` = výchozí stav stupňů volnosti zachycený při prvním řešení (úhly °, posuvy mm); `rel` = poloha A vůči B (Zámek).
 */
export type Mate = {
  id: string; type: MateType; a: MateRef; b: MateRef; value?: number; flip?: boolean; center?: boolean; suppressed?: boolean; name?: string;
  c?: MateRef; d?: MateRef; min?: number; max?: number; phase?: number[]; rel?: Placement;
};
/** Motor pohybové studie: rotační (° na vazbě Souosost / Závěs / Šroub) nebo lineární (mm na vazbě Vzdálenost / Drážka / Dráha / Souosost). */
export type MotionMotor = { id: string; kind: "rotary" | "linear"; mate: string; from: number; to: number; /** rychlost místo rozsahu: ot/min (rotační) / mm/s (lineární) */ speed?: number };
/** Pohybová studie uložená v sestavě (cad/motion.ts): motory, délka [s], počet kroků, kontrola kolizí, stopa bodu komponenty. */
export type MotionStudy = { motors: MotionMotor[]; duration: number; steps: number; collisions?: boolean; trace?: { compId: string; point: Vec3 }; loop?: boolean };
