/**
 * Rohatka (`gear.ratchet`): pilové zuby – strmé čelo s podříznutím (aby se západka vtahovala do zubu), zaoblená pata a šikmý hřbet.
 * Profil jsou úsečky a oblouky (přesně).
 */
import { tr } from "../i18n";
import { bodyIssues, bodyPhrases, bodyRows, defaultsOf, discSection, fix, fmt, int, nf, num, oneOf, placeRows, rangeIssues, readBody, readPlace, row, validation, W, type Place } from "./common";
import { bodySummary, teethRow, widthRow } from "./cylindrical";
import { DEG, dist, filletCorner, mirrorX, polar, rot2, segMirrorRev, TAU, tiledArea } from "./num";
import type { BodyOpts, GearData, GearDataRow, GearRow, Issue, KindDef, Profile2D, Seg2, Vec2 } from "./types";

export type RatchetIn = { z: number; da: number; h: number; rake: number; r: number; dir: "cw" | "ccw"; body: BodyOpts; place: Place; raw: GearData };
export type RatchetC = { p: number; h: number; df: number; ok: boolean };

function compute(i: RatchetIn): RatchetC {
  const p = (Math.PI * i.da) / i.z;
  const h = i.h > 0 ? i.h : 0.35 * p;
  return { p, h, df: i.da - 2 * h, ok: h > 0 && h < i.da / 2 };
}

/** jeden zub: od hrotu na úhlu −τ strmým čelem k patě, zaoblení, hřbetem k hrotu na úhlu 0 (proti směru hodin) */
function tooth(i: RatchetIn, c: RatchetC): Seg2[] {
  const tau = TAU / i.z;
  const ra = i.da / 2;
  const rf = ra - c.h;
  const A = polar(ra, -tau);
  const B = polar(ra, 0);
  // čelo: dovnitř po poloměru, podříznuté o `rake` směrem do materiálu zubu (po směru hodin)
  const er: Vec2 = [Math.cos(-tau), Math.sin(-tau)];
  const tcw: Vec2 = [Math.sin(-tau), -Math.cos(-tau)];
  const rk = i.rake * DEG;
  const d: Vec2 = [-Math.cos(rk) * er[0] + Math.sin(rk) * tcw[0], -Math.cos(rk) * er[1] + Math.sin(rk) * tcw[1]];
  const bq = A[0] * d[0] + A[1] * d[1];
  const s = -bq - Math.sqrt(Math.max(0, bq * bq - (ra * ra - rf * rf)));
  const C: Vec2 = [A[0] + d[0] * s, A[1] + d[1] * s];
  const segs = filletCorner(A, C, B, Math.min(i.r, 0.45 * Math.min(dist(A, C), dist(C, B))));
  if (i.dir === "cw") return segs;
  // opačný smysl: zrcadlit podle osy X a pootočit zpět o rozteč (hrot zubu 0 zůstává na +X)
  return segs
    .map(segMirrorRev)
    .reverse()
    .map((sg) => (sg.t === "line" ? { t: "line", a: rot2(sg.a, -tau), b: rot2(sg.b, -tau) } : sg.t === "arc" ? { ...sg, c: rot2(sg.c, -tau), a0: sg.a0 - tau, a1: sg.a1 - tau } : sg) as Seg2);
}

