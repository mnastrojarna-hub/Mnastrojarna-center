/**
 * Zkrutná válcová šroubová pružina – výpočet podle EN 13906-3:2014 (statické zatížení, těsně vinutá).
 *
 *   účinné závity        nef = n + (l1 + l2) / (3 · π · D)        (ohyb ramen)
 *   úhlová tuhost        RM = E · d⁴ / (3667 · D · nef)           [N·mm/°]  (3667 = 64 · 180 / π)
 *   moment               M = RM · α
 *   ohybové napětí       σ = 32 · M / (π · d³), korekce q = (w + 0,07) / (w − 0,75), σq = q · σ
 *   dovolené (statické)  σzul = 0,7 · Rm(d)
 *   délka těla           Lk0 = (n + 1,5) · d
 *   vnitřní průměr při α Di(α) = D · n / (n + α / 360) − d   → trn nejvýš ≈ 0,9 · Di(α2)
 */
import { tr } from "../i18n";
import { materialLabel, rmOf, springMaterial } from "./materials";
import type { LegKind } from "./path";
import type { CalcRow, SpringCalc, SpringData, SpringModel } from "./types";
import { fmt } from "./types";
import { Issues, numOf, pct, posOf, row, strOf } from "./util";

export const LEGS: LegKind[] = ["tangential", "radial", "axial"];
export const legLabel = (l: LegKind) => (l === "tangential" ? tr("tečné") : l === "radial" ? tr("radiální") : tr("osové"));

export const torsionDefaults = (): SpringData => ({ d: 2, De: 20, n: 6.25, leg1: "tangential", leg2: "tangential", l1: 25, l2: 25, material: "SH", hand: "right", a2: 60 });

export type TorsionInput = { d: number; D: number; n: number; leg1: LegKind; leg2: LegKind; l1: number; l2: number; material: string; hand: "right" | "left"; a1?: number; a2?: number; M1?: number; M2?: number };
export function readTorsion(data: SpringData): TorsionInput {
  const d = posOf(data, "d") ?? NaN;
  const D = posOf(data, "D") ?? (posOf(data, "De") !== undefined ? posOf(data, "De")! - d : posOf(data, "Di") !== undefined ? posOf(data, "Di")! + d : NaN);
  const leg = (k: string): LegKind => (LEGS.includes(data[k] as LegKind) ? (data[k] as LegKind) : "tangential");
  return { d, D, n: posOf(data, "n") ?? NaN, leg1: leg("leg1"), leg2: leg("leg2"), l1: numOf(data, "l1") ?? 25, l2: numOf(data, "l2") ?? 25, material: strOf(data, "material", "SH"), hand: data.hand === "left" ? "left" : "right", a1: numOf(data, "a1"), a2: numOf(data, "a2"), M1: numOf(data, "M1"), M2: numOf(data, "M2") };
}

