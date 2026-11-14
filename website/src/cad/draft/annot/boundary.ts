/**
 * BALÍK 2 (annot) – hranice šrafy: „vnitřní bod“ (jako BHATCH) najde nejmenší uzavřenou oblast kolem bodu
 * z křivek viditelných entit (úsečky, oblouky, kružnice, křivky, elipsy a splajny – vzorkované), včetně oblastí
 * složených z více entit a ostrovů uvnitř (detekce ostrovů); „vybrat objekty“ udělá smyčky z uzavřených entit.
 *
 * Postup: křivky → úseky (úsečka / oblouk) → rozdělení v průsečících → rovinný graf → stěny (obcházení s nejostřejší
 * levotočivou zatáčkou) → stěna s nejmenší plochou obsahující bod; ostrovy = vnější obrysy ostatních komponent uvnitř.
 */
import { tr } from "../../i18n";
import { cIntersect, cPoint, cRange, type Curve } from "../curves";
import { angleOf, bulgeOf, circle3, dist, normA, TAU, type Box } from "../geom";
import { entityBox, entityCurves, type KindCtx } from "../kinds";
import { layerVisible } from "../layers";
import type { DraftEntity, DraftModel, Vec2 } from "../model";
import { inPoly, loopArea, loopPolygon } from "./patterns";
import type { DHatch } from "./types";

export type Loop = DHatch["loops"][number];
type Piece = { k: "L"; a: Vec2; b: Vec2 } | { k: "A"; c: Vec2; r: number; a0: number; sw: number };
type Edge = { p: Piece; u: number; v: number };
type Half = { e: number; rev: boolean; from: number; to: number; ang: number };

const pieceBox = (p: Piece): Box =>
  p.k === "L" ? { x0: Math.min(p.a[0], p.b[0]), y0: Math.min(p.a[1], p.b[1]), x1: Math.max(p.a[0], p.b[0]), y1: Math.max(p.a[1], p.b[1]) } : { x0: p.c[0] - p.r, y0: p.c[1] - p.r, x1: p.c[0] + p.r, y1: p.c[1] + p.r };
const toCurve = (p: Piece): Curve => (p.k === "L" ? { k: "line", a: p.a, b: p.b } : { k: "arc", c: p.c, r: p.r, a0: p.a0, sweep: p.sw });
const at = (p: Piece, t: number): Vec2 => (p.k === "L" ? [p.a[0] + (p.b[0] - p.a[0]) * t, p.a[1] + (p.b[1] - p.a[1]) * t] : [p.c[0] + p.r * Math.cos(p.a0 + p.sw * t), p.c[1] + p.r * Math.sin(p.a0 + p.sw * t)]);
const param = (p: Piece, q: Vec2): number => {
  if (p.k === "L") {
    const d = [p.b[0] - p.a[0], p.b[1] - p.a[1]];
    const l2 = d[0] * d[0] + d[1] * d[1];
    return l2 < 1e-300 ? 0 : ((q[0] - p.a[0]) * d[0] + (q[1] - p.a[1]) * d[1]) / l2;
  }
  return Math.min(1, Math.max(0, normA(angleOf([q[0] - p.c[0], q[1] - p.c[1]]) - p.a0) / p.sw));
};
const sub = (p: Piece, t0: number, t1: number): Piece => (p.k === "L" ? { k: "L", a: at(p, t0), b: at(p, t1) } : { k: "A", c: p.c, r: p.r, a0: p.a0 + p.sw * t0, sw: p.sw * (t1 - t0) });

/**
 * Elipsa / spline → kruhové oblouky přes tři body křivky (začátek, střed, konec úseku; elipsa 64 úseků na celý obvod,
 * spline 8 úseků na úsek uzlů). Odchylka oblouku od křivky je řádu h⁴ – plocha šrafy elipsy vychází na ~1e-7
 * (lomená čára se 96 body měla chybu −0,07 %). Vrací úseky v pořadí křivky s vydutím (pro smyčky šrafy).
 */
