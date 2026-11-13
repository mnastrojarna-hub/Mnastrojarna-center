/**
 * Rozmístění Chytrých kót na listu (ISO 129-1): kóty mimo obrys pohledu v řadách rovnoběžných s hranami
 * (první řada 8 mm od obrysu, další po 7 mm), texty vodorovně nebo zdola nahoru (čitelné zdola / zprava),
 * popisy děr pod stálým úhlem 45°. Žádný text nesmí překrýt jiný text, obrys pohledu, izometrii ani razítko
 * a žádná čára kóty nesmí přeškrtnout text – co se čistě umístit nedá, se vynechá a nahlásí.
 */
import { annotationGeometry, annToSheet, dimLabel, type DrawingResult, type PlacedView } from "./drawing";
import { boxesOverlap, calloutLines, calloutTexts, CALLOUT_SIZE, symbolsAsGeometry, textBox, textWidth, type Box } from "./drawing-symbols";
import type { DrawingAnnotation, Vec2 } from "./types";

export type Side = "top" | "bottom" | "left" | "right";
type Seg = [Vec2, Vec2];
type NewAnn = DrawingAnnotation extends infer T ? (T extends unknown ? Omit<T, "id"> : never) : never;

/** požadavek na délkovou kótu: body a, b v souřadnicích pohledu, směr kótovací čáry (h = vodorovná, v = svislá) */
export type LinReq = { key: string; view: string; dir: "h" | "v"; a: Vec2; b: Vec2; sides: Side[]; prefix?: string; suffix?: string; text?: string; minRow?: number };
/** požadavek na popis s odkazem: šipka v `tip` (souřadnice pohledu) */
export type CallReq = {
  key: string;
  view: string;
  tip: Vec2;
  lines: string[];
  circle?: { c: Vec2; r: number };
  /** preferovaný směr odkazu na listu (jinak od středu pohledu ven) */
  prefer?: Vec2;
  /** kružnice (souřadnice pohledu), na kterou míří šipka radiálně – hrot se dopočítá podle směru odkazu; více = vybere se nejkratší odkaz */
  ring?: { c: Vec2; r: number };
  rings?: { c: Vec2; r: number }[];
};

export const ROW0 = 8;
export const ROW_STEP = 7;
const DIM_SIZE = 3.5;
const MAX_ROWS = 7;

const rectOf = (v: PlacedView): Box => ({ x0: v.px, y0: v.py, x1: v.px + v.w * v.s, y1: v.py + v.h * v.s });

/** průsečík úsečky s obdélníkem (Liang–Barsky) */
export function segHitsBox(p: Vec2, q: Vec2, b: Box, pad = 0): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const clip = (pp: number, qq: number) => {
    if (Math.abs(pp) < 1e-12) return qq >= 0;
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, p[0] - (b.x0 - pad)) && clip(dx, b.x1 + pad - p[0]) && clip(-dy, p[1] - (b.y0 - pad)) && clip(dy, b.y1 + pad - p[1]) && t0 <= t1;
}

/** obdélníky textů vykreslených poznámek (stejná cesta jako list: annotationGeometry + značky jako čáry) */
export function annotationBoxes(d: Pick<DrawingResult, "views" | "scaleValue">, anns: DrawingAnnotation[]): { id: string; boxes: Box[] }[] {
  return anns.map((a) => ({ id: a.id, boxes: symbolsAsGeometry(annotationGeometry(d, [a])).texts.map((t) => textBox(t)) }));
}

export class DimLayout {
  readonly views: PlacedView[];
  /** obsazené texty (překážky) a čáry umístěných kót */
  readonly boxes: Box[] = [];
  readonly segs: Seg[] = [];
  /** odkazové čáry a police umístěných popisů (odkazy se nesmí křížit – nebylo by jasné, který popis patří ke kterému prvku) */
  private readonly leaders: Seg[] = [];
  private readonly rects: Box[];
  private readonly area: Box;
  readonly placed: { key: string; ann: NewAnn; side?: Side; row?: number; boxes?: Box[]; segs?: Seg[] }[] = [];

