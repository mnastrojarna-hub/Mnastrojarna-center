/**
 * Kreslicí příkazy 2D výkresu (jako AutoCAD): ČÁRA, KŘIVKA, KRUŽNICE, OBLOUK, OBDÉLNÍK, MNOHOÚHELNÍK, ELIPSA,
 * SPLINE, PŘÍMKA, POLOPŘÍMKA, BOD, TEXT. Výzvy a volby jsou stejné v GUI i v textu (`2d čára 0,0 100,0 @0,50 uzavřít`).
 */
import { tr } from "../i18n";
import { cIntersect, cClosest, clampedKnots, type Curve } from "./curves";
import { add, angleOf, arc3, bulgeArc, bulgeOf, circle3, deg, dist, len, mid, mul, normA, polar, rad, rot90, sub, tangentBulge, TAU, unit } from "./geom";
import { entityCurves, kindLabel } from "./kinds";
import { splineFromFit } from "./kinds-core";
import type { DArc, NewEntity, TextHAlign, TextVAlign, Vec2 } from "./model";
import { kw, registerCommand, type CmdCtx, type CmdGen, type Input, type Kw } from "./commands";
import { normDeg } from "./units";

export const K = {
  undo: kw("undo", "Zpět", "Undo", "Zurück"),
  close: kw("close", "Uzavřít", "Close", "Schließen"),
  arc: kw("arc", "Oblouk", "Arc", "Bogen"),
  line: kw("line", "Úsečka", "Line", "Linie"),
  width: kw("width", "Šířka", "Width", "Breite"),
  halfwidth: kw("halfwidth", "Pološířka", "Halfwidth", "Halbbreite"),
  second: kw("second", "Druhý", "Second", "Zweiter"),
  center: kw("center", "Střed", "Center", "Mittelpunkt"),
  end: kw("end", "Konec", "End", "Endpunkt"),
  angle: kw("angle", "Úhel", "Angle", "Winkel"),
  chord: kw("chord", "Tětiva", "Chord", "Sehne"),
  radius: kw("radius", "Poloměr", "Radius", "Radius"),
  direction: kw("direction", "Směr", "Direction", "Richtung"),
  diameter: kw("diameter", "Průměr", "Diameter", "Durchmesser"),
  p3: kw("3p", "3B", "3P", "3P"),
  p2: kw("2p", "2B", "2P", "2P"),
  ttr: kw("ttr", "TTP", "Ttr", "TTR"),
  chamfer: kw("chamfer", "Zkosení", "Chamfer", "Fase"),
  fillet: kw("fillet", "Zaoblení", "Fillet", "Abrunden"),
  rotation: kw("rotation", "Natočení", "Rotation", "Drehung"),
  dimensions: kw("dimensions", "Rozměry", "Dimensions", "Abmessungen"),
  edge: kw("edge", "Hrana", "Edge", "Kante"),
  inscribed: kw("inscribed", "Vepsaný", "Inscribed", "Umkreis"),
  circumscribed: kw("circumscribed", "Opsaný", "Circumscribed", "Inkreis"),
  method: kw("method", "Metoda", "Method", "Methode"),
  fit: kw("fit", "Proložit", "Fit", "Anpassen"),
  cv: kw("cv", "Řídicí", "CV", "SKP"),
  degree: kw("degree", "Stupeň", "Degree", "Grad"),
  hor: kw("hor", "Vodorovně", "Hor", "Hor"),
  ver: kw("ver", "Svisle", "Ver", "Ver"),
  ang: kw("ang", "Úhel", "Ang", "Winkel"),
  bisect: kw("bisect", "Osa", "Bisect", "Halbieren"),
  offset: kw("offset", "Odsazení", "Offset", "Abstand"),
  justify: kw("justify", "Zarovnání", "Justify", "Ausrichten"),
  style: kw("style", "Styl", "Style", "Stil"),
  param: kw("parameter", "Parametr", "Parameter", "Parameter"),
  included: kw("included", "Celkový", "Included", "Eingeschlossen"),
};

/** protokol vytvořených entit: „✓ Úsečka: e1, e2“ */
export function logCreated(c: CmdCtx, ids: string[]) {
  if (!ids.length) return c.log(tr("nic nevzniklo"));
  const by = new Map<string, string[]>();
  for (const id of ids) {
    const e = c.tx.get(id);
    if (!e) continue;
    const k = kindLabel(e.type);
    by.set(k, [...(by.get(k) ?? []), id]);
  }
  for (const [k, l] of by) c.log(`✓ ${k}: ${l.join(", ")}`);
}

/** oblouk entity ze středu, poloměru, počátečního úhlu a znaménkového úhlu oblouku (rad) */
export function arcEntity(c: Vec2, r: number, aStart: number, sweep: number): Omit<DArc, "id" | "layer"> {
  const a0 = sweep >= 0 ? aStart : aStart + sweep;
  const s = Math.abs(sweep);
  return { type: "arc", c, r, a0: normDeg(deg(a0)), a1: normDeg(deg(a0 + s)) };
}

// ---------------------------------------------------------------- ČÁRA

registerCommand({
  id: "LINE",
  names: { cs: ["čára", "úsečka", "cara", "usecka"], en: ["line"], de: ["linie"] },
  alias: ["L"],
  group: "draw",
  desc: () => tr("úsečky na sebe navazující (každý úsek je samostatná entita); Uzavřít spojí s prvním bodem, Zpět vrátí poslední úsek"),
  usage: () => tr("čára x,y x,y [@dx,dy | @d<úhel | délka] … [uzavřít]"),
  run: function* (c): CmdGen {
    const i0 = yield { k: "point", msg: tr("Zadejte první bod") };
    if (i0.k !== "point") return;
    const first = i0.p;
    const pts: Vec2[] = [first];
    const ids: string[] = [];
    for (;;) {
      const prev = pts[pts.length - 1];
      const kws = ids.length >= 2 ? [K.close, K.undo] : [K.undo];
      const inp = yield { k: "point", msg: tr("Zadejte další bod"), base: prev, kw: kws, none: true, preview: (p) => [{ type: "line", a: prev, b: p }], ...(pts.length > 1 ? { dir: unit(sub(prev, pts[pts.length - 2])) } : {}) };
      if (inp.k === "none") break;
      if (inp.k === "kw" && inp.id === "undo") {
        if (ids.length) {
          c.tx.remove(ids.pop()!);
          pts.pop();
          c.setLast(pts[pts.length - 1]);
        } else c.log(tr("není co vrátit"));
        continue;
      }
      if (inp.k === "kw" && inp.id === "close") {
        ids.push(c.tx.add({ type: "line", a: prev, b: first }));
        c.setLast(first);
        break;
      }
      if (inp.k !== "point") continue;
      if (dist(prev, inp.p) < 1e-12) {
        c.log(tr("bod je totožný s předchozím – přeskočen"));
        continue;
      }
      ids.push(c.tx.add({ type: "line", a: prev, b: inp.p }));
      pts.push(inp.p);
    }
    logCreated(c, ids);
  },
});

