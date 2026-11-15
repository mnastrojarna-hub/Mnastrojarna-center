/**
 * Tažná válcová šroubová pružina s očky – výpočet podle EN 13906-2:2013 (statické zatížení, studeně vinutá, těsně vinutá
 * s předpětím).
 *
 *   tuhost             R = G · d⁴ / (8 · D³ · n)
 *   délka těla         Lk = (n + 1) · d
 *   výška očka LH      německé (celé přes střed) = Di, poloviční ≈ 0,75 · D − d, boční (celé, seitlich) = Di
 *   volná délka        L0 = Lk + LH1 + LH2 (mezi vnitřními okraji oček)
 *   síla               F = F0 + R · (L − L0) pro L ≥ L0 (F0 = předpětí)
 *   napětí             τ = 8 · D · F / (π · d³), τk = k · τ (Bergsträsser), počáteční τ0 = 8 · D · F0 / (π · d³)
 *   dovolené (statické) τzul = 0,45 · Rm(d) (tělo; ohyb v očku se neposuzuje – očko bývá nejslabší místo); statická kontrola
 *                      napětím bez korekce τ (EN 13906-2, k až u únavy), τk = k · τ se jen vypíše
 *   největší délka     Ln: síla Fn při τ = τzul, Ln = L0 + (Fn − F0) / R
 */
import { tr } from "../i18n";
import { materialLabel, rmOf, springMaterial } from "./materials";
import type { LoopKind } from "./path";
import { bergstrasser } from "./compression";
import type { CalcRow, SpringCalc, SpringData, SpringModel } from "./types";
import { fmt } from "./types";
import { Issues, numOf, pct, posOf, row, strOf } from "./util";

export const LOOPS: LoopKind[] = ["german", "half", "side"];
export const loopLabel = (l: LoopKind) => (l === "german" ? tr("německé očko (celé přes střed)") : l === "half" ? tr("poloviční očko") : tr("celé očko boční"));
/** výška očka (od konce těla po vnitřní okraj očka) */
export const loopHeight = (l: LoopKind, D: number, d: number) => (l === "half" ? 0.75 * D - d : D - d);

export const extensionDefaults = (): SpringData => ({ d: 1.6, De: 12, n: 12, loop: "german", loop2: "german", F0: 5, material: "SH", hand: "right" });

export type ExtensionInput = { d: number; D: number; n: number; loop: LoopKind; loop2: LoopKind; F0: number; material: string; hand: "right" | "left"; angle?: number; L1?: number; L2?: number; F1?: number; F2?: number };
export function readExtension(data: SpringData): ExtensionInput {
  const d = posOf(data, "d") ?? NaN;
  const D = posOf(data, "D") ?? (posOf(data, "De") !== undefined ? posOf(data, "De")! - d : posOf(data, "Di") !== undefined ? posOf(data, "Di")! + d : NaN);
  const loop = (LOOPS.includes(data.loop as LoopKind) ? data.loop : "german") as LoopKind;
  const loop2 = (LOOPS.includes(data.loop2 as LoopKind) ? data.loop2 : loop) as LoopKind;
  let n = posOf(data, "n") ?? NaN;
  const angle = numOf(data, "angle");
  // natočení oček: počet závitů = celé závity + úhel / 360
  if (angle !== undefined && Number.isFinite(n)) n = Math.max(1, Math.floor(n)) + (((angle % 360) + 360) % 360) / 360;
  return { d, D, n, loop, loop2, F0: numOf(data, "F0") ?? 0, material: strOf(data, "material", "SH"), hand: data.hand === "left" ? "left" : "right", angle, L1: posOf(data, "L1"), L2: posOf(data, "L2"), F1: posOf(data, "F1"), F2: posOf(data, "F2") };
}

