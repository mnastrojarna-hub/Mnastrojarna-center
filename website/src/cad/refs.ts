/**
 * Referenční systém zadání („vrstva zadání“): odkazy na geometrii (bod, směr, rovina, osa), ukončení vysunutí
 * a definice rovin. Čisté typy a popisky – bez jádra. Řešení odkazů na skutečnou geometrii dělá `ref-resolve.ts`
 * ve workeru při stavbě modelu, takže prvky zůstávají asociativní (změní-li se těleso, odkaz se přepočítá).
 */
import { tr } from "./i18n";
import type { Axis, PlaneName, Vec3 } from "./types";

/**
 * Otisk topologické entity – podle něj se odkaz znovu najde, když se po úpravě historie posunou indexy.
 * `t` typ plochy/křivky, `c` střed, `s` velikost (plocha / délka), `r` poloměr válcové / kulové plochy a kružnice (rozliší
 * souosé plochy se stejným středem), `n` počet entit téhož druhu v tělese při razítkování výběru (jen otisky výběru,
 * pick-sigs.ts: stejný počet = topologie se nezměnila). Starší otisky `r` ani `n` nemají.
 */
export type Sig = { t: string; c: Vec3; s: number; r?: number; n?: number };

/** Místo na hraně: začátek, konec, střed délky, střed kružnice/oblouku, nebo parametr 0–1. */
export type EdgeAt = "start" | "end" | "mid" | "center" | { t: number };

export type DerivedOp =
  | "mid" // střed mezi body (průměr)
  | "between" // bod mezi dvěma body v poměru v (0–1)
  | "offset" // bod + směr × v
  | "project" // kolmý průmět bodu do roviny plochy / na osu
  | "intersect" // průsečík přímky (hrana / směr) s rovinou (plocha)
  | "percent"; // bod v procentech délky hrany

export type Ref =
  | { kind: "xyz"; p: Vec3 }
  | { kind: "vertex"; index: number; sig?: Sig }
  | { kind: "edge"; index: number; at?: EdgeAt; sig?: Sig }
  | { kind: "face"; index: number; sig?: Sig }
  /** charakteristický bod entity skici (klíče jako u SketchRef: a, b, c, mid, center, p0…) */
  | { kind: "sketchPt"; sketchId: string; entityId: string; k: string }
  /** pomocná rovina (datum) – počátek / normála */
  | { kind: "datum"; featureId: string }
  /** počátek souřadnic nebo osa souřadnicového systému */
  | { kind: "csys"; axis?: Axis }
  /** pomocná osa (prvek datumAxis, nebo osa Z souřadného systému csys) – bod na ose + směr */
  | { kind: "datumAxis"; featureId: string }
  /** pomocný bod (prvek datumPoint, nebo počátek souřadného systému csys) */
  | { kind: "datumPoint"; featureId: string }
  | { kind: "derived"; op: DerivedOp; args: Ref[]; v?: number };

/** Ukončení vysunutí / díry / rotace (jako SolidWorks „End Condition“, NX „Limits“, ZW3D „End E“). */
export type Extent =
  | { kind: "blind"; d: number }
  | { kind: "throughAll" }
  | { kind: "toNext" }
  | { kind: "toVertex"; ref: Ref }
  | { kind: "toFace"; ref: Ref; offset?: number }
  | { kind: "offsetFromFace"; ref: Ref; d: number }
  | { kind: "toBody" }
  | { kind: "midPlane"; d: number };

export type ExtentKind = Extent["kind"];

/** Směr (vysunutí, osa díry, směr pole…). */
export type Direction =
  | { kind: "normal" } // normála roviny skici / plochy
  | { kind: "axis"; axis: Axis }
  | { kind: "edge"; ref: Ref } // podél hrany / osy válce
  | { kind: "twoPoints"; a: Ref; b: Ref }
  | { kind: "faceNormal"; ref: Ref }
  | { kind: "vector"; v: Vec3 }
  /**
   * sklon `deg` od normály skici směrem k `toward` (globální vektor promítnutý do roviny skici; chybí-li = osa X skici, tj. kolem osy Y
   * skici). „Obráceně“ u vysunutí zrcadlí směr přes rovinu skici (strana sklonu zůstane), je-li `toward` nebo `keepSide` (text, nový
   * formulář); starší dokumenty bez nich obrátí celý směr.
   */
  | { kind: "angle"; deg: number; toward?: Vec3; keepSide?: boolean }
  | { kind: "tangent"; ref: Ref }; // tečna hrany v bodě