// ---------------------------------------------------------------- KŘIVKA (PLINE)

registerCommand({
  id: "PLINE",
  names: { cs: ["křivka", "polyčára", "krivka", "polycara"], en: ["pline", "polyline"], de: ["polylinie", "plinie"] },
  alias: ["PL"],
  group: "draw",
  desc: () => tr("jedna entita z úseků a oblouků (Oblouk = tečný oblouk, Druhý = oblouk třemi body, Úsečka = zpět na úseky), šířka, uzavření"),
  usage: () => tr("křivka x,y x,y [oblouk x,y [druhý x,y x,y] | úsečka x,y | šířka w0 w1] … [uzavřít]"),
  run: function* (c): CmdGen {
    const i0 = yield { k: "point", msg: tr("Zadejte počáteční bod") };
    if (i0.k !== "point") return;
    const pts: Vec2[] = [i0.p];
    const bul: number[] = [];
    const wid: [number, number][] = [];
    let arcMode = false;
    let w0 = 0;
    let w1 = 0;
    let closed = false;
    const tangent = (): Vec2 => {
      const n = pts.length;
      if (n < 2) return [1, 0];
      const a = pts[n - 2];
      const b = pts[n - 1];
      const bu = bul[n - 2] ?? 0;
      if (Math.abs(bu) < 1e-12) return unit(sub(b, a));
      const arc = bulgeArc(a, b, bu);
      const r = unit(sub(b, arc.c));
      return arc.sweep > 0 ? rot90(r) : mul(rot90(r), -1);
    };
    const preview = (p: Vec2): NewEntity[] => {
      const b = arcMode ? tangentBulge(pts[pts.length - 1], tangent(), p) : 0;
      return [{ type: "polyline", pts: [...pts, p], bulges: [...bul, b, 0] }];
    };
    for (;;) {
      const prev = pts[pts.length - 1];
      const kws = arcMode ? [K.line, K.second, K.close, K.width, K.undo] : [K.arc, K.close, K.width, K.halfwidth, K.undo];
      const inp = yield { k: "point", msg: arcMode ? tr("Zadejte koncový bod oblouku") : tr("Zadejte další bod"), base: prev, kw: pts.length >= 2 ? kws : kws.filter((k) => k.id !== "close"), none: true, preview };
      if (inp.k === "none") break;
      if (inp.k === "kw") {
        if (inp.id === "arc") arcMode = true;
        else if (inp.id === "line") arcMode = false;
        else if (inp.id === "close") {
          closed = true;
          if (arcMode) bul[pts.length - 1] = tangentBulge(prev, tangent(), pts[0]);
          break;
        } else if (inp.id === "undo") {
          if (pts.length > 1) {
            pts.pop();
            bul.pop();
            wid.pop();
          }
        } else if (inp.id === "width" || inp.id === "halfwidth") {
          const k = inp.id === "halfwidth" ? 2 : 1;
          const a = yield { k: "dist", msg: inp.id === "width" ? tr("Zadejte počáteční šířku") : tr("Zadejte počáteční pološířku"), base: prev, def: w0 / k, min: 0 };
          if (a.k !== "num") continue;
          w0 = a.v * k;
          const b = yield { k: "dist", msg: inp.id === "width" ? tr("Zadejte koncovou šířku") : tr("Zadejte koncovou pološířku"), base: prev, def: w0 / k, min: 0 };
          w1 = b.k === "num" ? b.v * k : w0;
        } else if (inp.id === "second") {
          const s = yield { k: "point", msg: tr("Zadejte druhý bod oblouku"), base: prev };
          if (s.k !== "point") continue;
          const e = yield { k: "point", msg: tr("Zadejte koncový bod oblouku"), base: s.p, preview: (p) => { const r = arc3(prev, s.p, p); return r ? [{ type: "polyline", pts: [...pts, p], bulges: [...bul, bulgeOf(dirSweep(prev, s.p, p)), 0] }] : []; } };
          if (e.k !== "point") continue;
          if (!arc3(prev, s.p, e.p)) {
            c.log(tr("body leží v přímce – oblouk nevznikl"));
            continue;
          }
          bul[pts.length - 1] = bulgeOf(dirSweep(prev, s.p, e.p));
          wid[pts.length - 1] = [w0, w1];
          pts.push(e.p);
          w0 = w1;
        }
        continue;
      }
      if (inp.k !== "point") continue;
      if (dist(prev, inp.p) < 1e-12) continue;
      bul[pts.length - 1] = arcMode ? tangentBulge(prev, tangent(), inp.p) : 0;
      wid[pts.length - 1] = [w0, w1];
      pts.push(inp.p);
      w0 = w1;
    }
    if (pts.length < 2) return c.log(tr("křivka potřebuje alespoň dva body"));
    const n = pts.length;
    const bulges = Array.from({ length: n }, (_, i) => bul[i] ?? 0);
    const widths = Array.from({ length: n }, (_, i) => wid[i] ?? ([w0, w1] as [number, number]));
    const constW = widths.every(([a, b]) => Math.abs(a - widths[0][0]) < 1e-12 && Math.abs(b - widths[0][0]) < 1e-12) ? widths[0][0] : null;
    const e: NewEntity = {
      type: "polyline",
      pts,
      ...(bulges.some((b) => Math.abs(b) > 1e-12) ? { bulges } : {}),
      ...(constW === null ? { widths } : constW > 0 ? { width: constW } : {}),
      ...(closed ? { closed: true } : {}),
    };
    logCreated(c, [c.tx.add(e)]);
  },
});

/** znaménkový úhel oblouku a → m → b (rad) */
function dirSweep(a: Vec2, m: Vec2, b: Vec2): number {
  const r = arc3(a, m, b)!;
  const sa = angleOf(sub(a, r.c));
  const sb = angleOf(sub(b, r.c));
  const sm = angleOf(sub(m, r.c));
  const ccw = normA(sm - sa) <= normA(sb - sa);
  return ccw ? normA(sb - sa) : -normA(sa - sb);
}

// ---------------------------------------------------------------- KRUŽNICE

/** kružnice daného poloměru tečná ke dvěma křivkám (úsečky / oblouky), nejblíž bodům výběru */
export function circleTTR(c1: Curve, p1: Vec2, c2: Curve, p2: Vec2, r: number): { c: Vec2; r: number } | null {
  const offs = (c: Curve): Curve[] => {
    if (c.k === "line") {
      const n = mul(unit(rot90(sub(c.b, c.a))), r);
      return [
        { k: "line", a: add(c.a, n), b: add(c.b, n), inf: 2 },
        { k: "line", a: sub(c.a, n), b: sub(c.b, n), inf: 2 },
      ];
    }
    if (c.k === "arc") return [{ k: "arc", c: c.c, r: c.r + r, a0: 0, sweep: TAU }, ...(Math.abs(c.r - r) > 1e-12 ? [{ k: "arc" as const, c: c.c, r: Math.abs(c.r - r), a0: 0, sweep: TAU }] : [])];
    return [];
  };
  let best: { c: Vec2; r: number } | null = null;
  let bd = Infinity;
  for (const a of offs(c1))
    for (const b of offs(c2))
      for (const x of cIntersect(a, b, true)) {
        const t1 = cClosest(c1.k === "line" ? { ...c1, inf: 2 } : { ...c1, a0: 0, sweep: TAU } as Curve, x).p;
        const t2 = cClosest(c2.k === "line" ? { ...c2, inf: 2 } : { ...c2, a0: 0, sweep: TAU } as Curve, x).p;
        const d = dist(t1, p1) + dist(t2, p2);
        if (d < bd) {
          bd = d;
          best = { c: x, r };
        }
      }
  return best;
}

