/**
 * Výkres → materiál, hmotnost, tepelné zpracování a povrchové úpravy (napojení Krok B).
 *
 * Čistý modul (klient i server): úklid výstupu AI (normalizeDrawingSpec), výchozí stav kontrolního
 * formuláře (initialSpecState), odhad polotovaru (recomputeSpecEstimate), sloupce DB (specColumns),
 * pravidlo „člověkem zadané se nepřepisuje" (mergeSpecPatch) a štítky pro přehledy (specChips).
 *
 * Výslovné stavy úprav — nikdy prázdné pole bez významu:
 *  - „uvedeno"    — na výkresu je úprava (kroky v pořadí, s hodnotami),
 *  - „bez"        — výkres přečten a úprava na něm není („Bez tepelného zpracování" / „Bez povrchové úpravy"),
 *  - „nezjisteno" — výkres nečitelný / AI neběžela („Nezjištěno — doplň").
 */
import {
  HEAT_KINDS, MATERIAL_GROUP_ORDER, MATERIAL_GROUPS, SURFACE_KINDS, classifyMaterial, findHardness, fold, isMaterialGroupKey,
  materialGroupFromText, parseTreatments,
  type HeatKind, type HeatTreatmentItem, type MaterialGroupKey, type SurfaceKind, type SurfaceTreatmentItem,
} from "@/lib/jobs/material-groups";
import {
  BLANK_SHAPE_LABELS, analyzeDrawingMaterial, formatKg, parseDimensionText, type BlankShape, type WeightSource,
} from "@/lib/jobs/blank-weight";

// ═════════════════════════════════════════════════════════════════════════
// Typy
// ═════════════════════════════════════════════════════════════════════════

export type TreatmentStatus = "uvedeno" | "bez" | "nezjisteno";
export const TREATMENT_STATUSES: readonly TreatmentStatus[] = ["uvedeno", "bez", "nezjisteno"];

export type HeatStepKind = Exclude<HeatKind, "bez_tz">;
export type SurfaceStepKind = Exclude<SurfaceKind, "bez_upravy">;
export const HEAT_STEP_KINDS = Object.keys(HEAT_KINDS).filter((k) => k !== "bez_tz") as HeatStepKind[];
export const SURFACE_STEP_KINDS = Object.keys(SURFACE_KINDS).filter((k) => k !== "bez_upravy") as SurfaceStepKind[];

export const HARDNESS_UNITS = ["HRC", "HV", "HB", "HRB", "HRA", "MPa"] as const;
export type HardnessUnit = (typeof HARDNESS_UNITS)[number] | "";

/** Krok tepelného zpracování (pořadí = pořadí na výkresu). Texty jsou česky psaná čísla („58±2", „0,8-1,2"). */
export interface HeatStep {
  kind: HeatStepKind;
  /** Hodnota tvrdosti / pevnosti („58±2", „55-60", „min. 600"), "" = neuvedeno. */
  value: string;
  unit: HardnessUnit;
  /** Hloubka vrstvy v mm („0,3", „0,8-1,2"), "" = neuvedeno. */
  depthMm: string;
  /** Upřesnění („vakuově", „jen čep Ø20", „HV1"). */
  note: string;
}

/** Krok povrchové úpravy (pořadí = pořadí na výkresu). */
export interface SurfaceStep {
  kind: SurfaceStepKind;
  /** Specifikace („Fe/Zn 8 modrá pasivace", „RAL 9005", „tvrdý elox"), "" = neuvedeno. */
  spec: string;
  /** Tloušťka vrstvy v µm („8", „15-20"), "" = neuvedeno. */
  thicknessUm: string;
}

/** Tvar dílu podle AI (nápověda pro odhad polotovaru). */
export type ShapeHint = "kulatina" | "trubka" | "sestihran" | "ctyrhran" | "hranol" | "plech" | "odlitek" | "";
export const SHAPE_HINTS: readonly Exclude<ShapeHint, "">[] = ["kulatina", "trubka", "sestihran", "ctyrhran", "hranol", "plech", "odlitek"];

/** Nová pole DrawingExtract (volitelná — starší vytěžení je nemají). */
export interface DrawingSpecExtract {
  materialGroup: MaterialGroupKey | "";
  /** Až 3 největší obrysové rozměry v mm, sestupně. */
  overallDims: number[];
  shapeHint: ShapeHint;
  /** Rozměr polotovaru, je-li na výkresu zvlášť (pole „Polotovar"). */
  blankDimensions: string;
  heatStatus: TreatmentStatus;
  heatSteps: HeatStep[];
  surfaceStatus: TreatmentStatus;
  surfaceSteps: SurfaceStep[];
  /** VŠECHNY poznámky výkresu (technické požadavky, obecné tolerance, nekótované hrany…), 1 položka = 1 poznámka. */
  drawingNotes: string[];
}

/** Skupiny údajů, u kterých se hlídá „kdo zadal" (spec_sources). */
export type SpecGroupKey = "material_group" | "material_designation" | "weight" | "blank" | "heat" | "surface" | "notes";
export const SPEC_GROUP_KEYS: readonly SpecGroupKey[] = ["material_group", "material_designation", "weight", "blank", "heat", "surface", "notes"];
export type SpecSource = "ai" | "rucne";

/** Stav sekce „Materiál a úpravy" kontrolního formuláře výkresu. */
export interface DrawingSpecState {
  materialGroup: MaterialGroupKey | "";
  /** Hmotnost dílu (kg, česky) — z výkresu, odhad nebo ručně. */
  weightKg: string;
  weightSource: WeightSource | "";
  /** Hmotnost polotovaru (kg) — vždy odhad, dokud ji člověk nepřepíše. */
  blankWeightKg: string;
  blankDims: string;
  blankShape: BlankShape | "";
  /** Jak se odhad počítal („plochá tyč 125 × 90 × 30 mm ≈ 2,6 kg, …"). */
  blankNote: string;
  heatStatus: TreatmentStatus;
  heatSteps: HeatStep[];
  surfaceStatus: TreatmentStatus;
  surfaceSteps: SurfaceStep[];
  /** Poznámky výkresu, 1 řádek = 1 poznámka. */
  notes: string;
  /** Sekce, které člověk upravil (zdroj „rucne"; odhad polotovaru se pak už nepřepočítá). */
  manual: SpecGroupKey[];
}

/** Sloupce na drawings i order_items (migrace 20261023130000 + 20261023158000). */
export interface DrawingSpecColumns {
  material_group: MaterialGroupKey | null;
  material_designation: string | null;
  material_condition: string | null;
  weight_kg: number | null;
  weight_source: WeightSource | null;
  blank_weight_kg: number | null;
  blank_dims: string | null;
  blank_shape: BlankShape | null;
  heat_status: TreatmentStatus | null;
  heat_steps: HeatStep[] | null;
  heat_treatment: string | null;
  hardness: string | null;
  surface_status: TreatmentStatus | null;
  surface_steps: SurfaceStep[] | null;
  surface_treatment: string | null;
  drawing_notes: string | null;
}
export type SpecSources = Partial<Record<SpecGroupKey, SpecSource>>;

export const SPEC_GROUP_COLUMNS: Record<SpecGroupKey, (keyof DrawingSpecColumns)[]> = {
  material_group: ["material_group"],
  material_designation: ["material_designation", "material_condition"],
  weight: ["weight_kg", "weight_source"],
  blank: ["blank_weight_kg", "blank_dims", "blank_shape"],
  heat: ["heat_status", "heat_steps", "heat_treatment", "hardness"],
  surface: ["surface_status", "surface_steps", "surface_treatment"],
  notes: ["drawing_notes"],
};
export const SPEC_COLUMN_NAMES = Object.values(SPEC_GROUP_COLUMNS).flat();

