/**
 * Řetězové kolo pro válečkové řetězy ISO 606 (`gear.sprocket`): roztečný průměr d = p / sin(180°/z), patní d_f = d − d1,
 * tvar zubové mezery ze dvou oblouků (lůžko válečku r_i s úhlem α, bok zubu r_e), 1–3 řady, typ náboje A / B / C.
 * Všechny oblouky profilu jsou přesné kružnice; boční odlehčení zubu je oblouk r_x = p (viz jádro).
 */
import { tr } from "../i18n";
import { bodyIssues, bodyPhrases, bodyRows, defaultsOf, discSection, fix, fmt, int, loc, mateRows, nf, num, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { bodySummary, teethRow } from "./cylindrical";
import { sprocketOverPins } from "./measure";
import { ang, circleX, DEG, polar, segMirrorRev, tiledArea } from "./num";
import { CHAIN_NAMES, CHAINS, type Chain } from "./tables";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Seg2, Vec2 } from "./types";

export type SprocketIn = { chain: string; ch: Chain; z: number; rows: number; form: "mid" | "min" | "max"; body: BodyOpts; place: Place; mateZ: number; aw: number; raw: GearData };
export type SprocketC = {
  p: number;
  d1: number;
  d: number;
  df: number;
  daMin: number;
  daMax: number;
  /** skutečný hlavový průměr (střed mezí, nebo menší u špičatých zubů) */
  da: number;
  pointed: boolean;
  ri: number;
  re: number;
  /** úhel lůžka (rad) */
  alpha: number;
  /** šířka zubu jedné řady, celková šířka přes řady, příčná rozteč */
  bf1: number;
  b: number;
  pt: number;
  /** boční odlehčení zubu a jeho poloměr */
  ba: number;
  rx: number;
  /** největší průměr náboje / osazení vedle zubů */
  dg: number;
  /** rozměr přes válečky */
  MR: number;
  /** úhel konce boku na hlavové kružnici (od osy zubu, rad) */
  tipHalf: number;
};

const FORMS = ["mid", "min", "max"] as const;

function compute(i: SprocketIn): SprocketC {
  const { p, d1, b1, pt, h2 } = i.ch;
  const z = i.z;
  const d = p / Math.sin(Math.PI / z);
  const df = d - d1;
  const daMax = d + 1.25 * p - d1;
  const daMin = d + p * (1 - 1.6 / z) - d1;
  const riMin = 0.505 * d1;
  const riMax = 0.505 * d1 + 0.069 * Math.cbrt(d1);
  const aMax = (140 - 90 / z) * DEG;
  const aMin = (120 - 90 / z) * DEG;
  const reMax = 0.12 * d1 * (z + 2);
  const reMin = 0.008 * d1 * (z * z + 180);
  // nejmenší tvar mezery: r_i min, α max, r_e max; největší: r_i max, α min, r_e min
  const pick = (lo: number, hi: number) => (i.form === "min" ? lo : i.form === "max" ? hi : (lo + hi) / 2);
  const ri = pick(riMin, riMax);
  const alpha = pick(aMax, aMin);
  const re = pick(reMax, reMin);
  const multi = i.rows > 1;
  const bf1 = (p <= 12.7 ? (multi ? 0.91 : 0.93) : multi ? 0.93 : 0.95) * b1;
  const c: SprocketC = { p, d1, d, df, daMin, daMax, da: (daMin + daMax) / 2, pointed: false, ri, re, alpha, bf1, b: (i.rows - 1) * pt + bf1, pt, ba: 0.13 * p, rx: p, dg: p / Math.tan(Math.PI / z) - 1.04 * h2 - 0.76, MR: sprocketOverPins(d, z, d1), tipHalf: 0 };
  const f = flank(i, c);
  c.da = 2 * f.rTip;
  c.pointed = f.pointed;
  c.tipHalf = f.tipHalf;
  return c;
}