let lastRadius = 10;
registerCommand({
  id: "CIRCLE",
  names: { cs: ["kružnice", "kruznice"], en: ["circle"], de: ["kreis"] },
  alias: ["C"],
  group: "draw",
  desc: () => tr("kružnice: střed a poloměr / průměr, třemi body (3B), dvěma body průměru (2B), tečná ke dvěma objektům s poloměrem (TTP)"),
  usage: () => tr("kružnice x,y r | kružnice x,y průměr d | kružnice 3b p1 p2 p3 | kružnice 2b p1 p2 | kružnice ttp e1 e2 r"),
  run: function* (c): CmdGen {
    const i0 = yield { k: "point", msg: tr("Zadejte střed kružnice"), kw: [K.p3, K.p2, K.ttr] };
    let ent: NewEntity | null = null;
    if (i0.k === "point") {
      const cc = i0.p;
      const r = yield { k: "dist", msg: tr("Zadejte poloměr kružnice"), base: cc, kw: [K.diameter], def: lastRadius, min: 1e-12, preview: (p) => [{ type: "circle", c: cc, r: Math.max(1e-9, dist(cc, p)) }] };
      if (r.k === "num") ent = { type: "circle", c: cc, r: r.v };
      else if (r.k === "kw") {
        const d = yield { k: "dist", msg: tr("Zadejte průměr kružnice"), base: cc, def: lastRadius * 2, min: 1e-12, preview: (p) => [{ type: "circle", c: cc, r: Math.max(1e-9, dist(cc, p) / 2) }] };
        if (d.k === "num") ent = { type: "circle", c: cc, r: d.v / 2 };
      }
    } else if (i0.k === "kw" && i0.id === "3p") {
      const a = yield { k: "point", msg: tr("Zadejte první bod na kružnici") };
      if (a.k !== "point") return;
      const b = yield { k: "point", msg: tr("Zadejte druhý bod na kružnici"), base: a.p, preview: (p) => [{ type: "line", a: a.p, b: p }] };
      if (b.k !== "point") return;
      const d = yield { k: "point", msg: tr("Zadejte třetí bod na kružnici"), base: b.p, preview: (p) => { const k = circle3(a.p, b.p, p); return k ? [{ type: "circle", c: k.c, r: k.r }] : []; } };
      if (d.k !== "point") return;
      const k = circle3(a.p, b.p, d.p);
      if (!k) throw new Error(tr("body leží v přímce – kružnice nevznikla"));
      ent = { type: "circle", c: k.c, r: k.r };
    } else if (i0.k === "kw" && i0.id === "2p") {
      const a = yield { k: "point", msg: tr("Zadejte první koncový bod průměru") };
      if (a.k !== "point") return;
      const b = yield { k: "point", msg: tr("Zadejte druhý koncový bod průměru"), base: a.p, preview: (p) => [{ type: "circle", c: mid(a.p, p), r: Math.max(1e-9, dist(a.p, p) / 2) }] };
      if (b.k !== "point") return;
      if (dist(a.p, b.p) < 1e-12) throw new Error(tr("body průměru jsou totožné"));
      ent = { type: "circle", c: mid(a.p, b.p), r: dist(a.p, b.p) / 2 };
    } else if (i0.k === "kw" && i0.id === "ttr") {
      const okCurve = (e: { type: string }) => ["line", "circle", "arc", "polyline", "xline", "ray"].includes(e.type);
      const e1 = yield { k: "entity", msg: tr("Vyberte první objekt pro tečnu"), filter: okCurve };
      if (e1.k !== "ent") return;
      const e2 = yield { k: "entity", msg: tr("Vyberte druhý objekt pro tečnu"), filter: okCurve };
      if (e2.k !== "ent") return;
      const r = yield { k: "dist", msg: tr("Zadejte poloměr kružnice"), def: lastRadius, min: 1e-12 };
      if (r.k !== "num") return;
      const pickCurve = (id: string, p: Vec2) => {
        const cs = entityCurves(c.tx.get(id)!, c.kctx()).filter((x) => x.k === "line" || x.k === "arc");
        return cs.reduce((b, x) => (cClosest(x, p).d < cClosest(b, p).d ? x : b), cs[0]);
      };
      const c1 = pickCurve(e1.id, e1.p);
      const c2 = pickCurve(e2.id, e2.p);
      const k = c1 && c2 ? circleTTR(c1, e1.p, c2, e2.p, r.v) : null;
      if (!k) throw new Error(tr("kružnice s poloměrem {0} tečná k oběma objektům neexistuje", r.v));
      ent = { type: "circle", c: k.c, r: k.r };
    }
    if (!ent) return;
    lastRadius = (ent as { r: number }).r;
    logCreated(c, [c.tx.add(ent)]);
  },
});

// ---------------------------------------------------------------- OBLOUK

