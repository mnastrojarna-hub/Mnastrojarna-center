/**
 * Tlačná válcová šroubová pružina z kruhového drátu – výpočet podle EN 13906-1:2013 (statické zatížení, studeně vinutá).
 *
 *   střední průměr        D = De − d = Di + d,  index vinutí w = D / d (doporučeno 4…20)
 *   tuhost                R = G · d⁴ / (8 · D³ · n)                                       [N/mm]
 *   celkový počet závitů  nt = n + 2 (závěrné konce), n (otevřené konce)
 *   délka na doraz        Ln = nt · d (broušené), (nt + 1,5) · d (neobroušené), (nt + 1) · d (otevřené)
 *   nejmenší součet mezer Sa = (0,0015 · D² / d + 0,1 · d) · n      → nejmenší pracovní délka Ln + Sa
 *   síla                  F = R · (L0 − L)
 *   napětí                τ = 8 · D · F / (π · d³), korekce (Bergsträsser) k = (w + 0,5) / (w − 0,75), τk = k · τ
 *   dovolené (statické)   τzul = 0,5 · Rm(d); statická a kvazistatická kontrola napětím BEZ korekce: τ2 ≤ τzul, τn ≤ τzul
 *                         (EN 13906-1 – k se uplatní až u únavy); τk2 = k · τ2 nad τzul hlásí přísnější ⚠ pro opakované
 *                         zatížení (stírače, vyhazovače), s výslovným „staticky vyhoví“
 *   pracovní bod silou    F ≤ Fn = R · (L0 − Ln), jinak ✗ u řádku síly (délka by vyšla pod Ln, i záporná)
 *   bez pracovního bodu   L0 < Ln + Sa → ⚠ u L0: pružina nemá přípustný pracovní zdvih
 *   vzpěr (kritický zdvih) sK = L0 · 0,5 / (1 − G/E) · [1 − √(1 − (1 − G/E)/(0,5 + G/E) · (π · D / (ν · L0))²)]
 *                         (záporný výraz pod odmocninou = pružina se nevybočí); ν = součinitel uložení konců
 *   vlastní frekvence     fe = d / (2π · n · D²) · √(G / (2ρ))   (oba konce na pevných opěrách)
 *   délka drátu, hmotnost l = π · D · nt, m = ρ · π · d² / 4 · l
 *   zvětšení De při Ln    ΔDe = 0,1 · (m² − 0,8 · m · d − 0,2 · d²) / D, m = stoupání činných závitů
 */
import { tr } from "../i18n";
import { materialLabel, rmOf, springMaterial } from "./materials";
import { compressionSpec, type Ends } from "./path";
import type { CalcRow, SpringCalc, SpringData, SpringModel } from "./types";
import { fmt } from "./types";
import { Issues, numOf, pct, posOf, row, strOf } from "./util";

export type CompressionInput = {
  d: number;
  D: number;
  L0: number;
  n: number;
  ends: Ends;
  material: string;
  nu: number;
  hand: "right" | "left";
  L1?: number;
  L2?: number;
  F1?: number;
  F2?: number;
};

export const ENDS: Ends[] = ["ground", "closed", "open"];
export const endsLabel = (e: Ends) => (e === "ground" ? tr("přiložené a broušené") : e === "closed" ? tr("přiložené, neobroušené") : tr("otevřené"));
/** součinitel uložení konců ν (EN 13906-1 obr. 5) */
export const SUPPORTS = [
  { v: "0.5", l: () => tr("oba konce vedené, rovnoběžné (0,5)") },
  { v: "0.7", l: () => tr("jeden vedený, druhý kloubově (0,7)") },
  { v: "1", l: () => tr("oba konce kloubově (1)") },
  { v: "2", l: () => tr("jeden vetknutý, druhý volný (2)") },
];

/** Výchozí data (tabulka bez zadání): drát 2, De 20, L0 50, n 8, broušené konce, SH. */
export const compressionDefaults = (): SpringData => ({ d: 2, De: 20, L0: 50, n: 8, ends: "ground", material: "SH", nu: "0.5", hand: "right" });

