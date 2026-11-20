/**
 * Hypoidní soukolí (`gear.hypoid`, jeden člen páru; úhel os 90°) – roztečné kužely z přesných vektorových podmínek ve
 * středním bodě P (ISO 23509 metoda 1 bez iterace křivosti nástroje):
 *   osa kola = Z přes počátek, osa pastorku ∥ X přes (0, E, 0), u = z₂/z₁, s = ±1 smysl stoupání pastorku;
 *   v₂ = ẑ × P, v₁ = s·u·x̂ × (P − (0, E, 0)), normála roztečné roviny n = v₁ × v₂, površky g_i = n × v̂_i,
 *   skluz v_s = v₁ − v₂ (tečna stopy zubu), δ_i = ∠(g_i, osa_i), β_mi = ∠(v_s, g_i), r_mi = vzdálenost P od osy i.
 * Neznámý bod P z podmínek: r_m2 = d_e2/2 − (b/2)·sin δ₂, δ₂ = cíl (zadané, nebo atan(u / k), k = 1 + 0,2·min(1, E/(0,15·d_e2))),
 * β_m1 = zadané. Platí u·r_m1·cos β_m1 = r_m2·cos β_m2 (stejná normálná rozteč). Každý člen se pak staví jako kuželové kolo
 * se zakřivenými zuby na vlastním kuželi (conic.ts). Přesné: roztečné kužely, úhly sklonu a normálná rozteč ve středním bodě.
 * Přibližné: vše mimo střední bod – boky jsou jmenovité, NE sdružené (obálkové).
 */
import { tr } from "../i18n";
import { bodyPhrases, bodyRows, defaultsOf, fix, fmt, int, loc, nf, num, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { coneSection, coneIssues, virtualProfile } from "./bevel";
import { coneGeom, type ConeGeom, type ConeMember } from "./conic";
import { alphaRow, bodySummary, handLabel, handRow } from "./cylindrical";
import { DEG, newton } from "./num";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Vec2 } from "./types";
import type { Vec3 } from "../types";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, Math.abs(dot(a, b)) / (len(a) * len(b)))));

export type HypoidMean = {
  P: Vec3;
  delta1: number;
  delta2: number;
  beta1: number;
  beta2: number;
  rm1: number;
  rm2: number;
  Rm1: number;
  Rm2: number;
  /** vrcholy roztečných kuželů (v soustavě soukolí) */
  apex1: Vec3;
  apex2: Vec3;
  /** površky ve středním bodě (od vrcholu k P) */
  g1: Vec3;
  g2: Vec3;
  /** jednotkový směr skluzu v₁ − v₂ = tečna stopy zubu v P */
  t: Vec3;
  /** střední normálný modul */
  mmn: number;
};

/** veličiny ve středním bodě P (osa kola Z, osa pastorku ∥ X přes (0, E, 0)) */
export function hypoidAt(P: Vec3, u: number, E: number, s: number): Omit<HypoidMean, "mmn"> {
  const q: Vec3 = sub(P, [0, E, 0]);
  const v2 = cross([0, 0, 1], P);
  const v1 = cross([s * u, 0, 0], q);
  const n = unit(cross(v1, v2));
  let g1 = unit(cross(n, unit(v1)));
  let g2 = unit(cross(n, unit(v2)));
  if (dot(g1, [0, q[1], q[2]]) < 0) g1 = [-g1[0], -g1[1], -g1[2]];
  if (dot(g2, [P[0], P[1], 0]) < 0) g2 = [-g2[0], -g2[1], -g2[2]];
  const t = unit(sub(v1, v2));
  const delta1 = angle(g1, [1, 0, 0]);
  const delta2 = angle(g2, [0, 0, 1]);
  const rm1 = Math.hypot(q[1], q[2]);
  const rm2 = Math.hypot(P[0], P[1]);
  const Rm1 = rm1 / Math.sin(delta1);
  const Rm2 = rm2 / Math.sin(delta2);
  return { P, delta1, delta2, beta1: angle(t, g1), beta2: angle(t, g2), rm1, rm2, Rm1, Rm2, apex1: sub(P, [g1[0] * Rm1, g1[1] * Rm1, g1[2] * Rm1]), apex2: sub(P, [g2[0] * Rm2, g2[1] * Rm2, g2[2] * Rm2]), g1, g2, t };
}

