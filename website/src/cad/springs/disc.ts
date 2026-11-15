/**
 * Talířové pružiny DIN 2093 (EN 16983) – rozměry řad A, B, C a výpočet podle DIN 2092 / EN 16984 (Almen–László, bez tření,
 * skupina 1–2 bez dosedacích ploch K4 = 1, ocel E = 206 000 MPa, μ = 0,3).
 *
 *   δ = De / Di
 *   K1 = (1/π) · ((δ − 1)/δ)² / ((δ + 1)/(δ − 1) − 2/ln δ)
 *   K2 = (6/π) · ((δ − 1)/ln δ − 1) / ln δ,   K3 = (3/π) · (δ − 1)/ln δ
 *   síla talíře        F(s) = 4E/(1 − μ²) · t⁴/(K1 · De²) · (s/t) · [(h0/t − s/t) · (h0/t − s/(2t)) + 1]
 *   síla naplocho      Fc = 4E/(1 − μ²) · t³ · h0/(K1 · De²)
 *   napětí             σOM = −4E/(1 − μ²) · t²/(K1 · De²) · (s/t) · 3/π
 *                      σII = −4E/(1 − μ²) · t²/(K1 · De²) · (s/t) · [K2 · (h0/t − s/(2t)) − K3]      (tah dole uvnitř)
 *                      σIII = −4E/(1 − μ²) · t²/(K1 · De²) · (s/t) / δ · [(K2 − 2K3) · (h0/t − s/(2t)) − K3] (tah dole vně)
 *   sloupec: ns talířů střídavě za sebou, v každém np talířů v sobě → L0 = ns · (h0 + np · t), F = np · F(s), s = (L0 − L)/ns
 *   doporučený zdvih talíře s ≤ 0,75 · h0
 */
import { tr } from "../i18n";
import { materialLabel, springMaterial } from "./materials";
import type { CalcRow, SpringCalc, SpringData, SpringModel } from "./types";
import { fmt } from "./types";
import { Issues, numOf, posOf, row, strOf } from "./util";

