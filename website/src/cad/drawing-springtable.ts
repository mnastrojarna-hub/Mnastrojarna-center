/**
 * Tabulka údajů pružiny na výkrese (EN ISO 2162-2 „údaje pro výrobu a kontrolu“): drát d, D / De, L0, n, nt, konce, tuhost,
 * pracovní body F1/L1 a F2/L2, Ln, materiál, smysl vinutí – nad razítkem (nad kusovníkem a tabulkou děr), dvě dvojice
 * „veličina – hodnota“ na řádek. Data z prvků `spring.*` dílu (cad/springs), čisté funkce bez jádra.
 * Zapíná se volbou listu `springTable` (`výkres tabulka pružiny ano`, přepínač v panelu výkresu).
 */
import { tr } from "./i18n";
import { endsLabel, legLabel, loopLabel, materialLabel, springCalc, springTablesOf, fmt, type Ends, type LegKind, type LoopKind, type SpringData } from "./springs";
import type { CadDoc, Feature } from "./types";
import type { DText, Poly } from "./drawing";

export type SpringDrawTable = { title: string; rows: [string, string][] };

const ROW = 4.6;
const v = (n: number | undefined, unit: string, d = 2) => (n === undefined || !Number.isFinite(n) ? "–" : `${fmt(n, d)} ${unit}`.trim());

/** Tabulky pružin dílu (nepotlačené prvky spring.*, pořadí historie). */
export function springDrawTables(doc: CadDoc): SpringDrawTable[] {
  return springTablesOf(doc).map((t) => {
    const f = doc.features.find((x) => x.id === t.featureId) as Extract<Feature, { type: "ext" }>;
    const data = (f.data ?? {}) as SpringData;
    const c = springCalc(t.ext, data);
    const x = c.v;
    const hand = data.hand === "left" ? tr("levé") : tr("pravé");
    const mat = materialLabel(String(data.material ?? (c.kind === "disc" ? "51CrV4" : "SH")) as never);
    const rows: [string, string][] = [];
    const pt = (L: string, F: string, key: "1" | "2", lu = "mm", fu = "N") => {
      if (x[`${L}${key}`] !== undefined) rows.push([`${F}${key} / ${L === "a" ? "α" : L}${key}`, `${fmt(x[`${F}${key}`], 1)} ${fu} / ${fmt(x[`${L}${key}`], 2)} ${lu}`]);
    };
    if (c.kind === "compression") {
      rows.push(["d", v(x.d, "mm")], ["D / De", `${fmt(x.D)} / ${fmt(x.De)} mm`], ["L0", v(x.L0, "mm")], ["n / nt", `${fmt(x.n)} / ${fmt(x.nt)}`]);
      rows.push([tr("konce"), endsLabel((data.ends ?? "ground") as Ends)], ["R", v(x.R, "N/mm", 3)]);
      pt("L", "F", "1");
      pt("L", "F", "2");
      rows.push(["Ln", v(x.Ln, "mm")], ["Fn", v(x.Fn, "N", 1)], [tr("materiál"), mat], [tr("vinutí"), hand]);
    } else if (c.kind === "extension") {
      rows.push(["d", v(x.d, "mm")], ["D / De", `${fmt(x.D)} / ${fmt(x.De)} mm`], ["n", fmt(x.n)], ["L0", v(x.L0, "mm")], ["F0", v(x.F0, "N", 1)], ["R", v(x.R, "N/mm", 3)]);
      pt("L", "F", "1");
      pt("L", "F", "2");
      rows.push(["Ln", v(x.Ln, "mm")], [tr("očka"), loopLabel((data.loop ?? "german") as LoopKind)], [tr("materiál"), mat], [tr("vinutí"), hand]);
    } else if (c.kind === "torsion") {
      rows.push(["d", v(x.d, "mm")], ["D / De", `${fmt(x.D)} / ${fmt(x.De)} mm`], ["n", fmt(x.n)], ["RM", v(x.RM, "N·mm/°")], ["α0", v(x.legAngle, "°", 0)]);
      rows.push([tr("ramena"), `${legLabel((data.leg1 ?? "tangential") as LegKind)} / ${legLabel((data.leg2 ?? "tangential") as LegKind)}`]);
      pt("a", "M", "1", "°", "N·mm");
      pt("a", "M", "2", "°", "N·mm");
      rows.push([tr("materiál"), mat], [tr("vinutí"), hand]);
    } else {
      rows.push(["De × Di × t", `${fmt(x.De)} × ${fmt(x.Di)} × ${fmt(x.t)}`], ["h0", v(x.h0, "mm")], [tr("sloupec"), `${x.ns} × ${x.np}`], ["L0", v(x.L0, "mm")], ["Lc", v(x.Lc, "mm")], ["F (0,75 h0)", v(x.F75, "N", 0)]);
      pt("L", "F", "1");
      pt("L", "F", "2");
      rows.push([tr("materiál"), mat]);
    }
    return { title: tr("Údaje pružiny „{0}“ (EN ISO 2162-2)", t.name), rows };
  });
}

/** výška všech tabulek (mm listu) – místo nad razítkem */
export const springTableHeight = (tables: SpringDrawTable[] | undefined): number => (tables ?? []).reduce((h, t) => h + (Math.ceil(t.rows.length / 2) + 1) * ROW + 3, 0);

/** Vykreslí tabulky nad `yBottom` v šířce `w` od `x`; vrací novou horní hranu. */
export function drawSpringTables(x: number, yBottom: number, w: number, tables: SpringDrawTable[], polys: Poly[], texts: DText[]): number {
  let y = yBottom;
  for (const t of [...tables].reverse()) {
    const n = Math.ceil(t.rows.length / 2);
    const h = (n + 1) * ROW;
    const y0 = y - 3 - h;
    polys.push({ layer: "frame", width: 0.7, pts: [[x, y0], [x + w, y0], [x + w, y0 + h], [x, y0 + h], [x, y0]] });
    for (let i = 1; i <= n; i++) polys.push({ layer: "title", width: i === 1 ? 0.5 : undefined, pts: [[x, y0 + i * ROW], [x + w, y0 + i * ROW]] });
    const cw = [0.17, 0.33, 0.17, 0.33].map((k) => k * w);
    let cx = x;
    for (let k = 0; k < 3; k++) {
      cx += cw[k];
      polys.push({ layer: "title", pts: [[cx, y0 + ROW], [cx, y0 + h]] });
    }
    texts.push({ x: x + 1.5, y: y0 + ROW - 1.4, s: t.title, size: 2.6, bold: true, anchor: "start", layer: "text" });
    t.rows.forEach(([k, val], i) => {
      const r = Math.floor(i / 2);
      const col = (i % 2) * 2;
      const rb = y0 + (r + 2) * ROW - 1.3;
      const left = x + cw.slice(0, col).reduce((a, b) => a + b, 0);
      texts.push({ x: left + 1.2, y: rb, s: k, size: 2.4, bold: true, anchor: "start", layer: "text" });
      texts.push({ x: left + cw[col] + 1.2, y: rb, s: val, size: 2.4, anchor: "start", layer: "text" });
    });
    y = y0;
  }
  return y;
}
