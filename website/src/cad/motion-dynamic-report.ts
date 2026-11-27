/**
 * Výstupy dynamické pohybové studie (cad/motion-dynamic.ts): řádky protokolu, sloupce CSV a řady grafu (poloha, rychlost, zrychlení
 * těles v hlavní ose pohybu, síly pružin). Kinematická studie dává beze změny totéž co cad/motion.ts (`motionSummary`, `motionCsv`).
 */
import { instanceKey } from "./assembly";
import { getLang, tr } from "./i18n";
import { motionCsv, motionSummary, type MotionResult } from "./motion";
import type { DynMotionStep, DynResult } from "./motion-dynamic";
import type { CadDoc } from "./types";
import { csvWithRev } from "./motion-export-rev";
import { modelRev } from "./engine/result-key";

/** číslo do CSV (středník, desetinná čárka pro Excel – jako motionCsv v cad/motion.ts) */
const num = (v: number, d = 3) => (Math.round(v * 10 ** d) / 10 ** d || 0).toString().replace(".", ",");
/** číslo do protokolu: desetinná tečka v EN, čárka v CS / DE (jako ostatní řádky protokolu) */
const txt = (v: number, d = 3) => {
  const s = (Math.round(v * 10 ** d) / 10 ** d || 0).toString();
  return getLang() === "en" ? s : s.replace(".", ",");
};
export const isDyn = (res: MotionResult | null | undefined): res is DynResult => !!res && "dynamic" in res && !!(res as DynResult).dynamic;
const AXES = ["X", "Y", "Z"] as const;

/** Hlavní osa pohybu tělesa (největší rozsah těžiště) – pro graf a CSV. */
export function mainAxis(res: DynResult, id: string): 0 | 1 | 2 {
  const steps = res.steps as DynMotionStep[];
  let best: 0 | 1 | 2 = 2;
  let span = -1;
  for (const k of [0, 1, 2] as const) {
    const v = steps.map((s) => s.dyn?.[id]?.p[k]).filter((x): x is number => x !== undefined);
    if (!v.length) continue;
    const sp = Math.max(...v) - Math.min(...v);
    if (sp > span + 1e-9) {
      span = sp;
      best = k;
    }
  }
  return best;
}
const moved = (res: DynResult, id: string) => {
  const k = mainAxis(res, id);
  const v = (res.steps as DynMotionStep[]).map((s) => s.dyn?.[id]?.p[k] ?? 0);
  return Math.max(...v) - Math.min(...v) > 1e-6;
};

const srcText = (s: string) => (s === "manual" ? tr("zadaná") : s === "default" ? tr("neznámá – náhradní 1 g") : tr("z objemu × hustoty"));

