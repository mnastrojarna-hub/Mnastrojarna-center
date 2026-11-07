/**
 * 2D výkres (DXF / DWG převedený na `Drawing2D`) → vektorové PDF na jednom listu formátu A.
 *
 * Kreslí totéž, co prohlížeč: čáry, polyčáry s oblouky (bulge), kružnice a oblouky (Bézierovy křivky),
 * elipsy, spliny, body a texty včetně čísel kót (viz ./dimension). Barvy hladin a entit jako
 * v prohlížeči na světlém pozadí (barva 7 černá, světlé barvy ztmavené), vypnuté hladiny se nekreslí.
 * List A4 – A0 na výšku / na šířku podle poměru stran a velikosti výkresu (nejmenší, na který se výkres
 * vejde 1 : 1), výkres zvětšený / zmenšený na celou plochu listu; dole drobná patička se zdrojovým
 * souborem a datem. Písmo Roboto vložené celé (čeština, Ø, °, ± — text jde v PDF hledat a kopírovat,
 * anonymizace PDF ho čte). Čistý modul (Node i prohlížeč) — písmo předává volající.
 */
import {
  LineCapStyle, LineJoinStyle, PDFDocument, appendBezierCurve, closePath, degrees, lineTo, moveTo, popGraphicsState, pushGraphicsState,
  rgb, setLineCap, setLineJoin, setLineWidth, setStrokingRgbColor, stroke, type PDFFont, type PDFOperator, type PDFPage,
} from "pdf-lib";
import * as fontkit from "fontkit";
import { bulgeArc, displayColor, textBounds } from "./drawing-model";
import type { DrawColor, DrawEntity, Drawing2D, Pt } from "./drawing2d";

const MM = 72 / 25.4;
const TAU = Math.PI * 2;
/** Formáty A (mm, kratší × delší strana). */
const SHEETS: [string, number, number][] = [["A4", 210, 297], ["A3", 297, 420], ["A2", 420, 594], ["A1", 594, 841], ["A0", 841, 1189]];
const MARGIN = 10;
const FOOTER = 6;
/** Tloušťka čar (pt) — jako tenká čára výkresu (~0,18 mm). */
const LINE_PT = 0.5;

export interface DrawingPdfOptions {
  /** Roboto-Regular.ttf (bajty). */
  font: Uint8Array;
  /** Název zdrojového souboru (patička, metadata). */
  sourceName: string;
  date?: Date;
}

export interface DrawingPdfResult {
  bytes: Uint8Array;
  /** Formát listu, např. „A3 na šířku". */
  sheet: string;
  /** Měřítko výkresu na listu (1 = 1 : 1). */
  scale: number;
  /** Počet nakreslených prvků / textů. */
  entities: number;
  texts: number;
}

/** Výkres je prázdný (nic k převodu) — srozumitelná chyba pro uživatele. */
export class EmptyDrawingError extends Error {
  constructor() {
    super("Výkres je prázdný — není co převést do PDF.");
    this.name = "EmptyDrawingError";
  }
}

type Bounds = [number, number, number, number];

function textOf(e: Extract<DrawEntity, { kind: "text" }>) {
  return { part: 0, x: e.p[0], y: e.p[1], text: e.text, height: e.height, rotation: e.rotation, hAlign: e.hAlign, vAlign: e.vAlign, width: e.width, color: null };
}

/** Rozsah viditelných prvků výkresu (mm). */
export function drawingBounds(entities: DrawEntity[]): Bounds | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const acc = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  };
  for (const e of entities) {
    switch (e.kind) {
      case "line": acc(...e.a); acc(...e.b); break;
      case "polyline": {
        for (const p of e.points) acc(...p);
        // oblouky polyčáry mohou vybočit z vrcholů
        const n = e.points.length;
        for (let i = 0; i < (e.closed ? n : n - 1); i++) {
          const a = bulgeArc(e.points[i], e.points[(i + 1) % n], e.bulges?.[i] ?? 0);
          if (a) { acc(a.c[0] - a.r, a.c[1] - a.r); acc(a.c[0] + a.r, a.c[1] + a.r); }
        }
        break;
      }
      case "circle":
      case "arc": acc(e.c[0] - e.r, e.c[1] - e.r); acc(e.c[0] + e.r, e.c[1] + e.r); break;
      case "ellipse": {
        const r = Math.hypot(e.major[0], e.major[1]);
        acc(e.c[0] - r, e.c[1] - r);
        acc(e.c[0] + r, e.c[1] + r);
        break;
      }
      case "curve": for (const p of e.points) acc(...p); break;
      case "point": acc(...e.p); break;
      case "text": {
        const [a, b, c, d] = textBounds(textOf(e));
        acc(a, b);
        acc(c, d);
        break;
      }
    }
  }
  return x1 >= x0 && y1 >= y0 ? [x0, y0, x1, y1] : null;
}