registerCommand({
  id: "ARC",
  names: { cs: ["oblouk"], en: ["arc"], de: ["bogen"] },
  alias: ["A"],
  group: "draw",
  desc: () => tr("oblouk: třemi body; počátek-střed-konec / úhel / tětiva; počátek-konec-úhel / směr / poloměr; střed-počátek-konec / úhel (proti směru hodin)"),
  usage: () => tr("oblouk p1 p2 p3 | oblouk p1 střed c p2 | oblouk p1 střed c úhel 90 | oblouk p1 konec p2 poloměr r | oblouk střed c p1 p2"),
  run: function* (c): CmdGen {
    const a0 = yield { k: "point", msg: tr("Zadejte počáteční bod oblouku"), kw: [K.center] };
    let S: Vec2 | null = null;
    let C: Vec2 | null = null;
    if (a0.k === "point") S = a0.p;
    else if (a0.k === "kw") {
      const cc = yield { k: "point", msg: tr("Zadejte střed oblouku") };
      if (cc.k !== "point") return;
      C = cc.p;
      const ss = yield { k: "point", msg: tr("Zadejte počáteční bod oblouku"), base: C, preview: (p) => [{ type: "line", a: C!, b: p }] };
      if (ss.k !== "point") return;
      S = ss.p;
    } else return;
    let arc: NewEntity | null = null;
    const s = S!;
    if (!C) {
      const b = yield { k: "point", msg: tr("Zadejte druhý bod oblouku"), base: s, kw: [K.center, K.end] };
      if (b.k === "point") {
        const e = yield { k: "point", msg: tr("Zadejte koncový bod oblouku"), base: b.p, preview: (p) => { const r = arc3(s, b.p, p); return r ? [arcEntity(r.c, r.r, angleOf(sub(s, r.c)), dirSweep(s, b.p, p))] : []; } };
        if (e.k !== "point") return;
        const r = arc3(s, b.p, e.p);
        if (!r) throw new Error(tr("body leží v přímce – oblouk nevznikl"));
        arc = arcEntity(r.c, r.r, angleOf(sub(s, r.c)), dirSweep(s, b.p, e.p));
      } else if (b.k === "kw" && b.id === "center") {
        const cc = yield { k: "point", msg: tr("Zadejte střed oblouku"), base: s };
        if (cc.k !== "point") return;
        C = cc.p;
      } else if (b.k === "kw" && b.id === "end") {
        const e = yield { k: "point", msg: tr("Zadejte koncový bod oblouku"), base: s };
        if (e.k !== "point") return;
        const E = e.p;
        if (dist(s, E) < 1e-12) throw new Error(tr("počátek a konec oblouku jsou totožné"));
        const fromBulge = (bu: number) => {
          const r = bulgeArc(s, E, bu);
          return arcEntity(r.c, r.r, r.a0, r.sweep);
        };
        const o = yield { k: "point", msg: tr("Zadejte střed oblouku"), base: s, kw: [K.angle, K.direction, K.radius], preview: (p) => (dist(p, s) > 1e-9 ? [arcEntity(p, dist(p, s), angleOf(sub(s, p)), normA(angleOf(sub(E, p)) - angleOf(sub(s, p))))] : []) };
        if (o.k === "point") arc = arcEntity(o.p, dist(o.p, s), angleOf(sub(s, o.p)), normA(angleOf(sub(E, o.p)) - angleOf(sub(s, o.p))) || TAU);
        else if (o.k === "kw" && o.id === "angle") {
          const a = yield { k: "angle", msg: tr("Zadejte celkový úhel oblouku"), def: 90 };
          if (a.k !== "num" || Math.abs(a.v) < 1e-9 || Math.abs(a.v) >= 360) throw new Error(tr("úhel oblouku musí být mezi 0° a 360°"));
          arc = fromBulge(Math.tan(rad(a.v) / 4));
        } else if (o.k === "kw" && o.id === "direction") {
          const d = yield { k: "angle", msg: tr("Zadejte směr tečny v počátečním bodě"), base: s };
          if (d.k !== "num") return;
          arc = fromBulge(tangentBulge(s, [Math.cos(rad(d.v)), Math.sin(rad(d.v))], E));
        } else if (o.k === "kw" && o.id === "radius") {
          const r = yield { k: "dist", msg: tr("Zadejte poloměr oblouku (záporný = větší oblouk)"), def: dist(s, E) };
          if (r.k !== "num") return;
          const ch = dist(s, E);
          if (Math.abs(r.v) < ch / 2 - 1e-12) throw new Error(tr("poloměr {0} je menší než polovina tětivy {1}", Math.abs(r.v), ch / 2));
          let th = 2 * Math.asin(Math.min(1, ch / (2 * Math.abs(r.v))));
          if (r.v < 0) th = TAU - th;
          arc = fromBulge(Math.tan(th / 4));
        } else return;
      } else return;
    }
    if (!arc && C) {
      const cc = C;
      const r = dist(s, cc);
      if (r < 1e-12) throw new Error(tr("počátek oblouku leží ve středu"));
      const as = angleOf(sub(s, cc));
      const e = yield { k: "point", msg: tr("Zadejte koncový bod oblouku"), base: cc, kw: [K.angle, K.chord], preview: (p) => [arcEntity(cc, r, as, normA(angleOf(sub(p, cc)) - as) || TAU)] };
      if (e.k === "point") arc = arcEntity(cc, r, as, normA(angleOf(sub(e.p, cc)) - as) || TAU);
      else if (e.k === "kw" && e.id === "angle") {
        const a = yield { k: "angle", msg: tr("Zadejte celkový úhel oblouku"), def: 90 };
        if (a.k !== "num") return;
        arc = arcEntity(cc, r, as, rad(a.v));
      } else if (e.k === "kw" && e.id === "chord") {
        const l = yield { k: "dist", msg: tr("Zadejte délku tětivy (záporná = větší oblouk)"), def: r };
        if (l.k !== "num") return;
        if (Math.abs(l.v) > 2 * r + 1e-12) throw new Error(tr("tětiva {0} je delší než průměr {1}", Math.abs(l.v), 2 * r));
        let th = 2 * Math.asin(Math.min(1, Math.abs(l.v) / (2 * r)));
        if (l.v < 0) th = TAU - th;
        arc = arcEntity(cc, r, as, th);
      } else return;
    }
    if (!arc) return;
    logCreated(c, [c.tx.add(arc)]);
  },
});

// ---------------------------------------------------------------- OBDÉLNÍK

/** obdélník jako uzavřená křivka (zaoblení / zkosení rohů, natočení) */
export function rectPolyline(p1: Vec2, L: number, W: number, rot: number, opt: { fillet?: number; chamfer?: [number, number] } = {}): NewEntity {
  const u: Vec2 = [Math.cos(rot), Math.sin(rot)];
  const v = rot90(u);
  const P = (x: number, y: number): Vec2 => add(p1, add(mul(u, x), mul(v, y)));
  const sx = Math.sign(L) || 1;
  const sy = Math.sign(W) || 1;
  const corners: Vec2[] = [P(0, 0), P(L, 0), P(L, W), P(0, W)];
  const ccw = sx * sy > 0;
  const f = opt.fillet ?? 0;
  const [d1, d2] = opt.chamfer ?? [0, 0];
  const minSide = Math.min(Math.abs(L), Math.abs(W));
  if (f > 0 && 2 * f <= minSide + 1e-12) {
    const pts: Vec2[] = [];
    const bul: number[] = [];
    const b = (ccw ? 1 : -1) * Math.tan(Math.PI / 8);
    const local: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [L, 0, -1, 1],
      [L, W, -1, -1],
      [0, W, 1, -1],
    ];
    // u každého rohu: bod na předchozí hraně → oblouk → bod na další hraně
    for (let i = 0; i < 4; i++) {
      const [x, y, dx, dy] = local[i];
      const before = i % 2 === 0 ? P(x, y + dy * f * sy) : P(x + dx * f * sx, y);
      const after = i % 2 === 0 ? P(x + dx * f * sx, y) : P(x, y + dy * f * sy);
      pts.push(before, after);
      bul.push(b, 0);
    }
    return { type: "polyline", pts, bulges: bul, closed: true };
  }
  if (d1 > 0 && d2 > 0 && d1 <= Math.abs(L) / 2 + 1e-12 && d2 <= Math.abs(W) / 2 + 1e-12) {
    const pts: Vec2[] = [P(0, d2 * sy), P(d1 * sx, 0), P(L - d1 * sx, 0), P(L, d2 * sy), P(L, W - d2 * sy), P(L - d1 * sx, W), P(d1 * sx, W), P(0, W - d2 * sy)];
    return { type: "polyline", pts, closed: true };
  }
  return { type: "polyline", pts: corners, closed: true };
}

