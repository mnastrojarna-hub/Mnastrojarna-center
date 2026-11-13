/**
 * Zadávání pokročilých a mechanických vazeb (panel sestavy i textové příkazy): které entity vazba potřebuje (plochy, hrany,
 * vrcholy – postupně a, b, c, d), na které komponentě, jaké hodnoty a výchozí hodnoty z geometrie. Čisté funkce.
 */
import type { FaceGeo, KinMateType, PendingMate } from "./mates";
import type { MateRef, MateType } from "./types";

/** Druh entity: plochy (rovina, válec/kužel, koule, libovolná plocha), hrany (úsečka, kružnice, křivka, libovolná hrana), vrchol. */
export type EntKind = "plane" | "cylinder" | "sphere" | "face" | "line" | "circle" | "curve" | "edge" | "vertex";
export type SlotKey = "a" | "b" | "c" | "d";
/** Krok zadání: `side` = komponenta (self = vybraná pohyblivá, target = cílová, any = libovolná), `label` = česky (tr při zobrazení). */
export type SlotSpec = { key: SlotKey; side: "self" | "target" | "any"; kinds: EntKind[]; label: string; optional?: boolean };
export type ParamSpec = { key: "value" | "min" | "max"; label: string; suffix: string; step: number };
export type KinSpec = { group: "advanced" | "mechanical"; slots: SlotSpec[]; params: ParamSpec[]; flip?: string; hint: string };

const AXIS: EntKind[] = ["cylinder", "line"];
const PT: EntKind[] = ["vertex", "sphere", "circle"];