/** Začátek vysunutí (SolidWorks „From“). */
export type StartFrom = { kind: "sketchPlane" } | { kind: "offset"; d: number } | { kind: "face"; ref: Ref } | { kind: "vertex"; ref: Ref };

/** Tenká stěna (SolidWorks „Thin Feature“, ZW3D „Offset → Thicken“). */
export type Thin = { side: "one" | "two" | "mid" | "in"; t1: number; t2?: number };

/** Osa rotace. */
export type AxisDef =
  | { kind: "sketchX" }
  | { kind: "sketchY" }
  | { kind: "sketchLine"; entityId: string }
  | { kind: "edge"; ref: Ref }
  | { kind: "twoPoints"; a: Ref; b: Ref }
  | { kind: "global"; axis: Axis }
  | { kind: "cylFace"; ref: Ref }
  | { kind: "datum"; featureId: string }
  /** průsečnice dvou rovin (rovinné plochy / pomocné roviny) */
  | { kind: "twoPlanes"; a: Ref; b: Ref }
  /** pomocná osa (prvek datumAxis / osa Z csys) */
  | { kind: "datumAxis"; featureId: string };

/** Definice roviny – 15 způsobů jako u referenční geometrie špičkových CADů. */
export type PlaneDef =
  | { kind: "base"; name: PlaneName; offset: number }
  | { kind: "face"; ref: Ref; offset?: number; flip?: boolean }
  | { kind: "threePoints"; a: Ref; b: Ref; c: Ref }
  | { kind: "pointLine"; p: Ref; line: Ref } // bod + přímka (hrana) ležící v rovině
  | { kind: "pointNormal"; p: Ref; dir: Direction } // bod + normála
  | { kind: "angle"; face: Ref; edge: Ref; deg: number } // rovina otočená kolem hrany od plochy
  | { kind: "mid"; a: Ref; b: Ref } // střední mezi dvěma rovnoběžnými plochami (jinak půlicí)
  | { kind: "tangentCyl"; face: Ref; through: Ref } // tečná k válci, rovnoběžná s rovinou/plochou `through`
  | { kind: "normalToCurve"; curve: Ref; at: Ref } // kolmá na hranu v bodě
  | { kind: "twoEdges"; a: Ref; b: Ref } // dvě rovnoběžné / různoběžné hrany
  | { kind: "datum"; featureId: string; offset?: number }
  | { kind: "custom"; origin: Vec3; normal: Vec3; xDir: Vec3 };

/** Rovina odvozená od zadání `PlaneDef` (výsledek řešení). */
export type ResolvedPlane = { origin: Vec3; normal: Vec3; xDir: Vec3 };

/** Vyřešený odkaz – podle druhu entity může mít bod, směr, rovinu, poloměr. */
export type Geo = { point?: Vec3; dir?: Vec3; plane?: ResolvedPlane; radius?: number; kindLabel?: string };

// ---------------- popisky a seznamy pro UI ----------------

export const EXTENT_KINDS: { v: ExtentKind; l: string; hint: string }[] = [
  { v: "blind", l: tr("Na vzdálenost"), hint: tr("slepé vysunutí o zadanou délku") },
  { v: "throughAll", l: tr("Skrz vše"), hint: tr("přes celé těleso") },
  { v: "toNext", l: tr("K dalšímu"), hint: tr("po nejbližší plochu tělesa (první stěna)") },
  { v: "toVertex", l: tr("K vrcholu"), hint: tr("po rovinu procházející vybraným bodem") },
  { v: "toFace", l: tr("K ploše"), hint: tr("po vybranou plochu (i zakřivenou)") },
  { v: "offsetFromFace", l: tr("Odsazeně od plochy"), hint: tr("po rovinu odsazenou od vybrané plochy") },
  { v: "toBody", l: tr("K tělesu"), hint: tr("po první stěnu stávajícího tělesa") },
  { v: "midPlane", l: tr("Střední rovina"), hint: tr("symetricky na obě strany (celková délka)") },
];

export const DIRECTION_KINDS: { v: Direction["kind"]; l: string }[] = [
  { v: "normal", l: tr("Kolmo na rovinu (normála)") },
  { v: "axis", l: tr("Osa X / Y / Z") },
  { v: "edge", l: tr("Podél hrany / osy válce") },
  { v: "twoPoints", l: tr("Dvěma body") },
  { v: "faceNormal", l: tr("Normála plochy") },
  { v: "vector", l: tr("Vektor (čísla)") },
  { v: "angle", l: tr("Pod úhlem od normály") },
  { v: "tangent", l: tr("Tečna křivky") },
];