export function calcTorsion(data: SpringData): SpringCalc {
  const i = readTorsion(data);
  const is = new Issues();
  const v: Record<string, number> = {};
  const rows: CalcRow[] = [];
  const m = springMaterial(i.material);
  const { d, D, n } = i;
  if (!(d > 0)) is.err(tr("zadejte průměr drátu d"), "d");
  if (!(D > 0)) is.err(tr("zadejte průměr vinutí – střední D, vnější De nebo vnitřní Di"), "De");
  if (!(n > 0)) is.err(tr("zadejte počet závitů n"), "n");
  const title = tr("Zkrutná pružina {0} × {1} – n {2}", fmt(d), fmt(D + d), fmt(n));
  if (!is.ok) return { kind: "torsion", ok: false, issues: is.list, v, rows, title, summary: title, model: null };
  const w = D / d;
  if (w <= 2) is.err(tr("průměr vinutí je příliš malý vůči drátu (D/d = {0}) – drát se nedá navinout", fmt(w)), "De");
  else if (w < 4) is.warn(tr("index vinutí D/d = {0} je pod 4 (EN 13906-3: 4…20)", fmt(w)), "De");
  else if (w > 20) is.warn(tr("index vinutí D/d = {0} je nad 20 (EN 13906-3: 4…20)", fmt(w)), "De");
  if (n < 1) is.err(tr("počet závitů musí být aspoň 1"), "n");
  if (!(i.l1 >= 0) || !(i.l2 >= 0)) is.err(tr("délka ramen nesmí být záporná"), "l1");
  const E = m.E;
  const nef = n + (i.l1 + i.l2) / (3 * Math.PI * D);
  const RM = (E * d ** 4) / (3667 * D * nef);
  const q = (w + 0.07) / (w - 0.75);
  const Rm = rmOf(m, d);
  const szul = 0.7 * Rm;
  const sigOf = (M: number) => (32 * M) / (Math.PI * d ** 3);
  const amax = (szul / q) * ((Math.PI * d ** 3) / 32) / RM;
  const Lk0 = (n + 1.5) * d;
  const at = (ai: number | undefined, Mi: number | undefined, key: "1" | "2") => {
    let a = ai;
    let M = Mi;
    if (a === undefined && M !== undefined) a = M / RM;
    if (a !== undefined) M = RM * a;
    if (a === undefined || M === undefined) return;
    const sq = q * sigOf(M);
    v[`a${key}`] = a;
    v[`M${key}`] = M;
    v[`sq${key}`] = sq;
    v[`Di${key}`] = (D * n) / (n + a / 360) - d;
    if (sq > szul) is.warn(tr("při natočení o {0}° je napětí {1} % dovoleného (σq = {2} MPa) – největší úhel {3}°", fmt(a, 0), pct(sq, szul), fmt(sq, 0), fmt(amax, 0)), `a${key}`);
  };
  at(i.a1, i.M1, "1");
  at(i.a2, i.M2, "2");
  const lw = Math.PI * D * n + i.l1 + i.l2;
  const mass = m.rho * 1e-6 * ((Math.PI * d * d) / 4) * lw;
  const legAngle = (n - Math.floor(n)) * 360;
  Object.assign(v, { d, D, De: D + d, Di: D - d, w, n, nef, E, Rm, szul, RM, q, Lk0, amax, lw, mass, legAngle });
  rows.push(row("D", tr("střední průměr D"), D, "mm", { symbol: "D", drawing: true }));
  rows.push(row("De", tr("vnější průměr De"), D + d, "mm", { symbol: "De", drawing: true }));
  rows.push(row("Di", tr("vnitřní průměr Di"), D - d, "mm", { symbol: "Di", drawing: true }));
  rows.push(row("RM", tr("úhlová tuhost RM"), RM, "N·mm/°", { symbol: "RM", dec: 2, drawing: true }));
  rows.push(row("nef", tr("účinné závity (s rameny)"), nef, "", { dec: 2 }));
  rows.push(row("Lk0", tr("délka těla Lk0"), Lk0, "mm", { symbol: "Lk0", drawing: true }));
  rows.push(row("legAngle", tr("úhel ramen ve volném stavu"), legAngle, "°", { symbol: "α0", dec: 0, drawing: true }));
  if (v.a1 !== undefined) rows.push(row("M1", tr("moment M1 při α1 {0}°", fmt(v.a1, 0)), v.M1, "N·mm", { symbol: "M1", dec: 0, drawing: true }));
  if (v.a2 !== undefined) rows.push(row("M2", tr("moment M2 při α2 {0}°", fmt(v.a2, 0)), v.M2, "N·mm", { symbol: "M2", dec: 0, drawing: true }));
  if (v.a2 !== undefined) rows.push(row("sq2", tr("napětí σq2 při α2"), v.sq2, "MPa", { symbol: "σq2", dec: 0, level: v.sq2 > szul ? "warn" : "ok", text: `${fmt(v.sq2, 0)} MPa (${pct(v.sq2, szul)} %)` }));
  if (v.a2 !== undefined) rows.push(row("Di2", tr("vnitřní průměr při α2 (trn ≤ 0,9 ×)"), v.Di2, "mm", { dec: 2 }));
  rows.push(row("amax", tr("největší úhel (σq = σzul)"), amax, "°", { dec: 0 }));
  rows.push(row("szul", tr("dovolené napětí σzul = 0,7 · Rm"), szul, "MPa", { symbol: "σzul", dec: 0, text: `${fmt(szul, 0)} MPa (Rm ${fmt(Rm, 0)})` }));
  rows.push(row("lw", tr("délka drátu"), lw, "mm", { dec: 0 }));
  rows.push(row("mass", tr("hmotnost"), mass * 1000, "g", { dec: 1 }));
  rows.push(row("material", tr("materiál"), undefined, "", { text: `${materialLabel(m)} · E ${fmt(E, 0)} MPa`, drawing: true }));
  rows.push(row("legs", tr("ramena"), undefined, "", { text: `${legLabel(i.leg1)} ${fmt(i.l1)} mm / ${legLabel(i.leg2)} ${fmt(i.l2)} mm`, drawing: true }));
  const model: SpringModel = { kind: "torsion", free: Lk0, rate: RM, massKg: mass, D, d, forceAt: () => 0, torqueAt: (deg: number) => RM * deg };
  const summary = tr("zkrutná d {0} · De {1} · n {2} · RM {3} N·mm/°", fmt(d), fmt(D + d), fmt(n), fmt(RM, 2));
  return { kind: "torsion", ok: is.ok, issues: is.list, v, rows, title, summary, model };
}