export const KIN_SPEC: Record<KinMateType, KinSpec> = {
  perpendicular: { group: "advanced", hint: "Rovina nebo osa A kolmo na rovinu nebo osu B", params: [], slots: [{ key: "a", side: "self", kinds: ["plane", ...AXIS], label: "Rovina / osa této komponenty" }, { key: "b", side: "target", kinds: ["plane", ...AXIS], label: "Rovina / osa cílové komponenty" }] },
  tangent: {
    group: "advanced",
    hint: "Válec, koule nebo rovina se dotýká válce, koule nebo roviny",
    params: [],
    flip: "Vnitřní dotyk / druhá strana roviny",
    slots: [{ key: "a", side: "self", kinds: ["plane", "cylinder", "sphere"], label: "Plocha této komponenty" }, { key: "b", side: "target", kinds: ["plane", "cylinder", "sphere"], label: "Plocha cílové komponenty" }],
  },
  coincident: {
    group: "advanced",
    hint: "Vrchol, střed koule / kružnice nebo osa na vrchol, rovinu nebo osu",
    params: [],
    slots: [{ key: "a", side: "self", kinds: [...PT, ...AXIS, "plane"], label: "Bod / osa / rovina této komponenty" }, { key: "b", side: "target", kinds: [...PT, ...AXIS, "plane"], label: "Bod / osa / rovina cílové komponenty" }],
  },
  symmetric: {
    group: "advanced",
    hint: "Plocha A je zrcadlovým obrazem plochy B podle roviny souměrnosti",
    params: [],
    flip: "Opačná orientace normál",
    slots: [
      { key: "a", side: "self", kinds: ["plane", "cylinder", ...PT], label: "Plocha této komponenty" },
      { key: "b", side: "target", kinds: ["plane", "cylinder", ...PT], label: "Protější plocha" },
      { key: "c", side: "any", kinds: ["plane"], label: "Rovina souměrnosti (libovolná komponenta)" },
    ],
  },
  width: {
    group: "advanced",
    hint: "Jazýček (dvě plochy nebo čep) uprostřed drážky (dvě stěny)",
    params: [],
    slots: [
      { key: "a", side: "self", kinds: ["plane", "cylinder"], label: "1. plocha jazýčku (nebo čep)" },
      { key: "c", side: "self", kinds: ["plane"], label: "2. plocha jazýčku", optional: true },
      { key: "b", side: "target", kinds: ["plane"], label: "1. stěna drážky" },
      { key: "d", side: "target", kinds: ["plane"], label: "2. stěna drážky" },
    ],
  },
  path: { group: "advanced", hint: "Bod komponenty se pohybuje po hraně (úsečka, kružnice, křivka)", params: [], slots: [{ key: "a", side: "self", kinds: PT, label: "Bod této komponenty (vrchol, střed)" }, { key: "b", side: "target", kinds: ["edge"], label: "Dráha – hrana cílové komponenty" }] },
  slot: {
    group: "advanced",
    hint: "Čep se pohybuje v drážce mezi jejími konci",
    params: [],
    slots: [
      { key: "a", side: "self", kinds: ["cylinder"], label: "Čep (válcová plocha)" },
      { key: "b", side: "target", kinds: ["cylinder"], label: "1. konec drážky (válcová plocha)" },
      { key: "c", side: "target", kinds: ["cylinder"], label: "2. konec drážky (válcová plocha)" },
    ],
  },
  hinge: {
    group: "advanced",
    hint: "Souosost + dosedací roviny (nebo pevná osová poloha) – otáčení kolem osy",
    params: [],
    slots: [
      { key: "a", side: "self", kinds: ["cylinder"], label: "Osa (válcová plocha) této komponenty" },
      { key: "b", side: "target", kinds: ["cylinder"], label: "Osa (válcová plocha) cílové komponenty" },
      { key: "c", side: "self", kinds: ["plane"], label: "Dosedací rovina této komponenty", optional: true },
      { key: "d", side: "target", kinds: ["plane"], label: "Dosedací rovina cílové komponenty", optional: true },
    ],
  },
  lock: { group: "advanced", hint: "Komponenty drží vzájemnou polohu (jako jeden celek)", params: [], slots: [] },
  limitDistance: {
    group: "advanced",
    hint: "Vzdálenost ploch se smí měnit jen v rozsahu min–max",
    params: [
      { key: "min", label: "Min", suffix: "mm", step: 1 },
      { key: "max", label: "Max", suffix: "mm", step: 1 },
    ],
    flip: "Plochy souhlasně",
    slots: [{ key: "a", side: "self", kinds: ["plane", ...PT], label: "Plocha / bod této komponenty" }, { key: "b", side: "target", kinds: ["plane"], label: "Rovina cílové komponenty" }],
  },
  limitAngle: {
    group: "advanced",
    hint: "Úhel ploch / os se smí měnit jen v rozsahu min–max",
    params: [
      { key: "min", label: "Min", suffix: "°", step: 5 },
      { key: "max", label: "Max", suffix: "°", step: 5 },
    ],
    slots: [{ key: "a", side: "self", kinds: ["plane", ...AXIS], label: "Rovina / osa této komponenty" }, { key: "b", side: "target", kinds: ["plane", ...AXIS], label: "Rovina / osa cílové komponenty" }],
  },
  gear: {
    group: "mechanical",
    hint: "Kola se otáčejí kolem svých os v převodovém poměru (otáčky A : otáčky B = zuby B : zuby A)",
    params: [{ key: "value", label: "Převodový poměr A : B", suffix: "", step: 0.1 }],
    flip: "Stejný smysl otáčení (vnitřní ozubení, řemen)",
    slots: [{ key: "a", side: "self", kinds: AXIS, label: "Osa kola této komponenty" }, { key: "b", side: "target", kinds: AXIS, label: "Osa druhého kola" }],
  },
  rack: {
    group: "mechanical",
    hint: "Otočení pastorku posune hřeben (posuv na otáčku = π · roztečný průměr)",
    params: [{ key: "value", label: "Posuv hřebenu na otáčku", suffix: "mm", step: 1 }],
    flip: "Obrácený směr",
    slots: [{ key: "a", side: "self", kinds: AXIS, label: "Osa pastorku" }, { key: "b", side: "target", kinds: ["plane", "line", "cylinder"], label: "Hřeben – rovina zubů nebo hrana ve směru pohybu" }],
  },
  screw: {
    group: "mechanical",
    hint: "Souosost + otočení o otáčku posune o stoupání",
    params: [{ key: "value", label: "Stoupání", suffix: "mm", step: 0.25 }],
    flip: "Levý závit",
    slots: [{ key: "a", side: "self", kinds: ["cylinder"], label: "Válcová plocha této komponenty (matice)" }, { key: "b", side: "target", kinds: ["cylinder"], label: "Válcová plocha šroubu" }],
  },
  cam: {
    group: "mechanical",
    hint: "Zdvihátko (rovina, váleček, koule, hrot) zůstává v dotyku s plochou vačky",
    params: [],
    slots: [{ key: "a", side: "self", kinds: ["plane", "cylinder", "sphere", "vertex"], label: "Zdvihátko – rovina, váleček, koule nebo vrchol" }, { key: "b", side: "target", kinds: ["face"], label: "Plocha vačky" }],
  },
  universal: {
    group: "mechanical",
    hint: "Kardanův kloub: natočení výstupního hřídele podle vstupního (tan θ2 = tan θ1 / cos β)",
    params: [],
    slots: [{ key: "a", side: "self", kinds: AXIS, label: "Vstupní hřídel (osa)" }, { key: "b", side: "target", kinds: AXIS, label: "Výstupní hřídel (osa)" }],
  },
};

export const ADVANCED: KinMateType[] = ["perpendicular", "tangent", "coincident", "symmetric", "width", "path", "slot", "hinge", "lock", "limitDistance", "limitAngle"];
export const MECHANICAL: KinMateType[] = ["gear", "rack", "screw", "cam", "universal"];
export const isKinMode = (m: PendingMate["mode"]): m is KinMateType => m in KIN_SPEC;
/** Má pokročilá vazba číselnou hodnotu (poměr, stoupání, dráha na otáčku)? */
export const kinHasValue = (t: MateType) => t in KIN_SPEC && KIN_SPEC[t as KinMateType].params.some((p) => p.key === "value");
export const kinHasLimits = (t: MateType) => t === "limitDistance" || t === "limitAngle";

