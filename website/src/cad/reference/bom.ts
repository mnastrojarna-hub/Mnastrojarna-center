/**
 * Kusovník předlohy: tabulka z textů a svislých čar mřížky – z objektu AutoCAD Mechanical ACMPARTLIST (náhradní
 * grafika: čáry a texty buněk) nebo obecně (hlavička s „Poz“ / „Pos“ / „Item“ a „Ks“ / „Qty“ / „Název“ …).
 */
import type { Vec2 } from "../draft/model";
import type { RefBom, RefBomRow, RefBox } from "./types";

export type TText = { s: string; p: Vec2; h: number; id?: string };

const POS_RE = /^(poz\.?|pozice|pos\.?|position|item|položka|polozka|č\.|c\.)$/i;
const QTY_RE = /^(ks|kus[ůu]?|qty|quantity|množství|mnozstvi|počet|pocet|menge|stk\.?|anz\.?|anzahl)$/i;
const NAME_RE = /^(název|nazev|name|benennung|bezeichnung|description|popis|označení|oznaceni)$/i;
/** sloupec → pole řádku */
const FIELDS: [keyof RefBomRow, RegExp][] = [
  ["pos", POS_RE],
  ["qty", QTY_RE],
  ["name", NAME_RE],
  ["std", /^(norma.*|standard|norm|polotovar.*|halbzeug)$/i],
  ["material", /^(mat.*|materi[aá]l.*|werkstoff.*)$/i],
  ["dim", /^(.*rozm[eě]r.*|dimension|abmessung.*|size)$/i],
  ["mass", /^(hmot.*|mass|weight|gewicht|masse)$/i],
  ["note", /^(pozn.*|note.*|remark.*|bemerkung.*)$/i],
];

/** je to hlavička kusovníku? (pozice + počet nebo název) */
export function isBomHeader(cells: string[]): boolean {
  return cells.some((c) => POS_RE.test(c.trim())) && cells.some((c) => QTY_RE.test(c.trim()) || NAME_RE.test(c.trim()));
}

/** shluky řádků podle y (tolerance podle výšky textu) – od shora */
function rowsOf(texts: TText[]): TText[][] {
  const sorted = [...texts].sort((a, b) => b.p[1] - a.p[1]);
  const rows: TText[][] = [];
  for (const t of sorted) {
    const r = rows[rows.length - 1];
    if (r && Math.abs(r[0].p[1] - t.p[1]) <= 0.6 * Math.max(t.h, r[0].h)) r.push(t);
    else rows.push([t]);
  }
  for (const r of rows) r.sort((a, b) => a.p[0] - b.p[0]);
  return rows;
}

/**
 * Tabulka z textů: hlavička (řádek s „Poz“ a „Ks“ / „Název“), sloupce podle svislých čar mřížky (`vx`), jinak podle
 * poloh textů hlavičky. Vrací null, když hlavička není.
 */
