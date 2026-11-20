/**
 * Kontrola čitelnosti celého listu (vlna 22, bod 17; kritik M7) – čistý modul bez jádra nad hotovým listem (výsledek
 * jádra + poznámky a kóty listu z `withAnnotations`).
 *
 * Dřív se kontroloval jen překryv nové / upravené poznámky s jiným textem a přesah rámu (drawing-marks.ts). Teď všechny
 * dvojice, které dělají list nečitelným:
 * - balónek × balónek, balónek × text / kóta, balónek × tabulka / razítko, balónek × rám, balónek × geometrie pohledu;
 * - odkazová čára × cizí balónek; křížení odkazových čar (počítá se zvlášť – „křížení odkazů“);
 * - text × text (kóty × kóty, poznámky × kóty …) mimo tabulky; text × geometrie pohledu (poznámka / kóta přes obrys);
 * - tabulka (kusovník, tabulka děr, pružin, revizí, razítko) × geometrie pohledu; text přes rám listu.
 * Výsledek: počty po druzích, místa (obdélníky na listu pro značky v GUI) a rada. „Překryvy 0“ smí hlásit jen tato kontrola
 * nad skutečným listem (greens: bez kontroly se píše „nezkontrolováno“).
 */
import type { DrawingResult, DText } from "./drawing";
import { textBox } from "./drawing";
import { countCrossings, segmentHitsCircle } from "./drawing-balloons";
import { tr } from "./i18n";
import type { Vec2 } from "./types";

export type OverlapKind = "balloon-balloon" | "balloon-text" | "balloon-table" | "balloon-frame" | "balloon-geometry" | "leader-balloon" | "text-text" | "text-geometry" | "table-geometry" | "text-frame";
export const OVERLAP_KINDS: OverlapKind[] = ["balloon-balloon", "balloon-text", "balloon-table", "balloon-frame", "balloon-geometry", "leader-balloon", "text-text", "text-geometry", "table-geometry", "text-frame"];
export type OverlapHit = { kind: OverlapKind; /** obdélník místa na listu [x0, y0, x1, y1] (mm, y dolů) */ at: [number, number, number, number]; /** co se překrývá (číslo pozice, text) */ what: string };
export type SheetOverlaps = {
  total: number;
  byKind: Partial<Record<OverlapKind, number>>;
  hits: OverlapHit[];
  /** křížení odkazových čar pozic (dvojice) */
  crossings: number;
  /** pozice na listu (počet) */
  balloons: number;
};

type Box = [number, number, number, number];
const shrink = (b: Box, d: number): Box => [b[0] + d, b[1] + d, b[2] - d, b[3] - d];
const hit = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const inside = (a: Box, b: Box) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];
const rbox = (r: { x: number; y: number; w: number; h: number }): Box => [r.x, r.y, r.x + r.w, r.y + r.h];
const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** úsečky geometrie pohledů v mřížce (rychlý dotaz obdélník → úsečky) */
class SegIndex {
  private readonly C = 10;
  private cells = new Map<string, number[]>();
  readonly segs: [Vec2, Vec2][] = [];
  add(a: Vec2, b: Vec2) {
    const i = this.segs.push([a, b]) - 1;
    const x0 = Math.floor(Math.min(a[0], b[0]) / this.C);
    const x1 = Math.floor(Math.max(a[0], b[0]) / this.C);
    const y0 = Math.floor(Math.min(a[1], b[1]) / this.C);
    const y1 = Math.floor(Math.max(a[1], b[1]) / this.C);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return; // dlouhé úsečky (rám, osy) – geometrie pohledu je krátká
    for (let gx = x0; gx <= x1; gx++)
      for (let gy = y0; gy <= y1; gy++) {
        const k = `${gx},${gy}`;
        const l = this.cells.get(k);
        if (l) l.push(i);
        else this.cells.set(k, [i]);
      }
  }
  near(b: Box): [Vec2, Vec2][] {
    const out = new Set<number>();
    for (let gx = Math.floor(b[0] / this.C); gx <= Math.floor(b[2] / this.C); gx++)
      for (let gy = Math.floor(b[1] / this.C); gy <= Math.floor(b[3] / this.C); gy++) for (const i of this.cells.get(`${gx},${gy}`) ?? []) out.add(i);
    return [...out].map((i) => this.segs[i]);
  }
}