/** Druh entity z geometrie jádra (`ent` = hrana / vrchol). */
export function entKindOf(g: Pick<FaceGeo, "kind">, ent?: MateRef["ent"]): EntKind {
  if (ent === "vertex" || g.kind === "point") return "vertex";
  if (g.kind === "line" || g.kind === "circle" || g.kind === "curve") return g.kind;
  if (g.kind === "plane" || g.kind === "cylinder" || g.kind === "sphere") return g.kind;
  return "face";
}
const FACE_KINDS: EntKind[] = ["plane", "cylinder", "sphere", "face"];
const EDGE_KINDS: EntKind[] = ["line", "circle", "curve"];
/** Vyhoví entita kroku? */
export const accepts = (kinds: EntKind[], k: EntKind) => kinds.includes(k) || (kinds.includes("face") && FACE_KINDS.includes(k)) || (kinds.includes("edge") && EDGE_KINDS.includes(k));
/** Je potřeba v kroku plocha / hrana / vrchol? (seznamy v panelu) */
export const slotWants = (kinds: EntKind[]) => ({ face: kinds.some((k) => FACE_KINDS.includes(k)), edge: kinds.some((k) => k === "edge" || EDGE_KINDS.includes(k)), vertex: kinds.includes("vertex") });

/** Další nevyplněný krok rozpracované vazby (null = vše vybráno). */
export function nextSlot(p: PendingMate): SlotSpec | null {
  if (!isKinMode(p.mode)) return null;
  const skip = new Set(p.skip ?? []);
  for (const s of KIN_SPEC[p.mode].slots) if (!p[s.key] && !skip.has(s.key as "c" | "d")) return s;
  return null;
}

/** Komponenta, na které musí být entita kroku: self = vybraná, target = cíl (podle už vybraného B), any = kterákoli. */
export function slotCompOk(p: PendingMate, s: SlotSpec, compId: string): boolean {
  if (s.side === "self") return compId === p.compId;
  if (s.side === "target") return compId !== p.compId && (!p.b || s.key === "b" || p.b.compId === compId);
  return true;
}

/** Je rozpracovaná vazba připravená k vytvoření? (vybrané povinné kroky; Zámek = vybraná cílová komponenta) */
export function pendingReady(p: PendingMate): boolean {
  if (!isKinMode(p.mode)) return false;
  if (p.mode === "lock") return !!p.target;
  if (nextSlot(p)) return false;
  if (kinHasLimits(p.mode)) return p.min !== undefined || p.max !== undefined;
  return true;
}

/** Nepovinný krok přeskočit (Závěs bez dosedacích rovin vynechá obě, Šířka s čepem 2. plochu jazýčku). */
export function skipSlot(p: PendingMate, s: SlotSpec): PendingMate {
  const keys: ("c" | "d")[] = p.mode === "hinge" ? ["c", "d"] : [s.key as "c" | "d"];
  return { ...p, skip: [...new Set([...(p.skip ?? []), ...keys])] };
}

const ISO_PITCH: [number, number][] = [
  [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [20, 2.5], [24, 3], [30, 3.5], [36, 4], [42, 4.5], [48, 5],
];
/** Hrubé stoupání ISO podle průměru (výchozí hodnota vazby Šroub). */
export function isoPitch(d: number): number {
  let best = ISO_PITCH[0];
  for (const x of ISO_PITCH) if (Math.abs(x[0] - d) < Math.abs(best[0] - d)) best = x;
  return best[1];
}
const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

/**
 * Výchozí hodnoty z vybraných ploch (světové souřadnice): Ozubení poměr = rB / rA, Hřeben posuv = 2π·r pastorku, Šroub = hrubé
 * stoupání ISO podle průměru, meze = aktuální hodnota ± 10 mm / ± 15°.
 */
export function kinDefaults(type: KinMateType, A: FaceGeo | null, B: FaceGeo | null): { value?: number; min?: number; max?: number } {
  const rA = A?.radius ?? 0;
  const rB = B?.radius ?? 0;
  switch (type) {
    case "gear":
      return { value: rA > 0 && rB > 0 ? r4(rB / rA) : 1 };
    case "rack":
      return { value: r4(2 * Math.PI * (rA || 10)) };
    case "screw":
      return { value: isoPitch(2 * (rA || rB || 5)) };
    case "limitDistance": {
      if (!A || !B) return { min: 0, max: 10 };
      const n = B.normal;
      const g = (A.origin[0] - B.origin[0]) * n[0] + (A.origin[1] - B.origin[1]) * n[1] + (A.origin[2] - B.origin[2]) * n[2];
      return { min: Math.round(g) - 10, max: Math.round(g) + 10 };
    }
    case "limitAngle": {
      if (!A || !B) return { min: 0, max: 90 };
      const c = A.normal[0] * B.normal[0] + A.normal[1] * B.normal[1] + A.normal[2] * B.normal[2];
      const a = (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
      return { min: Math.max(0, Math.round(a) - 15), max: Math.min(180, Math.round(a) + 15) };
    }
    default:
      return {};
  }
}
