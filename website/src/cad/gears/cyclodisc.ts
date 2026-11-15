/**
 * Kotouč cykloidního reduktoru a věnec s čepy (`gear.cyclodisc`). Profil kotouče je ekvidistanta epitrochoidy středů čepů:
 *   ψ(t) = atan2(sin((1 − N)t), R/(e·N) − cos((1 − N)t))
 *   x = R·cos t − r_p·cos(t + ψ) − e·cos(N·t),  y = −R·sin t + r_p·sin(t + ψ) + e·sin(N·t)
 * (R = poloměr roztečné kružnice čepů, r_p = poloměr čepu, e = výstřednost, N = počet čepů). Počet laloků n = N − 1,
 * převod i = n (věnec stojí). Hlavový průměr D_p + 2e − d_p, patní D_p − 2e − d_p.
 */
import { tr } from "../i18n";
import { defaultsOf, fix, fmt, int, num, oneOf, placeRows, rangeIssues, readPlace, row, validation, W, type Place } from "./common";
import { widthRow } from "./cylindrical";
import { ang, circleX, curveSeg, mirrorX, polar, TAU, tiledArea } from "./num";
import type { GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Seg2, Vec2 } from "./types";

export type CycloDiscIn = { N: number; pinCircle: number; pinD: number; e: number; b: number; part: "disc" | "ring"; centerD: number; outN: number; outD: number; outPcd: number; ringD: number; pins: "solid" | "holes"; place: Place; raw: GearData };
export type CycloDiscC = {
  n: number;
  R: number;
  rp: number;
  da: number;
  df: number;
  ratio: number;
  /** nejmenší poloměr křivosti vypuklé části křivky středů čepů (musí být větší než r_p) */
  rhoMin: number;
  /** věnec: vnější průměr a vnitřní průměr */
  ringD: number;
  ringIn: number;
  /** roztečná kružnice výstupních děr (0 = nejsou) */
  outPcd: number;
};

/** bod profilu kotouče pro parametr t (po směru hodin; údolí na +X pro t = 0) */
export function discPoint(i: Pick<CycloDiscIn, "N" | "pinCircle" | "pinD" | "e">, t: number): Vec2 {
  const R = i.pinCircle / 2;
  const rp = i.pinD / 2;
  const psi = Math.atan2(Math.sin((1 - i.N) * t), R / (i.e * i.N) - Math.cos((1 - i.N) * t));
  return [R * Math.cos(t) - rp * Math.cos(t + psi) - i.e * Math.cos(i.N * t), -R * Math.sin(t) + rp * Math.sin(t + psi) + i.e * Math.sin(i.N * t)];
}

function compute(i: CycloDiscIn): CycloDiscC {
  const R = i.pinCircle / 2;
  const rp = i.pinD / 2;
  const n = i.N - 1;
  // křivost křivky středů čepů C(t) = (R cos t − e cos Nt, −R sin t + e sin Nt); vypuklá část má κ > 0
  let rhoMin = Infinity;
  for (let k = 0; k <= 720; k++) {
    const t = (TAU / n) * (k / 720);
    const x1 = -R * Math.sin(t) + i.e * i.N * Math.sin(i.N * t);
    const y1 = -R * Math.cos(t) + i.e * i.N * Math.cos(i.N * t);
    const x2 = -R * Math.cos(t) + i.e * i.N * i.N * Math.cos(i.N * t);
    const y2 = R * Math.sin(t) - i.e * i.N * i.N * Math.sin(i.N * t);
    const kappa = -(x1 * y2 - y1 * x2) / Math.hypot(x1, y1) ** 3;
    if (kappa > 1e-12) rhoMin = Math.min(rhoMin, 1 / kappa);
  }
  const ringIn = 2 * (R + 2 * i.e - rp) + 0.02 * i.pinCircle; // kotouč se vejde i s výstředností, vůle 1 % D_p
  return { n, R, rp, da: i.pinCircle + 2 * i.e - i.pinD, df: i.pinCircle - 2 * i.e - i.pinD, ratio: n, rhoMin, ringD: i.ringD > 0 ? i.ringD : i.pinCircle + 3 * i.pinD, ringIn, outPcd: i.outPcd > 0 ? i.outPcd : i.outN > 0 ? (i.centerD + (i.pinCircle - 2 * i.e - i.pinD)) / 2 : 0 };
}