  constructor(d: Pick<DrawingResult, "views" | "sheet" | "texts" | "polys">) {
    this.views = d.views;
    this.rects = d.views.map(rectOf);
    // izometrie (tenké čáry) a razítko jako překážky
    const thin = d.polys.filter((p) => p.layer === "thin").flatMap((p) => p.pts);
    if (thin.length) this.rects.push({ x0: Math.min(...thin.map((p) => p[0])), y0: Math.min(...thin.map((p) => p[1])), x1: Math.max(...thin.map((p) => p[0])), y1: Math.max(...thin.map((p) => p[1])) });
    const W = d.sheet.w;
    const H = d.sheet.h;
    this.rects.push({ x0: W - 10 - 180, y0: H - 10 - 38, x1: W - 10, y1: H - 10 });
    for (const t of d.texts) this.boxes.push(textBox(t));
    this.area = { x0: 21, y0: 11, x1: W - 11, y1: H - 11 };
  }

  rectOfView(key: string): Box | null {
    const i = this.views.findIndex((v) => v.key === key);
    return i >= 0 ? this.rects[i] : null;
  }
  private S = (view: string, q: Vec2) => annToSheet(this.views, view, q);
  private inArea = (b: Box) => b.x0 >= this.area.x0 && b.y0 >= this.area.y0 && b.x1 <= this.area.x1 && b.y1 <= this.area.y1;

  /** volné místo pro text a čáry? */
  private free(texts: Box[], segs: Seg[], ownView: string): boolean {
    const own = this.rectOfView(ownView);
    for (const b of texts) {
      if (!this.inArea(b)) return false;
      if (this.rects.some((r) => boxesOverlap(b, r, 0.6))) return false;
      if (this.boxes.some((o) => boxesOverlap(b, o, 0.4))) return false;
      if (this.segs.some(([p, q]) => segHitsBox(p, q, b, 0.2))) return false;
    }
    for (const [p, q] of segs) {
      if (this.boxes.some((o) => segHitsBox(p, q, o, 0.2))) return false;
      // čáry kót nesmí vést přes jiný pohled
      if (this.rects.some((r) => r !== own && segHitsBox(p, q, r, -0.5))) return false;
      if (!this.inArea({ x0: Math.min(p[0], q[0]), y0: Math.min(p[1], q[1]), x1: Math.max(p[0], q[0]), y1: Math.max(p[1], q[1]) })) return false;
    }
    // text se nesmí křížit s vlastními čarami jiných vynášecích čar (stačí kontrola výše) – a texty téže kóty se nepřekrývají
    return true;
  }

  /** geometrie délkové kóty v řadě `row` na straně `side` */
  linGeom(req: LinReq, side: Side, row: number, label: string): { offset: number; text: Box; segs: Seg[] } | null {
    const r = this.rectOfView(req.view);
    if (!r) return null;
    const A = this.S(req.view, req.a);
    const B = this.S(req.view, req.b);
    const dist = ROW0 + ROW_STEP * row;
    if (req.dir === "h") {
      if (side !== "top" && side !== "bottom") return null;
      const y = side === "bottom" ? r.y1 + dist : r.y0 - dist;
      const A2: Vec2 = [A[0], y];
      const B2: Vec2 = [B[0], y];
      const text = textBox({ x: (A[0] + B[0]) / 2, y: y - 1.2, s: label, size: DIM_SIZE, anchor: "middle" });
      return { offset: y - A[1], text, segs: [[A, A2], [B, B2], [A2, B2]] };
    }
    if (side !== "left" && side !== "right") return null;
    const x = side === "right" ? r.x1 + dist : r.x0 - dist;
    const A2: Vec2 = [x, A[1]];
    const B2: Vec2 = [x, B[1]];
    const text = textBox({ x: x - 1.2, y: (A[1] + B[1]) / 2, s: label, size: DIM_SIZE, anchor: "middle", rotate: -90 });
    return { offset: x - A[0], text, segs: [[A, A2], [B, B2], [A2, B2]] };
  }

