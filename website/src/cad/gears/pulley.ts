/**
 * Ozubená řemenice (`gear.pulley`): HTD 3M / 5M / 8M / 14M (ISO 13050) a T5 / T10 (DIN 7721). Roztečný průměr d_0 = z·p/π,
 * hlavový d_a = d_0 − 2·PLD (HTD) / d_0 − 2u (T). Drážka je přiblížená: HTD jeden oblouk se zaoblením hran, T lichoběžník
 * bez zaoblení – rozteč a průměry jsou přesné, tvar drážky ne.
 */
import { tr } from "../i18n";
import { bodyIssues, bodyPhrases, bodyRows, bool, defaultsOf, discSection, fix, fmt, int, loc, nf, num, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { bodySummary, teethRow } from "./cylindrical";
import { ang, circleX, DEG, polar, segMirrorRev, tiledArea } from "./num";
import { BELT_NAMES, HTD, TBELTS } from "./tables";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Seg2, Vec2 } from "./types";

export type PulleyIn = { profile: string; z: number; w: number; flanges: boolean; body: BodyOpts; place: Place; raw: GearData };
export type PulleyC = {
  p: number;
  d0: number;
  da: number;
  df: number;
  /** hloubka drážky */
  hg: number;
  /** šířka ozubené části a tloušťka / průměr bočnic */
  wt: number;
  ft: number;
  fd: number;
  /** celková šířka včetně bočnic */
  B: number;
  htd: boolean;
};

const norm = (s: unknown) => {
  const t = String(s ?? "5M").toUpperCase().replace(/^HTD\s*/, "").replace(/\s+/g, "");
  return BELT_NAMES.includes(t) ? t : "5M";
};

function compute(i: PulleyIn): PulleyC {
  const h = HTD[i.profile];
  const t = TBELTS[i.profile];
  const p = h ? h.p : t.p;
  const d0 = (i.z * p) / Math.PI;
  const da = h ? d0 - 2 * h.pld : d0 - t.u2;
  const hg = h ? h.h : t.hg;
  const wt = i.w + (p >= 8 ? 3 : 2);
  const ft = i.flanges ? (p >= 8 ? 1.5 : 1.2) : 0;
  return { p, d0, da, df: da - 2 * hg, hg, wt, ft, fd: da + 2 * hg + 2, B: wt + 2 * ft, htd: !!h };
}

function profile(i: PulleyIn, c: PulleyC): Profile2D {
  const ra = c.da / 2;
  const ag = -Math.PI / i.z; // střed drážky pod zubem 0
  const tooth: Seg2[] = [];
  let tipA: number;
  if (c.htd) {
    const h = HTD[i.profile];
    const G = polar(ra - h.h + h.r, ag);
    const rc = 0.08 * c.p; // zaoblení hrany drážky
    const F = circleX(G, h.r + rc, [0, 0], ra - rc).filter((q) => ang(q) > ag)[0];
    if (F) {
      tooth.push({ t: "arc", c: G, r: h.r, a0: ag + Math.PI, a1: ang(F, G), ccw: false }, { t: "arc", c: F, r: rc, a0: ang(G, F), a1: ang(F), ccw: true });
      tipA = ang(F);
    } else {
      const X = circleX(G, h.r, [0, 0], ra).filter((q) => ang(q) > ag)[0] ?? polar(ra, ag / 2);
      tooth.push({ t: "arc", c: G, r: h.r, a0: ag + Math.PI, a1: ang(X, G), ccw: false });
      tipA = ang(X);
    }
  } else {
    const t = TBELTS[i.profile];
    const rf = ra - t.hg;
    const hb = t.br / 2 / rf; // polovina úhlu dna drážky
    const A = polar(rf, ag + hb);
    // bok drážky svírá s osou drážky úhel φ/2 a končí na hlavové kružnici
    const dir = ag + (t.phi / 2) * DEG;
    const u: Vec2 = [Math.cos(dir), Math.sin(dir)];
    const bq = A[0] * u[0] + A[1] * u[1];
    const s = -bq + Math.sqrt(bq * bq - (rf * rf - ra * ra));
    const E: Vec2 = [A[0] + u[0] * s, A[1] + u[1] * s];
    tooth.push({ t: "arc", c: [0, 0], r: rf, a0: ag, a1: ag + hb, ccw: true }, { t: "line", a: A, b: E });
    tipA = ang(E);
  }
  const low = [...tooth];
  tooth.push({ t: "arc", c: [0, 0], r: ra, a0: tipA, a1: -tipA, ccw: true }, ...low.map(segMirrorRev).reverse());
  return { tooth, count: i.z, circles: { ref: c.d0, tip: c.da, root: c.df }, area: tiledArea(tooth, i.z) };
}