export const SPEC_GROUP_LABEL: Record<SpecGroupKey, string> = {
  material_group: "skupina materiálu",
  material_designation: "označení materiálu",
  weight: "hmotnost dílu",
  blank: "polotovar",
  heat: "tepelné zpracování",
  surface: "povrchová úprava",
  notes: "poznámky výkresu",
};

// ═════════════════════════════════════════════════════════════════════════
// Pomocné
// ═════════════════════════════════════════════════════════════════════════

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : typeof v === "number" && Number.isFinite(v) ? String(v).replace(".", ",") : "";
}

/** „1,5" / "1.5" / 1.5 → 1.5; jinak null. */
export function parseDecimal(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const t = v.replace(/\s/g, "").replace(",", ".").replace(/kg$/i, "");
  if (!t || !/^\d*\.?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** 1.234 → „1,234" (bez zbytečných nul). */
export function decimalText(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n * 1000) / 1000).replace(".", ",");
}

export function isTreatmentStatus(v: unknown): v is TreatmentStatus {
  return typeof v === "string" && (TREATMENT_STATUSES as readonly string[]).includes(v);
}

/**
 * Stav z volného textu (fixtures, starší vytěžení, pole TZ „žádné"). Nejistota se testuje první
 * („not readable" ≠ „no"), „bez" jen celé slovo / začátek „bez…".
 */
export function statusFrom(v: unknown): TreatmentStatus | null {
  if (isTreatmentStatus(v)) return v;
  if (typeof v !== "string") return null;
  const f = fold(v).replace(/[\s_-]+/g, "");
  if (!f) return null;
  if (/^(nezjist|nezna|unknown|nejist|necitel|neciteln|notreadable|notlegible|unreadable|illegible|unclear|uncertain|na$|n\/a$|\?+$)/.test(f)) return "nezjisteno";
  if (/^bez/.test(f) || /^(zadn[aeyo]?|none|no|nothing|ohne|kein[e]?|neni|nein|without)$/.test(f)) return "bez";
  if (/^(uvedeno|ano|yes|stated|present)$/.test(f)) return "uvedeno";
  return null;
}

/** „hrc" / „HV10" / „N/mm²" → jednotka seznamu, jinak "". */
export function hardnessUnit(v: unknown): HardnessUnit {
  if (typeof v !== "string") return "";
  const u = v.replace(/\s/g, "").toUpperCase();
  if (!u) return "";
  if (u.startsWith("HRC")) return "HRC";
  if (u.startsWith("HRB")) return "HRB";
  if (u.startsWith("HRA")) return "HRA";
  if (u.startsWith("HV")) return "HV";
  if (u.startsWith("HB")) return "HB";
  if (u === "MPA" || u.startsWith("N/MM")) return "MPa";
  return "";
}

/** „58±2 HRC" → { value: "58±2", unit: "HRC" } (jednotka na konci textu hodnoty). */
function splitValueUnit(value: string, unit: HardnessUnit): { value: string; unit: HardnessUnit; note: string } {
  const m = /^(.*?)\s*(HRC|HRB|HRA|HBW|HB|HV\d{0,2}|MPa|N\/mm²|N\/mm2)$/i.exec(value);
  if (!m) return { value, unit, note: "" };
  const u = hardnessUnit(m[2]);
  const note = /^HV\d+$/i.test(m[2]) ? m[2].toUpperCase() : "";
  return { value: m[1].trim(), unit: unit || u, note };
}

const cleanMm = (v: unknown) => str(v, 30).replace(/\s*mm$/i, "").replace(/(\d)\.(\d)/g, "$1,$2");
const cleanUm = (v: unknown) => str(v, 30).replace(/\s*(µm|um|μm|mikr\w*)$/i, "").replace(/(\d)\.(\d)/g, "$1,$2");

function heatKindFrom(v: unknown, context: string): HeatStepKind | null {
  if (typeof v === "string" && (HEAT_STEP_KINDS as string[]).includes(v)) return v as HeatStepKind;
  const hit = parseTreatments(`${typeof v === "string" ? v : ""} ${context}`).heat.find((h) => h.kind !== "bez_tz");
  return (hit?.kind as HeatStepKind | undefined) ?? null;
}

function surfaceKindFrom(v: unknown, context: string): SurfaceStepKind | null {
  if (typeof v === "string" && (SURFACE_STEP_KINDS as string[]).includes(v)) return v as SurfaceStepKind;
  const hit = parseTreatments(`${typeof v === "string" ? v : ""} ${context}`).surface.find((s) => s.kind !== "bez_upravy");
  return (hit?.kind as SurfaceStepKind | undefined) ?? null;
}

/** Krok TZ z libovolného vstupu (AI, formulář) — neplatný druh = null. */
export function cleanHeatStep(raw: unknown): HeatStep | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const note0 = str(r.note, 200);
  const kind = heatKindFrom(r.kind, note0);
  if (!kind) return null;
  const sv = splitValueUnit(str(r.value, 40).replace(/(\d)\.(\d)/g, "$1,$2"), hardnessUnit(r.unit));
  const note = [note0, sv.note].filter(Boolean).join(", ").slice(0, 200);
  return { kind, value: sv.value, unit: sv.value || sv.unit ? sv.unit : "", depthMm: cleanMm(r.depthMm ?? r.depth), note };
}

/** Krok PÚ z libovolného vstupu (AI, formulář) — neplatný druh = null. */
export function cleanSurfaceStep(raw: unknown): SurfaceStep | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r) return null;
  const spec = str(r.spec, 200);
  const kind = surfaceKindFrom(r.kind, spec);
  if (!kind) return null;
  return { kind, spec, thicknessUm: cleanUm(r.thicknessUm ?? r.thickness) };
}

/**
 * Zápis tvrdosti tak, jak je ve zdrojovém textu („58±2 HRC", „58+2 HRC", „min. 55 HRC") — parseTreatments
 * vrací rozsah („56-60 HRC"); hodnota kroku má zůstat jako na výkresu. Jen tvar „číslo … jednotka".
 */
function rawHardness(source: string, value: string, used: Set<number>): string | null {
  if (!source) return null;
  const t = source.replace(/[‐-―−]/g, "-");
  for (const m of findHardness(t)) {
    if (m.value !== value || used.has(m.index)) continue;
    const raw = t.slice(m.index, m.index + m.length).replace(/\s+/g, " ").trim();
    if (!/^(?:(?:min|max)\.?\s*|[≥≤<>]=?\s*)?\d[\d.,\s±+\-–÷/]*\s*(?:HRC|HRB|HRA|HBW|HB|HV\d{0,2})$/i.test(raw)) continue;
    used.add(m.index);
    return raw.replace(/\s*±\s*/g, "±").replace(/(\d)\s*\+\s*(\d)/g, "$1+$2");
  }
  return null;
}

/** Výsledek parseTreatments → krok TZ (source = text, ze kterého se četlo — pro zápis tvrdosti). */
export function heatStepFromParsed(h: HeatTreatmentItem, source = "", used: Set<number> = new Set()): HeatStep | null {
  if (h.kind === "bez_tz") return null;
  let value = "", unit: HardnessUnit = "", note = h.detail ?? "";
  if (h.hardness) {
    const sv = splitValueUnit(rawHardness(source, h.hardness, used) ?? h.hardness, "");
    value = sv.value; unit = sv.unit;
    if (sv.note) note = [note, sv.note].filter(Boolean).join(", ");
  }
  return { kind: h.kind, value, unit, depthMm: (h.depth ?? "").replace(/\s*mm$/i, ""), note };
}

/** Výsledek parseTreatments → krok PÚ (tloušťka µm z detailu zvlášť). */
export function surfaceStepFromParsed(s: SurfaceTreatmentItem): SurfaceStep | null {
  if (s.kind === "bez_upravy") return null;
  const detail = s.detail ?? "";
  const um = /(\d+(?:[.,]\d+)?(?:\s*[-–]\s*\d+(?:[.,]\d+)?)?)\s*(?:µm|um|μm)/i.exec(detail);
  const spec = um ? detail.replace(um[0], "").replace(/^[\s,;]+|[\s,;]+$/g, "").replace(/\s*,\s*,/g, ",") : detail;
  return { kind: s.kind, spec, thicknessUm: um ? um[1].replace(/\s/g, "").replace(".", ",") : "" };
}