/** vnitřní obrys věnce: oblouky vnitřní kružnice a čepů (plné čepy vystupují dovnitř, díry pro čepy ven) – proti směru hodin */
export function ringInner(i: CycloDiscIn, c: CycloDiscC): Seg2[] | null {
  const rin = c.ringIn / 2;
  const P = polar(c.R, 0);
  const xs = circleX(P, c.rp, [0, 0], rin);
  if (xs.length < 2) return null;
  const [lo, hi] = xs[0][1] < xs[1][1] ? [xs[0], xs[1]] : [xs[1], xs[0]];
  const aHi = ang(hi);
  const step = TAU / i.N;
  // čep 0 na +X: oblouk čepu od dolního průsečíku k hornímu (plný čep přes stranu ke středu = po směru hodin kolem čepu)
  const pin: Seg2 = { t: "arc", c: P, r: c.rp, a0: ang(lo, P), a1: ang(hi, P), ccw: i.pins !== "solid" };
  const arc: Seg2 = { t: "arc", c: [0, 0], r: rin, a0: aHi, a1: step - aHi, ccw: true };
  return [pin, arc];
}

function profile(i: CycloDiscIn, c: CycloDiscC): Profile2D {
  if (i.part === "ring") {
    const one = ringInner(i, c) ?? [{ t: "arc", c: [0, 0], r: c.ringIn / 2, a0: 0, a1: TAU / i.N, ccw: true } as Seg2];
    return { tooth: one, count: i.N, circles: { ref: i.pinCircle, tip: c.ringIn, root: c.ringD }, area: (Math.PI * c.ringD * c.ringD) / 4 - tiledArea(one, i.N) };
  }
  const lobe = TAU / c.n;
  const f = (s: number) => mirrorX(discPoint(i, s)); // proti směru hodin
  const tooth: Seg2[] = [curveSeg("epitrochoid-offset", f, 0, lobe / 2, 12), curveSeg("epitrochoid-offset", f, lobe / 2, lobe, 12)];
  return { tooth, count: c.n, circles: { ref: 2 * i.e * c.n, tip: c.da, root: c.df }, area: tiledArea(tooth, c.n) };
}

const rows = (): GearRow[] => [
  row("N", tr("Počet čepů N"), "int", 10, tr("počet čepů věnce; kotouč má o jeden lalok méně a převod je N − 1"), "basic", W(["n", "čepy"], ["n", "pins"], ["n", "bolzen"]), { min: 4, max: 120, required: true, symbol: "N" }),
  row("pinCircle", tr("Roztečný Ø čepů D_p"), "number", 60, tr("průměr kružnice, na které leží osy čepů věnce"), "basic", W(["dp", "rozteč"], ["dp", "pincircle"], ["dp", "teilkreis"]), { unit: "mm", min: 5, required: true, symbol: "D_p" }),
  row("pinD", tr("Ø čepu d_p"), "number", 6, tr("průměr čepu (válečku) věnce"), "basic", W(["čep", "pind"], ["pin", "pind"], ["bolzen-d", "pind"]), { unit: "mm", min: 0.5, required: true, symbol: "d_p" }),
  row("e", tr("Výstřednost e"), "number", 1.5, tr("výstřednost hřídele; musí být menší než D_p / (2·N), jinak by měl profil smyčky"), "basic", W(["e", "výstřednost"], ["e", "eccentricity"], ["e", "exzentrizität"]), { unit: "mm", min: 0.05, required: true, symbol: "e" }),
  widthRow(10, tr("tloušťka kotouče / věnce")),
  row("part", tr("Díl"), "enum", "disc", tr("kotouč s laloky, nebo věnec s čepy (počátek ve středu roztečné kružnice čepů)"), "basic", W(["díl", "part"], "part", ["teil", "part"]), {
    options: [{ v: "disc", l: tr("Kotouč") }, { v: "ring", l: tr("Věnec s čepy") }],
    enumWords: { disc: W("kotouč", "disc", "scheibe"), ring: W("věnec", "ring", "ring") },
  }),
  row("centerD", tr("Ø díry pro ložisko"), "number", 0, tr("středová díra kotouče pro výstředníkové ložisko; 0 = bez díry"), "body", W(["ložisko", "centerd"], ["bearing", "centerd"], ["lager", "centerd"]), { unit: "mm", min: 0, when: (d) => d.part !== "ring" }),
  row("outN", tr("Výstupní díry – počet"), "int", 0, tr("díry pro čepy výstupního unašeče; 0 = žádné"), "body", W(["výstup-počet", "outn"], ["output-count", "outn"], ["abtrieb-anzahl", "outn"]), { min: 0, max: 24, when: (d) => d.part !== "ring" }),
  row("outD", tr("Výstupní díry Ø"), "number", 0, tr("průměr díry = průměr válečku unašeče + 2·e"), "body", W(["výstup-průměr", "outd"], ["output-diameter", "outd"], ["abtrieb-durchmesser", "outd"]), { unit: "mm", min: 0, when: (d) => d.part !== "ring" }),
  row("outPcd", tr("Výstupní díry – roztečná Ø"), "number", 0, tr("0 = uprostřed mezi středovou dírou a patou laloků"), "body", W(["výstup-rozteč", "outpcd"], ["output-pcd", "outpcd"], ["abtrieb-teilkreis", "outpcd"]), { unit: "mm", min: 0, when: (d) => d.part !== "ring" }),
  row("ringD", tr("Vnější Ø věnce"), "number", 0, tr("0 = automaticky D_p + 3·d_p"), "body", W(["věnec-průměr", "ringd"], ["ring-diameter", "ringd"], ["ring-durchmesser", "ringd"]), { unit: "mm", min: 0, when: (d) => d.part === "ring" }),
  row("pins", tr("Čepy věnce"), "enum", "solid", tr("plné čepy (jeden kus s věncem), nebo jen díry, do kterých se čepy vloží"), "body", W(["čepy-tvar", "pinform"], ["pin-style", "pinform"], ["bolzen-form", "pinform"]), {
    options: [{ v: "solid", l: tr("Plné čepy") }, { v: "holes", l: tr("Díry pro čepy") }],
    enumWords: { solid: W("plné", "solid", "voll"), holes: W("díry", "holes", "bohrungen") },
    when: (d) => d.part === "ring",
  }),
  ...placeRows().filter((r) => r.key !== "jn"),
];