const rows = (): GearRow[] => [
  teethRow(24, 6, tr("počet zubů rohatky"), 200),
  row("da", tr("Vnější průměr dₐ"), "number", 60, tr("průměr přes hroty zubů"), "basic", W(["da", "průměr"], ["da", "diameter"], ["da", "durchmesser"]), { unit: "mm", min: 2, required: true, symbol: "dₐ" }),
  widthRow(8, tr("šířka rohatky")),
  row("h", tr("Výška zubu h"), "number", 0, tr("0 = automaticky 0,35 × rozteč na vnějším průměru"), "teeth", W(["h", "výška"], ["h", "height"], ["h", "höhe"]), { unit: "mm", min: 0, symbol: "h" }),
  row("rake", tr("Podříznutí čela"), "number", 5, tr("úhel, o který je strmé čelo zubu skloněné pod hrot – západka se pak do zubu vtahuje (0–15°)"), "teeth", W(["podříznutí", "rake"], "rake", ["hinterschnitt", "rake"]), { unit: "°", min: 0, max: 15 }),
  row("r", tr("Zaoblení paty"), "number", 0.5, tr("poloměr zaoblení mezi čelem a hřbetem zubu"), "teeth", W(["r", "zaoblení"], ["r", "radius"], ["r", "radius"]), { unit: "mm", min: 0 }),
  row("dir", tr("Smysl"), "enum", "cw", tr("kterým směrem se rohatka volně otáčí (západka drží opačný směr)"), "teeth", W(["smysl", "dir"], ["direction", "dir"], ["richtung", "dir"]), {
    options: [{ v: "cw", l: tr("Volně po směru hodin") }, { v: "ccw", l: tr("Volně proti směru hodin") }],
    enumWords: { cw: W("posměru", "cw", "uhrzeigersinn"), ccw: W("protisměru", "ccw", "gegenuhrzeigersinn") },
  }),
  ...bodyRows({ chamfer: false }),
  ...placeRows().filter((x) => x.key !== "jn"),
];

const rws = rows();
export const RATCHET: KindDef<RatchetIn, RatchetC> = {
  kind: "ratchet",
  ext: "gear.ratchet",
  label: tr("Rohatka"),
  short: tr("rohatka"),
  standards: ["DIN 6885-1"],
  rows: rws,
  phrases: bodyPhrases(),
  words: W(["rohatka"], ["ratchet"], ["sperrrad", "klinkenrad"]),
  accuracy: tr("Přesně: celý profil (úsečky a oblouky). Rozměry zubu nejsou normalizované – volí se podle západky."),
  defaults: () => defaultsOf(rws),
  read: (d): RatchetIn => ({ z: int(d.z, 24), da: num(d.da, 60), h: Math.max(0, num(d.h)), rake: num(d.rake, 5), r: Math.max(0, num(d.r, 0.5)), dir: oneOf(d.dir, ["cw", "ccw"] as const, "cw"), body: readBody(d, num(d.b, 8)), place: readPlace(d), raw: d }),
  validate: (i) => {
    const out: Issue[] = rangeIssues(rws, i.raw);
    if (out.some((x) => x.level === "error")) return validation(out);
    const c = compute(i);
    if (!(c.h < 0.4 * i.da)) out.push({ level: "error", code: "h", key: "h", text: tr("Výška zubu {0} mm je příliš velká pro průměr {1} mm.", nf(c.h, 2), nf(i.da)) });
    else out.push(...bodyIssues(i.body, { rootR: c.df / 2, tipR: i.da / 2, m: c.p / Math.PI }));
    return validation(out);
  },
  compute,
  profile: (i, c): Profile2D => {
    const t = tooth(i, c);
    return { tooth: t, count: i.z, circles: { ref: i.da, tip: i.da, root: c.df }, area: tiledArea(t, i.z) };
  },
  blank: (i, c) => discSection(i.body, { tipR: i.da / 2, rootR: c.df / 2, m: c.p / Math.PI }),
  dataRows: (i, c): GearDataRow[] => {
    const R = (key: string, label: string, symbol: string, value: string, unit: string, group: GearDataRow["group"]): GearDataRow => ({ key, label, ...(symbol ? { symbol } : {}), value, ...(unit ? { unit } : {}), group });
    return [R("z", tr("Počet zubů"), "z", String(i.z), "", "basic"), R("da", tr("Vnější průměr"), "dₐ", fix(i.da), "mm", "geometry"), R("df", tr("Patní průměr"), "d_f", fix(c.df), "mm", "geometry"), R("h", tr("Výška zubu"), "h", fix(c.h), "mm", "geometry"), R("p", tr("Rozteč na vnějším průměru"), "p", fix(c.p), "mm", "geometry"), R("rake", tr("Podříznutí čela"), "", fix(i.rake, 1), "°", "geometry")];
  },
  summary: (i, c) => [`${tr("rohatka")} z${i.z} dₐ ${nf(i.da)} h ${nf(c.h, 2)} b${nf(i.body.b)}`, bodySummary(i.body, i.place)].join(" · "),
  name: (i) => tr("Rohatka z{0} Ø{1}", i.z, fmt(i.da)),
};
export { mirrorX };
