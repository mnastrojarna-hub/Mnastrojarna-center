/**
 * Výtah z předlohy (2D model z DWG / DXF / PDF): listy, pohledy, měřítko, kóty (hodnota, tolerance, uložení, počet,
 * poloha, změřená hodnota geometrie → rozpory „text ≠ geometrie“), díry (i normálie AutoCAD Mechanical STDPART2D),
 * kusovník, pozice, razítka, poznámky, drsnost, tolerance tvaru, základny, řezy a rozpory mezi nimi.
 */
import { tr } from "../i18n";
// druhy entit 2D modelu (křivky, obálky vložení…) – v aplikaci se jinak registrují až s otevřením 2D výkresu
import "../draft/index";
import { cBox } from "../draft/curves";
import { boxUnion, emptyBox, IDENTITY, xfMul, xfPt, type Affine, type Box } from "../draft/geom";
import { checkDimText, parseDimText } from "../draft/io/dimtext";
import type { AcmData } from "../draft/io/types";
import { dimValueText, resolveDimStyle } from "../draft/annot/dimstyle";
import { dimensionGeometry } from "../draft/io/dimgeom";
import type { DDimension } from "../draft/annot/types";
import { findBlock } from "../draft/layout/blocks";
import { layerVisible } from "../draft/layers";
import type { DraftEntity, DraftModel, Vec2 } from "../draft/model";
import { bomRows, findTable, tableFromTexts, type TText } from "./bom";
import { flatten, insertXf, isConstruction, mtextToPlain, type GeomItem, type TextItem } from "./geom";
import { findSheets, sheetAt } from "./sheets";
import type { RefBalloon, RefBom, RefBox, RefContradiction, RefDim, RefExtract, RefFormat, RefHole, RefHoleKind, RefNote, RefSheet, RefSymbol, RefTitle, RefView } from "./types";

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const r3 = (x: number) => Math.round(x * 1e3) / 1e3;
const centerOf = (b: Box): Vec2 => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
const inBox = (p: Vec2, b: Box, m = 0) => p[0] >= b.x0 - m && p[0] <= b.x1 + m && p[1] >= b.y0 - m && p[1] <= b.y1 + m;
const boxDist = (p: Vec2, b: Box) => Math.hypot(Math.max(b.x0 - p[0], 0, p[0] - b.x1), Math.max(b.y0 - p[1], 0, p[1] - b.y1));

/** objekt AutoCAD Mechanical (i vnořený v bloku) s transformací do souřadnic výkresu */
type AcmObj = { cls: string; acm: AcmData; e: DraftEntity; xf: Affine; block: DraftEntity[] };
function acmObjects(model: DraftModel): AcmObj[] {
  const out: AcmObj[] = [];
  const seen = new Set<string>();
  const visit = (list: readonly DraftEntity[], xf: Affine, depth: number) => {
    if (depth > 6) return;
    for (const e of list) {
      if (e.type !== "insert" || e.ext?.invisible || !layerVisible(model, e.layer)) continue;
      const ins = e as DraftEntity & { block: string; p: Vec2; sx?: number; sy?: number; rot?: number };
      const blk = findBlock(model, ins.block);
      if (!blk) continue;
      const m = xfMul(xf, insertXf(ins, blk.base));
      if (e.ext?.acm) out.push({ cls: e.ext.acm.cls, acm: e.ext.acm, e, xf: m, block: blk.entities });
      else if (!seen.has(blk.name) || depth > 0) visit(blk.entities, m, depth + 1);
    }
  };
  visit(model.entities, IDENTITY, 0);
  return out;
}

/** kružnice, texty a body obsahu bloku objektu Mechanical (souřadnice výkresu); `model` = bez konstrukčních čar (AM_9) */
function acmParts(o: AcmObj, model?: DraftModel): { circles: { c: Vec2; r: number }[]; texts: { s: string; p: Vec2 }[]; pts: Vec2[]; box: Box } {
  const circles: { c: Vec2; r: number }[] = [];
  const texts: { s: string; p: Vec2 }[] = [];
  const pts: Vec2[] = [];
  let box = emptyBox();
  const k = Math.hypot(o.xf[0], o.xf[1]) || 1;
  const add = (p: Vec2) => {
    pts.push(p);
    box = boxUnion(box, { x0: p[0], y0: p[1], x1: p[0], y1: p[1] });
  };
  for (const e of o.block) {
    if (model && e.type !== "text" && isConstruction(model, e, o.e.layer)) continue;
    const x = e as DraftEntity & { c?: Vec2; r?: number; a?: Vec2; b?: Vec2; pts?: Vec2[]; p?: Vec2; s?: string };
    if ((e.type === "circle" || e.type === "arc") && x.c && x.r) {
      const c = xfPt(o.xf, x.c);
      circles.push({ c, r: x.r * k });
      box = boxUnion(box, { x0: c[0] - x.r * k, y0: c[1] - x.r * k, x1: c[0] + x.r * k, y1: c[1] + x.r * k });
    } else if (e.type === "line" && x.a && x.b) {
      add(xfPt(o.xf, x.a));
      add(xfPt(o.xf, x.b));
    } else if (e.type === "polyline" && x.pts) for (const p of x.pts) add(xfPt(o.xf, p));
    else if (e.type === "text" && x.p && x.s) {
      const p = xfPt(o.xf, x.p);
      texts.push({ s: x.s, p });
      add(p);
    }
  }
  return { circles, texts, pts, box };
}