export function curveArcs(c: Curve): { a: Vec2; b: Vec2; bulge: number }[] {
  const [t0, t1] = cRange(c);
  const ts: number[] = [];
  if (c.k === "nurbs") {
    const ks = [...new Set(c.knots.filter((k) => k > t0 && k < t1))].sort((x, y) => x - y);
    const brk = [t0, ...ks, t1];
    const per = Math.max(8, Math.ceil(48 / (brk.length - 1)));
    for (let i = 0; i + 1 < brk.length; i++) for (let j = 0; j < per; j++) ts.push(brk[i] + ((brk[i + 1] - brk[i]) * j) / per);
  } else {
    const n = Math.max(8, Math.ceil((64 * Math.abs(t1 - t0)) / TAU));
    for (let j = 0; j < n; j++) ts.push(t0 + ((t1 - t0) * j) / n);
  }
  ts.push(t1);
  const out: { a: Vec2; b: Vec2; bulge: number }[] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = cPoint(c, ts[i]);
    const b = cPoint(c, ts[i + 1]);
    if (dist(a, b) < 1e-12) continue;
    const m = cPoint(c, (ts[i] + ts[i + 1]) / 2);
    const cc = circle3(a, m, b);
    let bulge = 0;
    if (cc && cc.r < 1e6 * dist(a, b)) {
      const aa = angleOf([a[0] - cc.c[0], a[1] - cc.c[1]]);
      const s = normA(angleOf([b[0] - cc.c[0], b[1] - cc.c[1]]) - aa);
      const sm = normA(angleOf([m[0] - cc.c[0], m[1] - cc.c[1]]) - aa);
      bulge = bulgeOf(sm < s ? s : -(TAU - s));
    }
    out.push({ a, b, bulge });
  }
  return out;
}
/** úsek s vydutím → úsek grafu (oblouk vždy proti směru hodin) */
function bulgePiece(a: Vec2, b: Vec2, bulge: number): Piece {
  if (Math.abs(bulge) < 1e-12) return { k: "L", a, b };
  const sw = 4 * Math.atan(bulge);
  const ch = dist(a, b);
  const r = ch / (2 * Math.abs(Math.sin(sw / 2)));
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  // střed leží vlevo od tětivy pro kladné vydutí < půlkruh (vzdálenost r·cos(sw/2))
  const h = r * Math.cos(sw / 2) * Math.sign(sw);
  const ux = (b[0] - a[0]) / ch;
  const uy = (b[1] - a[1]) / ch;
  const c: Vec2 = [mx - uy * h, my + ux * h];
  if (sw > 0) return { k: "A", c, r, a0: angleOf([a[0] - c[0], a[1] - c[1]]), sw };
  return { k: "A", c, r, a0: angleOf([b[0] - c[0], b[1] - c[1]]), sw: -sw };
}

/** křivky entity → úseky (nekonečné přímky oříznuté na `clip`) */
function piecesOf(cs: Curve[], clip: Box): Piece[] {
  const out: Piece[] = [];
  for (const c of cs) {
    if (c.k === "line") {
      if (c.inf) {
        const d: Vec2 = [c.b[0] - c.a[0], c.b[1] - c.a[1]];
        const L = Math.hypot(d[0], d[1]) || 1;
        const big = 4 * Math.max(clip.x1 - clip.x0, clip.y1 - clip.y0, 1);
        out.push({ k: "L", a: c.inf === 2 ? [c.a[0] - (d[0] / L) * big, c.a[1] - (d[1] / L) * big] : c.a, b: [c.a[0] + (d[0] / L) * big, c.a[1] + (d[1] / L) * big] });
      } else if (dist(c.a, c.b) > 1e-12) out.push({ k: "L", a: c.a, b: c.b });
    } else if (c.k === "arc") {
      if (c.sweep >= TAU - 1e-12) {
        out.push({ k: "A", c: c.c, r: c.r, a0: c.a0, sw: Math.PI }, { k: "A", c: c.c, r: c.r, a0: c.a0 + Math.PI, sw: Math.PI });
      } else out.push({ k: "A", c: c.c, r: c.r, a0: c.a0, sw: c.sweep });
    } else for (const x of curveArcs(c)) out.push(bulgePiece(x.a, x.b, x.bulge));
  }
  return out;
}

export type BoundaryResult = { loops: Loop[]; ids: string[] };

/**
 * Smyčky šrafy kolem vnitřního bodu `p` (null = bod neleží v uzavřené oblasti). `islands` = detekce ostrovů.
 *
 * Výpočet je místní: řeší se jen entity, jejichž obálka zasahuje do okna kolem bodu, a okno se zvětšuje (×4), dokud
 * nalezená oblast neleží celá uvnitř okna (pak ji žádná entita mimo okno nemůže rozdělit ani v ní být ostrovem) nebo
 * okno nepokryje celý výkres. Čas výběru tak závisí na okolí bodu, ne na velikosti výkresu.
 */