export type DiscSize = { s: "A" | "B" | "C"; De: number; Di: number; t: number; h0: number };
const T = (s: DiscSize["s"], rows: number[][]): DiscSize[] => rows.map(([De, Di, t, h0]) => ({ s, De, Di, t, h0 }));
/** DIN 2093 řady A (De/t ≈ 18, h0/t ≈ 0,4), B (≈ 28, 0,75), C (≈ 40, 1,3) */
export const DISC_SIZES: DiscSize[] = [
  ...T("A", [[8, 4.2, 0.4, 0.2], [10, 5.2, 0.5, 0.25], [12.5, 6.2, 0.7, 0.3], [14, 7.2, 0.8, 0.3], [16, 8.2, 0.9, 0.35], [18, 9.2, 1, 0.4], [20, 10.2, 1.1, 0.45], [22.5, 11.2, 1.25, 0.5], [25, 12.2, 1.5, 0.55], [28, 14.2, 1.5, 0.65], [31.5, 16.3, 1.75, 0.7], [35.5, 18.3, 2, 0.8], [40, 20.4, 2.25, 0.9], [45, 22.4, 2.5, 1], [50, 25.4, 3, 1.1], [56, 28.5, 3, 1.3], [63, 31, 3.5, 1.4], [71, 36, 4, 1.6], [80, 41, 5, 1.7], [90, 46, 5, 2], [100, 51, 6, 2.2], [112, 57, 6, 2.5], [125, 64, 8, 2.6], [140, 72, 8, 3.2], [160, 82, 10, 3.5], [180, 92, 10, 4], [200, 102, 12, 4.2], [225, 112, 12, 5], [250, 127, 14, 5.6]]),
  ...T("B", [[8, 4.2, 0.3, 0.25], [10, 5.2, 0.4, 0.3], [12.5, 6.2, 0.5, 0.35], [14, 7.2, 0.5, 0.4], [16, 8.2, 0.6, 0.45], [18, 9.2, 0.7, 0.5], [20, 10.2, 0.8, 0.55], [22.5, 11.2, 0.8, 0.65], [25, 12.2, 0.9, 0.7], [28, 14.2, 1, 0.8], [31.5, 16.3, 1.25, 0.9], [35.5, 18.3, 1.25, 1], [40, 20.4, 1.5, 1.15], [45, 22.4, 1.75, 1.3], [50, 25.4, 2, 1.4], [56, 28.5, 2, 1.6], [63, 31, 2.5, 1.75], [71, 36, 2.5, 2], [80, 41, 3, 2.3], [90, 46, 3.5, 2.5], [100, 51, 3.5, 2.8], [112, 57, 4, 3.2], [125, 64, 5, 3.5], [140, 72, 5, 4], [160, 82, 6, 4.5], [180, 92, 6, 5.1], [200, 102, 8, 5.6], [225, 112, 8, 6.5], [250, 127, 10, 7]]),
  ...T("C", [[8, 4.2, 0.2, 0.25], [10, 5.2, 0.25, 0.3], [12.5, 6.2, 0.35, 0.45], [14, 7.2, 0.35, 0.45], [16, 8.2, 0.4, 0.5], [18, 9.2, 0.45, 0.6], [20, 10.2, 0.5, 0.65], [22.5, 11.2, 0.6, 0.8], [25, 12.2, 0.7, 0.9], [28, 14.2, 0.8, 1], [31.5, 16.3, 0.8, 1.05], [35.5, 18.3, 0.9, 1.15], [40, 20.4, 1, 1.3], [45, 22.4, 1.25, 1.6], [50, 25.4, 1.25, 1.6], [56, 28.5, 1.5, 1.95], [63, 31, 1.8, 2.35], [71, 36, 2, 2.6], [80, 41, 2.25, 2.95], [90, 46, 2.5, 3.2], [100, 51, 2.7, 3.5], [112, 57, 3, 3.9], [125, 64, 3.5, 4.5], [140, 72, 3.8, 4.9], [160, 82, 4.3, 5.6], [180, 92, 4.8, 6.2], [200, 102, 5.5, 7], [225, 112, 6.5, 7.1], [250, 127, 7, 7.8]]),
];
export const discOuterSizes = (s: string) => DISC_SIZES.filter((x) => x.s === s).map((x) => x.De);
export const discSize = (series: string, De: number) => DISC_SIZES.find((x) => x.s === series && Math.abs(x.De - De) < 1e-6);

export const discDefaults = (): SpringData => ({ series: "A", De: 40, ns: 1, np: 1, material: "51CrV4" });

export type DiscInput = { series: "A" | "B" | "C" | "custom"; De: number; Di: number; t: number; h0: number; ns: number; np: number; material: string; L1?: number; L2?: number; F1?: number; F2?: number };
export function readDisc(data: SpringData): DiscInput {
  const series = (["A", "B", "C", "custom"].includes(String(data.series)) ? data.series : "A") as DiscInput["series"];
  const De = posOf(data, "De") ?? 40;
  const std = series !== "custom" ? discSize(series, De) : undefined;
  return {
    series,
    De,
    Di: std?.Di ?? posOf(data, "Di") ?? NaN,
    t: std?.t ?? posOf(data, "t") ?? NaN,
    h0: std?.h0 ?? posOf(data, "h0") ?? NaN,
    ns: Math.max(1, Math.round(numOf(data, "ns") ?? 1)),
    np: Math.max(1, Math.round(numOf(data, "np") ?? 1)),
    material: strOf(data, "material", "51CrV4"),
    L1: posOf(data, "L1"),
    L2: posOf(data, "L2"),
    F1: posOf(data, "F1"),
    F2: posOf(data, "F2"),
  };
}