registerCommand({
  id: "RECTANG",
  names: { cs: ["obdélník", "obdelnik"], en: ["rectang", "rectangle"], de: ["rechteck", "rechteck2"] },
  alias: ["REC", "REG"],
  group: "draw",
  desc: () => tr("obdélník jako uzavřená křivka: dva rohy nebo rozměry, zaoblení / zkosení rohů, šířka čáry, natočení"),
  usage: () => tr("obdélník x,y @šířka,výška | obdélník zaoblení r x,y x,y | obdélník x,y rozměry 100 50 | obdélník natočení 30 x,y x,y"),
  run: function* (c): CmdGen {
    let fillet = 0;
    let chamfer: [number, number] | undefined;
    let width = 0;
    let rot = 0;
    let p1: Vec2 | null = null;
    while (!p1) {
      const i = yield { k: "point", msg: tr("Zadejte první roh"), kw: [K.chamfer, K.fillet, K.width, K.rotation] };
      if (i.k === "point") p1 = i.p;
      else if (i.k === "kw") {
        if (i.id === "fillet") {
          const r = yield { k: "dist", msg: tr("Zadejte poloměr zaoblení rohů"), def: fillet, min: 0 };
          if (r.k === "num") fillet = r.v;
          chamfer = undefined;
        } else if (i.id === "chamfer") {
          const a = yield { k: "dist", msg: tr("Zadejte první vzdálenost zkosení"), def: chamfer?.[0] ?? 0, min: 0 };
          const b = yield { k: "dist", msg: tr("Zadejte druhou vzdálenost zkosení"), def: a.k === "num" ? a.v : 0, min: 0 };
          chamfer = [a.k === "num" ? a.v : 0, b.k === "num" ? b.v : 0];
          fillet = 0;
        } else if (i.id === "width") {
          const w = yield { k: "dist", msg: tr("Zadejte šířku čáry obdélníku"), def: width, min: 0 };
          if (w.k === "num") width = w.v;
        } else if (i.id === "rotation") {
          const a = yield { k: "angle", msg: tr("Zadejte úhel natočení"), def: 0 };
          if (a.k === "num") rot = rad(a.v);
        }
      } else return;
    }
    const base = p1;
    const make = (q: Vec2): NewEntity => {
      const d = sub(q, base);
      const u: Vec2 = [Math.cos(rot), Math.sin(rot)];
      const L = d[0] * u[0] + d[1] * u[1];
      const W = -d[0] * u[1] + d[1] * u[0];
      const e = rectPolyline(base, L, W, rot, { fillet, chamfer });
      return width > 0 ? ({ ...e, width } as NewEntity) : e;
    };
    let ent: NewEntity | null = null;
    for (;;) {
      const i = yield { k: "point", msg: tr("Zadejte druhý roh"), base, kw: [K.dimensions, K.rotation], preview: (p) => [make(p)] };
      if (i.k === "point") {
        ent = make(i.p);
        break;
      }
      if (i.k === "kw" && i.id === "rotation") {
        const a = yield { k: "angle", msg: tr("Zadejte úhel natočení"), base, def: deg(rot) };
        if (a.k === "num") rot = rad(a.v);
        continue;
      }
      if (i.k === "kw" && i.id === "dimensions") {
        const l = yield { k: "dist", msg: tr("Zadejte délku obdélníku"), def: 10, min: 1e-12 };
        if (l.k !== "num") return;
        const w = yield { k: "dist", msg: tr("Zadejte šířku obdélníku"), def: 10, min: 1e-12 };
        if (w.k !== "num") return;
        const u: Vec2 = [Math.cos(rot), Math.sin(rot)];
        const v = rot90(u);
        const q = yield { k: "point", msg: tr("Zadejte směr druhého rohu (Enter = vpravo nahoru)"), base, none: true };
        let sx = 1;
        let sy = 1;
        if (q.k === "point") {
          const d = sub(q.p, base);
          sx = d[0] * u[0] + d[1] * u[1] < 0 ? -1 : 1;
          sy = d[0] * v[0] + d[1] * v[1] < 0 ? -1 : 1;
        }
        const e = rectPolyline(base, sx * l.v, sy * w.v, rot, { fillet, chamfer });
        ent = width > 0 ? ({ ...e, width } as NewEntity) : e;
        break;
      }
      return;
    }
    logCreated(c, [c.tx.add(ent)]);
  },
});

// ---------------------------------------------------------------- MNOHOÚHELNÍK

let lastSides = 4;
/** pravidelný mnohoúhelník: střed, poloměr opsané kružnice a úhel prvního vrcholu */
export function polygonPts(cc: Vec2, n: number, R: number, a0: number): Vec2[] {
  return Array.from({ length: n }, (_, i) => polar(cc, a0 + (i * TAU) / n, R));
}
registerCommand({
  id: "POLYGON",
  names: { cs: ["mnohoúhelník", "mnohouhelnik", "polygon"], en: ["polygon"], de: ["vieleck", "polygon2"] },
  alias: ["POL"],
  group: "draw",
  desc: () => tr("pravidelný mnohoúhelník (3–1024 stran): střed a poloměr vepsaný / opsaný, nebo hranou; číslem = spodní hrana vodorovně, bodem = natočení k bodu"),
  usage: () => tr("mnohoúhelník 6 x,y vepsaný 20 | mnohoúhelník 6 x,y opsaný x,y | mnohoúhelník 5 hrana p1 p2"),
  run: function* (c): CmdGen {
    const n0 = yield { k: "int", msg: tr("Zadejte počet stran"), def: lastSides, min: 3, max: 1024 };
    if (n0.k !== "num") return;
    const n = n0.v;
    lastSides = n;
    const ci = yield { k: "point", msg: tr("Zadejte střed mnohoúhelníku"), kw: [K.edge] };
    let pts: Vec2[] | null = null;
    if (ci.k === "kw") {
      const a = yield { k: "point", msg: tr("Zadejte první koncový bod hrany") };
      if (a.k !== "point") return;
      const mk = (b: Vec2) => {
        const s = dist(a.p, b);
        const R = s / (2 * Math.sin(Math.PI / n));
        const m = mid(a.p, b);
        const h = R * Math.cos(Math.PI / n);
        const cc = add(m, mul(unit(rot90(sub(b, a.p))), h));
        return polygonPts(cc, n, R, angleOf(sub(a.p, cc)));
      };
      const b = yield { k: "point", msg: tr("Zadejte druhý koncový bod hrany"), base: a.p, preview: (p) => (dist(p, a.p) > 1e-9 ? [{ type: "polyline", pts: mk(p), closed: true }] : []) };
      if (b.k !== "point") return;
      pts = mk(b.p);
    } else if (ci.k === "point") {
      const cc = ci.p;
      const t = yield { k: "kw", msg: tr("Mnohoúhelník je"), kw: [K.inscribed, K.circumscribed], def: "inscribed" };
      const ins = t.k !== "kw" || t.id === "inscribed";
      const fromPt = (p: Vec2) => {
        const R0 = dist(cc, p);
        const R = ins ? R0 : R0 / Math.cos(Math.PI / n);
        return polygonPts(cc, n, R, angleOf(sub(p, cc)) + (ins ? 0 : Math.PI / n));
      };
      const r = yield { k: "dist", msg: ins ? tr("Zadejte poloměr opsané kružnice") : tr("Zadejte poloměr vepsané kružnice"), base: cc, pt: true, min: 1e-12, preview: (p) => (dist(p, cc) > 1e-9 ? [{ type: "polyline", pts: fromPt(p), closed: true }] : []) };
      if (r.k === "point") pts = fromPt(r.p);
      else if (r.k === "num") {
        const R = ins ? r.v : r.v / Math.cos(Math.PI / n);
        pts = polygonPts(cc, n, R, -Math.PI / 2 - Math.PI / n); // spodní hrana vodorovně
      }
    }
    if (!pts) return;
    logCreated(c, [c.tx.add({ type: "polyline", pts, closed: true })]);
  },
});

