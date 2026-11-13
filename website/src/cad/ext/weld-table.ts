/**
 * Tabulka svarů: řádek za každý svar (housenka, tupý, děrový / žlábkový, bodový, ruční značka) s délkou, průřezem, objemem,
 * hmotností svarového kovu a odhadem přídavného materiálu; součty. Údaje bere ze stavu prvků po stavbě (`status.data.weld`,
 * skutečná geometrie); prvky bez výsledku (ruční značka, dosud nepostavený prvek) se odhadnou z dat podle vzorců. Bez OCCT.
 */
import { cadLocale, tr } from "../i18n";
import type { CadDoc, Feature, FeatureStatus } from "../types";
import { depositionEff, filletSize, materialDensity, grooveAreaFormula, processDef, reinforcementArea, weldMetal, weldSizeText, weldTypeText, type GroovePrep, type WeldInfo } from "./weld-calc";
import { SYMBOL_TYPES, symbolData } from "./weld-symbol";

const fmt = (n: number, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString(cadLocale(), { maximumFractionDigits: d });

/** hustota svarového kovu [g/cm³] = hustota materiálu dílu (známá třída), jinak ocel 7,85 */
export const weldDensity = (doc: Pick<CadDoc, "material">) => materialDensity(doc.material);

// ---------------- housenka (koutový svar) – data prvku ----------------

export type BeadData = {
  edges: number[];
  /** velikost: a (účinná tloušťka) nebo z (rameno) podle `measure` */
  a: number;
  /** starší prvky bez údaje = rameno z (dřívější „a×a“) */
  measure: "a" | "z";
  intermittent: boolean;
  segLen: number;
  pitch: number;
  edgeLens: number[];
  both: boolean;
  allAround: boolean;
  /** svarový kov jako samostatné těleso „Svar k“ (starší prvky = sloučit s tělesem) */
  separate: boolean;
  field: boolean;
  process: string;
  eff: number;
};
export function beadData(data: Record<string, unknown>): BeadData {
  const n = (k: string, d: number) => (typeof data[k] === "number" && Number.isFinite(data[k] as number) ? (data[k] as number) : d);
  return {
    edges: Array.isArray(data.edges) ? (data.edges as number[]) : [],
    a: n("a", 4),
    measure: data.measure === "a" ? "a" : "z",
    intermittent: !!data.intermittent,
    segLen: n("segLen", 50),
    pitch: n("pitch", 100),
    edgeLens: Array.isArray(data.edgeLens) ? (data.edgeLens as number[]) : [],
    both: !!data.both,
    allAround: !!data.allAround,
    separate: !!data.separate,
    field: !!data.field,
    process: String(data.process ?? "135"),
    eff: n("eff", 0),
  };
}

/** Délka svaru na hraně délky L: souvislý = L, přerušovaný = součet úseků. */
export function weldLength(L: number, b: Pick<BeadData, "intermittent" | "segLen" | "pitch"> & Partial<BeadData>) {
  if (!b.intermittent || b.pitch <= 0) return L;
  let total = 0;
  for (let s = 0; s < L - 1e-9; s += b.pitch) total += Math.min(b.segLen, L - s);
  return total;
}

// ---------------- tabulka ----------------

export type WeldRow = {
  pos: number;
  id: string;
  feature: string;
  type: string;
  /** velikost jako text (a5 (z7,07), s10, Ø12) */
  sizeText: string;
  /** číselná velikost (a / s / d) */
  a: number;
  length: number;
  count: number;
  area: number;
  volume: number;
  mass: number;
  filler: number;
  process: string;
  /** údaj odhadnutý z dat (prvek bez výsledku stavby) */
  estimate: boolean;
  info?: WeldInfo;
};

const WELD_EXTS = new Set(["weld.bead", "weld.groove", "weld.plug", "weld.spot", "weld.symbol"]);
export const isWeldFeature = (f: Feature) => f.type === "ext" && WELD_EXTS.has(f.ext);

/** Výsledek svaru ze stavu prvku. */
export function weldInfoOf(st: FeatureStatus | undefined): WeldInfo | undefined {
  const w = (st?.data as { weld?: WeldInfo } | undefined)?.weld;
  return w && typeof w === "object" && typeof w.volume === "number" ? w : undefined;
}

/** Odhad z dat prvku bez výsledku stavby (ruční značka, starší housenka s délkami hran z formuláře). */
function estimateRow(f: Extract<Feature, { type: "ext" }>, density: number): Omit<WeldRow, "pos" | "id" | "feature"> | null {
  const d = f.data ?? {};
  if (f.ext === "weld.bead") {
    const b = beadData(d);
    const fs = filletSize(b.a, b.measure);
    const length = b.edgeLens.reduce((s, L) => s + weldLength(L, b), 0) * (b.both ? 2 : 1);
    const volume = fs.area * length;
    const eff = depositionEff(b.process, b.eff);
    const m = weldMetal(volume, density, eff);
    const info: Pick<WeldInfo, "kind" | "both" | "allAround" | "count" | "segLen" | "pitch" | "field"> = { kind: "fillet", both: b.both, allAround: b.allAround, count: 1, field: b.field, ...(b.intermittent ? { segLen: b.segLen, pitch: b.pitch } : {}) };
    return { type: weldTypeText(info), sizeText: weldSizeText({ kind: "fillet", size: b.a, sizeLabel: b.measure, z: fs.z, a: fs.a }), a: b.measure === "z" ? b.a : fs.a, length, count: 1, area: fs.area, volume, mass: m.mass, filler: m.filler, process: b.process, estimate: true };
  }
  if (f.ext === "weld.symbol") {
    const s = symbolData(d);
    const label = `${SYMBOL_TYPES.find((t) => t.v === s.kind)?.l ?? s.kind}${s.allAround ? tr(" (po obvodu)") : ""}${s.field ? tr(" (montážní)") : ""}`;
    const n = s.count && s.count > 1 ? s.count : 1;
    const length = s.length * n * (s.both ? 2 : 1);
    let area = 0;
    if (s.kind === "fillet") area = s.prefix === "z" ? (s.size * s.size) / 2 : s.size * s.size;
    else if (s.kind !== "spot" && s.kind !== "plug" && s.kind !== "square" && s.size > 0) {
      const prep: GroovePrep = s.kind === "halfV" ? "HV" : (s.kind as GroovePrep);
      const def = { prep, t: s.size, c: s.rootFace ?? 0, g: s.gap ?? 0, angle: s.angle ?? (prep === "V" || prep === "Y" || prep === "X" ? 60 : prep === "HV" || prep === "HY" || prep === "K" ? 45 : 10), R: 6, cap: 0, root: 0, backing: false, overlap: 0 };
      try {
        area = grooveAreaFormula(def) + reinforcementArea(def);
      } catch {
        area = 0;
      }
    }
    const volume = area * length;
    const proc = s.process ?? "135";
    const m = weldMetal(volume, density, depositionEff(proc), processDef(proc)?.filler ?? true);
    return { type: label, sizeText: s.size > 0 ? `${s.prefix ?? (s.kind === "fillet" ? "a" : s.kind === "plug" || s.kind === "spot" ? "Ø" : "s")}${fmt(s.size, 1)}` : "", a: s.size, length, count: n, area, volume, mass: m.mass, filler: m.filler, process: proc, estimate: true };
  }
  return null;
}

/** Řádky tabulky svarů v pořadí historie. `status` = stav prvků po stavbě (bez něj jen odhad z dat). */
export function weldTable(doc: CadDoc, status?: FeatureStatus[] | null): WeldRow[] {
  const st = new Map((status ?? []).map((s) => [s.id, s]));
  const density = weldDensity(doc);
  const rows: WeldRow[] = [];
  for (const f of doc.features) {
    if (f.type !== "ext" || f.suppressed || !WELD_EXTS.has(f.ext)) continue;
    const s = st.get(f.id);
    const w = s?.ok !== false ? weldInfoOf(s) : undefined;
    if (w) {
      rows.push({ pos: 0, id: f.id, feature: f.name, type: weldTypeText(w), sizeText: weldSizeText(w), a: w.sizeLabel === "z" ? (w.z ?? w.size) : w.size, length: w.length, count: w.count, area: w.area, volume: w.volume, mass: w.mass, filler: w.filler, process: w.process ?? "", estimate: false, info: w });
      continue;
    }
    const e = s?.ok === false ? null : estimateRow(f, density);
    if (e) rows.push({ pos: 0, id: f.id, feature: f.name, ...e });
    else rows.push({ pos: 0, id: f.id, feature: f.name, type: s?.ok === false ? tr("chyba stavby: {0}", (s.error ?? "").slice(0, 60)) : tr("(bez výsledku – přestavte model)"), sizeText: "", a: 0, length: 0, count: 0, area: 0, volume: 0, mass: 0, filler: 0, process: String(f.data?.process ?? ""), estimate: true });
  }
  rows.forEach((r, i) => (r.pos = i + 1));
  return rows;
}

export function weldTotals(rows: WeldRow[]) {
  return rows.reduce((t, r) => ({ length: t.length + r.length, count: t.count + r.count, volume: t.volume + r.volume, mass: t.mass + r.mass, filler: t.filler + r.filler }), { length: 0, count: 0, volume: 0, mass: 0, filler: 0 });
}

export function weldTableText(doc: CadDoc, status?: FeatureStatus[] | null): string {
  const rows = weldTable(doc, status);
  if (!rows.length) return tr("Žádné svary (přidejte Svarovou housenku, Tupý svar, Děrový / Bodový svar nebo Značku svaru).");
  const lines = [tr("Poz. | Prvek | Typ | Velikost | Délka | Ks | Průřez | Objem | Svarový kov | Přídavný materiál | Metoda")];
  for (const r of rows)
    lines.push([String(r.pos), r.feature, r.type, r.sizeText || "–", `${fmt(r.length, 1)} mm`, String(r.count), `${fmt(r.area, 2)} mm²`, `${fmt(r.volume / 1000, 3)} cm³`, `${fmt(r.mass, 4)} kg`, `${fmt(r.filler, 4)} kg`, `${r.process || "–"}${r.estimate ? " *" : ""}`].join(" | "));
  const t = weldTotals(rows);
  lines.push(tr("Celkem: {0} svarů · délka {1} mm · objem {2} cm³ · svarový kov {3} kg · přídavný materiál ≈ {4} kg", rows.length, fmt(t.length, 1), fmt(t.volume / 1000, 3), fmt(t.mass, 4), fmt(t.filler, 4)));
  lines.push(tr("Hustota svarového kovu {0} g/cm³; přídavný materiál = hmotnost / účinnost navaření (135 MAG: 0,9).", fmt(weldDensity(doc), 2)));
  if (rows.some((r) => r.estimate)) lines.push(tr("* odhad z parametrů prvku (bez geometrie)"));
  return lines.join("\n");
}

export function weldTableCsv(doc: CadDoc, status?: FeatureStatus[] | null): string {
  const rows = weldTable(doc, status);
  const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
  const n = (x: number, d = 4) => String(Math.round(x * 10 ** d) / 10 ** d).replace(".", ",");
  const out = [tr("Pozice;Prvek;Typ;Velikost;Délka [mm];Ks;Průřez [mm²];Objem [cm³];Svarový kov [kg];Přídavný materiál [kg];Metoda")];
  for (const r of rows) out.push([r.pos, q(r.feature), q(r.type), q(r.sizeText), n(r.length, 1), r.count, n(r.area, 2), n(r.volume / 1000, 3), n(r.mass), n(r.filler), q(r.process)].join(";"));
  const t = weldTotals(rows);
  out.push([tr("Celkem"), "", "", "", n(t.length, 1), t.count, "", n(t.volume / 1000, 3), n(t.mass), n(t.filler), ""].join(";"));
  return "﻿" + out.join("\r\n") + "\r\n";
}