export function almen(o: { De: number; Di: number; t: number; h0: number; E: number; mu?: number }) {
  const mu = o.mu ?? 0.3;
  const dl = o.De / o.Di;
  const ln = Math.log(dl);
  const K1 = ((1 / Math.PI) * ((dl - 1) / dl) ** 2) / ((dl + 1) / (dl - 1) - 2 / ln);
  const K2 = ((6 / Math.PI) * ((dl - 1) / ln - 1)) / ln;
  const K3 = ((3 / Math.PI) * (dl - 1)) / ln;
  const C = (4 * o.E) / (1 - mu * mu);
  const { t, h0, De } = o;
  const F = (s: number) => ((C * t ** 4) / (K1 * De * De)) * (s / t) * ((h0 / t - s / t) * (h0 / t - s / (2 * t)) + 1);
  const rate = (s: number) => ((C * t ** 3) / (K1 * De * De)) * ((h0 / t) ** 2 - 3 * (h0 / t) * (s / t) + 1.5 * (s / t) ** 2 + 1);
  const sOM = (s: number) => -((C * t * t) / (K1 * De * De)) * (s / t) * (3 / Math.PI);
  const sII = (s: number) => -((C * t * t) / (K1 * De * De)) * (s / t) * (K2 * (h0 / t - s / (2 * t)) - K3);
  const sIII = (s: number) => -((C * t * t) / (K1 * De * De)) * (s / t) * (1 / dl) * ((K2 - 2 * K3) * (h0 / t - s / (2 * t)) - K3);
  const Fc = (C * t ** 3 * h0) / (K1 * De * De);
  return { K1, K2, K3, F, rate, sOM, sII, sIII, Fc, delta: dl };
}