// ═════════════════════════════════════════════════════════════════════════
// Úklid výstupu AI (normalizeDrawing → DrawingExtract)
// ═════════════════════════════════════════════════════════════════════════

export interface SpecBaseText {
  material: string;
  heatTreatment: string;
  surfaceTreatment: string;
  notes: string;
}

function cleanNotes(raw: unknown, fallback: string): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\r?\n/) : [];
  const out: string[] = [];
  for (const v of list) {
    const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim().replace(/^[-•*·]\s*/, "").slice(0, 500) : "";
    if (t && !out.some((x) => fold(x) === fold(t))) out.push(t);
    if (out.length >= 40) break;
  }
  if (!out.length && fallback.trim()) {
    for (const part of fallback.split(/\r?\n|;\s+/)) {
      const t = part.trim().slice(0, 500);
      if (t) out.push(t);
    }
  }
  return out;
}

function cleanDims(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : [];
  const nums = list.map((v) => parseDecimal(typeof v === "string" ? v.replace(/\s*mm\s*$/i, "") : v)).filter((n): n is number => n !== null && n > 0 && n <= 6000);
  return nums.sort((a, b) => b - a).slice(0, 3).map((n) => Math.round(n * 100) / 100);
}

/** Skupina materiálu: jednoznačné označení má přednost, AI skupina je záloha (classifyMaterial). */
export function resolveMaterialGroup(material: string, aiGroup: unknown): MaterialGroupKey | "" {
  const ai = isMaterialGroupKey(aiGroup) ? aiGroup : materialGroupFromText(typeof aiGroup === "string" ? aiGroup : "");
  if (!material.trim()) return ai ?? "";
  const cls = classifyMaterial(material, ai);
  return cls.group;
}

/** Klíč označení materiálu pro porovnání (uklizené označení bez stavu dodání, mezer a diakritiky). */
export function materialKey(material: string): string {
  const t = material.trim();
  if (!t) return "";
  const cls = classifyMaterial(t, null);
  return fold(cls.normalizedDesignation.trim() || t).replace(/\+\s?[a-z]{1,3}\b/g, "").replace(/[\s.\-/]/g, "");
}

/**
 * Rozdíl materiálu objednávky (položky) a výkresu: null = shodné / jedno chybí; jinak „sameGroup"
 * (jiné označení, stejná skupina — třeba jen jiný zápis) nebo „group" (jiná skupina = jiná hustota, cena).
 */
export function materialDifference(itemMaterial: string, drawingMaterial: string): "sameGroup" | "group" | null {
  const a = materialKey(itemMaterial), b = materialKey(drawingMaterial);
  if (!a || !b || a === b) return null;
  return resolveMaterialGroup(itemMaterial, null) === resolveMaterialGroup(drawingMaterial, null) ? "sameGroup" : "group";
}

/** Položka s jiným materiálem z objednávky: skupina a odhad podle objednávky (ruční skupina zůstává). */
export function specForMaterial(spec: DrawingSpecState, material: string, ctx: Omit<SpecContext, "material">): DrawingSpecState {
  const group = spec.manual.includes("material_group") ? spec.materialGroup : resolveMaterialGroup(material, spec.materialGroup || null);
  return recomputeSpecEstimate({ ...spec, materialGroup: group }, { ...ctx, material });
}

/** Seznam z parseTreatments → kroky TZ (zápis tvrdosti ze zdrojového textu). */
export function heatStepsFromText(items: HeatTreatmentItem[], source: string): HeatStep[] {
  const used = new Set<number>();
  return items.map((h) => heatStepFromParsed(h, source, used)).filter((x): x is HeatStep => x !== null);
}

const toSurfaceSteps = (items: SurfaceTreatmentItem[]) => items.map(surfaceStepFromParsed).filter((x): x is SurfaceStep => x !== null);

/**
 * Stav dodání materiálu v poznámkách („42CrMo4+QT", „+A", „+N", „+SR") není krok tepelného zpracování
 * výkresu — při rozporu s „bez TZ" se nepočítá.
 */
const isConditionToken = (matched: string) => /^\s*\+|^\s*q\s?[+&]?\s?t\s*$/i.test(matched);

/** Výsledek úklidu: pole výkresu + rozpory (do needsClarification, kontrola se otevře). */
export interface NormalizedDrawingSpec extends DrawingSpecExtract {
  conflicts: string[];
}

/**
 * Nová pole výkresu z výstupu AI. Kroky úprav z AI mají přednost; chybí-li, rozpoznají se z textu
 * (pole TZ a PÚ spolu — AI občas zapíše nitridaci do PÚ nebo černění do TZ —, pak poznámky; starší
 * vytěžení, fixtures, nahrání do archivu). Stav je vždy výslovný. Výslovné „bez" (AI nebo pole) proti
 * kroku v poznámkách = rozpor → „nezjištěno" (kroky se nevymýšlí) + text rozporu.
 */