export const START_KINDS: { v: StartFrom["kind"]; l: string }[] = [
  { v: "sketchPlane", l: tr("Rovina skici") },
  { v: "offset", l: tr("Odsazení od roviny skici") },
  { v: "face", l: tr("Od plochy") },
  { v: "vertex", l: tr("Od vrcholu") },
];

export const THIN_SIDES: { v: Thin["side"]; l: string }[] = [
  { v: "one", l: tr("Ven") },
  { v: "in", l: tr("Dovnitř") },
  { v: "mid", l: tr("Na střed") },
  { v: "two", l: tr("Dvě tloušťky") },
];

export const AXIS_KINDS: { v: AxisDef["kind"]; l: string }[] = [
  { v: "sketchY", l: tr("Osa Y skici (svislá)") },
  { v: "sketchX", l: tr("Osa X skici (vodorovná)") },
  { v: "sketchLine", l: tr("Čára ve skici") },
  { v: "edge", l: tr("Hrana modelu") },
  { v: "cylFace", l: tr("Osa válcové plochy") },
  { v: "twoPoints", l: tr("Dva body") },
  { v: "global", l: tr("Globální osa X / Y / Z") },
  { v: "datum", l: tr("Pomocná rovina (normála)") },
  { v: "twoPlanes", l: tr("Průsečnice dvou rovin") },
  { v: "datumAxis", l: tr("Pomocná osa / osa Z souř. systému") },
];

export const PLANE_KINDS: { v: PlaneDef["kind"]; l: string }[] = [
  { v: "base", l: tr("Základní rovina + odsazení") },
  { v: "face", l: tr("Rovnoběžně s plochou (+ odsazení)") },
  { v: "threePoints", l: tr("Třemi body") },
  { v: "pointLine", l: tr("Bodem a přímkou") },
  { v: "pointNormal", l: tr("Bodem a normálou") },
  { v: "angle", l: tr("Pod úhlem k ploše kolem hrany") },
  { v: "mid", l: tr("Střední mezi dvěma plochami") },
  { v: "tangentCyl", l: tr("Tečně k válci") },
  { v: "normalToCurve", l: tr("Kolmo na křivku v bodě") },
  { v: "twoEdges", l: tr("Dvěma hranami") },
  { v: "datum", l: tr("Pomocná rovina (+ odsazení)") },
  { v: "custom", l: tr("Vlastní (počátek, normála, X)") },
];

/** Volby zadání bodu (pravé tlačítko ve vstupním poli bodu, jako ZW3D „Input Point Options“). */
export type PointOption = { id: string; label: string; hint: string; picks: { want: "vertex" | "edge" | "face" | "point"; label: string }[]; make: (refs: Ref[], v?: number) => Ref; needsValue?: { label: string; def: number } };