const rows = (): GearRow[] => [
  row("profile", tr("Profil řemene"), "enum", "5M", tr("HTD 3M–14M (ISO 13050, obloukový zub) nebo T5 / T10 (DIN 7721, lichoběžníkový zub); AT a GT2 zde nejsou – tvar drážky je firemní"), "basic", W(["profil", "řemen"], ["profile", "belt"], ["profil", "riemen"]), { required: true, options: BELT_NAMES.map((k) => ({ v: k, l: HTD[k] ? `HTD ${k}` : k })) }),
  teethRow(32, 10, tr("počet zubů řemenice; roztečný průměr d_0 = z·p / π"), 216),
  row("w", tr("Šířka řemene"), "number", 15, tr("ozubená část je o 2 mm (od rozteče 8 mm o 3 mm) širší než řemen"), "basic", W(["w", "šířka"], ["w", "width"], ["w", "breite"]), { unit: "mm", min: 2 }),
  row("flanges", tr("Bočnice"), "bool", true, tr("vodicí bočnice po obou stranách (aspoň jedna řemenice v převodu je má mít)"), "basic", W("bočnice", "flanges", "bordscheiben")),
  ...bodyRows({ chamfer: false, web: false }),
  ...placeRows().filter((r) => r.key !== "jn"),
];

const rws = rows();
export const PULLEY: KindDef<PulleyIn, PulleyC> = {
  kind: "pulley",
  ext: "gear.pulley",
  label: tr("Ozubená řemenice"),
  short: tr("řemenice"),
  standards: ["ISO 13050", "ISO 5294", "DIN 7721", "DIN 6885-1"],
  rows: rws,
  phrases: bodyPhrases(),
  words: W(["řemenice"], ["pulley", "timingpulley"], ["zahnriemenscheibe", "riemenscheibe"]),
  positional: ["profile"],
  accuracy: tr("Přesně: rozteč, roztečný a hlavový průměr. Přibližně: tvar drážky (HTD jeden oblouk se zaoblenou hranou, T lichoběžník bez zaoblení) – pro výrobu ozubení použijte profil nástroje podle normy."),
  defaults: () => defaultsOf(rws),
  read: (d): PulleyIn => {
    const profile_ = norm(d.profile);
    const z = int(d.z, 32);
    const w = num(d.w, 15);
    const flanges = d.flanges === undefined ? true : bool(d.flanges);
    const p = HTD[profile_]?.p ?? TBELTS[profile_].p;
    return { profile: profile_, z, w, flanges, body: readBody(d, w + (p >= 8 ? 3 : 2) + (flanges ? 2 * (p >= 8 ? 1.5 : 1.2) : 0)), place: readPlace(d), raw: d };
  },
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const c = compute(i);
    out.push(...bodyIssues(i.body, { rootR: c.df / 2, tipR: c.da / 2, m: c.p / Math.PI }).filter((x) => x.code !== "b"));
    return validation(out);
  },
  compute,
  profile,
  blank: (i, c) => {
    const sec = discSection(i.body, { tipR: c.da / 2, rootR: c.df / 2, m: c.p / Math.PI });
    if (!i.flanges) return sec;
    // bočnice: obruby Ø fd na obou koncích
    const k = sec.findIndex((q, n) => Math.abs(q[0] - c.da / 2) < 1e-9 && Math.abs(sec[(n + 1) % sec.length][0] - c.da / 2) < 1e-9);
    if (k < 0) return sec;
    const r = c.fd / 2;
    sec.splice(k, 2, [r, 0], [r, c.ft], [c.da / 2, c.ft], [c.da / 2, c.B - c.ft], [r, c.B - c.ft], [r, c.B]);
    return sec;
  },
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    return [
      R("profile", tr("Profil řemene"), "", c.htd ? `HTD ${i.profile}` : i.profile, "", "basic"),
      R("p", tr("Rozteč"), "p", loc(fmt(c.p, 3)), "mm", "basic"),
      R("z", tr("Počet zubů"), "z", String(i.z), "", "basic"),
      R("d0", tr("Roztečný průměr"), "d₀", fix(c.d0), "mm", "geometry"),
      R("da", tr("Hlavový průměr"), "dₐ", fix(c.da), "mm", "geometry"),
      R("df", tr("Patní průměr"), "d_f", fix(c.df), "mm", "geometry"),
      R("wt", tr("Šířka ozubení"), "b", fix(c.wt, 1), "mm", "geometry"),
      ...(i.flanges ? [R("fd", tr("Průměr bočnic"), "d_B", fix(c.fd, 1), "mm", "geometry")] : []),
    ];
  },
  summary: (i, c) => [`${tr("řemenice")} ${c.htd ? "HTD " : ""}${i.profile} z${i.z} ${tr("řemen")} ${nf(i.w)}`, `d₀ ${nf(c.d0, 3)}`, `dₐ ${nf(c.da, 3)}`, bodySummary(i.body, i.place)].join(" · "),
  name: (i) => tr("Řemenice {0} z{1}", HTD[i.profile] ? `HTD ${i.profile}` : i.profile, i.z),
};