export function normalizeDrawingSpec(o: Record<string, unknown>, base: SpecBaseText): NormalizedDrawingSpec {
  const drawingNotes = cleanNotes(o.drawingNotes, base.notes);
  const notesText = drawingNotes.join(" | ");
  const fieldText = [base.heatTreatment, base.surfaceTreatment].map((t) => t.trim()).filter(Boolean).join(" | ");
  const fieldParse = parseTreatments(fieldText);
  const notesParse = parseTreatments(notesText);
  const conflicts: string[] = [];

  // tepelné zpracování
  let heatSteps = (Array.isArray(o.heatSteps) ? o.heatSteps : []).slice(0, 10).map(cleanHeatStep).filter((x): x is HeatStep => x !== null);
  let heatStatus = statusFrom(o.heatStatus);
  if (!heatSteps.length) {
    const fromField = heatStepsFromText(fieldParse.heat, fieldText);
    const fromNotes = heatStepsFromText(notesParse.heat, notesText);
    const fieldNone = fieldParse.heat.some((h) => h.kind === "bez_tz") || statusFrom(base.heatTreatment) === "bez";
    if (fromField.length) {
      heatSteps = fromField;
    } else if (heatStatus === "bez" || fieldNone) {
      const real = heatStepsFromText(notesParse.heat.filter((h) => !isConditionToken(h.matched)), notesText);
      if (real.length) {
        conflicts.push(`Tepelné zpracování: ${heatStatus === "bez" ? "AI" : "pole TZ"} uvádí „bez TZ", poznámky výkresu: ${formatHeatSteps(real)} — doplň.`);
        heatStatus = "nezjisteno";
      } else {
        heatStatus = "bez";
      }
    } else if (fromNotes.length) {
      heatSteps = fromNotes;
    } else if (notesParse.heat.some((h) => h.kind === "bez_tz")) {
      heatStatus = "bez";
    }
  }
  heatStatus = heatSteps.length ? "uvedeno" : heatStatus === "bez" ? "bez" : "nezjisteno";

  // povrchové úpravy
  let surfaceSteps = (Array.isArray(o.surfaceSteps) ? o.surfaceSteps : []).slice(0, 10).map(cleanSurfaceStep).filter((x): x is SurfaceStep => x !== null);
  let surfaceStatus = statusFrom(o.surfaceStatus);
  if (!surfaceSteps.length) {
    const fromField = toSurfaceSteps(fieldParse.surface);
    const fromNotes = toSurfaceSteps(notesParse.surface);
    const fieldNone = fieldParse.surface.some((s) => s.kind === "bez_upravy") || statusFrom(base.surfaceTreatment) === "bez";
    if (fromField.length) {
      surfaceSteps = fromField;
    } else if (surfaceStatus === "bez" || fieldNone) {
      if (fromNotes.length) {
        conflicts.push(`Povrchová úprava: ${surfaceStatus === "bez" ? "AI" : "pole PÚ"} uvádí „bez PÚ", poznámky výkresu: ${formatSurfaceSteps(fromNotes)} — doplň.`);
        surfaceStatus = "nezjisteno";
      } else {
        surfaceStatus = "bez";
      }
    } else if (fromNotes.length) {
      surfaceSteps = fromNotes;
    } else if (notesParse.surface.some((s) => s.kind === "bez_upravy")) {
      surfaceStatus = "bez";
    }
  }
  surfaceStatus = surfaceSteps.length ? "uvedeno" : surfaceStatus === "bez" ? "bez" : "nezjisteno";

  const shape = typeof o.shapeHint === "string" && (SHAPE_HINTS as readonly string[]).includes(o.shapeHint) ? (o.shapeHint as ShapeHint) : "";
  return {
    materialGroup: resolveMaterialGroup(base.material, o.materialGroup),
    overallDims: cleanDims(o.overallDims),
    shapeHint: shape,
    blankDimensions: str(o.blankDimensions, 200),
    heatStatus, heatSteps, surfaceStatus, surfaceSteps, drawingNotes,
    conflicts,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Odhad polotovaru
// ═════════════════════════════════════════════════════════════════════════

const eq2 = (x: number, y: number) => Math.abs(x - y) <= Math.max(x, y) * 0.02;

/** Text rozměrů pro parseDimensionText ze 3 největších rozměrů a tvaru. */
export function dimsTextFromHints(dims: number[], shape: ShapeHint): string {
  const d = [...dims].sort((a, b) => b - a);
  const f = (n: number) => String(n);
  const [a, b, c] = d;
  if (a === undefined) return "";
  if (b === undefined) return shape === "kulatina" ? `Ø${f(a)}` : f(a);
  const rot = (): string => {
    if (c !== undefined && eq2(b, c)) return `Ø${f(b)} x ${f(a)}`;
    if (c !== undefined && eq2(a, b)) return `Ø${f(a)} x ${f(c)}`;
    return `Ø${f(b)} x ${f(a)}`;
  };
  switch (shape) {
    case "kulatina": case "trubka": return rot();
    case "sestihran": return `6hr ${f(c !== undefined && eq2(b, c) ? b : b)} x ${f(a)}`;
    case "ctyrhran": return `□${f(b)} x ${f(a)}`;
    case "plech": return c !== undefined ? `tl. ${f(c)} x ${f(b)} x ${f(a)}` : `${f(a)} x ${f(b)}`;
    default: return c !== undefined ? `${f(a)} x ${f(b)} x ${f(c)}` : `${f(a)} x ${f(b)}`;
  }
}

export interface SpecEstimateInput {
  material: string;
  materialGroup: MaterialGroupKey | "";
  dimensions: string;
  overallDims?: number[];
  shapeHint?: ShapeHint;
  blankDimensions?: string;
  /** Hmotnost dílu z výkresu / ručně (kg), null = neuvedeno → odhad. */
  partWeightKg: number | null;
  title: string;
  quantity: number | null;
  notes?: string;
}

export interface SpecEstimate {
  blankWeightKg: number | null;
  blankDims: string;
  blankShape: BlankShape | "";
  partWeightKg: number | null;
  partWeightSource: WeightSource | null;
  description: string;
}

/** Odhad polotovaru a hmotnosti dílu (analyzeDrawingMaterial; zvolená skupina mění hustotu). */
/**
 * AI hlásí trubku, ale text rozměrů čte parseDimensionText jako plnou (stupňovitou) kulatinu
 * („Ø60 x Ø40 x 100" — bez nápovědy je to stupňovitý hřídel) → přepsat na „Ø60/Ø40 x 100".
 */
export function tubeDimsText(dimsText: string, shapeHint: ShapeHint | undefined): string {
  if (shapeHint !== "trubka" || !dimsText.trim()) return dimsText;
  const p = parseDimensionText(dimsText);
  if (p.shape !== "kulatina") return dimsText;
  const ds = [...dimsText.matchAll(/[Øø⌀∅]\s*(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1].replace(",", "."))).filter((n) => n > 0);
  const outer = Math.max(...ds);
  const inner = Math.max(...ds.filter((n) => n < outer), 0);
  if (ds.length < 2 || !(inner > 0)) return dimsText;
  return `Ø${outer}/Ø${inner}${p.l ? ` x ${p.l}` : ""}`;
}

export function estimateSpec(input: SpecEstimateInput): SpecEstimate {
  const dimsText = tubeDimsText(input.dimensions.trim() || dimsTextFromHints(input.overallDims ?? [], input.shapeHint ?? ""), input.shapeHint);
  const cls = classifyMaterial(input.material, input.materialGroup || null);
  const override = input.materialGroup && input.materialGroup !== cls.group ? MATERIAL_GROUPS[input.materialGroup].density : null;
  const a = analyzeDrawingMaterial({
    material: input.material,
    materialGroup: input.materialGroup || null,
    dimensions: dimsText,
    blankDimensions: input.blankDimensions || null,
    weightKg: input.partWeightKg,
    title: input.title,
    quantity: input.quantity,
    notes: [input.notes ?? "", input.shapeHint === "odlitek" ? "odlitek" : ""].filter(Boolean).join(" | ") || null,
    densityOverride: override,
  });
  return {
    blankWeightKg: a.columns.blank_weight_kg,
    blankDims: a.columns.blank_dims ?? "",
    blankShape: a.columns.blank_shape ?? "",
    partWeightKg: a.columns.weight_kg,
    partWeightSource: a.columns.weight_source,
    description: a.blank.description,
  };
}

/** Kontext výkresu pro odhad (pole formuláře mimo sekci materiálu). */
export interface SpecContext {
  material: string;
  dimensions: string;
  title: string;
  quantity: string;
  overallDims?: number[];
  shapeHint?: ShapeHint;
  blankDimensions?: string;
}

/**
 * Přepočet odhadu po změně materiálu / rozměrů / skupiny: polotovar jen když ho člověk nepřepsal,
 * hmotnost dílu jen když není z výkresu ani ručně.
 */
export function recomputeSpecEstimate(spec: DrawingSpecState, ctx: SpecContext): DrawingSpecState {
  const weightFixed = spec.weightSource === "vykres" || spec.weightSource === "rucne";
  const partKg = weightFixed ? parseDecimal(spec.weightKg) : null;
  const est = estimateSpec({
    material: ctx.material, materialGroup: spec.materialGroup, dimensions: ctx.dimensions, overallDims: ctx.overallDims,
    shapeHint: ctx.shapeHint, blankDimensions: ctx.blankDimensions, partWeightKg: partKg && partKg > 0 ? partKg : null,
    title: ctx.title, quantity: parseDecimal(ctx.quantity), notes: spec.notes,
  });
  const next = { ...spec };
  if (!spec.manual.includes("blank")) {
    next.blankWeightKg = decimalText(est.blankWeightKg);
    next.blankDims = est.blankDims;
    next.blankShape = est.blankShape;
    next.blankNote = est.description;
  }
  if (!weightFixed) {
    next.weightKg = decimalText(est.partWeightKg);
    next.weightSource = est.partWeightKg ? "odhad" : "";
  }
  return next;
}

// ═════════════════════════════════════════════════════════════════════════
// Stav formuláře
// ═════════════════════════════════════════════════════════════════════════

/** Minimum z DrawingExtract, ze kterého vzniká výchozí stav. */
export interface SpecSourceDrawing extends Partial<DrawingSpecExtract> {
  material: string;
  dimensions: string;
  weightKg: number;
  heatTreatment: string;
  surfaceTreatment: string;
  notes: string;
  title: string;
  quantity: number;
}

/** Výchozí (AI) stav sekce materiálu. Bez AI = vše „Nezjištěno — doplň". */
export function initialSpecState(dr: SpecSourceDrawing, opts: { aiUsed: boolean; title?: string; quantity?: string }): DrawingSpecState {
  const spec = dr.heatStatus ? (dr as SpecSourceDrawing & DrawingSpecExtract) : { ...dr, ...normalizeDrawingSpec(dr as unknown as Record<string, unknown>, dr) };
  const base: DrawingSpecState = {
    materialGroup: spec.materialGroup ?? resolveMaterialGroup(dr.material, null),
    weightKg: dr.weightKg > 0 ? decimalText(dr.weightKg) : "",
    weightSource: dr.weightKg > 0 ? "vykres" : "",
    blankWeightKg: "", blankDims: "", blankShape: "", blankNote: "",
    heatStatus: opts.aiUsed ? spec.heatStatus ?? "nezjisteno" : spec.heatSteps?.length ? "uvedeno" : "nezjisteno",
    heatSteps: (spec.heatSteps ?? []).map((s) => ({ ...s })),
    surfaceStatus: opts.aiUsed ? spec.surfaceStatus ?? "nezjisteno" : spec.surfaceSteps?.length ? "uvedeno" : "nezjisteno",
    surfaceSteps: (spec.surfaceSteps ?? []).map((s) => ({ ...s })),
    notes: (spec.drawingNotes ?? []).join("\n"),
    manual: [],
  };
  return recomputeSpecEstimate(base, {
    material: dr.material, dimensions: dr.dimensions, title: opts.title ?? dr.title, quantity: opts.quantity ?? (dr.quantity > 0 ? String(dr.quantity) : ""),
    overallDims: spec.overallDims, shapeHint: spec.shapeHint, blankDimensions: spec.blankDimensions,
  });
}

const BLANK_SHAPES = Object.keys(BLANK_SHAPE_LABELS) as BlankShape[];
const WEIGHT_SOURCES: WeightSource[] = ["vykres", "odhad", "rucne"];

/** Stav sekce z prohlížeče (sanitizace). null = nebyl poslán (platí AI návrh). */
export function sanitizeSpecState(raw: unknown): DrawingSpecState | string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") return "Výkres: neplatné údaje o materiálu.";
  const o = raw as Record<string, unknown>;
  const weight = str(o.weightKg, 30);
  if (weight && (parseDecimal(weight) === null || parseDecimal(weight)! > 100_000)) return "Výkres: neplatná hmotnost dílu.";
  const blank = str(o.blankWeightKg, 30);
  if (blank && (parseDecimal(blank) === null || parseDecimal(blank)! > 100_000)) return "Výkres: neplatná hmotnost polotovaru.";
  const heatSteps = (Array.isArray(o.heatSteps) ? o.heatSteps : []).slice(0, 12).map(cleanHeatStep).filter((x): x is HeatStep => x !== null);
  const surfaceSteps = (Array.isArray(o.surfaceSteps) ? o.surfaceSteps : []).slice(0, 12).map(cleanSurfaceStep).filter((x): x is SurfaceStep => x !== null);
  const heatStatus = heatSteps.length ? "uvedeno" : isTreatmentStatus(o.heatStatus) && o.heatStatus !== "uvedeno" ? o.heatStatus : "nezjisteno";
  const surfaceStatus = surfaceSteps.length ? "uvedeno" : isTreatmentStatus(o.surfaceStatus) && o.surfaceStatus !== "uvedeno" ? o.surfaceStatus : "nezjisteno";
  const ws = typeof o.weightSource === "string" && (WEIGHT_SOURCES as string[]).includes(o.weightSource) ? (o.weightSource as WeightSource) : "";
  const notes = typeof o.notes === "string" ? o.notes.replace(/\r\n/g, "\n").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n").slice(0, 8000) : "";
  return {
    materialGroup: isMaterialGroupKey(o.materialGroup) ? o.materialGroup : "",
    weightKg: weight,
    weightSource: weight ? ws || "rucne" : "",
    blankWeightKg: blank,
    blankDims: str(o.blankDims, 120),
    blankShape: typeof o.blankShape === "string" && (BLANK_SHAPES as string[]).includes(o.blankShape) ? (o.blankShape as BlankShape) : "",
    blankNote: str(o.blankNote, 300),
    heatStatus, heatSteps, surfaceStatus, surfaceSteps, notes,
    manual: (Array.isArray(o.manual) ? o.manual : []).filter((k): k is SpecGroupKey => typeof k === "string" && (SPEC_GROUP_KEYS as readonly string[]).includes(k))
      .filter((k, i, a) => a.indexOf(k) === i),
  };
}

// ═════════════════════════════════════════════════════════════════════════
// Formát textu
// ═════════════════════════════════════════════════════════════════════════

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plain = (label: string) => label.replace(/\s*\(.*\)\s*$/, "");

export function heatValueText(s: Pick<HeatStep, "value" | "unit">): string {
  return [s.value, s.value ? s.unit : ""].filter(Boolean).join(" ").trim();
}

/** „kalení 58±2 HRC (vakuově); nitridace 700 HV, hloubka 0,3 mm" → sloupec heat_treatment. */
export function formatHeatSteps(steps: HeatStep[]): string {
  return steps.map((s) => {
    let t = lower(plain(HEAT_KINDS[s.kind].label));
    const v = heatValueText(s);
    if (v) t += ` ${v}`;
    if (s.depthMm) t += `, hloubka ${s.depthMm} mm`;
    if (s.note) t += ` (${s.note})`;
    return t;
  }).join("; ");
}

/** „nitridace; černění" / „galvanický zinek 8 µm (Fe/Zn 8)" → sloupec surface_treatment. */
export function formatSurfaceSteps(steps: SurfaceStep[]): string {
  return steps.map((s) => {
    let t = lower(plain(SURFACE_KINDS[s.kind].label));
    if (s.thicknessUm) t += ` ${s.thicknessUm} µm`;
    if (s.spec) t += ` (${s.spec})`;
    return t;
  }).join("; ");
}

/** První tvrdost z kroků („58±2 HRC") → sloupec hardness. */
export function hardnessFromSteps(steps: HeatStep[]): string | null {
  const s = steps.find((x) => x.value && x.unit && x.unit !== "MPa") ?? steps.find((x) => x.value && x.unit);
  return s ? heatValueText(s) : null;
}

// ═════════════════════════════════════════════════════════════════════════
// Uložení: sloupce, zdroje, pravidlo nepřepisování
// ═════════════════════════════════════════════════════════════════════════

/** Sloupce DB ze stavu formuláře (+ označení materiálu z pole Materiál). */
export function specColumns(spec: DrawingSpecState, material: string): DrawingSpecColumns {
  const mat = material.trim();
  const cls = mat ? classifyMaterial(mat, spec.materialGroup || null) : null;
  const weight = parseDecimal(spec.weightKg);
  const blank = parseDecimal(spec.blankWeightKg);
  const notes = spec.notes.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return {
    material_group: spec.materialGroup || null,
    // označení tak, jak je na výkresu („ČSN 41 9436", „Docol 1200M"); uklizené jen pro hledání / title štítku
    material_designation: mat ? mat.slice(0, 200) : null,
    material_condition: cls?.condition ?? null,
    weight_kg: weight && weight > 0 ? Math.round(weight * 1000) / 1000 : null,
    weight_source: weight && weight > 0 ? spec.weightSource || "rucne" : null,
    blank_weight_kg: blank && blank > 0 ? Math.round(blank * 1000) / 1000 : null,
    blank_dims: spec.blankDims.trim() || null,
    blank_shape: spec.blankShape || null,
    heat_status: spec.heatSteps.length ? "uvedeno" : spec.heatStatus,
    heat_steps: spec.heatSteps.length ? spec.heatSteps : null,
    heat_treatment: spec.heatSteps.length ? formatHeatSteps(spec.heatSteps) : null,
    hardness: hardnessFromSteps(spec.heatSteps),
    surface_status: spec.surfaceSteps.length ? "uvedeno" : spec.surfaceStatus,
    surface_steps: spec.surfaceSteps.length ? spec.surfaceSteps : null,
    surface_treatment: spec.surfaceSteps.length ? formatSurfaceSteps(spec.surfaceSteps) : null,
    drawing_notes: notes || null,
  };
}

/**
 * Zdroj každé skupiny: „rucne" = člověk ji v kontrole upravil (nebo zadal hmotnost), jinak „ai"
 * (návrh AI / odhad — příště ho smí nahradit novější výkres). Označení materiálu podle pole Materiál.
 */
export function specSources(spec: DrawingSpecState, materialChanged: boolean): SpecSources {
  const out: SpecSources = {};
  for (const k of SPEC_GROUP_KEYS) out[k] = spec.manual.includes(k) ? "rucne" : "ai";
  if (spec.weightSource === "rucne") out.weight = "rucne";
  if (materialChanged) out.material_designation = "rucne";
  return out;
}

type RowLike = Record<string, unknown> & { spec_sources?: unknown };

const emptyVal = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** Skupina v řádku DB je prázdná (TZ/PÚ „nezjištěno" bez kroků = prázdná — doplní ji cokoli). */
function groupEmpty(row: RowLike, g: SpecGroupKey): boolean {
  if (g === "heat") return !row.heat_steps && !row.heat_treatment && (row.heat_status === null || row.heat_status === undefined || row.heat_status === "nezjisteno");
  if (g === "surface") return !row.surface_steps && !row.surface_treatment && (row.surface_status === null || row.surface_status === undefined || row.surface_status === "nezjisteno");
  return SPEC_GROUP_COLUMNS[g].every((c) => emptyVal(row[c]));
}

function newGroupEmpty(cols: DrawingSpecColumns, g: SpecGroupKey): boolean {
  if (g === "heat") return cols.heat_status === null || (cols.heat_status === "nezjisteno" && !cols.heat_steps);
  if (g === "surface") return cols.surface_status === null || (cols.surface_status === "nezjisteno" && !cols.surface_steps);
  if (g === "material_designation") return emptyVal(cols.material_designation);
  if (g === "weight") return emptyVal(cols.weight_kg);
  if (g === "blank") return emptyVal(cols.blank_weight_kg) && emptyVal(cols.blank_dims);
  return SPEC_GROUP_COLUMNS[g].every((c) => emptyVal(cols[c]));
}

/** jsonb vrací klíče objektů v jiném pořadí ({kind,note,unit,value,depthMm}) → porovnávat kanonicky. */
const canon = (v: unknown): unknown => Array.isArray(v)
  ? v.map(canon)
  : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
    : v ?? null;
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));