export const POINT_OPTIONS: PointOption[] = [
  { id: "vertex", label: tr("Vrchol / koncový bod"), hint: tr("klikněte na vrchol tělesa"), picks: [{ want: "vertex", label: "vrchol" }], make: ([a]) => a },
  { id: "edgeMid", label: tr("Střed hrany"), hint: tr("klikněte na hranu – bod v polovině délky"), picks: [{ want: "edge", label: "hrana" }], make: ([a]) => (a.kind === "edge" ? { ...a, at: "mid" } : a) },
  { id: "edgeStart", label: tr("Začátek hrany"), hint: tr("klikněte na hranu"), picks: [{ want: "edge", label: "hrana" }], make: ([a]) => (a.kind === "edge" ? { ...a, at: "start" } : a) },
  { id: "edgeEnd", label: tr("Konec hrany"), hint: tr("klikněte na hranu"), picks: [{ want: "edge", label: "hrana" }], make: ([a]) => (a.kind === "edge" ? { ...a, at: "end" } : a) },
  { id: "center", label: tr("Střed kružnice / oblouku"), hint: tr("klikněte na kruhovou hranu"), picks: [{ want: "edge", label: tr("kruhová hrana") }], make: ([a]) => (a.kind === "edge" ? { ...a, at: "center" } : a) },
  { id: "faceCenter", label: tr("Střed plochy"), hint: tr("klikněte na plochu – těžiště"), picks: [{ want: "face", label: "plocha" }], make: ([a]) => a },
  { id: "percent", label: tr("Bod na hraně v % délky"), hint: tr("klikněte na hranu a zadejte procenta"), picks: [{ want: "edge", label: "hrana" }], make: ([a], v) => (a.kind === "edge" ? { ...a, at: { t: Math.max(0, Math.min(1, (v ?? 50) / 100)) } } : a), needsValue: { label: tr("Poloha na hraně (%)"), def: 50 } },
  { id: "mid", label: tr("Střed mezi dvěma body"), hint: tr("vyberte dva body"), picks: [{ want: "point", label: tr("1. bod") }, { want: "point", label: tr("2. bod") }], make: (refs) => ({ kind: "derived", op: "mid", args: refs }) },
  { id: "between", label: tr("Mezi dvěma body (poměr)"), hint: tr("vyberte dva body a zadejte poměr 0–1"), picks: [{ want: "point", label: tr("1. bod") }, { want: "point", label: tr("2. bod") }], make: (refs, v) => ({ kind: "derived", op: "between", args: refs, v: v ?? 0.5 }), needsValue: { label: tr("Poměr (0 = první bod, 1 = druhý)"), def: 0.5 } },
  { id: "offset", label: tr("Odsazený bod podél hrany"), hint: tr("bod + hrana udávající směr + vzdálenost"), picks: [{ want: "point", label: "bod" }, { want: "edge", label: tr("hrana (směr)") }], make: (refs, v) => ({ kind: "derived", op: "offset", args: refs, v: v ?? 10 }), needsValue: { label: tr("Vzdálenost (mm)"), def: 10 } },
  { id: "project", label: tr("Průmět bodu na plochu"), hint: tr("bod + plocha"), picks: [{ want: "point", label: "bod" }, { want: "face", label: "plocha" }], make: (refs) => ({ kind: "derived", op: "project", args: refs }) },
  { id: "intersect", label: tr("Průsečík hrany s plochou"), hint: tr("přímá hrana + plocha"), picks: [{ want: "edge", label: "hrana" }, { want: "face", label: "plocha" }], make: (refs) => ({ kind: "derived", op: "intersect", args: refs }) },
  { id: "origin", label: tr("Počátek souřadnic"), hint: tr("bod 0, 0, 0"), picks: [], make: () => ({ kind: "csys" }) },
  { id: "xyz", label: tr("Zadat souřadnice…"), hint: tr("X, Y, Z v mm (nebo @dx,dy,dz od posledního bodu)"), picks: [], make: (refs) => refs[0] ?? { kind: "xyz", p: [0, 0, 0] } },
];

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace(".", ",");
export const fmtVec = (p: Vec3) => `${fmt(p[0])}; ${fmt(p[1])}; ${fmt(p[2])}`;

export function edgeAtLabel(at?: EdgeAt): string {
  if (!at) return "";
  if (typeof at === "object") return ` · ${Math.round(at.t * 100)} %`;
  return { start: tr(" · začátek"), end: tr(" · konec"), mid: tr(" · střed"), center: tr(" · střed kružnice") }[at];
}

/** Krátký popisek odkazu pro formulář. */
export function refLabel(ref: Ref | null | undefined): string {
  if (!ref) return tr("— nevybráno —");
  switch (ref.kind) {
    case "xyz":
      return tr("Bod {0}", fmtVec(ref.p));
    case "vertex":
      return tr("Vrchol {0}", ref.index + 1);
    case "edge":
      return tr("Hrana {0}{1}", ref.index + 1, edgeAtLabel(ref.at));
    case "face":
      return tr("Plocha {0}", ref.index + 1);
    case "sketchPt":
      return tr("Bod skici ({0})", ref.k);
    case "datum":
      return tr("Pomocná rovina");
    case "datumAxis":
      return tr("Pomocná osa");
    case "datumPoint":
      return tr("Pomocný bod");
    case "csys":
      return ref.axis ? tr("Osa {0}", ref.axis) : tr("Počátek");
    case "derived": {
      const op = { mid: tr("Střed mezi"), between: tr("Mezi"), offset: tr("Odsazení od"), project: tr("Průmět"), intersect: tr("Průsečík"), percent: tr("Bod na") }[ref.op];
      return `${op}: ${ref.args.map((a) => refLabel(a)).join(" + ")}${ref.v != null ? ` (${fmt(ref.v)})` : ""}`;
    }
  }
}

export function extentLabel(e: Extent | undefined): string {
  if (!e) return tr("Na vzdálenost");
  const k = EXTENT_KINDS.find((x) => x.v === e.kind)?.l ?? e.kind;
  if (e.kind === "blind" || e.kind === "midPlane") return `${k} ${fmt(e.d)} mm`;
  if (e.kind === "toVertex" || e.kind === "toFace" || e.kind === "offsetFromFace") return `${k} (${refLabel(e.ref)})`;
  return k;
}

