/**
 * Geometrie ťukacího editoru anonymizace (čistý modul): stav oblastí (automatické / ručně přidané /
 * ručně zrušené), přepnutí řádku textové vrstvy jedním ťuknutím, kreslení obdélníku, přiblížení.
 * Souřadnice jsou normalizované 0..1 vůči stránce (stejně jako na serveru).
 */

export interface NBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EdRegion extends NBox {
  id: string;
  page: number;
  category: string;
  source: string;
  quad?: number[];
  text?: string;
  zone?: string;
  /** on = vypálí se; off = ručně zrušená automatická oblast. */
  state: "on" | "off";
  /** Ručně přidaná (zrušením zmizí úplně). */
  added?: boolean;
}

export interface ServerRegion extends NBox {
  id: string;
  page: number;
  category: string;
  source: string;
  quad?: number[];
  text?: string;
  zone?: string;
  manual?: "added" | "removed";
}

export interface EdLine extends NBox {
  id: string;
  text: string;
  zone: string;
  /** Chráněné pole (číslo výkresu, revize, materiál, název…) podle pravidel serveru. */
  keep?: boolean;
}

/** Chráněné pole ze serveru (normalizovaně). */
export interface KeepBoxN extends NBox {
  field: string;
}

/** Oblasti ze serveru → stav editoru. */
export function fromServer(regions: readonly ServerRegion[]): EdRegion[] {
  return regions.map((r) => ({
    id: r.id, page: r.page, x: r.x, y: r.y, w: r.w, h: r.h, category: r.category, source: r.manual === "added" ? "manual" : r.source,
    ...(r.quad ? { quad: r.quad } : {}), ...(r.text ? { text: r.text } : {}), ...(r.zone ? { zone: r.zone } : {}),
    state: r.manual === "removed" ? "off" : "on", ...(r.manual === "added" ? { added: true } : {}),
  }));
}

/** Stav editoru → ruční sada pro PUT (manual: added | removed). */
export function toManualSet(items: readonly EdRegion[]): ServerRegion[] {
  const out: ServerRegion[] = [];
  for (const r of items) {
    const base = { id: r.id, page: r.page, x: r.x, y: r.y, w: r.w, h: r.h, category: r.category, source: "manual", ...(r.quad ? { quad: r.quad } : {}) };
    if (r.added && r.state === "on") out.push({ ...base, manual: "added" });
    else if (!r.added && r.state === "off") out.push({ ...base, manual: "removed" });
  }
  return out;
}

/** Počet změn proti serveru: +přidané, −zrušené. */
export function diffCounts(items: readonly EdRegion[], initial: readonly EdRegion[]): { added: number; removed: number } {
  const init = new Map(initial.map((r) => [r.id, r]));
  let added = 0, removed = 0;
  for (const r of items) {
    const was = init.get(r.id);
    if (!was) { if (r.state === "on") added++; continue; }
    if (was.state !== r.state) { if (r.state === "on") added++; else removed++; }
  }
  for (const w of initial) if (w.added && !items.some((r) => r.id === w.id)) removed++;
  return { added, removed };
}

export function area(b: NBox): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function intersect(a: NBox, b: NBox): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Podíl řádku pokrytý oblastí. */
export function coverage(line: NBox, r: NBox): number {
  const a = area(line);
  return a > 0 ? intersect(line, r) / a : 0;
}

export const LINE_COVER = 0.3;

/** Je řádek smazaný (pokrývá ho zapnutá oblast)? */
export function lineState(line: EdLine, items: readonly EdRegion[], page: number): "on" | "off" | "none" {
  const hits = items.filter((r) => r.page === page && coverage(line, r) >= LINE_COVER);
  if (hits.some((r) => r.state === "on")) return "on";
  if (hits.length) return "off";
  return "none";
}