/** Prázdné hodnoty skupiny (člověk v kontrole výslovně smazal / dal „Nezjištěno"). */
function clearedGroup(g: SpecGroupKey): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of SPEC_GROUP_COLUMNS[g]) out[c] = null;
  if (g === "heat") out.heat_status = "nezjisteno";
  if (g === "surface") out.surface_status = "nezjisteno";
  return out;
}

export function sourcesOf(row: RowLike | null | undefined): SpecSources {
  const s = row?.spec_sources;
  if (!s || typeof s !== "object" || Array.isArray(s)) return {};
  const out: SpecSources = {};
  for (const k of SPEC_GROUP_KEYS) {
    const v = (s as Record<string, unknown>)[k];
    if (v === "ai" || v === "rucne") out[k] = v;
  }
  return out;
}

/**
 * Změny řádku (drawings / order_items) podle pravidla: prázdné nebo AI-vyplněné se doplní / nahradí;
 * hodnotu, kterou zadal člověk (zdroj „rucne", nebo starší vyplněná hodnota bez zdroje), nahradí jen
 * nová ruční hodnota z kontroly. Prázdné nové hodnoty nic nemažou; „nezjištěno" jen doplní prázdné —
 * kromě výslovného ručního smazání / „Nezjištěno" v kontrole, které smaže hodnotu z AI.
 * Odhad hmotnosti nikdy nenahradí hmotnost z výkresu / ručně. fillOnly (starší revize výkresu než
 * u položky): jen doplnit prázdné, AI hodnoty novější revize nepřepisovat.
 */
