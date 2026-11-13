/**
 * Zadání bodu textem (příkazový řádek i agenti) – jako AutoCAD:
 *   x,y         absolutně            @dx,dy   relativně k poslednímu bodu      @d<a   relativně polárně (a ve °)
 *   d<a         polárně od počátku   #x,y     absolutně (přepis dynamického zadání)  @   poslední bod
 * a přesné body entit (uchopení textem):
 *   e3.start / e3.end / e3.mid / e3.cen / e3.q1…q4 / e3.v2 (vrchol křivky) / e3.ins     (cs: zac, kon, pul, str; de: anf, ende, mitte, zen)
 *   x(e1,e2[,k])  průsečík (k = pořadí, nebo bod nápovědy x(e1,e2,10,5))    (cs: pr(…), de: sp(…))
 *   per(e3)  pata kolmice z předchozího bodu   tan(e3[,k])  bod dotyku tečny z předchozího bodu   nea(e3,x,y)  nejbližší bod
 * Čísla smí být výrazy (100/3, 2*25). Desetinná tečka.
 */
import { tr } from "../i18n";
import { cClosest, cEnd, cIntersect, cPerpFrom, cPoint, cStart, cTangentFrom, type Curve } from "./curves";
import { add, dist, polar, rad } from "./geom";
import { entityCurves, kindOf, type KindCtx } from "./kinds";
import { entityById, type DraftEntity, type DraftModel, type Vec2 } from "./model";
import { evalNumber } from "./units";