/** Vstup z dat prvku (D z De / Di, n z nt). Chybějící hodnoty = NaN (validace je ohlásí u řádku). */
export function readCompression(data: SpringData): CompressionInput {
  const d = posOf(data, "d") ?? NaN;
  const ends = (["ground", "closed", "open"].includes(String(data.ends)) ? data.ends : "ground") as Ends;
  const D = posOf(data, "D") ?? (posOf(data, "De") !== undefined ? posOf(data, "De")! - d : posOf(data, "Di") !== undefined ? posOf(data, "Di")! + d : NaN);
  const dead = ends === "open" ? 0 : 2;
  const n = posOf(data, "n") ?? (posOf(data, "nt") !== undefined ? posOf(data, "nt")! - dead : NaN);
  return {
    d,
    D,
    L0: posOf(data, "L0") ?? NaN,
    n,
    ends,
    material: strOf(data, "material", "SH"),
    nu: Number(strOf(data, "nu", "0.5")) || 0.5,
    hand: data.hand === "left" ? "left" : "right",
    L1: posOf(data, "L1"),
    L2: posOf(data, "L2"),
    F1: posOf(data, "F1"),
    F2: posOf(data, "F2"),
  };
}

/** Délka na doraz podle konců (EN 13906-1 tab. 3, studeně vinuté). */
export const solidLength = (d: number, nt: number, ends: Ends) => (ends === "ground" ? nt * d : ends === "closed" ? (nt + 1.5) * d : (nt + 1) * d);
/** Kritický zdvih vzpěru sK (Infinity = nevybočí). */
export function bucklingDeflection(o: { L0: number; D: number; G: number; E: number; nu: number }): number {
  const g = o.G / o.E;
  const rad = 1 - ((1 - g) / (0.5 + g)) * ((Math.PI * o.D) / (o.nu * o.L0)) ** 2;
  if (rad < 0) return Infinity;
  return ((o.L0 * 0.5) / (1 - g)) * (1 - Math.sqrt(rad));
}
/** Součinitel korekce napětí (Bergsträsser) */
export const bergstrasser = (w: number) => (w + 0.5) / (w - 0.75);
/** Smykové napětí bez korekce τ = 8 · D · F / (π · d³) [MPa] (statická kontrola EN 13906-1; τk = k · τ) */
export const shearStress = (D: number, d: number, F: number) => (8 * D * F) / (Math.PI * d ** 3);