export function mergeSpecPatch(
  existing: RowLike | null | undefined,
  cols: DrawingSpecColumns,
  sources: SpecSources,
  opts: { fillOnly?: boolean } = {},
): { patch: Record<string, unknown>; changed: SpecGroupKey[]; kept: SpecGroupKey[] } {
  const row: RowLike = existing ?? {};
  const exSources = sourcesOf(row);
  const nextSources: SpecSources = { ...exSources };
  const patch: Record<string, unknown> = {};
  const changed: SpecGroupKey[] = [];
  const kept: SpecGroupKey[] = [];
  for (const g of SPEC_GROUP_KEYS) {
    const src = sources[g] ?? "ai";
    const exEmpty = groupEmpty(row, g);
    const nEmpty = newGroupEmpty(cols, g);
    const exSrc: SpecSource | null = exEmpty ? null : exSources[g] ?? "rucne";
    const colsOfGroup = SPEC_GROUP_COLUMNS[g];
    if (nEmpty) {
      // „nezjištěno" doplní jen úplně prázdnou úpravu (ať je stav výslovný)
      if (g === "heat" || g === "surface") {
        const col = g === "heat" ? "heat_status" : "surface_status";
        if (exEmpty && cols[col] === "nezjisteno" && row[col] !== "nezjisteno") {
          patch[col] = "nezjisteno";
          nextSources[g] = src;
        }
      }
      // člověk v kontrole výslovně smazal / dal „Nezjištěno" → hodnota z AI se smaže
      if (!exEmpty && src === "rucne" && exSrc === "ai" && !opts.fillOnly) {
        const cleared = clearedGroup(g);
        const diff = colsOfGroup.filter((c) => !same(row[c], cleared[c]));
        if (diff.length) {
          Object.assign(patch, cleared);
          nextSources[g] = "rucne";
          changed.push(g);
        }
      }
      continue;
    }
    // starší revize: vyplněné (AI) hodnoty novější revize zůstávají
    if (!exEmpty && opts.fillOnly && src !== "rucne") continue;
    const diff = colsOfGroup.filter((c) => !same(row[c], cols[c]));
    if (!diff.length) {
      // stejná hodnota: ruční potvrzení ji označí jako ruční, AI návrh zdroj nemění
      if (src === "rucne" || exSrc === null) nextSources[g] = src;
      continue;
    }
    if (!exEmpty && exSrc === "rucne" && src !== "rucne") { kept.push(g); continue; }
    // odhad hmotnosti dílu nenahradí hmotnost uvedenou na výkresu (ani ručně zadanou)
    if (g === "weight" && !exEmpty && row.weight_source !== "odhad" && cols.weight_source === "odhad" && src !== "rucne") continue;
    for (const c of colsOfGroup) patch[c] = cols[c];
    nextSources[g] = src;
    changed.push(g);
  }
  if (!same(nextSources, exSources) || Object.keys(patch).length) patch.spec_sources = nextSources;
  return { patch, changed, kept };
}

// ═════════════════════════════════════════════════════════════════════════
// Zobrazení (štítky v Položkách, archivu výkresů, Knize)
// ═════════════════════════════════════════════════════════════════════════