// ---------------------------------------------------------------- ELIPSA

/** parametr elipsy pro geometrický úhel φ od hlavní osy */
export const ellParam = (phi: number, ratio: number) => Math.atan2(Math.sin(phi), ratio * Math.cos(phi));

registerCommand({
  id: "ELLIPSE",
  names: { cs: ["elipsa"], en: ["ellipse"], de: ["ellipse"] },
  alias: ["EL"],
  group: "draw",
  desc: () => tr("elipsa osou (dva koncové body + poloosa) nebo středem; Oblouk = eliptický oblouk (počáteční a koncový úhel od první osy, nebo parametr)"),
  usage: () => tr("elipsa p1 p2 b | elipsa střed c p b | elipsa oblouk střed c p b 0 180 | elipsa p1 p2 natočení 60"),
  run: function* (c): CmdGen {
    let isArc = false;
    let i = yield { k: "point", msg: tr("Zadejte koncový bod osy elipsy"), kw: [K.arc, K.center] };
    if (i.k === "kw" && i.id === "arc") {
      isArc = true;
      i = yield { k: "point", msg: tr("Zadejte koncový bod osy eliptického oblouku"), kw: [K.center] };
    }
    let cc: Vec2;
    let axis: Vec2;
    if (i.k === "kw" && i.id === "center") {
      const a = yield { k: "point", msg: tr("Zadejte střed elipsy") };
      if (a.k !== "point") return;
      cc = a.p;
      const b = yield { k: "point", msg: tr("Zadejte koncový bod osy"), base: cc, preview: (p) => [{ type: "line", a: cc, b: p }] };
      if (b.k !== "point") return;
      axis = sub(b.p, cc);
    } else if (i.k === "point") {
      const p1 = i.p;
      const b = yield { k: "point", msg: tr("Zadejte druhý koncový bod osy"), base: p1, preview: (p) => [{ type: "line", a: p1, b: p }] };
      if (b.k !== "point") return;
      cc = mid(p1, b.p);
      axis = sub(b.p, cc);
    } else return;
    if (len(axis) < 1e-12) throw new Error(tr("osa elipsy má nulovou délku"));
    const A = len(axis);
    const mk = (Bh: number) => {
      if (Bh <= A) return { major: axis, ratio: Bh / A, swap: false };
      return { major: mul(unit(rot90(axis)), Bh), ratio: A / Bh, swap: true };
    };
    const o = yield { k: "dist", msg: tr("Zadejte délku druhé poloosy"), base: cc, kw: [K.rotation], min: 1e-12, preview: (p) => { const r = mk(Math.max(1e-9, Math.abs((sub(p, cc)[0] * -axis[1] + sub(p, cc)[1] * axis[0]) / A))); return [{ type: "ellipse", c: cc, major: r.major, ratio: r.ratio }]; } };
    let B: number;
    if (o.k === "num") B = o.v;
    else if (o.k === "kw") {
      const r = yield { k: "angle", msg: tr("Zadejte natočení kolem hlavní osy"), def: 0 };
      if (r.k !== "num" || Math.abs(r.v) >= 89.4) throw new Error(tr("natočení musí být 0°–89,4°"));
      B = A * Math.cos(rad(r.v));
    } else return;
    const g = mk(B);
    if (!isArc) return logCreated(c, [c.tx.add({ type: "ellipse", c: cc, major: g.major, ratio: g.ratio })]);
    // úhly od PRVNÍ zadané osy (po prohození os posun o −90°); bodem = úhel směru od středu
    const shift = g.swap ? -Math.PI / 2 : 0;
    const axAng = angleOf(axis);
    const toT = (phiDeg: number) => ellParam(rad(phiDeg) + shift, g.ratio);
    const relDeg = (inp: Input) => (inp.k === "point" ? deg(angleOf(sub(inp.p, cc)) - axAng) : inp.k === "num" ? inp.v : 0);
    const s = yield { k: "angle", msg: tr("Zadejte počáteční úhel"), base: cc, kw: [K.param], def: 0, pt: true };
    let t0: number;
    let sDeg: number;
    if (s.k === "kw") {
      const v = yield { k: "angle", msg: tr("Zadejte počáteční parametr"), def: 0 };
      if (v.k !== "num") return;
      t0 = rad(v.v);
      sDeg = deg(Math.atan2(g.ratio * Math.sin(t0), Math.cos(t0)) - shift);
    } else if (s.k === "num" || s.k === "point") {
      sDeg = relDeg(s);
      t0 = toT(sDeg);
    } else return;
    const e = yield { k: "angle", msg: tr("Zadejte koncový úhel"), base: cc, kw: [K.param, K.included], def: 180, pt: true, preview: (p) => [{ type: "ellipse", c: cc, major: g.major, ratio: g.ratio, t0: normDeg(deg(t0)), t1: normDeg(deg(toT(deg(angleOf(sub(p, cc)) - axAng)))) }] };
    let t1: number;
    if (e.k === "kw" && e.id === "parameter") {
      const v = yield { k: "angle", msg: tr("Zadejte koncový parametr"), def: 180 };
      if (v.k !== "num") return;
      t1 = rad(v.v);
    } else if (e.k === "kw" && e.id === "included") {
      const v = yield { k: "angle", msg: tr("Zadejte celkový úhel oblouku"), def: 180 };
      if (v.k !== "num") return;
      t1 = toT(sDeg + v.v);
    } else if (e.k === "num" || e.k === "point") t1 = toT(relDeg(e));
    else return;
    logCreated(c, [c.tx.add({ type: "ellipse", c: cc, major: g.major, ratio: g.ratio, t0: normDeg(deg(t0)), t1: normDeg(deg(t1)) })]);
  },
});

// ---------------------------------------------------------------- SPLINE