export function calcCompression(data: SpringData): SpringCalc {
  const i = readCompression(data);
  const is = new Issues();
  const v: Record<string, number> = {};
  const rows: CalcRow[] = [];
  const m = springMaterial(i.material);
  const { d, D, L0, n } = i;
  if (!(d > 0)) is.err(tr("zadejte průměr drátu d"), "d");
  if (!(D > 0)) is.err(tr("zadejte průměr vinutí – střední D, vnější De nebo vnitřní Di"), "De");
  if (!(L0 > 0)) is.err(tr("zadejte volnou délku L0"), "L0");
  if (!(n > 0)) is.err(tr("zadejte počet činných závitů n (nebo celkový nt)"), "n");
  const title = tr("Tlačná pružina {0} × {1} × {2}", fmt(d), fmt(D + d), fmt(L0));
  if (!is.ok) return { kind: "compression", ok: false, issues: is.list, v, rows, title, summary: title, model: null };
  const w = D / d;
  if (w <= 2) is.err(tr("průměr vinutí je příliš malý vůči drátu (D/d = {0}) – drát se nedá navinout", fmt(w)), "De");
  else if (w < 4) is.warn(tr("index vinutí D/d = {0} je pod 4 – těžko vyrobitelné, vysoké napětí na vnitřní straně (EN 13906-1: 4…20)", fmt(w)), "De");
  else if (w > 20) is.warn(tr("index vinutí D/d = {0} je nad 20 – pružina je měkká a nestabilní při navíjení (EN 13906-1: 4…20)", fmt(w)), "De");
  if (n < 1) is.err(tr("počet činných závitů musí být aspoň 1"), "n");
  else if (n < 2) is.warn(tr("méně než 2 činné závity – EN 13906-1 doporučuje n ≥ 2"), "n");
  const dead = i.ends === "open" ? 0 : 2;
  const nt = n + dead;
  const G = m.G;
  const E = m.E;
  const R = (G * d ** 4) / (8 * D ** 3 * n);
  const Ln = solidLength(d, nt, i.ends);
  const Sa = (0.0015 * (D * D) / d + 0.1 * d) * n;
  const Lmin = Ln + Sa;
  const k = bergstrasser(w);
  const Rm = rmOf(m, d);
  const tauzul = 0.5 * Rm;
  const tauOf = (F: number) => shearStress(D, d, F);
  if (L0 <= Ln + 1e-9) is.err(tr("volná délka L0 {0} mm není větší než délka na doraz Ln {1} mm – zvětšete L0 nebo zmenšete počet závitů", fmt(L0), fmt(Ln)), "L0");
  const spec = compressionSpec({ d, D, n, L0, ends: i.ends });
  if (spec.pa <= d * 1.0001 && L0 > Ln) is.err(tr("stoupání činných závitů {0} mm je menší než drát – závity by se ve volném stavu dotýkaly", fmt(spec.pa, 3)), "L0");
  // pracovní body
  const FnMax = R * (L0 - Ln);
  const at = (Li: number | undefined, Fi: number | undefined, key: "1" | "2"): { L?: number; F?: number } => {
    let L = Li;
    let F = Fi;
    if (L === undefined && F !== undefined) {
      // síla nad silou na doraz: délka by vyšla pod Ln (i záporná) – chyba patří k zadané síle, ne k nevyplněné délce
      if (L0 > Ln && F > FnMax * (1 + 1e-9)) {
        is.err(tr("síla F{0} {1} N je větší než síla na doraz Fn {2} N – pružina ji nepřenese (stlačí se nejvýš na Ln {3} mm); zvolte tužší pružinu nebo menší sílu", key, fmt(F, 1), fmt(FnMax, 1), fmt(Ln)), `F${key}`);
        return {};
      }
      L = L0 - F / R;
    }
    if (L !== undefined) F = R * (L0 - L);
    if (Li !== undefined && Fi !== undefined && Math.abs(R * (L0 - Li) - Fi) > Math.max(0.5, Fi * 0.02)) is.info(tr("zadána délka L{0} i síla F{0} – platí délka (F{0} = {1} N)", key, fmt(R * (L0 - Li), 1)), `F${key}`);
    return { L, F };
  };
  const p1 = at(i.L1, i.F1, "1");
  const p2 = at(i.L2, i.F2, "2");
  if (p1.L !== undefined && p2.L !== undefined && p1.L < p2.L) is.warn(tr("L1 by měla být delší než L2 (L1 = menší stlačení)"), "L1");
  for (const [p, key] of [[p1, "1"], [p2, "2"]] as const) {
    if (p.L === undefined) continue;
    if (p.L > L0) is.err(tr("pracovní délka L{0} {1} mm je delší než volná délka L0 – tlačná pružina by nebyla stlačena", key, fmt(p.L)), `L${key}`);
    else if (p.L < Ln) is.err(tr("pracovní délka L{0} {1} mm je kratší než délka na doraz Ln {2} mm – pružinu nelze tolik stlačit", key, fmt(p.L), fmt(Ln)), `L${key}`);
    else if (p.L < Lmin) is.warn(tr("pracovní délka L{0} {1} mm je pod nejmenší přípustnou Ln + Sa = {2} mm – závity se budou dotýkat", key, fmt(p.L), fmt(Lmin)), `L${key}`);
  }
  // i bez pracovního bodu: volná délka pod Ln + Sa = žádný přípustný zdvih
  if (L0 > Ln && L0 < Lmin) is.warn(tr("volná délka L0 {0} mm je kratší než nejmenší pracovní délka Ln + Sa = {1} mm – pružina nemá přípustný pracovní zdvih; zvětšete L0 nebo uberte závity", fmt(L0), fmt(Lmin)), "L0");
  const Fn = R * (L0 - Ln);
  const taun = tauOf(Fn);
  const taukn = k * taun;
  const sK = bucklingDeflection({ L0, D, G, E, nu: i.nu });
  const lw = Math.PI * D * nt;
  const mass = (m.rho * 1e-6) * ((Math.PI * d * d) / 4) * lw; // kg (ρ g/cm³ → kg/mm³ · 1e-6 · … )
  const fe = (d / (2 * Math.PI * n * D * D)) * Math.sqrt((G * 1e6) / (2 * m.rho * 1000)) * 1000;
  const mp = spec.pa;
  const dDe = (0.1 * (mp * mp - 0.8 * mp * d - 0.2 * d * d)) / D;
  Object.assign(v, { d, D, De: D + d, Di: D - d, w, L0, n, nt, G, E, rho: m.rho, Rm, tauzul, R, Ln, Sa, Lmin, sn: L0 - Ln, Fn, k, taun, taukn, sK, lw, mass, fe, p: spec.pa, dDe, nu: i.nu });
  const kn2 = (p: { L?: number; F?: number }, key: "1" | "2") => {
    if (p.L === undefined || p.F === undefined) return;
    const tau = tauOf(p.F);
    v[`L${key}`] = p.L;
    v[`F${key}`] = p.F;
    v[`s${key}`] = L0 - p.L;
    v[`tau${key}`] = tau;
    v[`tauk${key}`] = k * tau;
  };
  kn2(p1, "1");
  kn2(p2, "2");
  // napětí (statická kontrola EN 13906-1 bez korekce k; τk = k · τ jen jako přísnější rada pro opakované zatížení) a vzpěr
  if (v.tau2 !== undefined && v.tau2 > tauzul) is.warn(tr("při stlačení na L2 je napětí {0} % dovoleného (τ2 = {1} MPa, τzul = {2} MPa, statická kontrola EN 13906-1) – silnější drát, víc závitů nebo menší zdvih", pct(v.tau2, tauzul), fmt(v.tau2, 0), fmt(tauzul, 0)), "L2");
  else if (v.tauk2 !== undefined && v.tauk2 > tauzul) is.warn(tr("při stlačení na L2 je napětí s korekcí k {0} % dovoleného (τk2 = {1} MPa) – staticky vyhoví (τ2 {2} %), při opakovaném zatížení (stírače, vyhazovače) volte silnější drát, víc závitů nebo menší zdvih", pct(v.tauk2, tauzul), fmt(v.tauk2, 0), pct(v.tau2, tauzul)), "L2");
  if (taun > tauzul) is.warn(tr("při stlačení na doraz Ln je napětí {0} % dovoleného – pružina by sedla; omezte zdvih dorazem nad Ln", pct(taun, tauzul)), "Ln");
  const sMax = v.s2 ?? L0 - Ln;
  if (Number.isFinite(sK) && sMax > sK) is.warn(tr("pružina se vybočí – kritický zdvih sK = {0} mm je menší než zdvih {1} mm; použijte trn nebo vedení (pouzdro)", fmt(sK, 1), fmt(sMax, 1)), "nu");
  // řádky (pořadí = tabulka)
  const lvl = (bad: boolean, warn = false): CalcRow["level"] => (bad ? "error" : warn ? "warn" : "ok");
  rows.push(row("D", tr("střední průměr D"), D, "mm", { symbol: "D", drawing: true }));
  rows.push(row("De", tr("vnější průměr De"), D + d, "mm", { symbol: "De", drawing: true }));
  rows.push(row("Di", tr("vnitřní průměr Di"), D - d, "mm", { symbol: "Di", drawing: true }));
  rows.push(row("w", tr("index vinutí w = D/d"), w, "", { symbol: "w", level: lvl(w <= 2, w < 4 || w > 20) }));
  rows.push(row("nt", tr("celkový počet závitů nt"), nt, "", { symbol: "nt", drawing: true }));
  rows.push(row("p", tr("stoupání činných závitů"), spec.pa, "mm", { symbol: "m", dec: 3 }));
  rows.push(row("R", tr("tuhost R"), R, "N/mm", { symbol: "R", dec: 3, drawing: true }));
  rows.push(row("Ln", tr("délka na doraz Ln"), Ln, "mm", { symbol: "Ln", drawing: true, level: lvl(L0 <= Ln) }));
  rows.push(row("Sa", tr("nejmenší součet mezer Sa"), Sa, "mm", { symbol: "Sa" }));
  rows.push(row("Lmin", tr("nejmenší pracovní délka Ln + Sa"), Lmin, "mm", { symbol: "Ln+Sa" }));
  if (v.L1 !== undefined) rows.push(row("F1", tr("síla F1 při L1 {0} mm", fmt(v.L1)), v.F1, "N", { symbol: "F1", dec: 1, drawing: true }));
  if (v.L2 !== undefined) rows.push(row("F2", tr("síla F2 při L2 {0} mm", fmt(v.L2)), v.F2, "N", { symbol: "F2", dec: 1, drawing: true }));
  rows.push(row("Fn", tr("síla na doraz Fn"), Fn, "N", { symbol: "Fn", dec: 1 }));
  rows.push(row("k", tr("součinitel korekce napětí k"), k, "", { symbol: "k", dec: 3 }));
  if (v.tau2 !== undefined) rows.push(row("tau2", tr("napětí τ2 při L2 (statická kontrola)"), v.tau2, "MPa", { symbol: "τ2", dec: 0, level: lvl(false, v.tau2 > tauzul), text: `${fmt(v.tau2, 0)} MPa (${pct(v.tau2, tauzul)} %)` }));
  if (v.tauk2 !== undefined) rows.push(row("tauk2", tr("napětí τk2 = k · τ2 (opakované zatížení)"), v.tauk2, "MPa", { symbol: "τk2", dec: 0, level: lvl(false, v.tauk2 > tauzul), text: `${fmt(v.tauk2, 0)} MPa (${pct(v.tauk2, tauzul)} %)` }));
  rows.push(row("taun", tr("napětí τn na dorazu (statická kontrola)"), taun, "MPa", { symbol: "τn", dec: 0, level: lvl(false, taun > tauzul), text: `${fmt(taun, 0)} MPa (${pct(taun, tauzul)} %)` }));
  rows.push(row("taukn", tr("napětí τkn = k · τn na dorazu"), taukn, "MPa", { symbol: "τkn", dec: 0, text: `${fmt(taukn, 0)} MPa (${pct(taukn, tauzul)} %)` }));
  rows.push(row("tauzul", tr("dovolené napětí τzul = 0,5 · Rm"), tauzul, "MPa", { symbol: "τzul", dec: 0, text: `${fmt(tauzul, 0)} MPa (Rm ${fmt(Rm, 0)})` }));
  rows.push(row("sK", tr("kritický zdvih vzpěru sK"), Number.isFinite(sK) ? sK : undefined, "mm", { symbol: "sK", dec: 1, level: lvl(false, Number.isFinite(sK) && sMax > sK), text: Number.isFinite(sK) ? `${fmt(sK, 1)} mm` : tr("nevybočí") }));
  rows.push(row("fe", tr("vlastní frekvence fe"), fe, "Hz", { symbol: "fe", dec: 0 }));
  rows.push(row("dDe", tr("zvětšení De při stlačení na doraz"), dDe, "mm", { symbol: "ΔDe", dec: 2 }));
  rows.push(row("lw", tr("délka drátu"), lw, "mm", { dec: 0 }));
  rows.push(row("mass", tr("hmotnost"), mass * 1000, "g", { dec: 1 }));
  rows.push(row("material", tr("materiál"), undefined, "", { text: `${materialLabel(m)} · G ${fmt(G, 0)} MPa`, drawing: true }));
  rows.push(row("ends", tr("konce"), undefined, "", { text: endsLabel(i.ends), drawing: true }));
  const model: SpringModel = {
    kind: "compression",
    free: L0,
    solid: Ln,
    rate: R,
    massKg: mass,
    D,
    d,
    forceAt: (L: number) => R * (L0 - L),
  };
  const summary = tr("tlačná d {0} · De {1} · L0 {2} · n {3} · R {4} N/mm · Ln {5} mm{6}", fmt(d), fmt(D + d), fmt(L0), fmt(n), fmt(R, 3), fmt(Ln), v.F2 !== undefined ? tr(" · F2 {0} N", fmt(v.F2, 1)) : "");
  return { kind: "compression", ok: is.ok, issues: is.list, v, rows, title, summary, model };
}

/** Pomocník: hodnota, která ještě chybí (pro texty „chybí“) – nepoužívá se ve výpočtu. */
export const compressionNeed = (data: SpringData) => ["d", "L0"].filter((k) => numOf(data, k) === undefined);