export interface DrawingSpecView {
  materialGroup: MaterialGroupKey | null;
  materialDesignation: string | null;
  /** Stav dodání z označení („zušlechtěno (+QT)"); volitelné — starší pohledy ho nemají. */
  materialCondition?: string | null;
  weightKg: number | null;
  weightSource: WeightSource | null;
  blankWeightKg: number | null;
  blankDims: string | null;
  blankShape: BlankShape | null;
  heatStatus: TreatmentStatus | null;
  heatSteps: HeatStep[];
  heatTreatment: string | null;
  hardness: string | null;
  surfaceStatus: TreatmentStatus | null;
  surfaceSteps: SurfaceStep[];
  surfaceTreatment: string | null;
  drawingNotes: string | null;
}

const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const textOrNull = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Řádek DB (drawings / order_items) → pohled pro štítky; null = výkres nic neuvádí (starší řádek). */
export function specViewFromRow(row: Record<string, unknown> | null | undefined): DrawingSpecView | null {
  if (!row) return null;
  const heatSteps = (Array.isArray(row.heat_steps) ? row.heat_steps : []).map(cleanHeatStep).filter((x): x is HeatStep => x !== null);
  const surfaceSteps = (Array.isArray(row.surface_steps) ? row.surface_steps : []).map(cleanSurfaceStep).filter((x): x is SurfaceStep => x !== null);
  const v: DrawingSpecView = {
    materialGroup: isMaterialGroupKey(row.material_group) ? row.material_group : null,
    materialDesignation: textOrNull(row.material_designation),
    materialCondition: textOrNull(row.material_condition),
    weightKg: numOrNull(row.weight_kg),
    weightSource: row.weight_source === "vykres" || row.weight_source === "odhad" || row.weight_source === "rucne" ? row.weight_source : null,
    blankWeightKg: numOrNull(row.blank_weight_kg),
    blankDims: textOrNull(row.blank_dims),
    blankShape: typeof row.blank_shape === "string" && (BLANK_SHAPES as string[]).includes(row.blank_shape) ? (row.blank_shape as BlankShape) : null,
    heatStatus: isTreatmentStatus(row.heat_status) ? row.heat_status : null,
    heatSteps,
    heatTreatment: textOrNull(row.heat_treatment),
    hardness: textOrNull(row.hardness),
    surfaceStatus: isTreatmentStatus(row.surface_status) ? row.surface_status : null,
    surfaceSteps,
    surfaceTreatment: textOrNull(row.surface_treatment),
    drawingNotes: textOrNull(row.drawing_notes),
  };
  const any = v.materialGroup || v.weightKg || v.blankWeightKg || v.heatStatus || v.heatTreatment || v.surfaceStatus || v.surfaceTreatment || v.drawingNotes;
  return any ? v : null;
}

export type SpecChipTone = "group" | "weight" | "heat" | "surface" | "none" | "unknown";
export interface SpecChip {
  key: string;
  label: string;
  /** Plné znění do title / čtečky. */
  title: string;
  tone: SpecChipTone;
  className: string;
}

/** Slovo štítku TZ („Kaleno 55 HRC", „Nitridace 700 HV"). */
export const HEAT_CHIP_WORD: Record<HeatStepKind, string> = {
  kaleni: "Kaleno", indukcni_kaleni: "Ind. kaleno", zuslechteni: "Zušlechtěno", cementace: "Cementováno",
  karbonitridace: "Karbonitridace", nitridace: "Nitridace", nitrocementace: "Nitrocementace", zihani: "Žíháno",
  zihani_pnuti: "Žíháno na pnutí", normalizace: "Normalizováno", popousteni: "Popuštěno",
  precipitacni_vytvrzeni: "Vytvrzeno", hlubokozmrazeni: "Zmrazeno",
};

/** Slovo štítku PÚ („Černění", „Zinek galv. 8 µm"). */
export const SURFACE_CHIP_WORD: Record<SurfaceStepKind, string> = {
  zinkovani: "Zinkování", galvanicky_zinek: "Zinek galv.", zinkove_lamely: "Zinkové lamely", cerneni: "Černění",
  eloxovani: "Elox", chromovani: "Chromování", tvrdochrom: "Tvrdochrom", niklovani: "Niklování", chemicky_nikl: "Chem. nikl",
  lakovani: "Lakování", praskove_lakovani: "Práškový lak", fosfatovani: "Fosfátování", moreni: "Moření", pasivace: "Pasivace",
  chromatovani: "Chromátování", tryskani: "Tryskání", lesteni: "Leštění", brouseni_povrchu: "Broušení",
  lapovani_honovani: "Lapování", povlak: "Povlak", cinovani: "Cínování", stribreni: "Stříbření", zlaceni: "Zlacení",
  nastrik: "Nástřik", konzervace: "Konzervace", omilani: "Omílání",
};

const MUTED = "border border-dashed border-neutral-300 bg-transparent text-muted-foreground dark:border-neutral-600";
const AMBER = "bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/40";
const WEIGHT = "bg-zinc-100 text-zinc-800 dark:bg-zinc-500/15 dark:text-zinc-200";

/** Druhy TZ s hloubkou vrstvy (hloubka se ukazuje i vedle tvrdosti — mění cenu). */
const DEPTH_KINDS: readonly HeatStepKind[] = ["cementace", "karbonitridace", "nitridace", "nitrocementace", "indukcni_kaleni"];
/** Druhy TZ, u kterých musí být uvedeno „kolik" (tvrdost / pevnost). */
export const HARDNESS_REQUIRED_KINDS: readonly HeatStepKind[] = ["kaleni", "indukcni_kaleni", "zuslechteni", "cementace"];

/** Krok kalení / zušlechtění / cementace bez hodnoty tvrdosti → „Tvrdost neuvedena — doplň". */
export function stepMissingHardness(s: Pick<HeatStep, "kind" | "value">): boolean {
  return HARDNESS_REQUIRED_KINDS.includes(s.kind) && !s.value.trim();
}
export function missingHardness(steps: readonly Pick<HeatStep, "kind" | "value">[]): boolean {
  return steps.some(stepMissingHardness);
}

/** „Kaleno 58±2 HRC", „Cementováno 58 HRC, 0,8 mm", „Nitridace 700 HV, 0,3 mm", „Kaleno ? HRC". */
export function heatChipLabel(s: HeatStep): string {
  const v = stepMissingHardness(s) ? `? ${s.unit || (s.kind === "zuslechteni" ? "" : "HRC")}`.trim() : heatValueText(s);
  const d = s.depthMm && (DEPTH_KINDS.includes(s.kind) || !v) ? `${s.depthMm} mm` : "";
  return [HEAT_CHIP_WORD[s.kind], [v, d].filter(Boolean).join(", ")].filter(Boolean).join(" ");
}

/** „Černění", „Tvrdý elox 50 µm", „DLC", „Práškový lak RAL 9005", „Fosfát Mn", „Zinek galv. 8 µm". */
export function surfaceChipLabel(s: SurfaceStep): string {
  const spec = s.spec.trim();
  const f = fold(spec);
  let word = SURFACE_CHIP_WORD[s.kind];
  const extra: string[] = [];
  if (s.kind === "eloxovani" && /tvrd|hard|hart|typ\w*\s?iii|type\s?iii/.test(f)) word = "Tvrdý elox";
  if (s.kind === "povlak" && spec && spec.length <= 12) word = spec;
  if (s.kind === "lakovani" || s.kind === "praskove_lakovani") {
    const ral = /\bral\s?(\d{4})\b/i.exec(spec);
    if (ral) extra.push(`RAL ${ral[1]}`);
  }
  if (s.kind === "fosfatovani") {
    if (/mangan|\bmn\b/.test(f)) word = "Fosfát Mn";
    else if (/zink|zinc|zinek|\bzn\b/.test(f)) word = "Fosfát Zn";
  }
  return [word, ...extra, s.thicknessUm ? `${s.thicknessUm} µm` : ""].filter(Boolean).join(" ");
}

/** „+QT" z „zušlechtěno (+QT)" (stav dodání materiálu ke štítku skupiny). */
function conditionCode(condition: string | null | undefined): string {
  return /\((\+[A-Z]{1,3}|\.\d)\)/.exec(condition ?? "")?.[1] ?? "";
}