/** Popisky keep polí (číslo výkresu, materiál, revize…) — smazání vyžaduje potvrzení. */
const KEEP_RE = /(č[ií]slo\s+v[ýy]kresu|drawing\s*(no|number)|zeichnungs|materi[aá]l|werkstoff|revize|revision|rev\.|index|měřítko|meritko|scale|ma(ß|ss)stab|hmotnost|weight|gewicht|tolerance|toleranz|drsnost|ra\s*\d|ø|±|\bh\d|\bH\d|iso\s*\d|din\s*\d|čsn|csn|en\s*\d)/iu;

export function needsKeepConfirm(line: Pick<EdLine, "text" | "zone"> & { keep?: boolean }): boolean {
  return Boolean(line.keep) || KEEP_RE.test(line.text);
}

/** Zasahuje obdélník do chráněného pole (keep box ze serveru nebo řádek s keep / technickým textem)? */
export function touchesKeep(box: NBox, keep: readonly KeepBoxN[], lines: readonly EdLine[]): boolean {
  if (keep.some((k) => intersect(box, k) > 0)) return true;
  return lines.some((l) => needsKeepConfirm(l) && coverage(l, box) >= LINE_COVER);
}

/** Obal oblastí dané strany s rezervou (výřez náhledu „před / po" kolem smazaného). */
export function regionsBox(regions: readonly (NBox & { page: number })[], page: number, pad = 0.03): NBox | null {
  const rs = regions.filter((r) => r.page === page && r.w > 0 && r.h > 0);
  if (!rs.length) return null;
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return clampBox({ x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad });
}

/** Posun okna po přiblížení tak, aby bod pod prsty (podíl obsahu) zůstal na stejném místě okna. */
export function anchorScroll(mid: { x: number; y: number }, size: { w: number; h: number }, offset: { x: number; y: number }): { left: number; top: number } {
  return { left: Math.max(0, mid.x * size.w - offset.x), top: Math.max(0, mid.y * size.h - offset.y) };
}

/** Přiblížení na razítko podle skutečné velikosti okna náhledu (celé razítko vidět, 5 % rezerva). */
export function stampZoom(b: NBox, fitW: number, aspect: number, clientW: number, clientH: number): number {
  const w = Math.max(0.01, b.w), h = Math.max(0.01, b.h);
  return clampZoom(Math.min(clientW / (fitW * w), clientH / ((fitW / Math.max(0.1, aspect)) * h)) * 0.95);
}

/** Texty oblastí bez opakování („J. Novák · J. Novák" → „J. Novák"). */
export function uniqueText(texts: readonly (string | null | undefined)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    const v = String(t ?? "").replace(/\s+/g, " ").trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out.join(" · ");
}