/** Nejmenší list A4 – A0, na který se výkres w × h mm vejde 1 : 1 (jinak A0); orientace podle poměru stran. */
export function chooseSheet(w: number, h: number): { name: string; width: number; height: number; landscape: boolean } {
  const landscape = w >= h;
  for (const [name, a, b] of SHEETS) {
    const pw = landscape ? b : a;
    const ph = landscape ? a : b;
    if (w <= pw - 2 * MARGIN && h <= ph - 2 * MARGIN - FOOTER) return { name, width: pw, height: ph, landscape };
  }
  const [name, a, b] = SHEETS[SHEETS.length - 1];
  return { name, width: landscape ? b : a, height: landscape ? a : b, landscape };
}

/** Oblouk proti směru hodin a0 → a1 jako Bézierovy křivky (úseky ≤ 90°). */
function arcOps(c: Pt, r: number, a0: number, a1: number, T: (p: Pt) => Pt, first: boolean): PDFOperator[] {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += TAU;
  if (sweep > TAU) sweep = TAU;
  const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const ops: PDFOperator[] = [];
  let a = a0;
  const at = (t: number): Pt => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
  if (first) ops.push(moveTo(...T(at(a))));
  for (let i = 0; i < n; i++) {
    const b = a + step;
    const p0 = at(a);
    const p3 = at(b);
    const c1: Pt = [p0[0] - k * r * Math.sin(a), p0[1] + k * r * Math.cos(a)];
    const c2: Pt = [p3[0] + k * r * Math.sin(b), p3[1] - k * r * Math.cos(b)];
    ops.push(appendBezierCurve(...T(c1), ...T(c2), ...T(p3)));
    a = b;
  }
  return ops;
}

/** Oblouk po směru hodin (z a0 klesajícím úhlem do a1). */
function arcOpsCw(c: Pt, r: number, a0: number, a1: number, T: (p: Pt) => Pt): PDFOperator[] {
  let sweep = a0 - a1;
  while (sweep <= 0) sweep += TAU;
  const n = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
  const step = sweep / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const ops: PDFOperator[] = [];
  let a = a0;
  const at = (t: number): Pt => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
  for (let i = 0; i < n; i++) {
    const b = a - step;
    const p0 = at(a);
    const p3 = at(b);
    const c1: Pt = [p0[0] + k * r * Math.sin(a), p0[1] - k * r * Math.cos(a)];
    const c2: Pt = [p3[0] - k * r * Math.sin(b), p3[1] + k * r * Math.cos(b)];
    ops.push(appendBezierCurve(...T(c1), ...T(c2), ...T(p3)));
    a = b;
  }
  return ops;
}

function pathOps(e: DrawEntity, T: (p: Pt) => Pt): PDFOperator[] {
  switch (e.kind) {
    case "line":
      return [moveTo(...T(e.a)), lineTo(...T(e.b))];
    case "polyline": {
      const n = e.points.length;
      if (n < 2) return [];
      const ops: PDFOperator[] = [moveTo(...T(e.points[0]))];
      const segs = e.closed ? n : n - 1;
      for (let i = 0; i < segs; i++) {
        const p1 = e.points[i];
        const p2 = e.points[(i + 1) % n];
        const arc = bulgeArc(p1, p2, e.bulges?.[i] ?? 0);
        if (!arc) ops.push(lineTo(...T(p2)));
        else if (arc.ccw) ops.push(...arcOps(arc.c, arc.r, arc.a0, arc.a1, T, false));
        else ops.push(...arcOpsCw(arc.c, arc.r, arc.a0, arc.a1, T));
      }
      if (e.closed) ops.push(closePath());
      return ops;
    }
    case "circle":
      return e.r > 0 ? [...arcOps(e.c, e.r, 0, TAU, T, true), closePath()] : [];
    case "arc":
      return e.r > 0 ? arcOps(e.c, e.r, e.start, e.end, T, true) : [];
    case "ellipse": {
      let a1 = e.end;
      if (a1 <= e.start) a1 += TAU;
      const n = Math.max(16, Math.ceil(((a1 - e.start) / TAU) * 128));
      const ops: PDFOperator[] = [];
      for (let i = 0; i <= n; i++) {
        const t = e.start + ((a1 - e.start) * i) / n;
        const p: Pt = [e.c[0] + e.major[0] * Math.cos(t) - e.major[1] * e.ratio * Math.sin(t), e.c[1] + e.major[1] * Math.cos(t) + e.major[0] * e.ratio * Math.sin(t)];
        ops.push(i === 0 ? moveTo(...T(p)) : lineTo(...T(p)));
      }
      return ops;
    }
    case "curve": {
      if (e.points.length < 2) return [];
      const ops: PDFOperator[] = e.points.map((p, i) => (i === 0 ? moveTo(...T(p)) : lineTo(...T(p))));
      if (e.closed) ops.push(closePath());
      return ops;
    }
    case "point": {
      const [x, y] = T(e.p);
      const s = 1.2;
      return [moveTo(x - s, y), lineTo(x + s, y), moveTo(x, y - s), lineTo(x, y + s)];
    }
    default:
      return [];
  }
}

