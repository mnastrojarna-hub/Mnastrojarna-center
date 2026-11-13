/**
 * Vektorové čáry stránky PDF → entity skici (čistá logika bez DOM, testováno v pdf-vector.test.ts).
 *
 * Vstupem je seznam operátorů stránky z pdf.js (`page.getOperatorList()`): cesty (`constructPath` s daty moveTo /
 * lineTo / curveTo / closePath a způsobem vykreslení), změny transformace (`transform`, `save` / `restore`) a vnořené
 * formuláře. Výstupem jsou cesty v souřadnicích stránky [body PDF = 1/72 palce, počátek vlevo nahoře, osa Y dolů –
 * stejně jako bitmapa stránky vykreslená v měřítku 1] a z nich entity skici: úsečky, lomené čáry, oblouky a kružnice
 * (Bézierovy křivky ležící na kružnici – tak PDF zapisuje oblouky z CADu) a ostatní křivky jako spline.
 * Text psaný písmem a vložené obrázky nejsou cesty, do skici se nepřevádějí.
 */
import { circleFrom3 } from "./sketch";
import { uid, type SketchEntity, type Vec2 } from "./types";

/** Afinní transformace `[a, b, c, d, e, f]`: x' = a·x + c·y + e, y' = b·x + d·y + f (jako v PDF a v canvasu). */
export type Mat = [number, number, number, number, number, number];
/** Úsek cesty: úsečka do `b`, nebo kubická Bézierova křivka (řídicí body `c1`, `c2`) do `b`. */
export type PdfSeg = { k: "L"; b: Vec2 } | { k: "C"; c1: Vec2; c2: Vec2; b: Vec2 };
/** Jedna souvislá cesta stránky (`stroke` = kreslená čarou, `fill` = vyplněná). */
export type PdfPath = { start: Vec2; segs: PdfSeg[]; closed: boolean; stroke: boolean; fill: boolean };
/** Seznam operátorů stránky z pdf.js. */
export type PdfOpList = { fnArray: ArrayLike<number>; argsArray: ArrayLike<unknown> };

/** nejvíc entit vložených jedním převodem (delší seznam se zkrátí na nejdelší čáry – skicář by jinak byl pomalý) */
export const PDF_ENTITY_MAX = 2000;

const IDENT: Mat = [1, 0, 0, 1, 0, 0];
/** složení transformací: nejdřív `n`, potom `m` (jako `ctx.transform` – nová matice se násobí zprava) */
const mul = (m: Mat, n: Mat): Mat => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: Mat, x: number, y: number): Vec2 => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const isMat = (v: unknown): v is Mat => (Array.isArray(v) || ArrayBuffer.isView(v)) && (v as ArrayLike<number>).length === 6 && Array.from(v as ArrayLike<number>).every((n) => typeof n === "number" && Number.isFinite(n));

/** kódy příkazů v datech cesty (pdf.js `DrawOPS`) */
const D_MOVE = 0;
const D_LINE = 1;
const D_CURVE = 2;
const D_QUAD = 3;
const D_CLOSE = 4;

/**
 * Cesty stránky z operátorů pdf.js. `OPS` = tabulka kódů operátorů (export `OPS` knihovny), `view` = transformace
 * z uživatelského prostoru PDF na stránku s počátkem vlevo nahoře (`page.getViewport({ scale: 1 }).transform` – zahrnuje
 * otočení stránky a ořez). Ořezové cesty (bez čáry i výplně) se vynechávají.
 */