/** změřená hodnota kóty v jednotkách výkresu (bez DIMLFAC); úhlová ve stupních */
function rawMeasure(e: DDimension, model: DraftModel): number | undefined {
  if (typeof e.measurement === "number" && Number.isFinite(e.measurement)) return e.kind === "angular" || e.kind === "angular3" ? (e.measurement * 180) / Math.PI : e.measurement;
  try {
    const m = dimensionGeometry(e, model).measurement;
    return Number.isFinite(m) ? m : undefined;
  } catch {
    return undefined;
  }
}

const HOLE_KIND: [RegExp, RefHoleKind][] = [
  [/ITHREAD|THREAD/i, "thread"],
  [/CNBR|CBORE|COUNTERBORE/i, "counterbore"],
  [/CSNK|CNSK|COUNTERSINK/i, "countersink"],
  [/BLND|BLIND/i, "blind"],
  [/FEAT\/BORE|BORE/i, "bore"],
  [/SCREW|BOLT/i, "screw"],
  [/PIN/i, "pin"],
  [/NUT/i, "nut"],
  [/WASH/i, "washer"],
];

/** symboly GDT (písmo AMGDT / gdt.shx) → znak ISO 1101 */
const GDT: Record<string, string> = { a: "∠", b: "⊥", c: "⏥", d: "⌓", e: "○", f: "∥", g: "⌭", h: "↗", i: "⌯", j: "⌖", k: "⌒", r: "◎", t: "⌰", u: "⏤" };

export type ExtractOpts = { name: string; format: RefFormat; version?: string; skipped?: Record<string, number> };