export function calcDisc(data: SpringData): SpringCalc {
  const i = readDisc(data);
  const is = new Issues();
  const v: Record<string, number> = {};
  const rows: CalcRow[] = [];
  const m = springMaterial(i.material);
  const { De, Di, t, h0, ns, np } = i;
  if (i.series !== "custom" && !discSize(i.series, De)) is.err(tr("DIN 2093 řada {0} nemá talíř De {1} mm – vyberte ze seznamu nebo zvolte vlastní rozměry", i.series, fmt(De)), "De");
  if (!(Di > 0) || !(t > 0) || !(h0 > 0)) is.err(tr("zadejte Di, tloušťku t a výšku kužele h0"), "Di");
  const title = tr("Talířová pružina {0} × {1} × {2}", fmt(De), fmt(Di), fmt(t));
  if (!is.ok) return { kind: "disc", ok: false, issues: is.list, v, rows, title, summary: title, model: null };
  if (Di >= De) is.err(tr("vnitřní průměr Di musí být menší než vnější De"), "Di");
  if (!is.ok) return { kind: "disc", ok: false, issues: is.list, v, rows, title, summary: title, model: null };
  const a = almen({ De, Di, t, h0, E: m.E });
  const l0 = t + h0;
  const L0 = ns * (h0 + np * t);
  const Lc = ns * np * t;
  const Fstack = (L: number) => np * a.F(Math.max(0, Math.min(h0, (L0 - L) / ns)));
  const at = (Li: number | undefined, Fi: number | undefined, key: "1" | "2") => {
    let L = Li;
    let F = Fi;
    if (L === undefined && F !== undefined) {
      // síla → délka (monotónní pro h0/t < 1,41 – řady A, B, C)
      let lo = 0;
      let hi = h0;
      for (let k = 0; k < 60; k++) {
        const mid = (lo + hi) / 2;
        if (np * a.F(mid) < F) lo = mid;
        else hi = mid;
      }
      L = L0 - ns * lo;
      if (np * a.F(h0) < F) is.err(tr("síla F{0} {1} N je větší než síla naplocho {2} N", key, fmt(F, 0), fmt(np * a.Fc, 0)), `F${key}`);
    }
    if (L === undefined) return;
    const s = (L0 - L) / ns;
    if (s < 0) is.err(tr("délka L{0} {1} mm je větší než volná výška sloupce L0 {2} mm", key, fmt(L), fmt(L0)), `L${key}`);
    else if (s > h0 + 1e-9) is.err(tr("délka L{0} {1} mm je pod výškou naplocho {2} mm", key, fmt(L), fmt(Lc)), `L${key}`);
    else if (s > 0.75 * h0 + 1e-9) is.warn(tr("zdvih talíře při L{0} je {1} % h0 – DIN 2093 doporučuje nejvýš 75 %", key, Math.round((s / h0) * 100)), `L${key}`);
    F = Fstack(L);
    v[`L${key}`] = L;
    v[`F${key}`] = F;
    v[`s${key}`] = s;
    v[`sOM${key}`] = a.sOM(s);
    v[`sII${key}`] = a.sII(s);
    v[`sIII${key}`] = a.sIII(s);
  };
  at(i.L1, i.F1, "1");
  at(i.L2, i.F2, "2");
  const vol = ((Math.PI / 4) * (De * De - Di * Di) * t) * ns * np;
  const mass = m.rho * 1e-6 * vol;
  const R0 = (np / ns) * a.rate(0);
  Object.assign(v, { De, Di, t, h0, l0, ns, np, L0, Lc, K1: a.K1, Fc: a.Fc * np, F75: np * a.F(0.75 * h0), R0, mass, delta: a.delta, s75: 0.75 * h0 * ns });
  rows.push(row("size", tr("talíř De × Di × t"), undefined, "", { text: `${i.series === "custom" ? "" : `DIN 2093 ${i.series} `}${fmt(De)} × ${fmt(Di)} × ${fmt(t)}`, drawing: true }));
  rows.push(row("h0", tr("výška kužele h0"), h0, "mm", { symbol: "h0", dec: 2, drawing: true }));
  rows.push(row("l0", tr("volná výška talíře l0"), l0, "mm", { symbol: "l0", dec: 2 }));
  rows.push(row("stack", tr("sloupec"), undefined, "", { text: tr("{0} × za sebou, po {1} v sobě", ns, np), drawing: true }));
  rows.push(row("L0", tr("volná výška sloupce L0"), L0, "mm", { symbol: "L0", dec: 2, drawing: true }));
  rows.push(row("Lc", tr("výška naplocho Lc"), Lc, "mm", { symbol: "Lc", dec: 2, drawing: true }));
  rows.push(row("F75", tr("síla při s = 0,75 h0"), np * a.F(0.75 * h0), "N", { dec: 0, drawing: true }));
  rows.push(row("Fc", tr("síla naplocho Fc"), a.Fc * np, "N", { symbol: "Fc", dec: 0 }));
  rows.push(row("R0", tr("počáteční tuhost sloupce"), R0, "N/mm", { dec: 0 }));
  if (v.L1 !== undefined) rows.push(row("F1", tr("síla F1 při L1 {0} mm", fmt(v.L1, 2)), v.F1, "N", { symbol: "F1", dec: 0, drawing: true }));
  if (v.L2 !== undefined) rows.push(row("F2", tr("síla F2 při L2 {0} mm", fmt(v.L2, 2)), v.F2, "N", { symbol: "F2", dec: 0, drawing: true }));
  if (v.L2 !== undefined) rows.push(row("sOM2", tr("napětí σOM / σII / σIII při L2"), v.sOM2, "MPa", { text: `${fmt(v.sOM2, 0)} / ${fmt(v.sII2, 0)} / ${fmt(v.sIII2, 0)} MPa` }));
  rows.push(row("mass", tr("hmotnost"), mass * 1000, "g", { dec: 1 }));
  rows.push(row("material", tr("materiál"), undefined, "", { text: materialLabel(m), drawing: true }));
  const model: SpringModel = { kind: "disc", free: L0, solid: Lc, rate: R0, massKg: mass, D: De, d: t, forceAt: Fstack };
  const summary = tr("talířová {0} × {1} × {2} · h0 {3} · sloupec {4}×{5} · L0 {6} · F(0,75 h0) {7} N", fmt(De), fmt(Di), fmt(t), fmt(h0), ns, np, fmt(L0), fmt(np * a.F(0.75 * h0), 0));
  return { kind: "disc", ok: is.ok, issues: is.list, v, rows, title, summary, model };
}