export type CoordCtx = {
  model: DraftModel;
  list: readonly DraftEntity[];
  /** poslední zadaný bod (LASTPOINT) pro @ */
  last: Vec2 | null;
  /** základní bod aktuální výzvy (pro per / tan) */
  base?: Vec2 | null;
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const NUM = (s: string) => evalNumber(s);

/** je token zápis bodu (bez vyhodnocení odkazů)? */
export function looksLikePoint(t: string): boolean {
  return /^[@#]?[^,<]+,[^,<]+$/.test(t) || /^@?[^<,]+<[^<,]+$/.test(t) || t === "@" || /^e\d+\.\w+$/i.test(t) || /^(x|int|pr|sp|per|kol|lot|tan|tec|nea|bli|nae)\(.*\)$/i.test(t);
}

const REF: Record<string, string> = {
  start: "start", zac: "start", zacatek: "start", anf: "start", anfang: "start", s: "start",
  end: "end", kon: "end", konec: "end", ende: "end", e: "end",
  mid: "mid", pul: "mid", polovina: "mid", mitte: "mid", m: "mid",
  cen: "cen", center: "cen", str: "cen", stred: "cen", zen: "cen", zentrum: "cen", c: "cen",
  ins: "ins", vlozeni: "ins", einf: "ins",
};

function entityFor(ctx: CoordCtx, id: string): DraftEntity {
  const e = entityById(ctx.list as DraftEntity[], id.toLowerCase());
  if (!e) throw new Error(tr("entita {0} neexistuje", id));
  return e;
}

/** bod entity podle názvu (start, end, mid, cen, q1–q4, v1…, ins) */
function entityPoint(ctx: CoordCtx, id: string, what0: string): Vec2 {
  const e = entityFor(ctx, id);
  const kctx: KindCtx = { model: ctx.model };
  const k = kindOf(e)!;
  const what = fold(what0);
  const vm = /^(v|p)(\d+)$/.exec(what);
  if (vm && "pts" in e && Array.isArray((e as { pts: Vec2[] }).pts)) {
    const pts = (e as { pts: Vec2[] }).pts;
    const i = Number(vm[2]) - 1;
    if (i < 0 || i >= pts.length) throw new Error(tr("{0} nemá vrchol {1} (vrcholů {2})", id, i + 1, pts.length));
    return pts[i];
  }
  const qm = /^q([1-4])$/.exec(what);
  const snaps = k.snaps(e, kctx);
  if (qm) {
    const qs = snaps.filter((s) => s.kind === "qua");
    if (e.type === "circle" || e.type === "ellipse") {
      const q = Number(qm[1]) - 1;
      const pt = e.type === "circle" ? polar(e.c, (q * Math.PI) / 2, e.r) : null;
      if (pt) return pt;
    }
    const q = qs[Number(qm[1]) - 1];
    if (!q) throw new Error(tr("{0} nemá kvadrant {1}", id, qm[1]));
    return q.p;
  }
  const ref = REF[what];
  if (!ref) throw new Error(tr("neznámý bod entity „{0}“ – start, end, mid, cen, q1–q4, v1…, ins", what0));
  const cs = entityCurves(e, kctx);
  if (ref === "start" || ref === "end") {
    if ("pts" in e && Array.isArray((e as { pts: Vec2[] }).pts)) {
      const pts = (e as { pts: Vec2[] }).pts;
      return ref === "start" ? pts[0] : (e as { closed?: boolean }).closed ? pts[0] : pts[pts.length - 1];
    }
    if (e.type === "line") return ref === "start" ? e.a : e.b;
    const c = cs[ref === "start" ? 0 : cs.length - 1];
    if (!c) throw new Error(tr("{0} nemá koncové body", id));
    return ref === "start" ? cStart(c) : cEnd(c);
  }
  const hit = snaps.find((s) => s.kind === ref);
  if (hit && ref !== "mid") return hit.p;
  if (ref === "mid") {
    if (hit && e.type !== "polyline") return hit.p;
    // polovina délky celé entity
    const total = cs.reduce((s, c) => s + curveLen(c), 0);
    let acc = 0;
    for (const c of cs) {
      const L = curveLen(c);
      if (acc + L >= total / 2) return pointAtLength(c, total / 2 - acc);
      acc += L;
    }
  }
  throw new Error(tr("{0} ({1}) nemá bod „{2}“", id, k.label(), what0));
}

function curveLen(c: Curve) {
  if (c.k === "line") return dist(c.a, c.b);
  if (c.k === "arc") return c.r * c.sweep;
  // elipsa / spline: vzorkování
  let L = 0;
  let prev = cStart(c);
  const [t0, t1] = c.k === "ell" ? [c.t0, c.t1] : [c.knots[c.deg], c.knots[c.ctrl.length]];
  for (let i = 1; i <= 256; i++) {
    const p = cPoint(c, t0 + ((t1 - t0) * i) / 256);
    L += dist(prev, p);
    prev = p;
  }
  return L;
}
function pointAtLength(c: Curve, s: number): Vec2 {
  if (c.k === "line") return add(c.a, [((c.b[0] - c.a[0]) * s) / dist(c.a, c.b), ((c.b[1] - c.a[1]) * s) / dist(c.a, c.b)]);
  if (c.k === "arc") return cPoint(c, c.rev ? c.sweep - s / c.r : s / c.r);
  const [t0, t1] = c.k === "ell" ? [c.t0, c.t1] : [c.knots[c.deg], c.knots[c.ctrl.length]];
  let L = 0;
  let prev = cStart(c);
  for (let i = 1; i <= 512; i++) {
    const t = t0 + ((t1 - t0) * i) / 512;
    const p = cPoint(c, t);
    L += dist(prev, p);
    if (L >= s) return p;
    prev = p;
  }
  return cEnd(c);
}

const allCurves = (ctx: CoordCtx, id: string) => entityCurves(entityFor(ctx, id), { model: ctx.model });

/**
 * Bod ze zápisu; null = token není zápis bodu (číslo, klíčové slovo…). Chybný odkaz / výraz = výjimka s důvodem.
 */
export function parsePoint(tok: string, ctx: CoordCtx): Vec2 | null {
  const t = tok.trim();
  if (!t) return null;
  if (t === "@") {
    if (!ctx.last) throw new Error(tr("@ = poslední bod – zatím nebyl zadán žádný bod"));
    return ctx.last;
  }
  // odkazy na entity
  const er = /^(e\d+)\.(\w+)$/i.exec(t);
  if (er) return entityPoint(ctx, er[1], er[2]);
  const fn = /^(\w+)\((.*)\)$/.exec(t);
  if (fn) {
    const name = fold(fn[1]);
    const args = fn[2].split(",").map((s) => s.trim());
    if (["x", "int", "pr", "sp"].includes(name)) {
      if (args.length < 2) throw new Error(tr("průsečík: x(e1,e2) nebo x(e1,e2,k) nebo x(e1,e2,x,y)"));
      const A = allCurves(ctx, args[0]);
      const B = allCurves(ctx, args[1]);
      const hits: Vec2[] = [];
      for (const a of A) for (const b of B) for (const p of cIntersect(a, b)) if (!hits.some((q) => dist(p, q) < 1e-9)) hits.push(p);
      if (!hits.length) throw new Error(tr("{0} a {1} se neprotínají", args[0], args[1]));
      hits.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      if (args.length >= 4) {
        const h: Vec2 = [NUM(args[2]), NUM(args[3])];
        return hits.reduce((best, p) => (dist(p, h) < dist(best, h) ? p : best), hits[0]);
      }
      const k = args[2] ? Math.round(NUM(args[2])) : 1;
      if (!(k >= 1 && k <= hits.length)) throw new Error(tr("{0} a {1} mají {2} průsečíků – pořadí {3} neexistuje", args[0], args[1], hits.length, args[2]));
      return hits[k - 1];
    }
    if (["per", "kol", "lot"].includes(name)) {
      const base = ctx.base ?? ctx.last;
      if (!base) throw new Error(tr("kolmo: chybí výchozí bod (zadejte nejdřív první bod)"));
      const out: Vec2[] = [];
      for (const c of allCurves(ctx, args[0])) out.push(...cPerpFrom(c, base));
      if (!out.length) throw new Error(tr("z bodu nelze spustit kolmici na {0}", args[0]));
      return out.reduce((b, p) => (dist(p, base) < dist(b, base) ? p : b), out[0]);
    }
    if (["tan", "tec"].includes(name)) {
      const base = ctx.base ?? ctx.last;
      if (!base) throw new Error(tr("tečně: chybí výchozí bod (zadejte nejdřív první bod)"));
      const out: Vec2[] = [];
      for (const c of allCurves(ctx, args[0])) out.push(...cTangentFrom(c, base));
      if (!out.length) throw new Error(tr("z bodu nevede tečna k {0}", args[0]));
      out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      const k = args[1] ? Math.round(NUM(args[1])) : 1;
      if (!(k >= 1 && k <= out.length)) throw new Error(tr("k {0} vedou {1} tečny – pořadí {2} neexistuje", args[0], out.length, args[1]));
      return out[k - 1];
    }
    if (["nea", "bli", "nae"].includes(name)) {
      if (args.length < 3) throw new Error(tr("nejbližší: nea(e3,x,y)"));
      const h: Vec2 = [NUM(args[1]), NUM(args[2])];
      let best: Vec2 | null = null;
      for (const c of allCurves(ctx, args[0])) {
        const r = cClosest(c, h);
        if (!best || dist(r.p, h) < dist(best, h)) best = r.p;
      }
      if (!best) throw new Error(tr("{0} nemá křivku", args[0]));
      return best;
    }
    return null;
  }
  let s = t;
  let rel = false;
  if (s.startsWith("@")) {
    rel = true;
    s = s.slice(1);
  } else if (s.startsWith("#")) s = s.slice(1);
  const base: Vec2 = rel ? (ctx.last ?? (() => { throw new Error(tr("@ = relativně k poslednímu bodu – zatím nebyl zadán žádný bod")); })()) : [0, 0];
  const pol = /^([^<]+)<([^<]+)$/.exec(s);
  if (pol) {
    const d = NUM(pol[1]);
    const a = NUM(pol[2].replace("°", ""));
    if (!Number.isFinite(d) || !Number.isFinite(a)) throw new Error(tr("neplatný polární zápis „{0}“ – vzdálenost<úhel, např. @50<30", tok));
    return polar(base, rad(a), d);
  }
  const parts = s.split(",");
  if (parts.length === 2) {
    const x = NUM(parts[0]);
    const y = NUM(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(tr("neplatné souřadnice „{0}“ – x,y s desetinnou tečkou, např. 12.5,40", tok));
    return rel ? add(base, [x, y]) : [x, y];
  }
  if (parts.length > 2) throw new Error(tr("neplatné souřadnice „{0}“ – x,y s desetinnou tečkou (čárka odděluje x a y)", tok));
  return null;
}