/** úsečka protíná obdélník (Liang–Barsky) */
function segInBox(a: Vec2, b: Vec2, r: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a[0] - r[0]) && clip(dx, r[2] - a[0]) && clip(-dy, a[1] - r[1]) && clip(dy, r[3] - a[1]) && t0 <= t1;
}

/** Překryvy na hotovém listu (výsledek jádra po `withAnnotations`). */
export function sheetOverlaps(res: Pick<DrawingResult, "polys" | "texts" | "balloons" | "tables" | "frameRect" | "zones">): SheetOverlaps {
  const hits: OverlapHit[] = [];
  const push = (kind: OverlapKind, at: Box, what: string) => hits.push({ kind, at: at.map((v) => Math.round(v * 10) / 10) as Box, what });
  const balloons = (res.balloons ?? []).filter((b) => b.a && b.r);
  const tables = (res.tables ?? []).map((t) => ({ kind: t.kind, box: rbox(t) }));
  const frame = res.frameRect ? rbox(res.frameRect) : null;
  // geometrie pohledů: viditelné hrany (pravoúhlé pohledy) a tenké čáry izometrie, mimo tabulky a razítko
  const geo = new SegIndex();
  for (const p of res.polys) {
    if (p.fill || p.img || (p.layer !== "visible" && p.layer !== "thin")) continue;
    for (let i = 0; i + 1 < p.pts.length; i++) geo.add(p.pts[i], p.pts[i + 1]);
  }
  const inTable = (b: Box) => tables.some((t) => inside(shrink(b, 0.3), t.box));
  const isBalloonText = (t: DText) => balloons.some((b) => Math.abs(t.x - b.x) < 0.01 && Math.abs(t.y - (b.y + 1.3)) < 0.01 && t.s === String(b.pos));
  // texty listu mimo tabulky (kóty, poznámky, popisky pohledů, odkazy děr …) bez čísel pozic
  const texts = res.texts.filter((t) => t.s.trim() && !isBalloonText(t)).map((t) => ({ t, box: textBox(t) as Box })).filter((x) => !inTable(x.box));

  // ---- balónky
  const R = (b: (typeof balloons)[number]) => b.r ?? 4;
  const bbox = (b: (typeof balloons)[number]): Box => [b.x - R(b), b.y - R(b), b.x + R(b), b.y + R(b)];
  for (let i = 0; i < balloons.length; i++) {
    const b = balloons[i];
    const bx = shrink(bbox(b), 0.3);
    for (let j = i + 1; j < balloons.length; j++) {
      const c = balloons[j];
      if (Math.hypot(b.x - c.x, b.y - c.y) < R(b) + R(c) - 0.3) push("balloon-balloon", union(bbox(b), bbox(c)), `${b.pos} × ${c.pos}`);
    }
    for (const x of texts) if (hit(bx, shrink(x.box, 0.2))) push("balloon-text", union(bbox(b), x.box), `${b.pos} × „${x.t.s}“`);
    for (const t of tables) if (hit(bx, t.box)) push("balloon-table", bbox(b), `${b.pos} × ${t.kind}`);
    if (frame && !inside(bbox(b), frame)) push("balloon-frame", bbox(b), String(b.pos));
    if (geo.near(bx).some(([p, q]) => segmentHitsCircle(p, q, [b.x, b.y], R(b) - 0.2))) push("balloon-geometry", bbox(b), String(b.pos));
    // odkazová čára přes cizí balónek
    const from: Vec2 = [b.x, b.y];
    for (const c of balloons) if (c !== b && segmentHitsCircle(from, b.a!, [c.x, c.y], R(c) - 0.3) && Math.hypot(c.x - b.x, c.y - b.y) > 0.5) push("leader-balloon", bbox(c), `${b.pos} → ${c.pos}`);
  }
  const crossings = countCrossings(balloons.map((b) => ({ x: b.x, y: b.y, a: b.a! })));

  // ---- texty
  for (let i = 0; i < texts.length; i++) {
    const a = shrink(texts[i].box, 0.25);
    for (let j = i + 1; j < texts.length; j++) {
      const b = shrink(texts[j].box, 0.25);
      if (hit(a, b)) push("text-text", union(texts[i].box, texts[j].box), `„${texts[i].t.s}“ × „${texts[j].t.s}“`);
    }
    const g = shrink(texts[i].box, 0.35);
    if (geo.near(g).some(([p, q]) => segInBox(p, q, g))) push("text-geometry", texts[i].box, `„${texts[i].t.s}“`);
    if (frame) {
      const tb = texts[i].box;
      const out = !inside(shrink(tb, 0.3), frame);
      const wholly = tb[2] <= frame[0] || tb[0] >= frame[2] || tb[3] <= frame[1] || tb[1] >= frame[3];
      // celý text v okraji listu (zóny) je záměr; přes čáru rámu ne
      if (out && !(wholly && res.zones)) push("text-frame", tb, `„${texts[i].t.s}“`);
    }
  }
  // ---- tabulky × geometrie pohledů
  for (const t of tables) {
    const g = shrink(t.box, 0.5);
    if (geo.near(g).some(([p, q]) => segInBox(p, q, g))) push("table-geometry", t.box, t.kind);
  }
  const byKind: Partial<Record<OverlapKind, number>> = {};
  for (const h of hits) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
  return { total: hits.length, byKind, hits, crossings, balloons: balloons.length };
}