export function directionLabel(d: Direction | undefined): string {
  if (!d || d.kind === "normal") return tr("Normála");
  if (d.kind === "axis") return tr("Osa {0}", d.axis);
  if (d.kind === "vector") return tr("Vektor {0}", fmtVec(d.v));
  if (d.kind === "angle") return d.toward ? tr("Úhel {0}° k {1}", fmt(d.deg), fmtVec(d.toward)) : tr("Úhel {0}°", fmt(d.deg));
  if (d.kind === "twoPoints") return `${refLabel(d.a)} → ${refLabel(d.b)}`;
  return `${DIRECTION_KINDS.find((x) => x.v === d.kind)?.l}: ${refLabel(d.ref)}`;
}

export function planeDefLabel(p: PlaneDef | undefined): string {
  if (!p) return "—";
  switch (p.kind) {
    case "base":
      return tr("Rovina {0}{1}", p.name, p.offset ? ` ${p.offset > 0 ? "+" : ""}${fmt(p.offset)} mm` : "");
    case "face":
      return `${refLabel(p.ref)}${p.offset ? ` ${p.offset > 0 ? "+" : ""}${fmt(p.offset)} mm` : ""}${p.flip ? tr(" (obráceně)") : ""}`;
    case "threePoints":
      return tr("3 body: {0}", [p.a, p.b, p.c].map((x) => refLabel(x)).join(", "));
    case "pointLine":
      return `${refLabel(p.p)} + ${refLabel(p.line)}`;
    case "pointNormal":
      return `${refLabel(p.p)} ⟂ ${directionLabel(p.dir)}`;
    case "angle":
      return tr("{0}° k {1} kolem {2}", fmt(p.deg), refLabel(p.face), refLabel(p.edge));
    case "mid":
      return tr("Střední: {0} / {1}", refLabel(p.a), refLabel(p.b));
    case "tangentCyl":
      return tr("Tečně k {0} ∥ {1}", refLabel(p.face), refLabel(p.through));
    case "normalToCurve":
      return tr("Kolmo na {0} v {1}", refLabel(p.curve), refLabel(p.at));
    case "twoEdges":
      return `${refLabel(p.a)} + ${refLabel(p.b)}`;
    case "datum":
      return tr("Pomocná rovina{0}", p.offset ? ` ${p.offset > 0 ? "+" : ""}${fmt(p.offset)} mm` : "");
    case "custom":
      return tr("Vlastní ({0})", fmtVec(p.origin));
  }
}

/** Výchozí hodnota ukončení daného druhu (při přepnutí v UI). */
export function defaultExtent(kind: ExtentKind, d = 20): Extent {
  switch (kind) {
    case "blind":
      return { kind, d };
    case "midPlane":
      return { kind, d };
    case "toVertex":
      return { kind, ref: { kind: "vertex", index: -1 } };
    case "toFace":
      return { kind, ref: { kind: "face", index: -1 } };
    case "offsetFromFace":
      return { kind, ref: { kind: "face", index: -1 }, d: 5 };
    default:
      return { kind } as Extent;
  }
}

/** Odkazy obsažené v hodnotě (pro kontrolu úplnosti zadání). */
export function refsOf(v: unknown, out: Ref[] = []): Ref[] {
  if (!v || typeof v !== "object") return out;
  const o = v as Record<string, unknown>;
  if (typeof o.kind === "string" && ["xyz", "vertex", "edge", "face", "sketchPt", "datum", "csys", "derived"].includes(o.kind) && !("ref" in o) && !("a" in o && "b" in o && !("args" in o))) {
    out.push(v as Ref);
    if (o.kind === "derived") (o.args as Ref[]).forEach((a) => refsOf(a, out));
    return out;
  }
  for (const k of Object.keys(o)) refsOf(o[k], out);
  return out;
}

/** Je odkaz „placeholder“ (ještě nebyl vybrán)? */
export function isPlaceholder(ref: Ref | undefined): boolean {
  return !!ref && (ref.kind === "vertex" || ref.kind === "edge" || ref.kind === "face") && ref.index < 0;
}

export const NO_REF: Ref = { kind: "vertex", index: -1 };
export const NO_FACE: Ref = { kind: "face", index: -1 };
export const NO_EDGE: Ref = { kind: "edge", index: -1 };