/** výchozí úhel roztečného kužele kola (rad) */
export const hypoidDelta2 = (u: number, E: number, de2: number) => Math.atan(u / (1 + 0.2 * Math.min(1, E / (0.15 * de2))));

/** Řešení středního bodu; null = nekonverguje (příliš velké přesazení nebo úhel sklonu). */
export function hypoidSolve(o: { z1: number; z2: number; de2: number; b: number; E: number; betaM1: number; hand: 1 | -1; delta2?: number }): HypoidMean | null {
  const u = o.z2 / o.z1;
  const d2 = o.delta2 && o.delta2 > 0 ? o.delta2 : hypoidDelta2(u, o.E, o.de2);
  const rm2 = o.de2 / 2 - (o.b / 2) * Math.sin(d2);
  if (!(rm2 > 0)) return null;
  const f = (x: number[]) => {
    const h = hypoidAt([x[0], x[1], x[2]], u, o.E, o.hand);
    return [(h.rm2 - rm2) / rm2, h.delta2 - d2, h.beta1 - o.betaM1];
  };
  let best: HypoidMean | null = null;
  for (const sz of [-o.hand, o.hand])
    for (const a0 of [0.3, 0.15, 0.5, 0.05]) {
      const x = newton(f, [rm2 * Math.cos(a0), rm2 * Math.sin(a0), (sz * rm2) / Math.tan(d2)], { tol: 1e-12, iter: 80 });
      if (!x) continue;
      const h = hypoidAt([x[0], x[1], x[2]], u, o.E, o.hand);
      // větev: vrchol pastorku na straně osy kola (g₁·x̂ > 0), sklon kola menší než pastorku, bod P na kladné straně X
      if (!(h.g1[0] > 0) || !(h.beta2 < h.beta1) || !(x[0] > 0)) continue;
      const res = { ...h, mmn: (2 * h.rm2 * Math.cos(h.beta2)) / o.z2 };
      if (!best || Math.abs(h.apex2[2]) < Math.abs(best.apex2[2])) best = res;
    }
  return best;
}

export type HypoidIn = { member: "pinion" | "wheel"; z1: number; z2: number; de2: number; b: number; E: number; betaM1: number; hand: "right" | "left"; alpha: number; rc: number; delta2: number; x: number; jn: number; backL: number; body: BodyOpts; place: Place; raw: GearData };
export type HypoidC = {
  mean: HypoidMean | null;
  /** člen jako kuželové kolo na vlastním kuželi (null = řešení neexistuje) */
  cone: ConeMember | null;
  geom: ConeGeom | null;
  b2: number;
  /** šířka ozubení tohoto členu */
  b: number;
  /** posun vrcholu roztečného kužele od průsečíku os po ose členu (kladný = za průsečíkem ve směru od zadního čela) */
  apexZ: number;
  mount: number;
};

function compute(i: HypoidIn): HypoidC {
  const b2 = i.b > 0 ? i.b : Math.round(0.15 * i.de2 * 10) / 10;
  const hs: 1 | -1 = i.hand === "left" ? -1 : 1;
  const mean = hypoidSolve({ z1: i.z1, z2: i.z2, de2: i.de2, b: b2, E: i.E, betaM1: i.betaM1 * DEG, hand: hs, delta2: i.delta2 > 0 ? i.delta2 * DEG : undefined });
  if (!mean) return { mean: null, cone: null, geom: null, b2, b: b2, apexZ: 0, mount: 0 };
  const pin = i.member === "pinion";
  const an = i.alpha * DEG;
  const rc = i.rc > 0 ? i.rc : mean.Rm2;
  // osa členu od zadního čela k vrcholu a poloha vrcholu vůči průsečíku os
  const apex = pin ? mean.apex1 : mean.apex2;
  const cross0: Vec3 = pin ? [0, i.E, 0] : [0, 0, 0];
  const foot: Vec3 = pin ? [mean.P[0], i.E, 0] : [0, 0, mean.P[2]];
  const zl = unit(sub(apex, foot));
  const apexZ = dot(sub(apex, cross0), zl);
  const eps = Math.abs(mean.beta1 - mean.beta2);
  // smysl stopy zubu v místní soustavě členu (+1 = vnější polovina zubu pootočená proti směru hodin při pohledu od vrcholu):
  // stopa v P musí ležet ve směru skluzu t – z geometrie, ne z pojmenování (pravý pastorek vyjde −1 = pravý podle ISO 23509)
  const gm = pin ? mean.g1 : mean.g2;
  const tt = dot(mean.t, gm) < 0 ? ([-mean.t[0], -mean.t[1], -mean.t[2]] as Vec3) : mean.t;
  const circ = cross(zl, unit(sub(mean.P, foot)));
  const trace: 1 | -1 = dot(tt, circ) < 0 ? -1 : 1;
  const b = pin ? Math.round((b2 / Math.cos(eps)) * 1.03 * 10) / 10 : b2;
  const x = pin ? i.x : -i.x;
  const beta = pin ? mean.beta1 : mean.beta2;
  const z = pin ? i.z1 : i.z2;
  const rm = pin ? mean.rm1 : mean.rm2;
  const Rm = pin ? mean.Rm1 : mean.Rm2;
  const cone: ConeMember = {
    z,
    delta: pin ? mean.delta1 : mean.delta2,
    Re: Rm + b / 2,
    b,
    betaM: beta,
    hand: trace,
    rc,
    alphaN: an,
    taper: false,
    ha: mean.mmn * (1 + x),
    hf: mean.mmn * (1.25 - x),
    psi: (Math.PI / 2 + (2 * x * Math.tan(an)) / Math.cos(beta)) / z - i.jn / (Math.cos(an) * Math.cos(beta)) / (2 * rm),
    rim: i.backL > 0 ? i.backL : 1.5 * mean.mmn,
    apexZ,
  };
  const geom = coneGeom(cone);
  return { mean, cone, geom, b2, b, apexZ, mount: -geom.zBack };
}