/** název druhu překryvu pro protokol */
export function overlapKindText(k: OverlapKind): string {
  switch (k) {
    case "balloon-balloon": return tr("balónek × balónek");
    case "balloon-text": return tr("balónek × text");
    case "balloon-table": return tr("balónek × tabulka");
    case "balloon-frame": return tr("balónek × rám");
    case "balloon-geometry": return tr("balónek × geometrie");
    case "leader-balloon": return tr("odkazová čára × balónek");
    case "text-text": return tr("text × text");
    case "text-geometry": return tr("text × geometrie");
    case "table-geometry": return tr("tabulka × pohled");
    case "text-frame": return tr("text × rám");
  }
}

/** rada podle druhů překryvů */
export function overlapAdvice(o: SheetOverlaps): string {
  const k = o.byKind;
  const tips: string[] = [];
  if (k["balloon-balloon"] || k["balloon-text"] || k["balloon-geometry"] || k["leader-balloon"] || k["balloon-table"] || k["balloon-frame"])
    tips.push(tr("rozdělte pozice do pohledů (výkres pozice pohled horní 13-30), posuňte a zamkněte pozici (výkres vygenerované posun pos:7 dx dy · výkres pozice zamknout 7) nebo zvolte větší formát"));
  if (k["table-geometry"]) tips.push(tr("kusovník ve sloupcích nebo na samostatném listu (výkres kusovník sloupce | list) nebo větší formát"));
  if (k["text-text"] || k["text-geometry"] || k["text-frame"]) tips.push(tr("posuňte kótu / poznámku (výkres upravit <id> posun=\"dx dy\" | odsazení=…)"));
  return tips.join("; ");
}

/** „3 (balónek × text 2, text × text 1)“ – počet a druhy */
export function overlapSummary(o: SheetOverlaps): string {
  if (!o.total) return "0";
  return `${o.total} (${OVERLAP_KINDS.filter((k) => o.byKind[k]).map((k) => `${overlapKindText(k)} ${o.byKind[k]}`).join(", ")})`;
}

/** text hlášení ⚠ drawing.overlap pro list (null = bez překryvů) */
export function overlapIssueText(o: SheetOverlaps): string | null {
  if (!o.total) return null;
  const ex = o.hits.slice(0, 3).map((h) => h.what).join("; ");
  return tr("{0} překryvů – {1}; např. {2} – {3}", o.total, OVERLAP_KINDS.filter((k) => o.byKind[k]).map((k) => `${overlapKindText(k)} ${o.byKind[k]}`).join(", "), ex, overlapAdvice(o));
}