let splineMethod: "fit" | "cv" = "fit";
let splineDegree = 3;
/** spline řídicími body (sevřená, uzavřená = periodická) */
export function splineFromCv(ctrl0: Vec2[], degree: number, closed: boolean): Pick<import("./model").DSpline, "degree" | "ctrl" | "knots" | "closed"> {
  const p = Math.max(1, Math.min(degree, ctrl0.length - 1));
  if (!closed) return { degree: p, ctrl: ctrl0, knots: clampedKnots(ctrl0.length, p) };
  const ctrl = [...ctrl0, ...ctrl0.slice(0, p)];
  const knots = Array.from({ length: ctrl.length + p + 1 }, (_, i) => i);
  return { degree: p, ctrl, knots, closed: true };
}
registerCommand({
  id: "SPLINE",
  names: { cs: ["spline", "splajn"], en: ["spline"], de: ["spline", "splinie"] },
  alias: ["SPL"],
  group: "draw",
  desc: () => tr("spline proložením bodů (kubická, délka tětiv) nebo řídicími body (Metoda Řídicí, stupeň 1–10); Uzavřít = uzavřená"),
  usage: () => tr("spline x,y x,y x,y … [uzavřít] | spline metoda řídicí x,y x,y x,y x,y | spline stupeň 2 x,y …"),
  run: function* (c): CmdGen {
    const pts: Vec2[] = [];
    let closed = false;
    const make = (P: Vec2[], cl: boolean): NewEntity | null => {
      try {
        if (P.length < 2) return null;
        if (splineMethod === "fit") return { type: "spline", ...splineFromFit(P, cl && P.length >= 3) };
        return { type: "spline", ...splineFromCv(P, splineDegree, cl && P.length >= 3) };
      } catch {
        return null;
      }
    };
    for (;;) {
      if (!pts.length) {
        const i = yield { k: "point", msg: splineMethod === "fit" ? tr("Zadejte první bod proložení") : tr("Zadejte první řídicí bod"), kw: [K.method, K.degree] };
        if (i.k === "kw" && i.id === "method") {
          const m = yield { k: "kw", msg: tr("Metoda"), kw: [K.fit, K.cv], def: splineMethod };
          if (m.k === "kw") splineMethod = m.id as "fit" | "cv";
          continue;
        }
        if (i.k === "kw" && i.id === "degree") {
          const d = yield { k: "int", msg: tr("Zadejte stupeň splajnu"), def: splineDegree, min: 1, max: 10 };
          if (d.k === "num") {
            splineDegree = d.v;
            splineMethod = "cv";
          }
          continue;
        }
        if (i.k !== "point") return;
        pts.push(i.p);
        continue;
      }
      const prev = pts[pts.length - 1];
      const i = yield { k: "point", msg: tr("Zadejte další bod"), base: prev, kw: pts.length >= 2 ? [K.close, K.undo] : [K.undo], none: true, preview: (p) => { const e = make([...pts, p], false); return e ? [e] : [{ type: "line", a: prev, b: p }]; } };
      if (i.k === "none") break;
      if (i.k === "kw" && i.id === "close") {
        closed = true;
        break;
      }
      if (i.k === "kw" && i.id === "undo") {
        pts.pop();
        if (!pts.length) return;
        continue;
      }
      if (i.k === "point" && dist(i.p, prev) > 1e-12) pts.push(i.p);
    }
    const e = make(pts, closed);
    if (!e) return c.log(tr("spline potřebuje alespoň dva body"));
    logCreated(c, [c.tx.add(e)]);
  },
});

// ---------------------------------------------------------------- PŘÍMKA, POLOPŘÍMKA

registerCommand({
  id: "XLINE",
  names: { cs: ["přímka", "primka", "konstrukční"], en: ["xline", "constructionline"], de: ["klinie", "konstruktionslinie"] },
  alias: ["XL"],
  group: "draw",
  desc: () => tr("nekonečné konstrukční přímky: bodem a průchozími body, vodorovně, svisle, pod úhlem, osa úhlu, odsazením od úsečky"),
  usage: () => tr("přímka p q [q2 …] | přímka vodorovně p … | přímka svisle p … | přímka úhel 30 p … | přímka osa v a b | přímka odsazení 10 e3 x,y"),
  run: function* (c): CmdGen {
    const ids: string[] = [];
    const add1 = (p: Vec2, d: Vec2) => {
      if (len(d) < 1e-12) return;
      ids.push(c.tx.add({ type: "xline", p, dir: unit(d) }));
    };
    const i = yield { k: "point", msg: tr("Zadejte bod přímky"), kw: [K.hor, K.ver, K.ang, K.bisect, K.offset] };
    let dir: Vec2 | null = null;
    if (i.k === "point") {
      const p = i.p;
      for (;;) {
        const q = yield { k: "point", msg: tr("Zadejte bod průchodu"), base: p, none: true, preview: (x) => (dist(x, p) > 1e-9 ? [{ type: "xline", p, dir: unit(sub(x, p)) }] : []) };
        if (q.k !== "point") break;
        add1(p, sub(q.p, p));
      }
      return logCreated(c, ids);
    }
    if (i.k !== "kw") return;
    if (i.id === "hor") dir = [1, 0];
    else if (i.id === "ver") dir = [0, 1];
    else if (i.id === "ang") {
      const a = yield { k: "angle", msg: tr("Zadejte úhel přímky"), def: 0 };
      if (a.k !== "num") return;
      dir = [Math.cos(rad(a.v)), Math.sin(rad(a.v))];
    } else if (i.id === "bisect") {
      const v = yield { k: "point", msg: tr("Zadejte vrchol úhlu") };
      if (v.k !== "point") return;
      const a = yield { k: "point", msg: tr("Zadejte počáteční bod úhlu"), base: v.p };
      if (a.k !== "point") return;
      for (;;) {
        const b = yield { k: "point", msg: tr("Zadejte koncový bod úhlu"), base: v.p, none: true };
        if (b.k !== "point") break;
        const ua = unit(sub(a.p, v.p));
        const ub = unit(sub(b.p, v.p));
        const s = add(ua, ub);
        add1(v.p, len(s) < 1e-9 ? rot90(ua) : s);
      }
      return logCreated(c, ids);
    } else if (i.id === "offset") {
      const d = yield { k: "dist", msg: tr("Zadejte vzdálenost odsazení"), def: 10, min: 0 };
      if (d.k !== "num") return;
      for (;;) {
        const e = yield { k: "entity", msg: tr("Vyberte úsečku nebo přímku"), filter: (x) => x.type === "line" || x.type === "xline" || x.type === "ray", none: true };
        if (e.k !== "ent") break;
        const cs = entityCurves(c.tx.get(e.id)!, c.kctx());
        const cl = cs[0];
        if (!cl || cl.k !== "line") continue;
        const side = yield { k: "point", msg: tr("Zadejte stranu odsazení") };
        if (side.k !== "point") break;
        const u = unit(sub(cl.b, cl.a));
        const n = rot90(u);
        const sgn = (side.p[0] - cl.a[0]) * n[0] + (side.p[1] - cl.a[1]) * n[1] >= 0 ? 1 : -1;
        add1(add(cl.a, mul(n, sgn * d.v)), u);
      }
      return logCreated(c, ids);
    }
    if (!dir) return;
    const D = dir;
    for (;;) {
      const q = yield { k: "point", msg: tr("Zadejte bod průchodu"), none: true, preview: (x) => [{ type: "xline", p: x, dir: D }] };
      if (q.k !== "point") break;
      add1(q.p, D);
    }
    logCreated(c, ids);
  },
});