const rows = (): GearRow[] => [
  row("member", tr("Člen"), "enum", "pinion", tr("který člen hypoidního páru se staví: pastorek, nebo talířové kolo (oba se zadávají stejnou tabulkou)"), "basic", W(["člen", "member"], "member", ["glied", "member"]), {
    required: true,
    options: [{ v: "pinion", l: tr("Pastorek") }, { v: "wheel", l: tr("Talířové kolo") }],
    enumWords: { pinion: W("pastorek", "pinion", "ritzel"), wheel: W(["talíř", "talířové"], ["crown", "ringgear"], ["tellerrad"]) },
  }),
  row("z1", tr("Zuby pastorku z₁"), "int", 11, tr("počet zubů pastorku"), "basic", W("z1", "z1", "z1"), { min: 5, max: 60, required: true, symbol: "z₁" }),
  row("z2", tr("Zuby kola z₂"), "int", 41, tr("počet zubů talířového kola"), "basic", W("z2", "z2", "z2"), { min: 15, max: 300, required: true, symbol: "z₂" }),
  row("de2", tr("Vnější roztečný Ø kola"), "number", 200, tr("vnější roztečný průměr talířového kola d_e2 (ISO 23509)"), "basic", W(["de2", "průměr"], ["de2", "diameter"], ["de2", "durchmesser"]), { unit: "mm", min: 10, required: true, symbol: "d_e2" }),
  row("b", tr("Šířka ozubení kola b"), "number", 0, tr("šířka ozubení talířového kola; 0 = automaticky 0,15·d_e2 (pastorek vyjde o něco širší)"), "basic", W(["b", "šířka"], ["b", "width"], ["b", "breite"]), { unit: "mm", min: 0, required: true, symbol: "b₂" }),
  row("E", tr("Přesazení os E"), "number", 25, tr("vzdálenost mimoběžných os pastorku a kola; pod 0,02·d_e2 použijte kuželové kolo se zakřivenými zuby"), "basic", W(["e", "přesazení"], ["e", "offset"], ["e", "achsversatz"]), { unit: "mm", min: 0, required: true, symbol: "E" }),
  row("betaM1", tr("Střední úhel sklonu pastorku"), "number", 45, tr("úhel sklonu zubů pastorku ve středu šířky; úhel kola vyjde menší"), "teeth", W(["beta", "sklon"], ["beta", "spiral"], ["beta", "spiralwinkel"]), { unit: "°", min: 20, max: 55, symbol: "β_m1" }),
  handRow(tr("smysl stoupání pastorku; talířové kolo má opačný")),
  alphaRow(tr("normálný úhel záběru (běžně 20°)")),
  row("rc", tr("Poloměr nástroje r_c0"), "number", 0, tr("poloměr frézovací hlavy (oblouk stopy zubu); 0 = automaticky střední délka površky kola"), "advanced", W(["nástroj", "rc"], ["cutter", "rc"], ["messerkopf", "rc"]), { unit: "mm", min: 0 }),
  row("delta2", tr("Úhel roztečného kužele kola"), "number", 0, tr("0 = automaticky atan(u / k), k = 1 až 1,2 podle přesazení (počáteční odhad ISO 23509)"), "advanced", W(["delta2"], ["delta2"], ["delta2"]), { unit: "°", min: 0, max: 89, symbol: "δ₂" }),
  row("x", tr("Posunutí profilu x"), "number", 0, tr("výškové posunutí pastorku (kolo má stejné záporné)"), "teeth", W(["x", "posunutí"], ["x", "shift"], ["x", "profilverschiebung"]), { min: -0.6, max: 0.6, step: 0.05, symbol: "x" }),
  row("backL", tr("Tloušťka těla pod patou"), "number", 0, tr("tloušťka těla pod patou zubu na velkém konci – určuje polohu zadního čela; 0 = automaticky 1,5·m"), "body", W(["tělo", "backl"], ["back", "backl"], ["körper", "backl"]), { unit: "mm", min: 0 }),
  ...bodyRows({ holes: false, chamfer: false, web: false }).filter((r) => r.key !== "hubSide"),
  ...placeRows(),
];