/** Řádky protokolu dynamické části. */
export function dynamicLines(res: DynResult, doc: CadDoc): string[] {
  const d = res.dynamic;
  const steps = res.steps as DynMotionStep[];
  const out: string[] = [];
  const g = d.gravity ? `${d.gravity.map((v, k) => (Math.abs(v) > 0.999 ? `${v < 0 ? "−" : "+"}${AXES[k]}` : "")).join("") || `[${d.gravity.map((v) => txt(v)).join("; ")}]`}` : tr("vyp");
  out.push(tr("Dynamika: {0} s · krok {1} ms · {2} kroků · gravitace {3} · tlumení {4} N·s/mm · odraz {5} · výpočet {6} s", txt(steps[steps.length - 1]?.t ?? 0, 4), txt(d.dt * 1000, 4), d.n, g, txt(d.damping, 4), txt(d.restitution, 2), txt(d.ms / 1000, 2)));
  if (!d.bodies.length) out.push(tr(" ⚠ žádná pohyblivá komponenta – dynamika potřebuje díly vedené vazbami (Souosost, Drážka, Závěs, Mez vzdálenosti…)"));
  for (const b of d.bodies) {
    const k = mainAxis(res, b.id);
    const p = steps.map((s) => s.dyn?.[b.id]?.p[k] ?? 0);
    // špičky ze všech integračních kroků (ne jen ze zaznamenaných snímků); zrychlení bez rázů na dorazech
    const pk = d.peaks?.[b.id];
    const vMax = pk ? pk.v : Math.max(...steps.map((s) => Math.hypot(...(s.dyn?.[b.id]?.v ?? [0, 0, 0]))));
    const aMax = pk ? pk.a : Math.max(...steps.map((s) => Math.hypot(...(s.dyn?.[b.id]?.a ?? [0, 0, 0]))));
    const span = Math.max(...p) - Math.min(...p);
    const mass = tr("{0} kg ({1})", txt(b.mass, 4), srcText(b.source));
    if (span < 1e-6 && vMax < 1e-6) {
      out.push(tr(" „{0}“ {1}: v klidu", b.name, mass));
      continue;
    }
    const jolts = d.contacts.some((c) => c.impacts.length);
    out.push(tr(" „{0}“ {1}: zdvih {2} {3} mm · v max {4} m/s · a max {5} m/s²{6}", b.name, mass, AXES[k], txt(span, 3), txt(vMax / 1000, 3), txt(aMax / 1000, 2), jolts ? tr(" (bez rázů na dorazech)") : ""));
  }
  // pružiny bez zadané tuhosti: tuhost z geometrie dílu, nebo žádná síla
  for (const r of d.springRates ?? []) {
    if (r.source === "def") continue;
    const nm = doc.components?.find((c) => c.id === r.id)?.name ?? r.id;
    if (r.source === "geometry") out.push(tr(" pružina „{0}“: tuhost {1} N/mm z geometrie dílu (EN 13906-1 R = G·d⁴ / (8·D³·n)) – v definici pružiny chybí", nm, txt(r.rate ?? 0, 3)));
    else out.push(tr(" ⚠ pružina „{0}“ nemá tuhost a díl není drátová pružina – v dynamice nepůsobí silou; zadejte tuhost (sestava pružina \"{0}\" … tuhost c)", nm));
  }
  if (d.springMax) {
    const nm = doc.components?.find((c) => c.id === d.springMax!.id)?.name ?? d.springMax.id;
    out.push(tr(" Největší síla pružiny: „{0}“ {1} N v t = {2} s", nm, txt(d.springMax.force, 1), txt(d.springMax.t, 4)));
  }
  for (const c of d.contacts) {
    const iv = c.intervals.slice(0, 4).map(([a, b]) => (Math.abs(b - a) < 1e-12 ? `${txt(a, 4)} s` : `${txt(a, 4)}–${txt(b, 4)} s`)).join(", ") + (c.intervals.length > 4 ? ` … (${c.intervals.length}×)` : "");
    const imp = c.impacts.slice(0, 3).map((x) => tr("{0} {1} (t = {2} s)", txt(c.unit === "°" ? x.v : x.v / 1000, 3), c.unit === "°" ? "°/s" : "m/s", txt(x.t, 4))).join(", ");
    out.push(tr(" doraz „{0}“ ({1} {2} {3}): dotyk {4}{5}", c.label, c.bound, txt(c.limit, 3), c.unit, iv, imp ? tr(" · nárazy {0}", imp) : ""));
    const back = c.intervals.find((x, i) => i > 0 || x[0] > 0);
    if (back && c.intervals[0][0] === 0 && c.intervals.length > 1) out.push(tr("  návrat na doraz v t = {0} s", txt(c.intervals[1][0], 4)));
    else if (back && c.intervals[0][0] > 0 && moved(res, d.bodies[0]?.id ?? "")) out.push(tr("  první dotyk v t = {0} s", txt(back[0], 4)));
  }
  const e = d.energy;
  if (e.drift !== null) out.push(tr(" Kontrola energie: odchylka {0} % z {1} J (největší pohybová energie nebo práce sil; mimo kroky s dotykem; tlumení {2} J, dotyky {3} J, zadané síly {4} J)", txt(e.drift * 100, 3), txt(e.ref ?? e.kinMax, 5), txt(e.damping, 4), txt(e.contacts, 4), txt(e.applied, 4)));
  else out.push(tr(" Energie: na začátku {0} J, na konci {1} J (motor koná práci – bilance se nekontroluje)", txt(e.e0, 4), txt(e.end, 4)));
  return out;
}

/** Protokol studie: kinematická beze změny, dynamická navíc s řádky dynamiky. */
export function studySummary(res: MotionResult, doc: CadDoc, o: Parameters<typeof motionSummary>[2] = {}): string[] {
  const base = motionSummary(res, doc, o);
  return isDyn(res) ? [...base, ...dynamicLines(res, doc)] : base;
}

/**
 * CSV studie: u dynamiky navíc poloha těžiště, rychlost a zrychlení každého tělesa v hlavní ose. Poslední sloupec „Revize
 * modelu“ = revize sestavy, ze které výsledek vznikl (vlna 22 kolo 7, bod 12 – cad/motion-export-rev.ts). Jedna funkce pro
 * všechny cesty: soubor z panelu Pohyb, ZIP snímků, `pohyb export csv` (soubor i výpis v konzoli) a `mncad.motion().csv`.
 */
export function studyCsv(res: MotionResult, doc: CadDoc): string {
  return csvWithRev(studyCsvCols(res, doc), modelRev(doc));
}