registerCommand({
  id: "RAY",
  names: { cs: ["polopřímka", "polopremka", "poloprimka"], en: ["ray"], de: ["strahl"] },
  group: "draw",
  desc: () => tr("polopřímky z počátečního bodu přes průchozí body"),
  usage: () => tr("polopřímka p q [q2 …]"),
  run: function* (c): CmdGen {
    const i = yield { k: "point", msg: tr("Zadejte počáteční bod") };
    if (i.k !== "point") return;
    const p = i.p;
    const ids: string[] = [];
    for (;;) {
      const q = yield { k: "point", msg: tr("Zadejte bod průchodu"), base: p, none: true, preview: (x) => (dist(x, p) > 1e-9 ? [{ type: "ray", p, dir: unit(sub(x, p)) }] : []) };
      if (q.k !== "point") break;
      if (dist(q.p, p) > 1e-12) ids.push(c.tx.add({ type: "ray", p, dir: unit(sub(q.p, p)) }));
    }
    logCreated(c, ids);
  },
});

// ---------------------------------------------------------------- BOD

registerCommand({
  id: "POINT",
  names: { cs: ["bod"], en: ["point"], de: ["punkt"] },
  alias: ["PO"],
  group: "draw",
  desc: () => tr("body (uzly) – vzhled podle PDMODE / PDSIZE (2d proměnná pdmode 3)"),
  usage: () => tr("bod x,y [x,y …]"),
  run: function* (c): CmdGen {
    const ids: string[] = [];
    for (;;) {
      const i = yield { k: "point", msg: tr("Zadejte bod"), none: ids.length > 0 };
      if (i.k !== "point") break;
      ids.push(c.tx.add({ type: "point", p: i.p }));
    }
    logCreated(c, ids);
  },
});

// ---------------------------------------------------------------- TEXT

const J: [string, TextHAlign, TextVAlign, Kw][] = [
  ["left", "left", "baseline", kw("left", "Vlevo", "Left", "Links")],
  ["center", "center", "baseline", kw("center", "Střed", "Center", "Zentrum")],
  ["right", "right", "baseline", kw("right", "Vpravo", "Right", "Rechts")],
  ["align", "aligned", "baseline", kw("align", "Zarovnat", "Align", "Ausrichten")],
  ["middle", "middle", "baseline", kw("middle", "Uprostřed", "Middle", "Mitte")],
  ["fit", "fit", "baseline", kw("fit", "Přizpůsobit", "Fit", "Einpassen")],
  ["tl", "left", "top", kw("tl", "TL", "TL", "OL")],
  ["tc", "center", "top", kw("tc", "TC", "TC", "OZ")],
  ["tr", "right", "top", kw("tr", "TR", "TR", "OR")],
  ["ml", "left", "middle", kw("ml", "ML", "ML", "ML")],
  ["mc", "center", "middle", kw("mc", "MC", "MC", "MZ")],
  ["mr", "right", "middle", kw("mr", "MR", "MR", "MR")],
  ["bl", "left", "bottom", kw("bl", "BL", "BL", "UL")],
  ["bc", "center", "bottom", kw("bc", "BC", "BC", "UZ")],
  ["br", "right", "bottom", kw("br", "BR", "BR", "UR")],
];
registerCommand({
  id: "TEXT",
  names: { cs: ["text", "dtext"], en: ["text", "dtext"], de: ["dtext", "text2"] },
  alias: ["DT"],
  group: "annotate",
  desc: () => tr("jednořádkový text: bod, výška, natočení, obsah (v uvozovkách); Zarovnání (Střed, Vpravo, Uprostřed, TL…BR, Zarovnat, Přizpůsobit), Styl"),
  usage: () => tr("text x,y výška úhel \"obsah\" | text zarovnání mc x,y 5 0 \"obsah\" | text styl Standard x,y 5 0 \"obsah\""),
  run: function* (c): CmdGen {
    let j = J[0];
    let style = c.tx.vars.textstyle;
    let p: Vec2 | null = null;
    let p2: Vec2 | null = null;
    while (!p) {
      const i = yield { k: "point", msg: j[0] === "left" ? tr("Zadejte počáteční bod textu") : tr("Zadejte bod zarovnání textu"), kw: [K.justify, K.style] };
      if (i.k === "point") p = i.p;
      else if (i.k === "kw" && i.id === "justify") {
        const k = yield { k: "kw", msg: tr("Zarovnání"), kw: J.map((x) => x[3]), def: "left" };
        if (k.k === "kw") j = J.find((x) => x[0] === k.id) ?? J[0];
      } else if (i.k === "kw" && i.id === "style") {
        const s = yield { k: "text", msg: tr("Zadejte název textového stylu"), def: style };
        if (s.k === "text") {
          const st = c.tx.model.textStyles.find((x) => x.name.toLowerCase() === s.s.trim().toLowerCase());
          if (!st) throw new Error(tr("textový styl „{0}“ ve výkresu není – styly: {1}", s.s, c.tx.model.textStyles.map((x) => x.name).join(", ")));
          style = st.name;
        }
      } else return;
    }
    if (j[1] === "aligned" || j[1] === "fit") {
      const q = yield { k: "point", msg: tr("Zadejte druhý koncový bod účaří textu"), base: p, preview: (x) => [{ type: "line", a: p!, b: x }] };
      if (q.k !== "point") return;
      p2 = q.p;
    }
    const st = c.tx.model.textStyles.find((x) => x.name === style);
    let h = st?.height || c.tx.vars.textsize;
    if (!(st?.height && st.height > 0) && j[1] !== "aligned") {
      const hi = yield { k: "dist", msg: tr("Zadejte výšku textu"), base: p, def: c.tx.vars.textsize, min: 1e-9 };
      if (hi.k !== "num") return;
      h = hi.v;
      c.tx.setVars({ textsize: h });
    }
    let rot = 0;
    if (!p2) {
      const r = yield { k: "angle", msg: tr("Zadejte úhel natočení textu"), base: p, def: 0 };
      if (r.k !== "num") return;
      rot = normDeg(r.v);
    }
    const ids: string[] = [];
    let at = p;
    for (;;) {
      const s = yield { k: "text", msg: tr("Zadejte text"), none: true };
      if (s.k !== "text" || !s.s) break;
      ids.push(
        c.tx.add({
          type: "text",
          p: at,
          h,
          s: s.s,
          ...(rot ? { rot } : {}),
          ...(style !== "Standard" ? { style } : {}),
          ...(j[1] !== "left" ? { halign: j[1] } : {}),
          ...(j[2] !== "baseline" ? { valign: j[2] } : {}),
          ...(p2 ? { p2 } : {}),
        }),
      );
      if (p2) break;
      // další řádek pod předchozím (řádkování 1,5 × výška)
      at = add(at, mul([Math.sin(rad(rot)), -Math.cos(rad(rot))], h * 1.5));
    }
    logCreated(c, ids);
  },
});