const rws = rows();
export const HYPOID: KindDef<HypoidIn, HypoidC> = {
  kind: "hypoid",
  ext: "gear.hypoid",
  label: tr("Hypoidní kolo"),
  short: tr("hypoidní"),
  standards: ["ISO 23509", "DIN 6885-1"],
  rows: rws,
  phrases: bodyPhrases({ holes: false }),
  words: W(["hypoidní", "hypoid"], ["hypoid"], ["hypoid", "hypoidrad"]),
  accuracy: tr("Tvar zubů je přibližný – pro zástavbu, hmotnost a výkres, ne pro výrobu ozubení. Přesně: roztečné kužely, úhly sklonu a normálná rozteč ve středním bodě. Přibližně: boky (jmenovité, nejsou sdružené – mimo střední bod čekejte několik setin mm mezery nebo přesahu), stálá výška zubu."),
  defaults: () => defaultsOf(rws),
  read: (d): HypoidIn => ({
    member: oneOf(d.member, ["pinion", "wheel"] as const, "pinion"),
    z1: int(d.z1, 11),
    z2: int(d.z2, 41),
    de2: num(d.de2, 200),
    b: Math.max(0, num(d.b)),
    E: Math.max(0, num(d.E, 25)),
    betaM1: num(d.betaM1, 45),
    hand: oneOf(d.hand, ["right", "left"] as const, "right"),
    alpha: num(d.alpha, 20),
    rc: Math.max(0, num(d.rc)),
    delta2: Math.max(0, num(d.delta2)),
    x: num(d.x),
    jn: Math.max(0, num(d.jn)),
    backL: Math.max(0, num(d.backL)),
    body: readBody({ ...d, hubSide: "bottom", holesN: 0, webT: 0, chamfer: 0 }, 1),
    place: readPlace(d),
    raw: d,
  }),
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const err = (key: string, code: string, text: string) => out.push({ level: "error", code, key, text });
    if (i.E < 0.02 * i.de2) {
      err("E", "e-min", tr("Přesazení {0} mm je menší než 0,02·d_e2 ({1} mm) – použijte kuželové kolo se zakřivenými zuby.", nf(i.E), nf(0.02 * i.de2, 2)));
      return validation(out);
    }
    if (i.z2 <= i.z1) err("z2", "ratio", tr("Talířové kolo musí mít víc zubů než pastorek."));
    const c = compute(i);
    if (!c.mean || !c.cone || !c.geom) {
      err("E", "no-solution", tr("Pro toto přesazení a úhel sklonu se roztečné kužely nepodařilo najít – zmenšete přesazení E nebo úhel sklonu pastorku, případně zadejte úhel kužele kola."));
      return validation(out);
    }
    if (i.E > 0.25 * i.de2) out.push({ level: "warn", code: "e-max", key: "E", text: tr("Přesazení nad 0,25·d_e2 ({0} mm) je neobvyklé – skluz v záběru bude velký.", nf(0.25 * i.de2, 2)) });
    out.push(...coneIssues(c.cone, c.geom, i.body, c.mean.mmn, { b: "b", x: "x", beta: "betaM1" }));
    if (i.jn > 0.3 * c.mean.mmn) err("jn", "jn-max", tr("Boční vůle {0} mm je větší než 0,3·m – zub by byl příliš tenký.", nf(i.jn)));
    return validation(out);
  },
  compute,
  profile: (i, c) => {
    const z = i.member === "pinion" ? i.z1 : i.z2;
    const m = c.mean ? c.mean.mmn : (i.de2 / i.z2) * 0.7;
    const delta = c.cone ? c.cone.delta : Math.PI / 4;
    const beta = c.cone ? c.cone.betaM : 0;
    return virtualProfile(m, z / (Math.cos(delta) * Math.cos(beta) ** 3), i.alpha, i.member === "pinion" ? i.x : -i.x);
  },
  blank: (i, c): Vec2[] => (c.cone && c.geom ? coneSection(c.cone, c.geom, i.body) : [[0, 0], [i.de2 / 2, 0], [i.de2 / 2, 10], [0, 10]]),
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    const pin = i.member === "pinion";
    const out = [R("member", tr("Člen"), "", pin ? tr("pastorek") : tr("talířové kolo"), "", "basic"), R("z1", tr("Zuby pastorku"), "z₁", String(i.z1), "", "basic"), R("z2", tr("Zuby kola"), "z₂", String(i.z2), "", "basic"), R("ratio", tr("Převod"), "u", fix(i.z2 / i.z1, 4), "", "pair"), R("E", tr("Přesazení os"), "E", fix(i.E), "mm", "pair"), R("alpha", tr("Úhel záběru"), "αₙ", fix(i.alpha, 2), "°", "basic")];
    if (!c.mean || !c.cone || !c.geom) return out;
    const hs = i.hand;
    const other = hs === "left" ? "right" : "left";
    out.push(
      R("mmn", tr("Střední normálný modul"), "m_mn", fix(c.mean.mmn, 4), "mm", "basic"),
      R("delta1", tr("Úhel roztečného kužele pastorku"), "δ₁", fix(c.mean.delta1 / DEG, 4), "°", "geometry"),
      R("delta2", tr("Úhel roztečného kužele kola"), "δ₂", fix(c.mean.delta2 / DEG, 4), "°", "geometry"),
      R("beta1", tr("Střední úhel sklonu pastorku"), "β_m1", fix(c.mean.beta1 / DEG, 3), "°", "geometry"),
      R("hand1", tr("Smysl stoupání pastorku"), "", handLabel(hs), "", "geometry"),
      R("beta2", tr("Střední úhel sklonu kola"), "β_m2", fix(c.mean.beta2 / DEG, 3), "°", "geometry"),
      R("hand2", tr("Smysl stoupání kola"), "", handLabel(other), "", "geometry"),
      R("de", tr("Vnější roztečný průměr"), "d_e", fix(c.geom.de), "mm", "geometry"),
      R("dae", tr("Vnější hlavový průměr"), "d_ae", fix(c.geom.dae), "mm", "geometry"),
      R("b", tr("Šířka ozubení"), "b", fix(c.b, 2), "mm", "geometry"),
      R("apex", tr("Vrchol kužele za průsečíkem os"), "t_z", fix(c.apexZ), "mm", "geometry"),
      R("mount", tr("Montážní vzdálenost (průsečík os – zadní čelo)"), "A", fix(c.mount), "mm", "geometry"),
    );
    return out;
  },
  summary: (i, c) =>
    [
      `${tr("hypoidní")} ${i.member === "pinion" ? tr("pastorek") : tr("talířové kolo")} z${i.z1}/${i.z2} d_e2 ${nf(i.de2)} E ${nf(i.E)} β₁ ${nf(i.betaM1)}° ${handLabel(i.hand)}`,
      c.mean && c.geom ? `m_mn ${fix(c.mean.mmn, 3)} · δ ${fix((i.member === "pinion" ? c.mean.delta1 : c.mean.delta2) / DEG, 2)}° · d_ae ${nf(c.geom.dae, 3)}` : tr("řešení neexistuje"),
      bodySummary(i.body, i.place),
    ].join(" · "),
  name: (i) => (i.member === "pinion" ? tr("Hypoidní pastorek z{0}/{1}", i.z1, i.z2) : tr("Hypoidní talířové kolo z{0}/{1}", i.z2, i.z1)),
};
export { loc };