/** dolní bok zubu 0 (zub na +X): střed lůžka S, střed boku C_e, úhly a konec boku na hlavové kružnici (nebo na ose zubu) */
function flank(i: SprocketIn, c: SprocketC) {
  const as = -Math.PI / i.z;
  const rf = c.df / 2;
  const S = polar(rf + c.ri, as); // patní průměr přesně d − d1: střed lůžka leží o r_i − d1/2 nad roztečnou kružnicí
  const aT = as + Math.PI - c.alpha / 2;
  const u: Vec2 = [Math.cos(aT), Math.sin(aT)];
  const Ce: Vec2 = [S[0] + (c.ri - c.re) * u[0], S[1] + (c.ri - c.re) * u[1]];
  let ra = c.da / 2;
  let end: Vec2;
  let pointed = false;
  // boky sousedních… boky zubu se mohou sejít na ose zubu (y = 0) dřív, než dosáhnou hlavové kružnice → špičatý zub
  const xy = Math.abs(Ce[1]) <= c.re ? Ce[0] - Math.sqrt(c.re * c.re - Ce[1] * Ce[1]) : Infinity;
  if (xy > 0 && xy < ra) {
    end = [xy, 0];
    ra = xy;
    pointed = true;
  } else {
    // průsečík boku s hlavovou kružnicí (ten u zubu 0, pod osou X)
    const xs = circleX(Ce, c.re, [0, 0], ra).filter((q) => q[1] <= 1e-12 && q[0] > 0 && ang(q) > as);
    end = xs.length ? xs.sort((p1, p2) => p2[1] - p1[1])[0] : polar(ra, 0);
  }
  return { S, Ce, aT, as, end, rTip: ra, pointed, tipHalf: -ang(end) };
}

function profile(i: SprocketIn, c: SprocketC): Profile2D {
  const f = flank(i, c);
  const seat: Seg2 = { t: "arc", c: f.S, r: c.ri, a0: f.as + Math.PI, a1: f.aT, ccw: false };
  const side: Seg2 = { t: "arc", c: f.Ce, r: c.re, a0: f.aT, a1: ang(f.end, f.Ce), ccw: false };
  const tooth: Seg2[] = [seat, side];
  if (!f.pointed && f.tipHalf > 1e-9) tooth.push({ t: "arc", c: [0, 0], r: f.rTip, a0: -f.tipHalf, a1: f.tipHalf, ccw: true });
  tooth.push(segMirrorRev(side), segMirrorRev(seat));
  return { tooth, count: i.z, circles: { ref: c.d, tip: 2 * f.rTip, root: c.df }, area: tiledArea(tooth, i.z) };
}

const rows = (): GearRow[] => [
  row("chain", tr("Řetěz"), "enum", "08B", tr("válečkový řetěz podle ISO 606: řada B (evropská) nebo ANSI 35–80; určuje rozteč, průměr válečku a šířku zubu"), "basic", W(["řetěz", "chain"], "chain", ["kette", "chain"]), { required: true, options: CHAIN_NAMES.map((k) => ({ v: k, l: `${k} (p ${loc(String(CHAINS[k].p))})` })) }),
  teethRow(19, 6, tr("počet zubů; pod 9 zubů běží řetěz neklidně, pro rychlý chod aspoň 17"), 150),
  row("rows", tr("Počet řad"), "int", 1, tr("simplex 1, duplex 2, triplex 3 – řady jsou od sebe o příčnou rozteč řetězu p_t"), "basic", W(["řady", "rows"], ["strands", "rows"], ["reihen", "rows"]), { min: 1, max: 3 }),
  row("form", tr("Tvar zubové mezery"), "enum", "mid", tr("ISO 606 dává nejmenší a největší tvar mezery (r_i, r_e, úhel lůžka); střední je uprostřed"), "teeth", W(["tvar", "form"], "form", "form"), {
    options: [{ v: "mid", l: tr("Střední") }, { v: "min", l: tr("Nejmenší mezera") }, { v: "max", l: tr("Největší mezera") }],
    enumWords: { mid: W("střední", "mid", "mittel"), min: W("nejmenší", "min", "min"), max: W("největší", "max", "max") },
  }),
  ...bodyRows({ sprocket: true, chamfer: false, web: false }),
  ...mateRows(),
  ...placeRows().filter((r) => r.key !== "jn"),
];