export function boundaryAt(model: DraftModel, list: readonly DraftEntity[], p: Vec2, islands = true): BoundaryResult | null {
  const ctx: KindCtx = { model };
  const ents: DraftEntity[] = [];
  const boxes: (Box | null)[] = [];
  let all: Box = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] };
  let near = Infinity;
  for (const e of list) {
    if (e.type === "hatch" || e.type === "dimension" || !layerVisible(model, e.layer)) continue;
    const b = entityBox(e, ctx);
    ents.push(e);
    boxes.push(b);
    if (!b) continue;
    all = { x0: Math.min(all.x0, b.x0), y0: Math.min(all.y0, b.y0), x1: Math.max(all.x1, b.x1), y1: Math.max(all.y1, b.y1) };
    // vzdálenost bodu k obálce (0 uvnitř) – první okno sahá k nejbližší entitě
    const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1);
    const dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
    if (dx || dy) near = Math.min(near, Math.max(dx, dy));
  }
  if (!ents.length) return null;
  const ext = Math.max(all.x1 - all.x0, all.y1 - all.y0, 1e-9);
  let half = Math.max(Number.isFinite(near) ? near * 1.5 : 0, ext / 512);
  for (;;) {
    const w: Box = { x0: p[0] - half, y0: p[1] - half, x1: p[0] + half, y1: p[1] + half };
    const covers = w.x0 <= all.x0 && w.y0 <= all.y0 && w.x1 >= all.x1 && w.y1 >= all.y1;
    const sub2 = covers ? ents : ents.filter((_, i) => !boxes[i] || (boxes[i]!.x0 <= w.x1 && boxes[i]!.x1 >= w.x0 && boxes[i]!.y0 <= w.y1 && boxes[i]!.y1 >= w.y0));
    const r = sub2.length ? solve(sub2, ctx, p, islands, all) : null;
    if (covers) return r;
    if (r) {
      const ob = r.box;
      // rezerva 2 % okna: obrys je mnohoúhelník z oblouků (vrcholy na oblouku), skutečný oblouk může mírně přesahovat
      const m = half * 0.02;
      if (ob.x0 > w.x0 + m && ob.y0 > w.y0 + m && ob.x1 < w.x1 - m && ob.y1 < w.y1 - m) return r;
    }
    half *= 4;
  }
}