/**
 * Štítky: skupina materiálu (+ stav dodání „+QT"), „≈ X kg/ks polotovar" / „X kg díl", kroky TZ a PÚ;
 * „bez TZ" / „bez PÚ" tlumeně, „TZ nezjištěno" / „PÚ nezjištěno" / „Materiál ?" / „Kaleno ? HRC"
 * oranžově. compact = jen skupina (Kniha).
 */
export function specChips(v: DrawingSpecView | null | undefined, opts: { compact?: boolean } = {}): SpecChip[] {
  if (!v) return [];
  const out: SpecChip[] = [];
  const steelGuess = !v.materialGroup || v.materialGroup === "ostatni";
  if (v.materialGroup) {
    const g = MATERIAL_GROUPS[v.materialGroup];
    const code = conditionCode(v.materialCondition);
    out.push({
      key: "group", label: code ? `${g.short} ${code}` : g.short, tone: "group", className: g.badge,
      title: [g.label, v.materialDesignation, v.materialCondition].filter(Boolean).join(" · "),
    });
  } else if (!opts.compact && (v.heatStatus || v.surfaceStatus)) {
    // jen řádek zpracovaný z výkresu (má výslovný stav úprav) — starší řádky skupinu nemají vůbec
    out.push({ key: "group-unknown", label: "Materiál ?", title: "Materiál / skupina nezjištěna — doplň", tone: "unknown", className: AMBER });
  }
  if (opts.compact) return out;
  if (v.blankWeightKg) {
    const kg = formatKg(v.blankWeightKg);
    out.push({
      key: "blank", label: `≈ ${kg} kg/ks polotovar${steelGuess ? " (ocel?)" : ""}`, tone: "weight", className: WEIGHT,
      title: `Polotovar na 1 ks (odhad${steelGuess ? ", materiál neurčen — počítáno jako ocel" : ""})${v.blankShape ? ` · ${BLANK_SHAPE_LABELS[v.blankShape]}` : ""}${v.blankDims ? ` ${v.blankDims}` : ""} ≈ ${kg} kg`,
    });
  }
  if (v.weightKg && (v.weightSource !== "odhad" || !v.blankWeightKg)) {
    const est = v.weightSource === "odhad";
    out.push({
      key: "weight", label: `${est ? "≈ " : ""}${formatKg(v.weightKg)} kg díl`, tone: "weight", className: WEIGHT,
      title: `Hmotnost dílu ${formatKg(v.weightKg)} kg/ks (${v.weightSource === "vykres" ? "z výkresu" : est ? "odhad" : "zadáno ručně"})`,
    });
  }
  const heat = v.heatSteps.length ? v.heatSteps
    : v.heatTreatment ? heatStepsFromText(parseTreatments(v.heatTreatment).heat, v.heatTreatment) : [];
  if (heat.length) {
    heat.forEach((s, i) => {
      const missing = stepMissingHardness(s);
      out.push({
        key: `heat-${i}`, label: heatChipLabel(s), tone: missing ? "unknown" : "heat", className: missing ? AMBER : HEAT_KINDS[s.kind].badge,
        title: `Tepelné zpracování: ${formatHeatSteps([s])}${missing ? " — tvrdost neuvedena, doplň" : ""}`,
      });
    });
  } else if (v.heatTreatment) {
    out.push({ key: "heat-text", label: v.heatTreatment.slice(0, 40), title: `Tepelné zpracování: ${v.heatTreatment}`, tone: "heat", className: HEAT_KINDS.kaleni.badge });
  } else if (v.heatStatus === "bez") {
    out.push({ key: "heat-none", label: "bez TZ", title: "Bez tepelného zpracování", tone: "none", className: MUTED });
  } else if (v.heatStatus === "nezjisteno") {
    out.push({ key: "heat-unknown", label: "TZ nezjištěno", title: "Tepelné zpracování nezjištěno — doplň", tone: "unknown", className: AMBER });
  }
  const surface = v.surfaceSteps.length ? v.surfaceSteps
    : v.surfaceTreatment ? parseTreatments(v.surfaceTreatment).surface.map(surfaceStepFromParsed).filter((x): x is SurfaceStep => x !== null) : [];
  if (surface.length) {
    surface.forEach((s, i) => out.push({ key: `surface-${i}`, label: surfaceChipLabel(s), title: `Povrchová úprava: ${formatSurfaceSteps([s])}`, tone: "surface", className: SURFACE_KINDS[s.kind].badge }));
  } else if (v.surfaceTreatment) {
    out.push({ key: "surface-text", label: v.surfaceTreatment.slice(0, 40), title: `Povrchová úprava: ${v.surfaceTreatment}`, tone: "surface", className: SURFACE_KINDS.zinkovani.badge });
  } else if (v.surfaceStatus === "bez") {
    out.push({ key: "surface-none", label: "bez PÚ", title: "Bez povrchové úpravy", tone: "none", className: MUTED });
  } else if (v.surfaceStatus === "nezjisteno") {
    out.push({ key: "surface-unknown", label: "PÚ nezjištěno", title: "Povrchová úprava nezjištěna — doplň", tone: "unknown", className: AMBER });
  }
  return out;
}

/** Popisky pro select skupiny materiálu (pořadí přehledu). */
export const MATERIAL_GROUP_OPTIONS = MATERIAL_GROUP_ORDER.map((k) => ({ value: k, label: MATERIAL_GROUPS[k].label }));
export const HEAT_KIND_OPTIONS = HEAT_STEP_KINDS.map((k) => ({ value: k, label: plain(HEAT_KINDS[k].label) }));
export const SURFACE_KIND_OPTIONS = SURFACE_STEP_KINDS.map((k) => ({ value: k, label: plain(SURFACE_KINDS[k].label) }));
export const BLANK_SHAPE_OPTIONS = BLANK_SHAPES.map((k) => ({ value: k, label: BLANK_SHAPE_LABELS[k] }));

/** Řádek DB → spec_sources pro uložený řádek (nový řádek = zdroje ze stavu). */
export function insertSpecRow(cols: DrawingSpecColumns, sources: SpecSources): Record<string, unknown> {
  const { patch } = mergeSpecPatch(null, cols, sources);
  return patch;
}

/**
 * Pole pro job_files.ai_extracted (camelCase — stejné hodnoty jako sloupce). weightKg drží význam
 * DrawingExtract („uvedeno na výkresu / ručně, 0 = neuvedeno" — i pro učení AI, které nemá odhadovat);
 * hmotnost dílu včetně odhadu je zvlášť v partWeightKg / partWeightSource.
 */
export function specExtractFields(cols: DrawingSpecColumns): Record<string, unknown> {
  const stated = cols.weight_source === "vykres" || cols.weight_source === "rucne";
  return {
    materialGroup: cols.material_group ?? "",
    materialDesignation: cols.material_designation ?? "",
    materialCondition: cols.material_condition ?? "",
    weightKg: stated ? cols.weight_kg ?? 0 : 0,
    weightSource: cols.weight_source ?? "",
    partWeightKg: cols.weight_kg ?? 0,
    partWeightSource: cols.weight_source ?? "",
    blankWeightKg: cols.blank_weight_kg ?? 0,
    blankDims: cols.blank_dims ?? "",
    blankShape: cols.blank_shape ?? "",
    heatStatus: cols.heat_status ?? "nezjisteno",
    heatSteps: cols.heat_steps ?? [],
    heatTreatment: cols.heat_treatment ?? "",
    hardness: cols.hardness ?? "",
    surfaceStatus: cols.surface_status ?? "nezjisteno",
    surfaceSteps: cols.surface_steps ?? [],
    surfaceTreatment: cols.surface_treatment ?? "",
    drawingNotes: cols.drawing_notes ? cols.drawing_notes.split("\n") : [],
  };
}