/** výtah z předlohy */
export function extractReference(model: DraftModel, o: ExtractOpts): RefExtract {
  const t0 = Date.now();
  const sheets = findSheets(model);
  const skip = new Set(sheets.flatMap((s) => s.frameIds));
  const { geom, texts } = flatten(model, { skip });
  const acm = acmObjects(model);
  const sheetOf = (p: Vec2) => sheetAt(sheets, p);
  const sheetN = (n: number) => sheets.find((s) => s.n === n);

  // ── kusovník: AutoCAD Mechanical ACMPARTLIST, jinak tabulka s hlavičkou Poz / Ks ──
  const boms: RefBom[] = [];
  const tableBoxes: RefBox[] = [];
  const tableTexts = new Set<TextItem>();
  for (const pl of acm.filter((a) => a.cls === "ACMPARTLIST")) {
    const parts = acmParts(pl);
    const tt: TText[] = [];
    for (const e of pl.block) if (e.type === "text") {
      const x = e as DraftEntity & { p: Vec2; s: string; h: number };
      tt.push({ s: x.s.replace(/∅/g, "Ø"), p: xfPt(pl.xf, x.p), h: x.h });
    }
    const vx: number[] = [];
    for (const e of pl.block) if (e.type === "line") {
      const x = e as DraftEntity & { a: Vec2; b: Vec2 };
      const a = xfPt(pl.xf, x.a);
      const b = xfPt(pl.xf, x.b);
      if (Math.abs(a[0] - b[0]) < 1e-6) vx.push(a[0]);
    }
    const t = tableFromTexts(tt, vx);
    if (t) boms.push({ sheet: sheetOf(centerOf(parts.box)), header: t.header, rows: bomRows(t), source: "mechanical" });
    tableBoxes.push(parts.box);
  }
  if (!boms.length) {
    const vlines: { x: number; y0: number; y1: number }[] = [];
    for (const g of geom) if (g.curve.k === "line" && Math.abs(g.curve.a[0] - g.curve.b[0]) < 1e-6) vlines.push({ x: g.curve.a[0], y0: Math.min(g.curve.a[1], g.curve.b[1]), y1: Math.max(g.curve.a[1], g.curve.b[1]) });
    for (const s of sheets) {
      const st = texts.filter((t) => !t.acm && !t.attrib && inBox(t.p, s.frame));
      const tab = findTable(st.map((t) => Object.assign({ s: t.s, p: t.p, h: t.h }, { __t: t })), vlines, s.n);
      if (!tab) continue;
      boms.push(tab.bom);
      tableBoxes.push(tab.box);
      for (const u of tab.used) tableTexts.add((u as unknown as { __t: TextItem }).__t);
    }
  }
  const inTable = (p: Vec2) => tableBoxes.some((b) => inBox(p, b, 0.5));

  // ── pozice (balónky): ACMBALLOON + značky dílu ACMPARTREF; obecně kružnice s číslem uvnitř ──
  const balloons: RefBalloon[] = [];
  const balloonCurves = new Set<GeomItem>();
  const partRefs = acm.filter((a) => a.cls === "ACMPARTREF").map((a) => acmParts(a).circles[0]?.c ?? centerOf(acmParts(a).box));
  for (const b of acm.filter((a) => a.cls === "ACMBALLOON")) {
    const p = acmParts(b);
    // pozice: číslo (text) v kroužku nebo nad vodorovnou čarou; cíl = tečka / šipka na konci odkazové čáry (nejdál od čísla)
    const big = p.circles.filter((c) => c.r >= 2).sort((x, y) => y.r - x.r)[0];
    const at = p.texts[0]?.p ?? big?.c ?? centerOf(p.box);
    const dot = p.circles.filter((c) => c.r < 1.5).sort((x, y) => Math.hypot(y.c[0] - at[0], y.c[1] - at[1]) - Math.hypot(x.c[0] - at[0], x.c[1] - at[1]))[0];
    let target: Vec2 | undefined = dot?.c;
    let bd = -1;
    if (!target)
      for (const q of p.pts) {
        const d = Math.hypot(q[0] - at[0], q[1] - at[1]);
        if (d > bd) {
          bd = d;
          target = q;
        }
      }
    const pos = (b.acm.texts ?? p.texts.map((t) => t.s)).find((s) => /^\d{1,4}[a-z]?$/i.test(s.trim()))?.trim() ?? b.acm.texts?.[0] ?? "?";
    const linked = !!target && partRefs.some((r) => Math.hypot(r[0] - target![0], r[1] - target![1]) <= 2.5);
    balloons.push({ sheet: sheetOf(at), pos, at, ...(target ? { target } : {}), linked });
  }
  if (!acm.some((a) => a.cls === "ACMBALLOON")) {
    for (const g of geom) {
      if (g.curve.k !== "arc" || Math.abs(g.curve.sweep) < 2 * Math.PI - 1e-6) continue;
      const c = g.curve.c;
      const r = g.curve.r;
      const s = sheetN(sheetOf(c));
      const u = s?.unitPerMm ?? 1;
      if (r < 2.5 * u || r > 10 * u) continue;
      const inside = texts.filter((t) => !t.attrib && Math.hypot(t.p[0] + 0.3 * t.h - c[0], t.p[1] + 0.5 * t.h - c[1]) < r && t.h >= 0.4 * r);
      if (inside.length !== 1 || !/^\d{1,3}[a-z]?$/i.test(inside[0].s.trim())) continue;
      balloonCurves.add(g);
      let target: Vec2 | undefined;
      for (const l of geom) {
        if (l.curve.k !== "line") continue;
        const da = Math.abs(Math.hypot(l.curve.a[0] - c[0], l.curve.a[1] - c[1]) - r);
        const db = Math.abs(Math.hypot(l.curve.b[0] - c[0], l.curve.b[1] - c[1]) - r);
        if (Math.min(da, db) <= 0.05 * r) {
          balloonCurves.add(l);
          target = da < db ? l.curve.b : l.curve.a;
        }
      }
      tableTexts.add(inside[0]);
      balloons.push({ sheet: s?.n ?? 0, pos: inside[0].s.trim(), at: c, ...(target ? { target } : {}) });
    }
  }

  // ── pohledy: shluky geometrie (obrys + skryté hrany) na listu ──
  const views: RefView[] = [];
  const viewGeom = new Map<string, GeomItem[]>();
  const usable = geom.filter((g) => (g.lt === "contour" || g.lt === "hidden" || g.lt === "other") && !balloonCurves.has(g));
  const bySheet = new Map<number, { g: GeomItem; b: Box }[]>();
  for (const g of usable) {
    const b = cBox(g.curve);
    if (!b || !Number.isFinite(b.x0)) continue;
    const c = centerOf(b);
    if (inTable(c)) continue;
    const n = sheetOf(c);
    if (!n) continue;
    const arr = bySheet.get(n) ?? [];
    arr.push({ g, b });
    bySheet.set(n, arr);
  }
  for (const s of sheets) {
    const items = bySheet.get(s.n) ?? [];
    const gap = 1.0 * s.unitPerMm;
    const par = items.map((_, i) => i);
    const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
    const order = items.map((_, i) => i).sort((a, b) => items[a].b.x0 - items[b].b.x0);
    for (let a = 0; a < order.length; a++) {
      const A = items[order[a]].b;
      for (let k = a + 1; k < order.length; k++) {
        const B = items[order[k]].b;
        if (B.x0 > A.x1 + gap) {
          if (B.x0 > A.x1 + gap + 400 * s.unitPerMm) break;
          continue;
        }
        if (B.y0 <= A.y1 + gap && B.y1 >= A.y0 - gap) par[find(order[a])] = find(order[k]);
      }
    }
    const cl = new Map<number, { b: Box; g: GeomItem[] }>();
    items.forEach((it, i) => {
      const r = find(i);
      const c = cl.get(r) ?? { b: emptyBox(), g: [] };
      c.b = boxUnion(c.b, it.b);
      c.g.push(it.g);
      cl.set(r, c);
    });
    const u = s.unitPerMm;
    // rámeček listu kreslený čarami (PDF, DXF bez bloku formátu) – dřív než slučování, jinak by pohltil všechny pohledy
    let vs = [...cl.values()].filter((c) => !(c.b.x1 - c.b.x0 >= 0.85 * (s.frame.x1 - s.frame.x0) && c.b.y1 - c.b.y0 >= 0.85 * (s.frame.y1 - s.frame.y0)));
    // tabulky a razítka kreslené čarami (jen svislé a vodorovné čáry, uvnitř hodně textů) – také před slučováním
    const isTable = (c: { b: Box; g: GeomItem[] }) => {
      const axis = c.g.every((g) => g.curve.k === "line" && (Math.abs(g.curve.a[0] - g.curve.b[0]) < 1e-6 || Math.abs(g.curve.a[1] - g.curve.b[1]) < 1e-6));
      if (!axis || c.g.length < 6) return false;
      return texts.filter((t) => inBox(t.p, c.b)).length >= c.g.length / 2;
    };
    vs = vs.filter((c) => !isTable(c));
    // obrys pohledu a kružnice uvnitř (díry) se nedotýkají – sloučit shluky, jejichž obálky se překrývají
    let merged = true;
    while (merged) {
      merged = false;
      outer: for (let i = 0; i < vs.length; i++)
        for (let j = i + 1; j < vs.length; j++) {
          const A = vs[i].b;
          const B = vs[j].b;
          if (A.x0 <= B.x1 && A.x1 >= B.x0 && A.y0 <= B.y1 && A.y1 >= B.y0) {
            vs[i] = { b: boxUnion(A, B), g: [...vs[i].g, ...vs[j].g] };
            vs.splice(j, 1);
            merged = true;
            break outer;
          }
        }
    }
    vs = vs.filter((c) => {
      const big = Math.max(c.b.x1 - c.b.x0, c.b.y1 - c.b.y0);
      const small = Math.min(c.b.x1 - c.b.x0, c.b.y1 - c.b.y0);
      if (c.g.length < 2 || big <= 3 * u) return false;
      if (big < 8 * u || (big < 10 * u && c.g.length <= 6)) return false; // značka (drsnost, promítání, logo) kreslená čarami
      if (small < 1.5 * u && c.g.length <= 4) return false; // samotné čáry
      // rámeček s poznámkami (tolerance, pokyny) – uvnitř víc vět než geometrie
      if (c.g.length < 40) {
        const words = texts.filter((t) => !t.attrib && inBox(t.p, c.b) && /\p{L}{3,}/u.test(t.s)).length;
        if (words >= 2 && words * 4 >= c.g.length) return false;
      }
      return true;
    });
    vs.sort((a, b) => b.b.y1 - a.b.y1 || a.b.x0 - b.b.x0);
    vs.forEach((v, i) => {
      const id = `${s.n}.${i + 1}`;
      views.push({ id, sheet: s.n, n: i + 1, box: v.b, w: r6(v.b.x1 - v.b.x0), h: r6(v.b.y1 - v.b.y0), geomScale: 1, count: v.g.length });
      viewGeom.set(id, v.g);
    });
  }
  const viewOf = (p: Vec2, sheet: number): string | undefined => {
    let best: RefView | undefined;
    let bd = Infinity;
    const u = sheetN(sheet)?.unitPerMm ?? 1;
    for (const v of views) {
      if (v.sheet !== sheet) continue;
      const d = boxDist(p, v.box);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best && bd <= 40 * u ? best.id : undefined;
  };

  // ── značky: řezy a popisky pohledů, drsnost, tolerance tvaru, základny ──
  const symbols: RefSymbol[] = [];
  const symKind: Record<string, RefSymbol["kind"]> = { ACMSURFSYM: "roughness", ACMFCFRAME: "fcf", ACMDATUMID: "datum", AMDTSECTIONSYM: "section", AMDTSECTIONSYMLABEL: "label" };
  for (const a of acm) {
    const kind = symKind[a.cls];
    if (!kind) continue;
    const p = acmParts(a);
    const at = p.texts[0]?.p ?? centerOf(p.box);
    const tx = (a.acm.texts ?? p.texts.map((t) => t.s)).map((s) => s.trim()).filter(Boolean);
    let text = tx.join(" ");
    if (kind === "roughness") text = tx.find((s) => /^\d+(?:[.,]\d+)?$/.test(s)) ?? text;
    else if (kind === "fcf") text = tx.map((s) => (s.length === 1 && GDT[s] ? GDT[s] : s)).join(" | ");
    else if (kind === "section") text = [...new Set(tx)].join(" ");
    symbols.push({ kind, sheet: sheetOf(at), text, at });
  }
  for (const e of model.entities) {
    if (e.type !== "tolerance" || e.ext?.invisible) continue;
    const x = e as DraftEntity & { p: Vec2; s: string };
    const text = x.s
      .replace(/\{\\Fgdt;(\w)\}/gi, (_, g) => GDT[g.toLowerCase()] ?? g)
      .replace(/%%v/gi, " | ")
      .replace(/\\[A-Za-z][^;]*;/g, "")
      .replace(/[{}]/g, "")
      .trim();
    symbols.push({ kind: "fcf", sheet: sheetOf(x.p), text, at: x.p });
  }
  const labelRe = /^([A-Z])\s*[-–—]\s*\1$|^(POHLED|ŘEZ|REZ|DETAIL|VIEW|SECTION|ANSICHT|SCHNITT|PŮDORYS|NÁRYS|BOKORYS)\b/i;
  for (const t of texts) if (!t.acm && !t.attrib && labelRe.test(t.s.trim())) symbols.push({ kind: "label", sheet: sheetOf(t.p), text: t.s.trim(), at: t.p });
  for (const t of texts) if (!t.acm && /^R[az]\s*\d+(?:[.,]\d+)?$/i.test(t.s.trim())) symbols.push({ kind: "roughness", sheet: sheetOf(t.p), text: t.s.trim().replace(/^R[az]\s*/i, ""), at: t.p });
  for (const sym of symbols) {
    if (sym.kind !== "label") continue;
    let best: RefView | undefined;
    let bd = Infinity;
    for (const v of views) {
      if (v.sheet !== sym.sheet) continue;
      const d = boxDist(sym.at, v.box);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    const u = sheetN(sym.sheet)?.unitPerMm ?? 1;
    if (best && bd <= 25 * u && !best.label) best.label = sym.text.replace(/\s+/g, "");
  }

  // ── kóty ──
  const countTexts = texts.filter((t) => !t.attrib && !t.acm && /^\d+\s*[x×*]$/i.test(t.s.trim()));
  const usedCount = new Set<TextItem>();
  const dims: RefDim[] = [];
  for (const e0 of model.entities) {
    if (e0.type !== "dimension" || e0.ext?.invisible || !layerVisible(model, e0.layer)) continue;
    const e = e0 as DraftEntity & DDimension;
    const st = resolveDimStyle(model, e.style, e.overrides);
    const raw = rawMeasure(e, model);
    const angular = e.kind === "angular" || e.kind === "angular3";
    const lfac = angular ? 1 : Number(st.dimlfac ?? 1) || 1;
    const measured = raw !== undefined ? r6(raw * lfac) : undefined;
    const shown = e.ext?.shown ?? (raw !== undefined ? dimValueText(e, angular ? raw : raw * lfac, st) : e.text ?? "");
    const info = parseDimText(shown);
    const at: Vec2 = e.ext?.shownAt ?? e.textPos ?? e.line ?? e.arc ?? e.p2 ?? e.chord ?? e.center ?? [0, 0];
    const sheet = sheetOf(at);
    const d: RefDim = {
      id: e.ext?.handle ?? e.id,
      sheet,
      kind: e.kind,
      text: info.text,
      ...(info.value !== undefined ? { value: info.value, decimals: info.decimals } : {}),
      ...(measured !== undefined ? { measured, raw: r6(raw!) } : {}),
      ...(info.tol ? { tol: info.tol } : {}),
      ...(info.fit ? { fit: info.fit } : {}),
      ...(info.reference ? { reference: true } : {}),
      ...(info.dia || e.kind === "diameter" ? { dia: true } : {}),
      ...(info.radius || e.kind === "radius" ? { radius: true } : {}),
      ...(info.thread ? { thread: info.thread } : {}),
      ...(info.chamfer ? { chamfer: info.chamfer } : {}),
      ...(info.count ? { count: info.count } : {}),
      at,
      check: measured !== undefined && !angular ? checkDimText(info, measured) : "none",
    };
    if (e.kind === "linear" || e.kind === "aligned") {
      d.p1 = e.p1;
      d.p2 = e.p2;
      d.dirDeg = e.kind === "linear" ? e.rot ?? 0 : (Math.atan2(e.p2![1] - e.p1![1], e.p2![0] - e.p1![0]) * 180) / Math.PI;
    } else if (e.kind === "ordinate") {
      d.p1 = e.origin;
      d.p2 = e.p1;
      d.dirDeg = (e.xAxis ? 0 : 90) + (e.hdir ?? 0);
    } else if (e.kind === "radius") {
      d.center = e.center;
      d.p2 = e.chord;
    } else if (e.kind === "diameter") {
      d.center = e.chord && e.far ? [(e.chord[0] + e.far[0]) / 2, (e.chord[1] + e.far[1]) / 2] : undefined;
      d.p2 = e.chord;
    }
    const v = viewOf(e.p1 ?? e.center ?? e.chord ?? at, sheet);
    if (v) d.view = v;
    dims.push(d);
  }
  // výkres bez entit kót (PDF, rozložené kóty): číselné texty u rovnoběžné kótovací čáry → kóta s délkou čáry;
  // měřítko listu = medián poměru délka / text, rozpor = text, který s tímto měřítkem nesedí
  if (!dims.length) dims.push(...textDims(texts, geom, sheets, sheetOf, viewOf, (t) => tableTexts.has(t) || inTable(t.p) || labelRe.test(t.s.trim())));
  // počty „4*“ (AutoCAD Mechanical je píše zvlášť vedle kóty) – nejbližší kóta do 4 výšek textu
  for (const ct of countTexts) {
    let best: RefDim | undefined;
    let bd = Infinity;
    for (const d of dims) {
      if (d.count) continue;
      const dd = Math.hypot(d.at[0] - ct.p[0], d.at[1] - ct.p[1]);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    if (best && bd <= 4 * Math.max(ct.h, 1) * 2) {
      best.count = parseInt(ct.s, 10);
      usedCount.add(ct);
    }
  }
  // měřítko geometrie pohledu: jednotky výkresu na 1 mm skutečné velikosti = změřená délka bez DIMLFAC / text kóty
  // (geometrie 1:1 → 1; geometrie kreslená v měřítku listu – PDF, export SolidWorks / Inventor, náš R12 – → 0,5 u 1:2).
  // Pohled bez použitelné kóty: medián ostatních pohledů listu, jinak měřítko listu × jednotky listu, jinak 1.
  const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  for (const v of views) {
    const rs = dims.filter((d) => d.view === v.id && d.value && d.raw && !d.thread && d.kind !== "angular" && d.kind !== "angular3" && d.check !== "mismatch").map((d) => d.raw! / d.value!);
    const sv = sheetN(v.sheet)?.scaleValue;
    if (o.format === "pdf" && sv) {
      v.geomScale = sv;
      v.scaleFrom = "sheet";
    } else if (rs.length) {
      v.geomScale = r6(med(rs));
      v.scaleFrom = "dims";
    }
  }
  for (const v of views) {
    if (v.scaleFrom) continue;
    const s = sheetN(v.sheet);
    const others = views.filter((x) => x.sheet === v.sheet && x.scaleFrom === "dims").map((x) => x.geomScale);
    if (others.length) {
      v.geomScale = r6(med(others));
      v.scaleFrom = "sheet-dims";
    } else if (s?.scaleValue) {
      v.geomScale = r6(s.scaleValue * s.unitPerMm);
      v.scaleFrom = "sheet";
    } else v.scaleFrom = "default";
  }

  // ── díry: normálie STDPART2D (druh, norma, označení, pohled) a kružnice pohledů ──
  const holes: RefHole[] = [];
  for (const a of acm.filter((x) => x.cls === "STDPART2D")) {
    // bez značky středu Ø2 na konstrukční hladině AM_9 (u každé normálie) – jen kružnice díry / závitu / dílu
    const p = acmParts(a, model);
    const dias = [...new Set(p.circles.map((c) => r3(2 * c.r)))].sort((x, y) => x - y);
    const center = p.circles.length ? p.circles[0].c : centerOf(p.box);
    const kind = HOLE_KIND.find(([re]) => re.test(a.acm.type ?? a.acm.branch ?? ""))?.[1] ?? "part";
    const sheet = sheetOf(center);
    holes.push({ sheet, ...(viewOf(center, sheet) ? { view: viewOf(center, sheet) } : {}), kind, ...(a.acm.std ? { std: a.acm.std } : {}), ...(a.acm.desig ? { desig: a.acm.desig.replace(/%%c/gi, "Ø") } : {}), ...(a.acm.branch ? { branch: a.acm.branch } : {}), ...(a.acm.view ? { side: a.acm.view } : {}), center: [r6(center[0]), r6(center[1])], dias, handle: a.acm.h });
  }
  const groups = new Map<string, { c: Vec2; rs: Set<number>; sheet: number; view?: string }>();
  for (const [vid, gs] of viewGeom) {
    for (const g of gs) {
      if (g.acm || g.curve.k !== "arc" || Math.abs(g.curve.sweep) < 2 * Math.PI - 1e-6 || g.lt === "hidden") continue;
      const c = g.curve.c;
      const key = `${vid}|${Math.round(c[0] * 100)}|${Math.round(c[1] * 100)}`;
      const gr = groups.get(key) ?? { c, rs: new Set<number>(), sheet: Number(vid.split(".")[0]), view: vid };
      gr.rs.add(r3(2 * g.curve.r));
      groups.set(key, gr);
    }
  }
  for (const gr of groups.values()) holes.push({ sheet: gr.sheet, view: gr.view, kind: "circle", center: [r6(gr.c[0]), r6(gr.c[1])], dias: [...gr.rs].sort((a, b) => a - b) });

  // ── razítka ──
  const titles: RefTitle[] = sheets.filter((s) => s.title).map((s) => s.title!);

  // ── poznámky ──
  const notes: RefNote[] = [];
  for (const t of texts) {
    if (t.acm || t.attrib || usedCount.has(t) || tableTexts.has(t) || inTable(t.p) || labelRe.test(t.s.trim()) || /^R[az]\s*\d/i.test(t.s.trim())) continue;
    const s = t.s.trim();
    if (s.length < 3 || !/\p{L}{2,}/u.test(s)) continue;
    notes.push({ sheet: sheetOf(t.p), text: s, at: t.p, layer: t.layer });
  }

  // ── rozpory ──
  const contradictions: RefContradiction[] = [];
  for (const d of dims) if (d.check === "mismatch") contradictions.push({ kind: "dim-text", sheet: d.sheet, text: tr("kóta {0} ukazuje {1}, geometrie {2}", d.id, d.text, d.measured ?? "?"), at: d.at });
  const norm = (s?: string) => (s ?? "").replace(/[Ø∅]|%%c/gi, "D").replace(/\s+/g, "").replace(/,/g, ".").replace(/[x×]/gi, "*").toUpperCase();
  const nums = (s?: string) => (norm(s).match(/\d+(?:\.\d+)?/g) ?? []).map(Number).sort((a, b) => a - b).join("*");
  const allRows = boms.flatMap((b) => b.rows);
  for (const t of titles) {
    if (!t.pos) continue;
    const row = allRows.find((r) => r.pos === t.pos!.trim());
    if (!row) continue;
    if (t.dim && row.dim && nums(t.dim) !== nums(row.dim)) contradictions.push({ kind: "title-bom", sheet: t.sheet, text: tr("pozice {0}: kusovník „{1}“, razítko listu {2} „{3}“", t.pos, row.dim, t.sheet, t.dim) });
    if (t.material && row.material && norm(t.material) !== norm(row.material)) contradictions.push({ kind: "title-bom", sheet: t.sheet, text: tr("pozice {0}: materiál v kusovníku „{1}“, v razítku listu {2} „{3}“", t.pos, row.material, t.sheet, t.material) });
  }
  // kóta Ø bez díry toho průměru na listu, kde díry jiného průměru jsou (např. řez Ø9 × půdorys Ø10)
  for (const s of sheets) {
    const hs = holes.filter((h) => h.sheet === s.n);
    const hd = new Set<number>();
    for (const h of hs) for (const d of h.dias) hd.add(d);
    // i skryté kružnice pohledů listu (díra vidět jen čárkovaně)
    for (const [vid, gs] of viewGeom) if (vid.startsWith(`${s.n}.`)) for (const g of gs) if (g.curve.k === "arc" && Math.abs(g.curve.sweep) >= 2 * Math.PI - 1e-6) hd.add(r3(2 * g.curve.r));
    for (const h of hs) {
      const m = /Ø\s*(\d+(?:[.,]\d+)?)/.exec(h.desig ?? "");
      if (m) hd.add(parseFloat(m[1].replace(",", ".")));
    }
    if (!hd.size) continue;
    // kandidáti: vrtání a zahloubení (normálie s označením Ø, kružnice pohledů) – ne šrouby, kolíky, závity
    const bores = new Set<number>();
    for (const h of hs) {
      if (h.kind !== "bore" && h.kind !== "counterbore" && h.kind !== "circle") continue;
      for (const x of h.dias) if (x >= 2.5) bores.add(x);
      const m = /Ø\s*(\d+(?:[.,]\d+)?)/.exec(h.desig ?? "");
      if (m) bores.add(parseFloat(m[1].replace(",", ".")));
    }
    const isSection = (vid?: string) => !!vid && /^([A-Z])-\1$/.test(views.find((v) => v.id === vid)?.label ?? "");
    for (const d of dims) {
      if (d.sheet !== s.n || !d.dia || d.thread || d.value === undefined || d.kind === "diameter" || !isSection(d.view)) continue;
      if ([...hd].some((x) => Math.abs(x - d.value!) <= 0.011)) continue;
      const near = [...bores].filter((x) => Math.abs(x - d.value!) <= 0.15 * d.value! && x !== d.value).sort((x, y) => Math.abs(x - d.value!) - Math.abs(y - d.value!)).slice(0, 3);
      if (!near.length) continue;
      contradictions.push({ kind: "hole-dim", sheet: s.n, text: tr("kóta {0} (pohled {1}) – díry na listu {2} mají Ø{3}, žádná nemá Ø{4}", d.text, d.view ?? "?", s.n, near.join(", Ø"), d.value), at: d.at });
    }
  }
  for (const b of balloons) if (allRows.length && !allRows.some((r) => r.pos === b.pos)) contradictions.push({ kind: "balloon-bom", sheet: b.sheet, text: tr("pozice {0} (list {1}) v kusovníku není", b.pos, b.sheet), at: b.at });

  // databáze kusovníku AutoCAD Mechanical: klíč atributu (velkými písmeny) a hned za ním hodnota
  const KEYS = /^(NAME|STANDARD|MATERIAL|MATERIAL2|DIM|NOTE|NOTE2|VENDOR|MASS|DESCR|DESCRIPTION|PART_NUMBER|NORM|POS)$/;
  const bomData: RefExtract["bomData"] = [];
  for (const a of model.ext?.acmData ?? []) {
    if (a.cls !== "ACMDATAENTRYPART" || !a.strs) continue;
    const attrs: Record<string, string> = {};
    for (let i = 0; i + 1 < a.strs.length; i++) if (KEYS.test(a.strs[i]) && !KEYS.test(a.strs[i + 1]) && !/^_/.test(a.strs[i + 1])) attrs[a.strs[i]] = a.strs[i + 1];
    if (Object.keys(attrs).length) bomData.push({ h: a.h, attrs });
  }
  return { name: o.name, format: o.format, ...(o.version ? { version: o.version } : {}), sheets, views, dims, holes, boms, balloons, titles, notes, symbols, contradictions, bomData, skipped: o.skipped ?? {}, ms: Date.now() - t0 };
}

/** kóty z textů (výkres bez entit kót – PDF): text s číslem u rovnoběžné čáry, změřeno = délka čáry / měřítko listu */
function textDims(texts: TextItem[], geom: GeomItem[], sheets: RefSheet[], sheetOf: (p: Vec2) => number, viewOf: (p: Vec2, sheet: number) => string | undefined, skipText: (t: TextItem) => boolean): RefDim[] {
  const lines = geom.filter((g) => g.curve.k === "line" && g.lt !== "center").map((g) => g.curve as { k: "line"; a: Vec2; b: Vec2 });
  const out: (RefDim & { _ratio?: number })[] = [];
  for (const t of texts) {
    if (t.attrib || t.acm || skipText(t)) continue;
    const s = t.s.trim();
    // jen text, který vypadá jako kóta (ne měřítko 1:2, datum, číslo výkresu)
    if (s.length > 28 || !/^(\d+\s*[x×*]\s*)?\(?\s*[ØR∅]?\s*\d+(?:[.,]\d+)?\s*(?:[A-Za-z]{1,2}\d{1,2}(?:\/[a-z]{1,2}\d{1,2})?|±\s*[\d.,]+|[+-]\s*[\d.,]+(?:\s*[+-]\s*[\d.,]+)?|°)?\s*\)?$/.test(s)) continue;
    const info = parseDimText(s);
    if (info.value === undefined || info.thread) continue;
    const a = (t.rot * Math.PI) / 180;
    const u: Vec2 = [Math.cos(a), Math.sin(a)];
    const nrm: Vec2 = [-u[1], u[0]];
    const wlen = 0.6 * t.h * s.length;
    const c: Vec2 = [t.p[0] + u[0] * wlen * 0.5 + nrm[0] * t.h * 0.5, t.p[1] + u[1] * wlen * 0.5 + nrm[1] * t.h * 0.5];
    let best: { a: Vec2; b: Vec2; d: number; L: number } | null = null;
    for (const l of lines) {
      const dx = l.b[0] - l.a[0];
      const dy = l.b[1] - l.a[1];
      const L = Math.hypot(dx, dy);
      if (L < 1) continue;
      if (Math.abs((dx / L) * u[1] - (dy / L) * u[0]) > 0.035) continue;
      const tt = ((c[0] - l.a[0]) * dx + (c[1] - l.a[1]) * dy) / (L * L);
      if (tt < -0.05 || tt > 1.05) continue;
      const d = Math.abs((c[0] - l.a[0]) * (dy / L) - (c[1] - l.a[1]) * (dx / L));
      if (d > 2.5 * t.h) continue;
      if (!best || d < best.d) best = { a: l.a, b: l.b, d, L };
    }
    if (!best) continue;
    const sheet = sheetOf(t.p);
    out.push({ id: t.top, sheet, kind: "text", text: info.text, value: info.value, decimals: info.decimals, raw: r6(best.L), ...(info.tol ? { tol: info.tol } : {}), ...(info.fit ? { fit: info.fit } : {}), ...(info.reference ? { reference: true } : {}), ...(info.dia ? { dia: true } : {}), ...(info.radius ? { radius: true } : {}), ...(info.count ? { count: info.count } : {}), at: t.p, p1: best.a, p2: best.b, dirDeg: (Math.atan2(best.b[1] - best.a[1], best.b[0] - best.a[0]) * 180) / Math.PI, check: "none", _ratio: best.L / info.value });
  }
  for (const sh of sheets) {
    const ds = out.filter((d) => d.sheet === sh.n && d._ratio! > 0);
    if (!ds.length) continue;
    const rs = ds.map((d) => d._ratio!).sort((a, b) => a - b);
    // k = jednotky výkresu na 1 mm skutečné velikosti (měřítko listu × jednotky listu), jinak medián poměrů
    const k = sh.scaleValue !== undefined ? sh.scaleValue * sh.unitPerMm : rs[Math.floor(rs.length / 2)];
    if (sh.scaleValue === undefined && rs.length >= 3) {
      const sv = k / sh.unitPerMm;
      sh.scaleValue = r6(sv);
      sh.scale = tr("{0} (odhad z kót)", sv >= 1 ? `${+sv.toFixed(3)}:1` : `1:${+(1 / sv).toFixed(3)}`);
    }
    for (const d of ds) {
      d.measured = r6(d.raw! / k);
      d.check = checkDimText({ text: d.text, value: d.value, decimals: d.decimals }, d.measured);
      const v = viewOf(d.p1!, d.sheet);
      if (v) d.view = v;
    }
  }
  return out.map(({ _ratio, ...d }) => (void _ratio, d));
}

/** geometrie pohledu předlohy (pro porovnání s modelem) */
export function viewGeometry(model: DraftModel, ex: RefExtract, viewId: string): GeomItem[] {
  const v = ex.views.find((x) => x.id === viewId);
  if (!v) return [];
  const skip = new Set(ex.sheets.flatMap((s) => s.frameIds));
  const { geom } = flatten(model, { skip, texts: false });
  return geom.filter((g) => {
    if (g.lt === "center" || g.lt === "thin") return false;
    const b = cBox(g.curve);
    return !!b && inBox(centerOf(b), v.box, 1e-6);
  });
}

export { mtextToPlain };