function solve(ents: DraftEntity[], ctx: KindCtx, p: Vec2, islands: boolean, all: Box): (BoundaryResult & { box: Box }) | null {
  const pieces: { pc: Piece; src: number }[] = [];
  ents.forEach((e, i) => {
    for (const pc of piecesOf(entityCurves(e, ctx), all)) pieces.push({ pc, src: i });
  });
  if (!pieces.length) return null;
  const scale = Math.max(all.x1 - all.x0, all.y1 - all.y0, 1);
  const tol = scale * 1e-9;
  // průsečíky (zametání podle x)
  const params: number[][] = pieces.map(() => [0, 1]);
  const bx = pieces.map((x) => pieceBox(x.pc));
  const order = pieces.map((_, i) => i).sort((a, b) => bx[a].x0 - bx[b].x0);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      if (bx[j].x0 > bx[i].x1 + tol) break;
      if (bx[j].y0 > bx[i].y1 + tol || bx[j].y1 < bx[i].y0 - tol) continue;
      const A = pieces[i].pc;
      const B = pieces[j].pc;
      if (A.k === "L" && B.k === "L") {
        // překrývající se kolineární úsečky: rozdělit v koncových bodech té druhé (pak se shodné hrany sloučí)
        const d: Vec2 = [A.b[0] - A.a[0], A.b[1] - A.a[1]];
        const L = Math.hypot(d[0], d[1]) || 1;
        const off = (p: Vec2) => Math.abs((p[0] - A.a[0]) * d[1] - (p[1] - A.a[1]) * d[0]) / L;
        if (off(B.a) <= tol * 10 && off(B.b) <= tol * 10) {
          for (const q of [B.a, B.b]) params[i].push(param(A, q));
          for (const q of [A.a, A.b]) params[j].push(param(B, q));
          continue;
        }
      }
      for (const q of cIntersect(toCurve(A), toCurve(B))) {
        params[i].push(param(A, q));
        params[j].push(param(B, q));
      }
    }
  }
  // vrcholy a hrany
  const verts: Vec2[] = [];
  const vkey = new Map<string, number>();
  const q = tol * 100;
  const vid = (pt: Vec2): number => {
    const kx = Math.round(pt[0] / q);
    const ky = Math.round(pt[1] / q);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const h = vkey.get(`${kx + dx},${ky + dy}`);
        if (h !== undefined && dist(verts[h], pt) <= q * 1.5) return h;
      }
    verts.push(pt);
    vkey.set(`${kx},${ky}`, verts.length - 1);
    return verts.length - 1;
  };
  const edges: (Edge & { src: number })[] = [];
  const seen = new Set<string>();
  pieces.forEach((x, i) => {
    const ts = [...new Set(params[i].map((t) => Math.min(1, Math.max(0, t))))].sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k++) {
      if (ts[k + 1] - ts[k] < 1e-12) continue;
      const pc = sub(x.pc, ts[k], ts[k + 1]);
      const a = at(pc, 0);
      const b = at(pc, 1);
      const u = vid(a);
      const v = vid(b);
      // úsek zúžený na jeden vrchol (i nepatrný oblouk u sdíleného konce sousedních oblouků elipsy) se vynechá
      if (u === v && (pc.k === "L" || Math.abs(pc.sw) * pc.r < q * 10)) continue;
      // shodná hrana (překryv dvou entit) jen jednou
      const mp = at(pc, 0.5);
      const key = pc.k === "L" ? `L${Math.min(u, v)},${Math.max(u, v)}` : `A${Math.min(u, v)},${Math.max(u, v)},${Math.round(mp[0] / q)},${Math.round(mp[1] / q)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ p: pc, u, v, src: x.src });
    }
  });
  // odstranit volné konce (vrchol stupně 1) opakovaně
  const alive = edges.map(() => true);
  for (;;) {
    const deg = new Array(verts.length).fill(0);
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      deg[e.u]++;
      deg[e.v]++;
    });
    let ch = false;
    edges.forEach((e, i) => {
      if (alive[i] && (deg[e.u] < 2 || deg[e.v] < 2)) {
        alive[i] = false;
        ch = true;
      }
    });
    if (!ch) break;
  }
  // poloviční hrany se směrem vycházení (úhel bodu kousek po hraně – rozliší i tečné oblouky)
  const halves: Half[] = [];
  const outOf: number[][] = verts.map(() => []);
  edges.forEach((e, i) => {
    if (!alive[i]) return;
    for (const rev of [false, true]) {
      const from = rev ? e.v : e.u;
      const to = rev ? e.u : e.v;
      const len = e.p.k === "L" ? dist(e.p.a, e.p.b) : Math.abs(e.p.sw) * e.p.r;
      const f = Math.min(0.25, (scale * 1e-6) / Math.max(len, 1e-300));
      const pt = at(e.p, rev ? 1 - f : f);
      const o = verts[from];
      halves.push({ e: i, rev, from, to, ang: Math.atan2(pt[1] - o[1], pt[0] - o[0]) });
      outOf[from].push(halves.length - 1);
    }
  });
  for (const l of outOf) l.sort((a, b) => halves[a].ang - halves[b].ang);
  const twin = (h: number) => (halves[h].rev ? h - 1 : h + 1);
  const next = (h: number) => {
    const t = twin(h);
    const l = outOf[halves[h].to];
    const i = l.indexOf(t);
    return l[(i - 1 + l.length) % l.length];
  };
  // stěny
  const used = new Array(halves.length).fill(false);
  type Face = { loop: Loop; poly: Vec2[]; area: number; edges: number[] };
  const faces: Face[] = [];
  for (let h0 = 0; h0 < halves.length; h0++) {
    if (used[h0]) continue;
    const cyc: number[] = [];
    let h = h0;
    let guard = 0;
    while (!used[h] && guard++ < halves.length + 2) {
      used[h] = true;
      cyc.push(h);
      h = next(h);
    }
    if (h !== h0 || cyc.length < 1) continue;
    const pts: Vec2[] = [];
    const bul: number[] = [];
    for (const hh of cyc) {
      const H = halves[hh];
      const e = edges[H.e];
      pts.push(verts[H.from]);
      bul.push(e.p.k === "A" ? bulgeOf(H.rev ? -e.p.sw : e.p.sw) : 0);
    }
    const area = loopArea(pts, bul);
    faces.push({ loop: { pts, ...(bul.some((b) => Math.abs(b) > 1e-12) ? { bulges: bul } : {}) }, poly: loopPolygon(pts, bul, 2), area, edges: cyc.map((x) => halves[x].e) });
  }
  // nejmenší stěna (proti směru hodin) obsahující bod
  let best: Face | null = null;
  for (const f of faces) if (f.area > 1e-12 * scale * scale && inPoly(p, f.poly) && (!best || f.area < best.area)) best = f;
  if (!best) return null;
  const ids = new Set(best.edges.map((i) => edges[i].src));
  const loops: Loop[] = [{ ...best.loop, outer: true }];
  if (islands) {
    // komponenty grafu
    const comp = new Array(verts.length).fill(-1);
    let nc = 0;
    const adj: number[][] = verts.map(() => []);
    edges.forEach((e, i) => {
      if (!alive[i]) return;
      adj[e.u].push(e.v);
      adj[e.v].push(e.u);
    });
    for (let s = 0; s < verts.length; s++) {
      if (comp[s] >= 0 || !adj[s].length) continue;
      const st = [s];
      comp[s] = nc;
      while (st.length) {
        const x = st.pop()!;
        for (const y of adj[x]) if (comp[y] < 0) (comp[y] = nc), st.push(y);
      }
      nc++;
    }
    const bestComp = comp[edges[best.edges[0]].u];
    // vnější obrys každé jiné komponenty = stěna se zápornou plochou s největší |plochou|
    const outer = new Map<number, Face>();
    for (const f of faces) {
      if (f.area >= 0) continue;
      const c = comp[edges[f.edges[0]].u];
      if (c === bestComp) continue;
      const o = outer.get(c);
      if (!o || f.area < o.area) outer.set(c, f);
    }
    for (const [, f] of outer) {
      if (!inPoly(f.poly[0], best.poly) || inPoly(p, f.poly)) continue;
      loops.push({ pts: [...f.loop.pts].reverse(), ...(f.loop.bulges ? { bulges: reverseBulges(f.loop.bulges) } : {}) });
      for (const i of f.edges) ids.add(edges[i].src);
    }
  }
  let box: Box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const q2 of best.poly) box = { x0: Math.min(box.x0, q2[0]), y0: Math.min(box.y0, q2[1]), x1: Math.max(box.x1, q2[0]), y1: Math.max(box.y1, q2[1]) };
  return { loops, ids: [...ids].map((i) => ents[i].id), box };
}

/** obrácené pořadí vrcholů: vydutí úseku i → i+1 se stane úsekem opačně (−b) na novém místě */
function reverseBulges(b: number[]): number[] {
  const n = b.length;
  return Array.from({ length: n }, (_, i) => -b[(n - 2 - i + n) % n]);
}

/** Smyčky z uzavřených entit (kružnice, uzavřené křivky, elipsy, splajny); neuzavřené vrátí v `skipped`. */
export function objectLoops(ents: DraftEntity[], ctx: KindCtx): { loops: Loop[]; skipped: string[] } {
  const loops: Loop[] = [];
  const skipped: string[] = [];
  for (const e of ents) {
    if (e.type === "circle") loops.push({ pts: [[e.c[0] + e.r, e.c[1]], [e.c[0] - e.r, e.c[1]]], bulges: [1, 1] });
    else if (e.type === "polyline" && (e.closed || (e.pts.length > 2 && dist(e.pts[0], e.pts[e.pts.length - 1]) < 1e-9))) {
      const pts = e.closed ? e.pts : e.pts.slice(0, -1);
      const bul = e.bulges ? pts.map((_, i) => e.bulges?.[i] ?? 0) : undefined;
      loops.push({ pts, ...(bul?.some((x) => x) ? { bulges: bul } : {}) });
    } else if ((e.type === "ellipse" && e.t0 === undefined && e.t1 === undefined) || (e.type === "spline" && e.closed)) {
      // obrys z kruhových oblouků přes body křivky (plocha a obrys odpovídají křivce na ~1e-7)
      const segs = entityCurves(e, ctx).flatMap((c) => curveArcs(c));
      if (segs.length >= 2) loops.push({ pts: segs.map((x) => x.a), bulges: segs.map((x) => x.bulge) });
    } else skipped.push(e.id);
  }
  // vnější = smyčky, které nejsou uvnitř jiné
  const polys = loops.map((l) => loopPolygon(l.pts, l.bulges));
  loops.forEach((l, i) => {
    if (!polys.some((q, j) => j !== i && Math.abs(loopArea(loops[j].pts, loops[j].bulges)) > Math.abs(loopArea(l.pts, l.bulges)) && inPoly(polys[i][0], q))) l.outer = true;
  });
  return { loops, skipped };
}

export const noBoundary = () => tr("bod neleží v uzavřené oblasti – hranice šrafy nenalezena (uzavřete obrys nebo vyberte objekty)");