export function extractPdfPaths(list: PdfOpList, OPS: Record<string, number>, view: Mat = [1, 0, 0, -1, 0, 0]): PdfPath[] {
  const out: PdfPath[] = [];
  const stroke = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const fill = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const closing = new Set([OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const push = new Set([OPS.save, OPS.paintFormXObjectBegin, OPS.beginGroup, OPS.beginAnnotation]);
  const pop = new Set([OPS.restore, OPS.paintFormXObjectEnd, OPS.endGroup, OPS.endAnnotation]);
  let ctm: Mat = IDENT;
  const stack: Mat[] = [];
  const n = list.fnArray.length;
  for (let i = 0; i < n; i++) {
    const fn = list.fnArray[i];
    const args = list.argsArray[i] as unknown[] | null;
    if (push.has(fn)) {
      stack.push(ctm);
      // vnořený formulář má vlastní matici; anotace transformaci a matici (3. a 4. argument)
      if (fn === OPS.paintFormXObjectBegin && isMat(args?.[0])) ctm = mul(ctm, args![0] as Mat);
      if (fn === OPS.beginAnnotation) for (const m of [args?.[2], args?.[3]]) if (isMat(m)) ctm = mul(ctm, m);
      continue;
    }
    if (pop.has(fn)) {
      ctm = stack.pop() ?? ctm;
      continue;
    }
    if (fn === OPS.transform) {
      if (isMat(args)) ctm = mul(ctm, args as unknown as Mat);
      continue;
    }
    if (fn !== OPS.constructPath || !args) continue;
    const paint = args[0] as number;
    const st = stroke.has(paint);
    const fl = fill.has(paint);
    if (!st && !fl) continue;
    const data = (Array.isArray(args[1]) ? args[1][0] : args[1]) as ArrayLike<number> | null | undefined;
    if (!data || typeof data.length !== "number") continue;
    const m = mul(view, ctm);
    const firstIdx = out.length;
    let cur: PdfPath | null = null;
    /** aktuální bod a začátek dílčí cesty v souřadnicích PDF (`has` = aktuální bod existuje) */
    let has = false;
    let lx = 0;
    let ly = 0;
    let sx = 0;
    let sy = 0;
    const open = (x: number, y: number): PdfPath => {
      const p: PdfPath = { start: apply(m, x, y), segs: [], closed: false, stroke: st, fill: fl };
      out.push(p);
      return p;
    };
    for (let j = 0; j < data.length; ) {
      const op = data[j++];
      if (op === D_MOVE) {
        lx = sx = data[j++];
        ly = sy = data[j++];
        has = true;
        cur = null; // cesta se založí až s prvním úsekem (samotné moveTo nic nekreslí)
      } else if (op === D_LINE || op === D_CURVE || op === D_QUAD) {
        const cnt = op === D_LINE ? 2 : op === D_CURVE ? 6 : 4;
        const v: number[] = [];
        for (let q = 0; q < cnt; q++) v.push(data[j++]);
        const x = v[cnt - 2];
        const y = v[cnt - 1];
        if (!has) {
          // úsek bez počátečního bodu (vadné PDF) jen nastaví aktuální bod
          lx = sx = x;
          ly = sy = y;
          has = true;
          continue;
        }
        if (!cur) cur = open(lx, ly);
        if (op === D_LINE) cur.segs.push({ k: "L", b: apply(m, x, y) });
        else if (op === D_CURVE) cur.segs.push({ k: "C", c1: apply(m, v[0], v[1]), c2: apply(m, v[2], v[3]), b: apply(m, x, y) });
        // kvadratická → kubická (řídicí body ve 2/3 cesty k řídicímu bodu kvadratické)
        else cur.segs.push({ k: "C", c1: apply(m, lx + (2 * (v[0] - lx)) / 3, ly + (2 * (v[1] - ly)) / 3), c2: apply(m, x + (2 * (v[0] - x)) / 3, y + (2 * (v[1] - y)) / 3), b: apply(m, x, y) });
        lx = x;
        ly = y;
      } else if (op === D_CLOSE) {
        if (cur) cur.closed = true;
        cur = null; // další úsek bez moveTo pokračuje od začátku uzavřené cesty
        lx = sx;
        ly = sy;
      } else break; // neznámý příkaz – data dál nelze číst
    }
    // „zavřít a obtáhnout“ (operátory s, b, b*) uzavírá poslední dílčí cestu
    if (closing.has(paint) && out.length > firstIdx) out[out.length - 1].closed = true;
  }
  return out.filter((p) => p.segs.length > 0);
}

// ======================= cesty → entity skici =======================

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const R4 = (p: Vec2): Vec2 => [r4(p[0]), r4(p[1])];
const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const bez = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return [k0 * a[0] + k1 * c1[0] + k2 * c2[0] + k3 * b[0], k0 * a[1] + k1 * c1[1] + k2 * c2[1] + k3 * b[1]];
};
/** vzdálenost bodu od přímky a–b (od bodu a, když a = b) */
const offLine = (p: Vec2, a: Vec2, b: Vec2) => {
  const l = dist(a, b);
  return l < 1e-12 ? dist(p, a) : Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / l;
};

type ArcFit = { c: Vec2; r: number; sweep: number };
/**
 * Leží Bézierova křivka na kružnici? (CAD zapisuje oblouky do PDF jako Bézierovy křivky po nejvýš 90°, odchylka od
 * kružnice je pod 0,03 % poloměru.) Vrací střed, poloměr a orientovaný úhel (kladně proti směru hodin), jinak null.
 */
function arcOfBezier(a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, tol: number): ArcFit | null {
  const mid = bez(a, c1, c2, b, 0.5);
  const cc = circleFrom3(a, mid, b);
  if (!cc || !(cc.r > 0)) return null;
  const { c, r } = cc;
  if (r > 1e4 * Math.max(dist(a, b), 1e-9)) return null; // prakticky přímka
  const eps = Math.max(tol, r * 2e-3);
  for (const t of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) if (Math.abs(dist(bez(a, c1, c2, b, t), c) - r) > eps) return null;
  // tečny v koncích musí být kolmé na poloměr (křivka, která kružnici jen několikrát protíná, oblouk není)
  for (const [p, q] of [[a, dist(c1, a) > 1e-9 ? c1 : c2], [b, dist(c2, b) > 1e-9 ? c2 : c1]] as [Vec2, Vec2][]) {
    const t: Vec2 = [q[0] - p[0], q[1] - p[1]];
    const n: Vec2 = [p[0] - c[0], p[1] - c[1]];
    const tl = Math.hypot(t[0], t[1]);
    if (tl > 1e-9 && Math.abs(t[0] * n[0] + t[1] * n[1]) / (tl * r) > 0.06) return null;
  }
  const ang = (p: Vec2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  // proti směru hodin: střed křivky leží vpravo od tětivy a → b
  const ccw = (mid[0] - a[0]) * (b[1] - a[1]) - (mid[1] - a[1]) * (b[0] - a[0]) > 0;
  let sweep = ang(b) - ang(a);
  if (ccw) while (sweep <= 0) sweep += 2 * Math.PI;
  else while (sweep >= 0) sweep -= 2 * Math.PI;
  return { c, r, sweep };
}

type Prim =
  | { t: "line"; a: Vec2; b: Vec2 }
  | { t: "arc"; a: Vec2; b: Vec2; c: Vec2; r: number; sweep: number }
  | { t: "curve"; pts: Vec2[]; /** směr na začátku a na konci (pro spojování hladce navazujících křivek) */ d0: Vec2; d1: Vec2 };

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

export type PdfEntityOpts = {
  /** vzít i vyplněné cesty bez obrysu (šipky, šrafy plochou, text převedený na křivky); výchozí: jen když stránka žádné čáry nemá */
  fills?: boolean;
  /** tolerance [mm]: odchylka křivky od přímky / kružnice, pod kterou se bere jako úsečka / oblouk */
  tol?: number;
  /** kratší úsečky se vynechají [mm] */
  minLen?: number;
  /** nejvíc vložených entit */
  max?: number;
};
export type PdfEntities = { entities: SketchEntity[]; /** počet entit před zkrácením na `max` */ found: number; /** počet cest stránky, které se převáděly */ paths: number };

/**
 * Entity skici z cest stránky PDF. `toSketch` převádí bod stránky na bod skici [mm] (podobnostní zobrazení: měřítko,
 * natočení, posun a překlopení osy Y – kružnice zůstávají kružnicemi). Úsečky jdoucí za sebou tvoří lomenou čáru,
 * Bézierovy křivky na společné kružnici jeden oblouk (celý obvod = kružnice), ostatní křivky spline. Shodné čáry
 * kreslené víckrát se vloží jednou; je-li entit víc než `max`, zůstanou ty nejdelší.
 */
export function pdfPathsToEntities(paths: PdfPath[], toSketch: (p: Vec2) => Vec2, o: PdfEntityOpts = {}): PdfEntities {
  const tol = o.tol ?? 0.01;
  const minLen = o.minLen ?? 0.02;
  const max = o.max ?? PDF_ENTITY_MAX;
  const stroked = paths.filter((p) => p.stroke);
  const use = o.fills ? paths : stroked.length ? stroked : paths;
  const found: { e: SketchEntity; len: number }[] = [];
  const seen = new Set<string>();
  const key = (p: Vec2) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)}`;
  const add = (e: SketchEntity, len: number, sig: string) => {
    if (seen.has(sig)) return;
    seen.add(sig);
    found.push({ e, len });
  };
  const addLine = (a: Vec2, b: Vec2) => {
    const l = dist(a, b);
    if (l < minLen) return;
    const [ka, kb] = [key(a), key(b)];
    add({ id: uid(), type: "line", a: R4(a), b: R4(b) }, l, `L${ka < kb ? ka + "|" + kb : kb + "|" + ka}`);
  };
  const polyLen = (pts: Vec2[], closed: boolean) => pts.reduce((s, p, i) => s + (i ? dist(pts[i - 1], p) : 0), 0) + (closed ? dist(pts[pts.length - 1], pts[0]) : 0);

  for (const path of use) {
    // 1) úseky cesty v mm skici → primitiva (úsečka / oblouk / obecná křivka)
    const prims: Prim[] = [];
    let a = toSketch(path.start);
    const first = a;
    for (const s of path.segs) {
      const b = toSketch(s.b);
      if (s.k === "L") {
        if (dist(a, b) > 1e-9) prims.push({ t: "line", a, b });
      } else {
        const c1 = toSketch(s.c1);
        const c2 = toSketch(s.c2);
        if (Math.max(offLine(c1, a, b), offLine(c2, a, b)) <= tol) {
          if (dist(a, b) > 1e-9) prims.push({ t: "line", a, b });
        } else {
          const arc = arcOfBezier(a, c1, c2, b, tol);
          if (arc) prims.push({ t: "arc", a, b, ...arc });
          else {
            const n = Math.max(4, Math.min(12, Math.ceil((dist(a, c1) + dist(c1, c2) + dist(c2, b)) / 5)));
            const from = a;
            const pts: Vec2[] = Array.from({ length: n + 1 }, (_, i) => bez(from, c1, c2, b, i / n));
            const t0 = dist(c1, a) > 1e-9 ? c1 : c2;
            const t1 = dist(c2, b) > 1e-9 ? c2 : c1;
            prims.push({ t: "curve", pts, d0: unit([t0[0] - a[0], t0[1] - a[1]]), d1: unit([b[0] - t1[0], b[1] - t1[1]]) });
          }
        }
      }
      a = b;
    }
    if (path.closed && dist(a, first) > 1e-6) prims.push({ t: "line", a, b: first });
    if (!prims.length) continue;

    // 2) sloučit navazující primitiva: oblouky na téže kružnici, hladce navazující křivky
    const merged: Prim[] = [];
    for (const p of prims) {
      const q = merged[merged.length - 1];
      if (q && p.t === "arc" && q.t === "arc" && Math.sign(p.sweep) === Math.sign(q.sweep) && dist(p.c, q.c) <= Math.max(tol, q.r * 4e-3) && Math.abs(p.r - q.r) <= Math.max(tol, q.r * 4e-3) && Math.abs(q.sweep + p.sweep) <= 2 * Math.PI + 1e-3) {
        merged[merged.length - 1] = { ...q, b: p.b, sweep: q.sweep + p.sweep };
      } else if (q && p.t === "curve" && q.t === "curve" && q.d1[0] * p.d0[0] + q.d1[1] * p.d0[1] > 0.996) {
        merged[merged.length - 1] = { t: "curve", pts: [...q.pts, ...p.pts.slice(1)], d0: q.d0, d1: p.d1 };
      } else merged.push(p);
    }
    // oblouk přes začátek uzavřené cesty (kružnice začínající uprostřed oblouku)
    if (merged.length > 1) {
      const f = merged[0];
      const l = merged[merged.length - 1];
      if (f.t === "arc" && l.t === "arc" && dist(l.b, f.a) < 1e-6 && Math.sign(f.sweep) === Math.sign(l.sweep) && dist(f.c, l.c) <= Math.max(tol, f.r * 4e-3) && Math.abs(f.r - l.r) <= Math.max(tol, f.r * 4e-3) && Math.abs(f.sweep + l.sweep) <= 2 * Math.PI + 1e-3) {
        merged[0] = { ...l, b: f.b, sweep: l.sweep + f.sweep };
        merged.pop();
      }
    }

    // 3) entity: běhy úseček → úsečka / lomená čára, oblouk / kružnice, spline
    const onlyLines = merged.every((p) => p.t === "line");
    let run: Vec2[] = [];
    const flush = () => {
      if (run.length === 2) addLine(run[0], run[1]);
      else if (run.length > 2) {
        const closed = onlyLines && dist(run[0], run[run.length - 1]) < 1e-6 && run.length > 3;
        const pts = (closed ? run.slice(0, -1) : run).map(R4);
        const len = polyLen(pts, closed);
        if (len >= minLen) add({ id: uid(), type: "polyline", points: pts, closed }, len, `P${closed ? "c" : ""}${pts.map(key).join("|")}`);
      }
      run = [];
    };
    for (const p of merged) {
      if (p.t === "line") {
        if (!run.length) run = [p.a];
        run.push(p.b);
        continue;
      }
      flush();
      if (p.t === "arc") {
        if (Math.abs(p.sweep) >= 2 * Math.PI - 0.02) add({ id: uid(), type: "circle", cx: r4(p.c[0]), cy: r4(p.c[1]), r: r4(p.r) }, 2 * Math.PI * p.r, `O${key(p.c)}|${Math.round(p.r * 1e3)}`);
        else if (p.r * Math.abs(p.sweep) >= minLen) {
          const a0 = Math.atan2(p.a[1] - p.c[1], p.a[0] - p.c[0]);
          const mid: Vec2 = [p.c[0] + p.r * Math.cos(a0 + p.sweep / 2), p.c[1] + p.r * Math.sin(a0 + p.sweep / 2)];
          const [ka, kb] = [key(p.a), key(p.b)];
          add({ id: uid(), type: "arc", a: R4(p.a), b: R4(mid), c: R4(p.b) }, p.r * Math.abs(p.sweep), `A${ka < kb ? ka + "|" + kb : kb + "|" + ka}|${key(mid)}`);
        }
      } else {
        const len = polyLen(p.pts, false);
        if (len >= minLen) add({ id: uid(), type: "spline", points: p.pts.map(R4), closed: false }, len, `S${p.pts.map(key).join("|")}`);
      }
    }
    flush();
  }
  const kept = found.length > max ? [...found].sort((x, y) => y.len - x.len).slice(0, max) : found;
  return { entities: kept.map((f) => f.e), found: found.length, paths: use.length };
}