function studyCsvCols(res: MotionResult, doc: CadDoc): string {
  const csv = motionCsv(res, doc);
  if (!isDyn(res)) return csv;
  const lines = csv.replace(/^﻿/, "").replace(/\r\n$/, "").split("\r\n");
  const key = (id: string) => (doc.components?.some((c) => c.id === id) ? instanceKey(doc, id) : id);
  const esc = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const bodies = res.dynamic.bodies.map((b) => ({ b, k: mainAxis(res, b.id) }));
  const head = bodies.flatMap(({ b, k }) => [tr("{0} těžiště {1} [mm]", key(b.id), AXES[k]), tr("{0} v{1} [mm/s]", key(b.id), AXES[k]), tr("{0} a{1} [m/s²]", key(b.id), AXES[k])]);
  const rows = (res.steps as DynMotionStep[]).map((s) => bodies.flatMap(({ b, k }) => { const x = s.dyn?.[b.id]; return x ? [num(x.p[k], 6), num(x.v[k], 4), num(x.a[k] / 1000, 4)] : ["", "", ""]; }));
  const out = [lines[0] + ";" + head.map(esc).join(";"), ...lines.slice(1).map((l, i) => l + ";" + (rows[i] ?? []).join(";"))];
  return "﻿" + out.join("\r\n") + "\r\n";
}

export type DynSeries = { id: string; name: string; values: number[] };
export type DynChart = { key: "pos" | "vel" | "acc" | "force"; label: string; unit: string; t: number[]; series: DynSeries[] };

/** Řady grafu: poloha [mm], rychlost [m/s], zrychlení [m/s²] těles v hlavní ose a síly pružin [N] (stejné pružiny jednou). */
export function dynCharts(res: DynResult, doc: CadDoc): DynChart[] {
  const steps = res.steps as DynMotionStep[];
  const t = steps.map((s) => s.t);
  const live = res.dynamic.bodies.filter((b) => moved(res, b.id));
  const nm = (b: { id: string; name: string }, k: number) => `${b.name} ${AXES[k]}`;
  const of = (f: (s: DynMotionStep, id: string, k: number) => number): DynSeries[] => live.map((b) => { const k = mainAxis(res, b.id); return { id: b.id, name: nm(b, k), values: steps.map((s) => f(s, b.id, k)) }; });
  const out: DynChart[] = [
    { key: "pos", label: tr("Poloha"), unit: "mm", t, series: of((s, id, k) => s.dyn?.[id]?.p[k] ?? NaN) },
    { key: "vel", label: tr("Rychlost"), unit: "m/s", t, series: of((s, id, k) => (s.dyn?.[id]?.v[k] ?? NaN) / 1000) },
    { key: "acc", label: tr("Zrychlení"), unit: "m/s²", t, series: of((s, id, k) => (s.dyn?.[id]?.a[k] ?? NaN) / 1000) },
  ];
  // síly pružin: stejný průběh (6 pružin stírače) jednou
  const seen = new Set<string>();
  const forces: DynSeries[] = [];
  for (const id of [...new Set(steps.flatMap((s) => Object.keys(s.springs ?? {})))]) {
    const values = steps.map((s) => s.springs?.[id]?.force ?? NaN);
    const sig = values.map((v) => Math.round(v * 10)).join(",");
    if (seen.has(sig)) continue;
    seen.add(sig);
    forces.push({ id, name: doc.components?.find((c) => c.id === id)?.name ?? id, values });
  }
  if (forces.length) out.push({ key: "force", label: tr("Síla pružin"), unit: "N", t, series: forces });
  return out;
}

/** Výsledek dynamiky pro `window.mncad.motion` (názvy místo id); u kinematiky prázdný objekt. */
export function dynApi(res: MotionResult, doc: CadDoc): { dynamic?: { bodies: { name: string; mass: number; source: string }[]; springMax: { name: string; force: number; t: number } | null; contacts: { label: string; bound: string; limit: number; intervals: [number, number][]; impacts: { t: number; v: number }[] }[]; energy: { e0: number; end: number; drift: number | null; damping: number; contacts: number } } } {
  if (!isDyn(res)) return {};
  const d = res.dynamic;
  const nm = (id: string) => (doc.components?.some((c) => c.id === id) ? instanceKey(doc, id) : id);
  return {
    dynamic: {
      bodies: d.bodies.map((b) => ({ name: nm(b.id), mass: b.mass, source: b.source })),
      springMax: d.springMax ? { name: nm(d.springMax.id), force: d.springMax.force, t: d.springMax.t } : null,
      contacts: d.contacts.map((c) => ({ label: c.label, bound: c.bound, limit: c.limit, intervals: c.intervals, impacts: c.impacts })),
      energy: { e0: d.energy.e0, end: d.energy.end, drift: d.energy.drift, damping: d.energy.damping, contacts: d.energy.contacts },
    },
  };
}