  private linAnn(req: LinReq, offset: number): NewAnn {
    return { type: "dim", view: req.view, auto: req.key, a: req.a, b: req.b, kind: req.dir === "h" ? "horizontal" : "vertical", offset: Math.round(offset * 100) / 100, ...(req.prefix ? { prefix: req.prefix } : {}), ...(req.suffix ? { suffix: req.suffix } : {}), ...(req.text != null ? { text: req.text } : {}) } as NewAnn;
  }

  /** popisek délkové kóty (stejně jako na listu) */
  linLabel(req: LinReq): string {
    const value = req.dir === "h" ? Math.abs(req.b[0] - req.a[0]) : Math.abs(req.b[1] - req.a[1]);
    return dimLabel({ kind: req.dir === "h" ? "horizontal" : "vertical", prefix: req.prefix, suffix: req.suffix, text: req.text }, value);
  }

  /** Umístí délkovou kótu do první volné řady (od `minRow`) na první vyhovující straně. */
  placeLin(req: LinReq, minRow = req.minRow ?? 0): { side: Side; row: number } | null {
    const label = this.linLabel(req);
    for (const side of req.sides) {
      for (let row = minRow; row < MAX_ROWS; row++) {
        const g = this.linGeom(req, side, row, label);
        if (!g) break;
        // kótovací čára se nesmí krýt s jinou rovnoběžnou čárou (stejná řada, překryv)
        if (!this.free([g.text], g.segs, req.view)) continue;
        if (this.segs.some(([p, q]) => overlapCollinear(p, q, g.segs[2][0], g.segs[2][1]))) continue;
        this.boxes.push(g.text);
        this.segs.push(...g.segs);
        this.placed.push({ key: req.key, ann: this.linAnn(req, g.offset), side, row, boxes: [g.text], segs: g.segs });
        return { side, row };
      }
    }
    return null;
  }

  /** Jak daleko za obrys pohledu sahají umístěné kóty a popisy [mm listu] – místo, které je kolem pohledu třeba nechat. */
  overhang(): Record<string, Record<"l" | "t" | "r" | "b", number>> {
    const out: Record<string, Record<"l" | "t" | "r" | "b", number>> = {};
    for (const p of this.placed) {
      const r = this.rectOfView(p.ann.view);
      if (!r) continue;
      const o = (out[p.ann.view] ??= { l: 0, t: 0, r: 0, b: 0 });
      const pts: Vec2[] = [...(p.boxes ?? []).flatMap((b): Vec2[] => [[b.x0, b.y0], [b.x1, b.y1]]), ...(p.segs ?? []).flat()];
      for (const [x, y] of pts) {
        o.l = Math.max(o.l, r.x0 - x);
        o.r = Math.max(o.r, x - r.x1);
        o.t = Math.max(o.t, r.y0 - y);
        o.b = Math.max(o.b, y - r.y1);
      }
    }
    return out;
  }

  /** Osa souměrnosti v pohledu (čára, žádný text – bez kontroly místa). */
  placeAxis(key: string, view: string, a: Vec2, b: Vec2) {
    this.placed.push({ key, ann: { type: "centerline", view, auto: key, a, b } as NewAnn });
  }