export function tableFromTexts(texts: TText[], vx: number[] = []): { header: string[]; rows: Record<string, string>[] } | null {
  const rows = rowsOf(texts.filter((t) => t.s.trim()));
  const hi = rows.findIndex((r) => isBomHeader(r.map((t) => t.s)));
  if (hi < 0) return null;
  const hdr = rows[hi];
  const edges = [...new Set(vx.map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
  const h0 = hdr[0].h || 2.5;
  // sloupec textu: poslední svislá čára vlevo od textu (buňky zarovnané vlevo i na střed); bez čar nejbližší text hlavičky vlevo
  const colOf = (x: number): number => {
    if (edges.length >= 2) {
      let c = -1;
      for (let i = 0; i < edges.length; i++) if (x >= edges[i] - 0.05 * h0) c = i;
      return c;
    }
    let c = 0;
    let bd = Infinity;
    hdr.forEach((t, i) => {
      const d = Math.abs(t.p[0] - x);
      if (t.p[0] <= x + h0 && d < bd) {
        bd = d;
        c = i;
      }
    });
    return c;
  };
  const header: string[] = [];
  const colName = new Map<number, string>();
  for (const t of hdr) {
    const c = colOf(t.p[0]);
    const prev = colName.get(c);
    colName.set(c, prev ? `${prev} ${t.s.trim()}` : t.s.trim());
  }
  for (const [, n] of [...colName].sort((a, b) => a[0] - b[0])) header.push(n);
  const out: Record<string, string>[] = [];
  rows.forEach((r, i) => {
    if (i === hi) return;
    const rec: Record<string, string> = {};
    for (const t of r) {
      const name = colName.get(colOf(t.p[0])) ?? `#${colOf(t.p[0])}`;
      rec[name] = rec[name] ? `${rec[name]} ${t.s.trim()}` : t.s.trim();
    }
    if (Object.keys(rec).length) out.push(rec);
  });
  return { header, rows: out };
}

/** řádky tabulky → řádky kusovníku (pozice číslem, počet, název, norma, materiál, rozměr, hmotnost, poznámka) */
export function bomRows(t: { header: string[]; rows: Record<string, string>[] }): RefBomRow[] {
  const map = new Map<string, keyof RefBomRow>();
  for (const h of t.header) {
    const f = FIELDS.find(([, re]) => re.test(h.trim()));
    if (f && ![...map.values()].includes(f[0])) map.set(h, f[0]);
  }
  const posCol = [...map].find(([, f]) => f === "pos")?.[0];
  const out: RefBomRow[] = [];
  for (const r of t.rows) {
    const pos = posCol ? r[posCol] : undefined;
    if (!pos || !/^\d{1,4}[a-z]?$/i.test(pos.trim())) continue; // nadpis tabulky („Kusovník“), prázdný řádek
    const row: RefBomRow = { pos: pos.trim(), cells: r };
    for (const [h, f] of map) {
      const v = r[h];
      if (v === undefined || f === "pos" || f === "cells") continue;
      if (f === "qty") {
        const q = parseFloat(v.replace(",", "."));
        if (Number.isFinite(q)) row.qty = q;
      } else (row as Record<string, unknown>)[f] = v;
    }
    out.push(row);
  }
  return out.sort((a, b) => parseFloat(a.pos) - parseFloat(b.pos) || a.pos.localeCompare(b.pos));
}

/**
 * Obecný kusovník na listu: hlavička + souvislé řádky nad ní nebo pod ní, které mají číslo pozice. Vrací tabulku,
 * její obdélník a použité texty (do poznámek ani pohledů nepatří).
 */
export function findTable(texts: TText[], vlines: { x: number; y0: number; y1: number }[], sheet: number): { bom: RefBom; box: RefBox; used: Set<TText> } | null {
  const rows = rowsOf(texts.filter((t) => t.s.trim()));
  const hi = rows.findIndex((r) => isBomHeader(r.map((t) => t.s)));
  if (hi < 0) return null;
  const hdr = rows[hi];
  const h = hdr[0].h || 2.5;
  const posT = hdr.find((t) => POS_RE.test(t.s.trim()))!;
  const x0 = Math.min(...hdr.map((t) => t.p[0])) - 3 * h;
  const x1 = Math.max(...hdr.map((t) => t.p[0])) + 40 * h;
  const inX = (t: TText) => t.p[0] >= x0 && t.p[0] <= x1;
  const hasPos = (r: TText[]) => r.some((t) => /^\d{1,4}[a-z]?$/i.test(t.s.trim()) && Math.abs(t.p[0] - posT.p[0]) <= 3 * h);
  const keep: TText[][] = [hdr.filter(inX)];
  for (const dir of [-1, 1]) {
    let prevY = hdr[0].p[1];
    for (let i = hi + dir; i >= 0 && i < rows.length; i += dir) {
      const r = rows[i].filter(inX);
      if (!r.length) continue;
      if (Math.abs(prevY - r[0].p[1]) > 6 * h || !hasPos(r)) break;
      keep.push(r);
      prevY = r[0].p[1];
    }
  }
  const used = new Set(keep.flat());
  const all = [...used];
  const box: RefBox = { x0: Math.min(...all.map((t) => t.p[0])) - h, y0: Math.min(...all.map((t) => t.p[1])) - h, x1: Math.max(...all.map((t) => t.p[0] + t.s.length * 0.7 * t.h)) + h, y1: Math.max(...all.map((t) => t.p[1] + t.h)) + h };
  const vx = vlines.filter((l) => l.x >= box.x0 - h && l.x <= box.x1 + h && Math.min(l.y1, box.y1) - Math.max(l.y0, box.y0) > 0.5 * h).map((l) => l.x);
  const t = tableFromTexts(all, vx);
  if (!t) return null;
  // obdélník tabulky i s mřížkou
  if (vx.length) {
    box.x0 = Math.min(box.x0, ...vx);
    box.x1 = Math.max(box.x1, ...vx);
  }
  return { bom: { sheet, header: t.header, rows: bomRows(t), source: "table" }, box, used };
}