/** Řádky textu: \n, u MTEXT se šířkou zalomení po slovech. */
function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number | null): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\t/g, " ").split("\n")) {
    if (!maxWidth || maxWidth <= 0 || font.widthOfTextAtSize(raw, size) <= maxWidth * 1.02) {
      out.push(raw);
      continue;
    }
    let line = "";
    for (const word of raw.split(/(\s+)/)) {
      const next = line + word;
      if (line.trim() && font.widthOfTextAtSize(next.trimEnd(), size) > maxWidth * 1.02) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Znaky, které písmo nemá (např. čínské texty) → otazník, ať se text vysází bez výjimky. */
function encodable(set: ReadonlySet<number>, s: string): string {
  let ok = true;
  for (const ch of s) if (ch !== "\n" && !set.has(ch.codePointAt(0)!)) { ok = false; break; }
  if (ok) return s;
  return Array.from(s, (ch) => (set.has(ch.codePointAt(0)!) || ch === " " || ch === "\n" ? ch : "?")).join("");
}

function drawText(page: PDFPage, font: PDFFont, charset: ReadonlySet<number>, e: Extract<DrawEntity, { kind: "text" }>, T: (p: Pt) => Pt, s: number) {
  const em = (e.height / 0.711) * s; // velikost písma (pt): výška velkých písmen Roboto ≈ 0,711 em
  if (!(em > 0) || !Number.isFinite(em)) return;
  const size = Math.max(0.5, em);
  const lines = wrapLines(encodable(charset, e.text), font, size, e.width ? e.width * s : null);
  const lh = size * 1.35;
  const n = lines.length;
  // účaří prvního řádku vůči bodu vložení (svisle, v rámci textu); stejné kotvy jako prohlížeč (troika)
  const top0 = -size * 1.02; // horní okraj řádku → účaří
  let first: number;
  if (e.vAlign === "baseline") first = 0;
  else if (e.vAlign === "top") first = top0;
  else if (e.vAlign === "bottom") first = (n - 1) * lh + size * 0.33;
  else first = (n * lh) / 2 + top0;
  const [ox, oy] = T(e.p);
  const cos = Math.cos(e.rotation);
  const sin = Math.sin(e.rotation);
  const color = displayColor(e.color, false);
  lines.forEach((line, i) => {
    if (!line) return;
    const w = font.widthOfTextAtSize(line, size);
    const dx = e.hAlign === "center" ? -w / 2 : e.hAlign === "right" ? -w : 0;
    const dy = first - i * lh;
    page.drawText(line, {
      x: ox + dx * cos - dy * sin, y: oy + dx * sin + dy * cos, size, font, color: rgb(color[0], color[1], color[2]),
      rotate: degrees((e.rotation * 180) / Math.PI),
    });
  });
}

function colorKey(c: DrawColor): string {
  return c === "fg" ? "fg" : c.map((v) => v.toFixed(3)).join(",");
}

function fmtScale(s: number): string {
  const f = (v: number) => (v >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toString().replace(".", ","));
  if (Math.abs(s - 1) < 0.005) return "1:1";
  return s < 1 ? `1:${f(1 / s)}` : `${f(s)}:1`;
}

function czDate(d: Date): string {
  return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`;
}

/** Výkres → PDF (jeden list). */
export async function drawingToPdf(d: Drawing2D, opts: DrawingPdfOptions): Promise<DrawingPdfResult> {
  const off = new Set(d.layers.filter((l) => l.off).map((l) => l.name));
  const entities = d.entities.filter((e) => !off.has(e.layer));
  const b = drawingBounds(entities);
  if (!b) throw new EmptyDrawingError();
  const w = Math.max(b[2] - b[0], 1e-6);
  const h = Math.max(b[3] - b[1], 1e-6);
  const sheet = chooseSheet(w, h);
  const availW = sheet.width - 2 * MARGIN;
  const availH = sheet.height - 2 * MARGIN - FOOTER;
  const scale = Math.min(availW / w, availH / h);
  const s = scale * MM; // pt na mm výkresu
  const offX = (MARGIN + (availW - w * scale) / 2) * MM;
  const offY = (MARGIN + FOOTER + (availH - h * scale) / 2) * MM;
  const T = (p: Pt): Pt => [offX + (p[0] - b[0]) * s, offY + (p[1] - b[1]) * s];

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit as unknown as Parameters<PDFDocument["registerFontkit"]>[0]);
  // celé písmo (podmnožina z fontkit 2 v pdf-lib nejde) — ~280 kB, čeština i Ø ° ± jistě
  const font = await doc.embedFont(opts.font, { subset: false });
  const page = doc.addPage([sheet.width * MM, sheet.height * MM]);
  const base = opts.sourceName.replace(/\.[^.]+$/, "");
  doc.setTitle(base || opts.sourceName);
  doc.setSubject(`Výkres převedený z ${opts.sourceName}`);
  doc.setCreator("Mnástrojárna — převod výkresu DXF / DWG");
  doc.setProducer("Mnástrojárna");
  const date = opts.date ?? new Date();
  doc.setCreationDate(date);
  doc.setModificationDate(date);

  // čáry po barvách (méně přepínání stavu); texty navrch
  const byColor = new Map<string, { color: DrawColor; ops: PDFOperator[] }>();
  let drawn = 0;
  for (const e of entities) {
    if (e.kind === "text") continue;
    const ops = pathOps(e, T);
    if (!ops.length) continue;
    const key = colorKey(e.color);
    let g = byColor.get(key);
    if (!g) {
      g = { color: e.color, ops: [] };
      byColor.set(key, g);
    }
    for (const op of ops) g.ops.push(op);
    drawn++;
    // dlouhé cesty průběžně tahem (velké výkresy)
    if (g.ops.length > 50_000) {
      flush(page, g);
      g.ops = [];
    }
  }
  for (const g of byColor.values()) flush(page, g);

  let texts = 0;
  const charset = new Set(font.getCharacterSet());
  for (const e of entities) {
    if (e.kind !== "text" || !e.text.trim()) continue;
    drawText(page, font, charset, e, T, s);
    texts++;
  }

  // patička
  const grey = rgb(0.42, 0.43, 0.44);
  const fs = 7;
  const left = encodable(charset, opts.sourceName);
  page.drawText(left, { x: MARGIN * MM, y: (MARGIN - 1) * MM, size: fs, font, color: grey });
  const right = `Převedeno do PDF ${czDate(date)} · ${sheet.name} · měřítko ≈ ${fmtScale(scale)}`;
  page.drawText(right, { x: (sheet.width - MARGIN) * MM - font.widthOfTextAtSize(right, fs), y: (MARGIN - 1) * MM, size: fs, font, color: grey });

  const bytes = await doc.save();
  return {
    bytes, sheet: `${sheet.name} ${sheet.landscape ? "na šířku" : "na výšku"}`, scale, entities: drawn, texts,
  };
}

function flush(page: PDFPage, g: { color: DrawColor; ops: PDFOperator[] }) {
  if (!g.ops.length) return;
  const c = displayColor(g.color, false);
  page.pushOperators(pushGraphicsState(), setLineWidth(LINE_PT), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round), setStrokingRgbColor(c[0], c[1], c[2]));
  // po kouscích (rozbalení velkého pole do argumentů by přeteklo zásobník)
  for (let i = 0; i < g.ops.length; i += 10_000) page.pushOperators(...g.ops.slice(i, i + 10_000));
  page.pushOperators(stroke(), popGraphicsState());
}