let seq = 0;
export function newId(prefix = "m"): string {
  seq = (seq + 1) % 1e6;
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rnd}${seq}`;
}

/** Rezerva kolem řádku (normalizovaně, ~ 0,15 výšky řádku). */
export function padLine(b: NBox, k = 0.15): NBox {
  const d = Math.max(0.0005, b.h * k);
  return clampBox({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
}

export function clampBox(b: NBox): NBox {
  const x = Math.max(0, Math.min(1, b.x)), y = Math.max(0, Math.min(1, b.y));
  return { x, y, w: Math.max(0, Math.min(1 - x, b.w - (x - b.x))), h: Math.max(0, Math.min(1 - y, b.h - (y - b.y))) };
}

/**
 * Jedno ťuknutí na řádek: smazaný → nechat (vypne pokrývající oblasti, ručně přidané zmizí);
 * nesmazaný → smazat (zapne dřív zrušené, jinak přidá ruční oblast přes řádek).
 * S `lines`: oblast sloučená přes víc řádků se vypne, ale ostatní smazané řádky pod ní dostanou
 * vlastní ruční oblast — odkryje se jen ťuknutý řádek.
 */
export function toggleLine(items: readonly EdRegion[], line: EdLine, page: number, lines: readonly EdLine[] = []): EdRegion[] {
  const st = lineState(line, items, page);
  const coversLine = (l: NBox) => (r: EdRegion) => r.page === page && coverage(l, r) >= LINE_COVER;
  const covers = coversLine(line);
  if (st === "on") {
    const off = items.filter((r) => covers(r) && r.state === "on");
    let next = items.flatMap((r) => (covers(r) && r.state === "on" ? (r.added ? [] : [{ ...r, state: "off" as const }]) : [r]));
    // sousední řádky, které byly smazané jen díky vypnuté (sloučené) oblasti → zachovat ručně
    for (const other of lines) {
      if (other.id === line.id || !off.some(coversLine(other))) continue;
      if (lineState(other, items, page) !== "on" || lineState(other, next, page) === "on") continue;
      const own = padLine(other);
      // ruční oblast nesmí přesahovat do ťuknutého řádku
      if (coverage(line, own) >= LINE_COVER) continue;
      const src = off.find(coversLine(other));
      next = [...next, { id: newId(), page, ...own, category: src?.category ?? "other", source: "manual", state: "on", added: true }];
    }
    return next;
  }
  if (st === "off") return items.map((r) => (covers(r) ? { ...r, state: "on" as const } : r));
  return [...items, { id: newId(), page, ...padLine(line), category: "other", source: "manual", state: "on", added: true }];
}

/** Ťuknutí na oblast (seznam / obdélník): přepnout. */
export function toggleRegion(items: readonly EdRegion[], id: string): EdRegion[] {
  return items.flatMap((r) => (r.id !== id ? [r] : r.added ? [] : [{ ...r, state: r.state === "on" ? ("off" as const) : ("on" as const) }]));
}

/** Obdélník z tažení (dva body 0..1), minimum 0,4 % strany. */
export function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, min = 0.004): NBox | null {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
  if (w < min || h < min) return null;
  return clampBox({ x, y, w, h });
}

export function addRect(items: readonly EdRegion[], box: NBox, page: number, category = "other"): EdRegion[] {
  return [...items, { id: newId(), page, ...clampBox(box), category, source: "manual", state: "on", added: true }];
}

/** Řádek pod bodem (nejmenší, který bod obsahuje, s tolerancí pro prst). */
export function lineAt(lines: readonly EdLine[], p: { x: number; y: number }, tol = 0.004): EdLine | null {
  let best: EdLine | null = null;
  for (const l of lines) {
    if (p.x < l.x - tol || p.x > l.x + l.w + tol || p.y < l.y - tol || p.y > l.y + l.h + tol) continue;
    if (!best || area(l) < area(best)) best = l;
  }
  return best;
}

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;

export function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1));
}

/** Přiblížení dvěma prsty: poměr vzdáleností. */
export function pinchZoom(start: number, d0: number, d1: number): number {
  if (!(d0 > 0)) return clampZoom(start);
  return clampZoom(start * (d1 / d0));
}

/** Oblast razítka (obal oblastí / řádků v pravém dolním rohu, jinak pravý dolní kvadrant). */
export function titleBlockBox(items: readonly { x: number; y: number; w: number; h: number; zone?: string }[]): NBox {
  const tb = items.filter((r) => r.zone === "title_block");
  if (!tb.length) return { x: 0.5, y: 0.65, w: 0.5, h: 0.35 };
  const x0 = Math.min(...tb.map((r) => r.x)), y0 = Math.min(...tb.map((r) => r.y));
  const x1 = Math.max(...tb.map((r) => r.x + r.w)), y1 = Math.max(...tb.map((r) => r.y + r.h));
  return clampBox({ x: x0 - 0.02, y: y0 - 0.02, w: x1 - x0 + 0.04, h: y1 - y0 + 0.04 });
}

/** Přiblížení na rámeček: zoom a posun (v podílech obsahu) tak, aby byl box celý vidět. */
export function zoomToBox(b: NBox, aspect = 1): { zoom: number; cx: number; cy: number } {
  const z = clampZoom(Math.min(1 / Math.max(b.w, 0.01), aspect / Math.max(b.h, 0.01)));
  return { zoom: z, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}