  /** Popis s odkazem pod úhlem 45° ven z pohledu; délka odkazu podle potřeby (text vždy mimo obrys). */
  placeCall(req: CallReq): boolean {
    const r = this.rectOfView(req.view);
    const view = this.views.find((v) => v.key === req.view);
    if (!r || !view) return false;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const s2 = Math.SQRT1_2;
    const dirs: Vec2[] = [
      [s2, -s2],
      [-s2, -s2],
      [s2, s2],
      [-s2, s2],
    ];
    const lines = calloutLines({ lines: req.lines });
    const w = Math.max(6, ...lines.map((l) => textWidth(l, CALLOUT_SIZE))) + 2;
    const rings = req.rings?.length ? req.rings : req.ring ? [req.ring] : [{ c: req.tip, r: 0 }];
    // kandidáti: kružnice × směr, seřazení podle preferovaného směru a délky odkazu
    const cands: { T: Vec2; tip: Vec2; u: Vec2; exit: number; score: number }[] = [];
    for (const ring of rings) {
      const C = this.S(req.view, ring.c);
      const want: Vec2 = req.prefer ?? [C[0] - cx || 1, C[1] - cy || -1];
      const wl = Math.hypot(want[0], want[1]) || 1;
      for (const u of dirs) {
        const T: Vec2 = [C[0] + u[0] * ring.r * view.s, C[1] + u[1] * ring.r * view.s];
        const tx = u[0] > 0 ? (r.x1 - T[0]) / u[0] : (r.x0 - T[0]) / u[0];
        const ty = u[1] > 0 ? (r.y1 - T[1]) / u[1] : (r.y0 - T[1]) / u[1];
        const exit = Math.max(0, Math.min(tx, ty));
        const align = (u[0] * want[0] + u[1] * want[1]) / wl;
        const tip: Vec2 = [ring.c[0] + u[0] * ring.r, ring.c[1] + u[1] * ring.r];
        cands.push({ T, tip, u, exit, score: exit - 25 * align });
      }
    }
    cands.sort((a, b) => a.score - b.score);
    for (const extra of [5, 8, 12, 16, 21, 27, 34]) {
      for (const { T, tip, u, exit } of cands) {
        const K: Vec2 = [T[0] + u[0] * (exit + extra), T[1] + u[1] * (exit + extra)];
        const right = u[0] >= 0;
        const texts = calloutTexts(K, lines, right).map((t) => textBox(t));
        const shelf: Vec2 = [K[0] + (right ? w : -w), K[1]];
        const segs: Seg[] = [[T, K], [K, shelf]];
        if (!this.free(texts, [], req.view)) continue;
        // odkaz smí vést přes vlastní pohled, ne přes texty a jiné pohledy
        if (this.boxes.some((o) => segs.some(([p, q]) => segHitsBox(p, q, o, 0.2)))) continue;
        const own = this.rectOfView(req.view);
        if (this.rects.some((rr) => rr !== own && segs.some(([p, q]) => segHitsBox(p, q, rr, -0.5)))) continue;
        if (this.leaders.some(([p, q]) => segs.some(([a, b]) => segsCross(p, q, a, b)))) continue;
        this.boxes.push(...texts);
        this.segs.push(...segs);
        this.leaders.push(...segs);
        const at: Vec2 = [(K[0] - view.px) / view.s + view.x0, (K[1] - view.py) / view.s + view.y0];
        const round = (q: Vec2): Vec2 => [Math.round(q[0] * 1000) / 1000, Math.round(q[1] * 1000) / 1000];
        this.placed.push({ key: req.key, ann: { type: "callout", view: req.view, auto: req.key, tip: round(tip), at: round(at), lines: req.lines, ...(req.circle ? { circle: req.circle } : {}) } as NewAnn, boxes: texts, segs });
        return true;
      }
    }
    return false;
  }
}

/** dvě úsečky se vlastně kříží (průsečík uvnitř obou, ne jen dotyk koncem) */
export function segsCross(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const o = (u: Vec2, v: Vec2, w: Vec2) => {
    const x = (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    return Math.abs(x) < 1e-9 ? 0 : Math.sign(x);
  };
  return o(p, q, a) * o(p, q, b) < 0 && o(a, b, p) * o(a, b, q) < 0;
}

/** dvě úsečky na téže přímce, které se překrývají (kóty přes sebe) */
function overlapCollinear(p: Vec2, q: Vec2, a: Vec2, b: Vec2): boolean {
  const horiz = (s: Vec2, t: Vec2) => Math.abs(s[1] - t[1]) < 0.3;
  const vert = (s: Vec2, t: Vec2) => Math.abs(s[0] - t[0]) < 0.3;
  if (horiz(p, q) && horiz(a, b) && Math.abs(p[1] - a[1]) < 0.3) return Math.min(Math.max(p[0], q[0]), Math.max(a[0], b[0])) - Math.max(Math.min(p[0], q[0]), Math.min(a[0], b[0])) > 0.3;
  if (vert(p, q) && vert(a, b) && Math.abs(p[0] - a[0]) < 0.3) return Math.min(Math.max(p[1], q[1]), Math.max(a[1], b[1])) - Math.max(Math.min(p[1], q[1]), Math.min(a[1], b[1])) > 0.3;
  return false;
}