const rws = rows();
export const CYCLODISC: KindDef<CycloDiscIn, CycloDiscC> = {
  kind: "cyclodisc",
  ext: "gear.cyclodisc",
  label: tr("Kotouč cykloidního reduktoru"),
  short: tr("cyklokotouč"),
  standards: [],
  rows: rws,
  phrases: [],
  words: W(["cyklodisk", "kotouč", "cyklokotouč"], ["cyclodisc", "cycloidaldisc"], ["kurvenscheibe", "zykloidscheibe"]),
  accuracy: tr("Přesně: křivka kotouče (ekvidistanta epitrochoidy, proložená 12 body na půl laloku) a kružnice věnce. Vůle mezi kotoučem a čepy se nemodeluje – přidejte ji zmenšením Ø čepu v tabulce kotouče."),
  defaults: () => defaultsOf(rws),
  read: (d): CycloDiscIn => ({
    N: int(d.N, 10),
    pinCircle: num(d.pinCircle, 60),
    pinD: num(d.pinD, 6),
    e: num(d.e, 1.5),
    b: num(d.b, 10),
    part: oneOf(d.part, ["disc", "ring"] as const, "disc"),
    centerD: Math.max(0, num(d.centerD)),
    outN: Math.max(0, int(d.outN)),
    outD: Math.max(0, num(d.outD)),
    outPcd: Math.max(0, num(d.outPcd)),
    ringD: Math.max(0, num(d.ringD)),
    pins: oneOf(d.pins, ["solid", "holes"] as const, "solid"),
    place: readPlace(d),
    raw: d,
  }),
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const err = (key: string, code: string, text: string) => out.push({ level: "error", code, key, text });
    if (!(i.e < i.pinCircle / (2 * i.N))) {
      err("e", "e-max", tr("Výstřednost je příliš velká – profil by měl smyčky. Pro D_p = {0} a N = {1} musí být e menší než {2} mm.", fmt(i.pinCircle), i.N, fmt(i.pinCircle / (2 * i.N), 3)));
      return validation(out);
    }
    const c = compute(i);
    if (!(i.pinD < (Math.PI * i.pinCircle) / i.N)) err("pinD", "pins-overlap", tr("Čepy Ø{0} se na roztečné kružnici překrývají – zmenšete průměr čepu nebo počet čepů.", fmt(i.pinD)));
    else if (!(c.rp < c.rhoMin)) err("pinD", "pin-curv", tr("Čep Ø{0} je příliš velký – profil kotouče by se podřezal (největší možný Ø{1}). Zmenšete čep nebo výstřednost.", fmt(i.pinD), fmt(2 * c.rhoMin, 2)));
    if (!(c.df > 0)) err("pinCircle", "root", tr("Patní průměr kotouče vychází záporný."));
    if (!(i.b > 0)) err("b", "b", tr("Šířka kola musí být kladná."));
    if (i.part === "disc") {
      if (i.centerD >= c.df - 1) err("centerD", "center", tr("Středová díra Ø{0} se do kotouče (patní Ø{1}) nevejde.", fmt(i.centerD), fmt(c.df, 2)));
      if (i.outN > 0) {
        if (!(i.outD > 0)) err("outD", "out-d", tr("Zadejte průměr výstupních děr."));
        else if (c.outPcd / 2 - i.outD / 2 < i.centerD / 2 + 0.5 || c.outPcd / 2 + i.outD / 2 > c.df / 2 - 0.5) err(i.outPcd > 0 ? "outPcd" : "outD", "out-fit", tr("Výstupní díry Ø{0} na roztečné Ø{1} se nevejdou mezi středovou díru a patu laloků.", fmt(i.outD), fmt(c.outPcd, 1)));
        else if (i.outN * i.outD > 0.92 * Math.PI * c.outPcd) err("outN", "out-overlap", tr("Výstupní díry se překrývají – uberte počet nebo průměr."));
      }
    } else {
      if (!(c.ringD > c.ringIn + 2 * c.rp + 1)) err("ringD", "ring", tr("Vnější průměr věnce Ø{0} je malý – čepy na roztečné Ø{1} se do něj nevejdou.", fmt(c.ringD), fmt(i.pinCircle)));
      if (!ringInner(i, c)) err("pinD", "ring-pins", tr("Čepy se nedotýkají vnitřního průměru věnce Ø{0} – zvětšete čep nebo zmenšete výstřednost.", fmt(c.ringIn, 2)));
    }
    return validation(out);
  },
  compute,
  profile,
  blank: (i, c) => (i.part === "ring" ? [[c.ringIn / 2, 0], [c.ringD / 2, 0], [c.ringD / 2, i.b], [c.ringIn / 2, i.b]] : [[0, 0], [c.da / 2, 0], [c.da / 2, i.b], [0, i.b]]),
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    return [
      R("N", tr("Počet čepů"), "N", String(i.N), "", "basic"),
      R("n", tr("Počet laloků kotouče"), "n", String(c.n), "", "basic"),
      R("ratio", tr("Převod (věnec stojí)"), "i", String(c.ratio), "", "pair"),
      R("pinCircle", tr("Roztečný průměr čepů"), "D_p", fix(i.pinCircle), "mm", "basic"),
      R("pinD", tr("Průměr čepu"), "d_p", fix(i.pinD), "mm", "basic"),
      R("e", tr("Výstřednost"), "e", fix(i.e), "mm", "basic"),
      R("da", tr("Hlavový průměr kotouče"), "dₐ", fix(c.da), "mm", "geometry"),
      R("df", tr("Patní průměr kotouče"), "d_f", fix(c.df), "mm", "geometry"),
      ...(i.part === "ring" ? [R("ringD", tr("Vnější průměr věnce"), "D", fix(c.ringD), "mm", "geometry"), R("ringIn", tr("Vnitřní průměr věnce"), "D_i", fix(c.ringIn), "mm", "geometry")] : []),
    ];
  },
  summary: (i, c) => [`${i.part === "ring" ? tr("věnec cykloreduktoru") : tr("cyklokotouč")} N${i.N} D_p ${fmt(i.pinCircle)} d_p ${fmt(i.pinD)} e ${fmt(i.e)} b${fmt(i.b)}`, tr("převod {0}", c.ratio), i.part === "ring" ? `D ${fmt(c.ringD, 2)}` : `dₐ ${fmt(c.da, 3)}`].join(" · "),
  name: (i) => (i.part === "ring" ? tr("Věnec cykloreduktoru N{0}", i.N) : tr("Kotouč cykloreduktoru N{0}", i.N)),
};