const rws = rows();
export const SPROCKET: KindDef<SprocketIn, SprocketC> = {
  kind: "sprocket",
  ext: "gear.sprocket",
  label: tr("Řetězové kolo"),
  short: tr("řetězové"),
  standards: ["ISO 606", "DIN 8187", "DIN 8196", "DIN 6885-1"],
  rows: rws,
  phrases: bodyPhrases(),
  words: W(["řetězové", "řetězka"], ["sprocket", "chainwheel"], ["kettenrad"]),
  positional: ["chain"],
  accuracy: tr("Přesně: roztečný, patní a hlavový průměr a oblouky zubové mezery podle ISO 606. Zjednodušeně: boční odlehčení zubu (oblouk r_x = p začínající 0,44·p pod hlavou)."),
  defaults: () => defaultsOf(rws),
  read: (d): SprocketIn => {
    const name = String(d.chain ?? "08B").toUpperCase().replace(/\s+/g, "");
    const chain = CHAINS[name] ? name : "08B";
    const rws_ = Math.min(3, Math.max(1, int(d.rows, 1)));
    const ch = CHAINS[chain];
    const multi = rws_ > 1;
    const bf1 = (ch.p <= 12.7 ? (multi ? 0.91 : 0.93) : multi ? 0.93 : 0.95) * ch.b1;
    return { chain, ch, z: int(d.z, 19), rows: rws_, form: oneOf(d.form, FORMS, "mid"), body: readBody(d, (rws_ - 1) * ch.pt + bf1), place: readPlace(d), mateZ: Math.max(0, int(d.mateZ)), aw: Math.max(0, num(d.aw)), raw: d };
  },
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (typeof i.raw.chain === "string" && !CHAINS[i.raw.chain.toUpperCase().replace(/\s+/g, "")]) out.push({ level: "error", code: "chain", key: "chain", text: tr("Řetěz „{0}“ v tabulce není – vyberte: {1}.", i.raw.chain, CHAIN_NAMES.join(", ")) });
    if (out.some((x) => x.level === "error")) return validation(out);
    const c = compute(i);
    if (i.z < 9) out.push({ level: "warn", code: "few", key: "z", text: tr("Kolo s {0} zuby běží neklidně (mnohoúhelníkový efekt) – doporučuje se aspoň 9, pro rychlý chod 17 zubů.", i.z) });
    if (c.pointed) out.push({ level: "info", code: "pointed", key: "form", text: tr("Boky zubů se sejdou pod hlavovou kružnicí – hlavový průměr vychází Ø{0}.", nf(c.da, 3)) });
    out.push(...bodyIssues(i.body, { rootR: c.df / 2, tipR: c.da / 2, m: i.ch.p / Math.PI }).filter((x) => x.code !== "b"));
    if (i.body.hubD > c.dg + 1e-9 && i.body.hubL > 0) out.push({ level: "warn", code: "hub-dg", key: "hubD", text: tr("Náboj Ø{0} je větší než největší dovolený průměr vedle zubů d_g = {1} mm (ISO 606) – destičky řetězu by o něj dřely.", nf(i.body.hubD), nf(c.dg, 2)) });
    return validation(out);
  },
  compute,
  profile,
  blank: (i, c) => discSection(i.body, { tipR: c.da / 2, rootR: c.df / 2, m: i.ch.p / Math.PI }),
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    const out = [
      R("chain", tr("Řetěz ISO 606"), "", `${i.chain}${i.rows > 1 ? `-${i.rows}` : ""}`, "", "basic"),
      R("p", tr("Rozteč"), "p", fix(c.p), "mm", "basic"),
      R("d1", tr("Průměr válečku"), "d₁", fix(c.d1, 2), "mm", "basic"),
      R("z", tr("Počet zubů"), "z", String(i.z), "", "basic"),
      R("d", tr("Roztečný průměr"), "d", fix(c.d), "mm", "geometry"),
      R("da", tr("Hlavový průměr"), "dₐ", fix(c.da), "mm", "geometry"),
      R("df", tr("Patní průměr"), "d_f", fix(c.df), "mm", "geometry"),
      R("bf1", tr("Šířka zubu"), "b_f1", fix(c.bf1, 2), "mm", "geometry"),
    ];
    if (i.rows > 1) out.push(R("pt", tr("Příčná rozteč řad"), "p_t", fix(c.pt, 2), "mm", "geometry"), R("b", tr("Šířka přes řady"), "b", fix(c.b, 2), "mm", "geometry"));
    out.push(R("dg", tr("Největší průměr náboje"), "d_g", fix(c.dg, 2), "mm", "geometry"), R("MR", tr("Rozměr přes válečky"), "M_R", fix(c.MR), "mm", "check"), R("dR", tr("Průměr měřicího válečku"), "d_R", fix(c.d1, 2), "mm", "check"));
    if (i.mateZ > 0) out.push(R("mateZ", tr("Počet zubů protikola"), "z₂", String(i.mateZ), "", "pair"));
    if (i.aw > 0) out.push(R("aw", tr("Osová vzdálenost"), "a", fix(i.aw), "mm", "pair"));
    return out;
  },
  summary: (i, c) => [`${tr("řetězové")} ${i.chain}${i.rows > 1 ? `-${i.rows}` : ""} z${i.z}`, `d ${nf(c.d, 3)}`, `dₐ ${nf(c.da, 3)}`, `M_R ${fix(c.MR)}`, bodySummary(i.body, i.place)].join(" · "),
  name: (i) => tr("Řetězové kolo {0} z{1}", `${i.chain}${i.rows > 1 ? `-${i.rows}` : ""}`, i.z),
};