export function calcExtension(data: SpringData): SpringCalc {
  const i = readExtension(data);
  const is = new Issues();
  const v: Record<string, number> = {};
  const rows: CalcRow[] = [];
  const m = springMaterial(i.material);
  const { d, D, n } = i;
  if (!(d > 0)) is.err(tr("zadejte průměr drátu d"), "d");
  if (!(D > 0)) is.err(tr("zadejte průměr vinutí – střední D, vnější De nebo vnitřní Di"), "De");
  if (!(n > 0)) is.err(tr("zadejte počet závitů těla n"), "n");
  const title = tr("Tažná pružina {0} × {1} – n {2}", fmt(d), fmt(D + d), fmt(n));
  if (!is.ok) return { kind: "extension", ok: false, issues: is.list, v, rows, title, summary: title, model: null };
  const w = D / d;
  if (w <= 2) is.err(tr("průměr vinutí je příliš malý vůči drátu (D/d = {0}) – drát se nedá navinout", fmt(w)), "De");
  else if (w < 4) is.warn(tr("index vinutí D/d = {0} je pod 4 – těžko vyrobitelné (EN 13906-2: 4…20)", fmt(w)), "De");
  else if (w > 20) is.warn(tr("index vinutí D/d = {0} je nad 20 (EN 13906-2: 4…20)", fmt(w)), "De");
  if (n < 1) is.err(tr("počet závitů musí být aspoň 1"), "n");
  if (i.F0 < 0) is.err(tr("předpětí F0 nesmí být záporné"), "F0");
  const G = m.G;
  const R = (G * d ** 4) / (8 * D ** 3 * n);
  const Lk = (n + 1) * d;
  const LH1 = loopHeight(i.loop, D, d);
  const LH2 = loopHeight(i.loop2, D, d);
  const L0 = Lk + LH1 + LH2;
  const k = bergstrasser(w);
  const Rm = rmOf(m, d);
  const tauzul = 0.45 * Rm;
  const tauOf = (F: number) => (8 * D * F) / (Math.PI * d ** 3);
  const tau0 = tauOf(i.F0);
  const Fn = (tauzul * Math.PI * d ** 3) / (8 * D);
  const Ln = L0 + (Fn - i.F0) / R;
  if (i.F0 > Fn) is.err(tr("předpětí F0 {0} N přesahuje dovolenou sílu {1} N", fmt(i.F0, 1), fmt(Fn, 1)), "F0");
  else if (tau0 > 0.3 * tauzul) is.warn(tr("předpětí τ0 = {0} MPa je vysoké ({1} % τzul) – ověřte s výrobcem, obvykle do 20 %", fmt(tau0, 0), pct(tau0, tauzul)), "F0");
  const at = (Li: number | undefined, Fi: number | undefined, key: "1" | "2") => {
    let L = Li;
    let F = Fi;
    if (L === undefined && F !== undefined) L = L0 + Math.max(0, F - i.F0) / R;
    if (L !== undefined) F = i.F0 + R * Math.max(0, L - L0);
    if (L !== undefined) {
      if (L < L0 - 1e-9) is.err(tr("pracovní délka L{0} {1} mm je kratší než volná délka L0 {2} mm – tažnou pružinu nelze stlačit", key, fmt(L), fmt(L0)), `L${key}`);
      else if (L > Ln) is.warn(tr("při protažení na L{0} {1} mm je napětí {2} % dovoleného (největší délka Ln {3} mm)", key, fmt(L), pct(tauOf(F!), tauzul), fmt(Ln)), `L${key}`);
      v[`L${key}`] = L;
      v[`F${key}`] = F!;
      v[`s${key}`] = L - L0;
      v[`tau${key}`] = tauOf(F!);
      v[`tauk${key}`] = k * tauOf(F!);
    }
  };
  at(i.L1, i.F1, "1");
  at(i.L2, i.F2, "2");
  const lw = Math.PI * D * n + 2 * Math.PI * D * 0.9;
  const mass = m.rho * 1e-6 * ((Math.PI * d * d) / 4) * lw;
  const turnsFrac = n - Math.floor(n);
  Object.assign(v, { d, D, De: D + d, Di: D - d, w, n, G, Rm, tauzul, R, Lk, LH1, LH2, L0, F0: i.F0, tau0, k, Fn, Ln, lw, mass, loopAngle: turnsFrac * 360 });
  rows.push(row("D", tr("střední průměr D"), D, "mm", { symbol: "D", drawing: true }));
  rows.push(row("De", tr("vnější průměr De"), D + d, "mm", { symbol: "De", drawing: true }));
  rows.push(row("w", tr("index vinutí w = D/d"), w, "", { symbol: "w" }));
  rows.push(row("R", tr("tuhost R"), R, "N/mm", { symbol: "R", dec: 3, drawing: true }));
  rows.push(row("Lk", tr("délka těla Lk"), Lk, "mm", { symbol: "Lk", drawing: true }));
  rows.push(row("LH", tr("výška oček LH"), LH1, "mm", { symbol: "LH", text: LH1 === LH2 ? `${fmt(LH1)} mm` : `${fmt(LH1)} / ${fmt(LH2)} mm` }));
  rows.push(row("L0", tr("volná délka L0 (mezi očky)"), L0, "mm", { symbol: "L0", drawing: true }));
  rows.push(row("loopAngle", tr("vzájemné natočení oček"), turnsFrac * 360, "°", { dec: 0 }));
  rows.push(row("tau0", tr("počáteční napětí τ0"), tau0, "MPa", { symbol: "τ0", dec: 0 }));
  if (v.L1 !== undefined) rows.push(row("F1", tr("síla F1 při L1 {0} mm", fmt(v.L1)), v.F1, "N", { symbol: "F1", dec: 1, drawing: true }));
  if (v.L2 !== undefined) rows.push(row("F2", tr("síla F2 při L2 {0} mm", fmt(v.L2)), v.F2, "N", { symbol: "F2", dec: 1, drawing: true }));
  if (v.tau2 !== undefined) rows.push(row("tau2", tr("napětí τ2 při L2 (statická kontrola)"), v.tau2, "MPa", { symbol: "τ2", dec: 0, level: v.tau2 > tauzul ? "warn" : "ok", text: `${fmt(v.tau2, 0)} MPa (${pct(v.tau2, tauzul)} %)` }));
  if (v.tauk2 !== undefined) rows.push(row("tauk2", tr("napětí τk2 = k · τ2 (opakované zatížení)"), v.tauk2, "MPa", { symbol: "τk2", dec: 0, text: `${fmt(v.tauk2, 0)} MPa (${pct(v.tauk2, tauzul)} %)` }));
  rows.push(row("Ln", tr("největší délka Ln (τ = τzul)"), Ln, "mm", { symbol: "Ln", drawing: true }));
  rows.push(row("Fn", tr("největší síla Fn"), Fn, "N", { symbol: "Fn", dec: 1 }));
  rows.push(row("tauzul", tr("dovolené napětí τzul = 0,45 · Rm"), tauzul, "MPa", { symbol: "τzul", dec: 0, text: `${fmt(tauzul, 0)} MPa (Rm ${fmt(Rm, 0)})` }));
  rows.push(row("lw", tr("délka drátu"), lw, "mm", { dec: 0 }));
  rows.push(row("mass", tr("hmotnost"), mass * 1000, "g", { dec: 1 }));
  rows.push(row("material", tr("materiál"), undefined, "", { text: `${materialLabel(m)} · G ${fmt(G, 0)} MPa`, drawing: true }));
  rows.push(row("loops", tr("očka"), undefined, "", { text: i.loop === i.loop2 ? loopLabel(i.loop) : `${loopLabel(i.loop)} / ${loopLabel(i.loop2)}`, drawing: true }));
  const model: SpringModel = { kind: "extension", free: L0, solid: Lk, rate: R, preload: i.F0, massKg: mass, D, d, forceAt: (L: number) => (L >= L0 - 1e-9 ? i.F0 + R * Math.max(0, L - L0) : 0) };
  const summary = tr("tažná d {0} · De {1} · n {2} · L0 {3} · R {4} N/mm · F0 {5} N", fmt(d), fmt(D + d), fmt(n), fmt(L0), fmt(R, 3), fmt(i.F0, 1));
  return { kind: "extension", ok: is.ok, issues: is.list, v, rows, title, summary, model };
}
