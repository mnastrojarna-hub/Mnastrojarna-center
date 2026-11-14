/**
 * BALÍK 1 (edit) – transformační příkazy: POSUN, KOPIE (vícenásobná, pole), OTOČIT (reference, kopie),
 * ZMĚNIT-MĚŘÍTKO (reference, kopie), ZRCADLIT, ZAROVNAT-OBJEKTY, PROTÁHNOUT (křížící okno / mnohoúhelník),
 * ÚCHOP (úprava úchopem: protáhnout / posun / otočit / měřítko / zrcadlit, mezera = další režim),
 * PŘENÉST-VLASTNOSTI a POŘADÍ. Každý příkaz = jeden krok historie; zamčené hladiny se přeskočí.
 */
import { tr } from "../../i18n";
import { registerCommand, type CmdCtx, type CmdGen, type Input, type Prompt } from "../commands";
import { add, angleOf, boxFrom2, bulgeArc, deg, dist, inBox, pointInPoly, rad, sub, xfMirror, xfMove, xfMul, xfRotate, xfScale, type Affine, type Box } from "../geom";
import { kindOf } from "../kinds";
import { splineFromFit } from "../kinds-core";
import { findLayer } from "../layers";
import { spaceEntities, withSpaceEntities, type DArc, type DraftEntity, type NewEntity, type Vec2 } from "../model";
import { windowSelect } from "../select";
import { spatialIndex } from "../spatial";
import { normDeg } from "../units";
import { asNew, doneSel, editState, EK, kc, nothing, pickObjects, PRESET, previewXf, Steps, transformIds, unlocked, xfEntity, askKw } from "./shared";
import { tolAt } from "./tol";

const fmtV = (c: CmdCtx, v: Vec2) => c.fmt.pt(v);

// ---------------------------------------------------------------- POSUN

registerCommand({
  id: "MOVE",
  names: { cs: ["posun", "posunout"], en: ["move"], de: ["schieben"] },
  alias: ["M"],
  group: "modify",
  desc: () => tr("posune vybrané entity: základní bod a druhý bod, nebo Posunutí dx,dy (Enter u druhého bodu = první bod jako posunutí)"),
  usage: () => tr("posun e3 e5 0,0 100,50 | posun vše posunutí 10,0 | posun 0,0 @25<45 (vybrané)"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty k posunu")));
    if (!ids.length) return nothing(c);
    const d = yield* displacement(c, ids, tr("Zadejte základní bod"));
    if (!d) return;
    const out = transformIds(c, ids, xfMove(d[0], d[1]), false);
    c.out("displacement", d);
    c.log(tr("✓ posunuto entit: {0} o {1}", out.length, fmtV(c, d)));
    doneSel(c);
  },
});

/** základní bod + druhý bod (nebo Posunutí) → vektor posunutí; null = zrušeno */
function* displacement(c: CmdCtx, ids: string[], msg: string): Generator<Prompt, Vec2 | null, Input> {
  const b = yield { k: "point", msg, kw: [EK.displacement] };
  if (b.k === "kw") {
    const v = yield { k: "point", msg: tr("Zadejte posunutí dx,dy"), base: [0, 0] };
    return v.k === "point" ? v.p : null;
  }
  if (b.k !== "point") return null;
  const base = b.p;
  const s = yield { k: "point", msg: tr("Zadejte druhý bod nebo <první bod = posunutí>"), base, none: true, preview: (p) => previewXf(c, ids, xfMove(p[0] - base[0], p[1] - base[1])) };
  if (s.k === "point") return sub(s.p, base);
  if (s.k === "none") return base;
  return null;
}

// ---------------------------------------------------------------- KOPIE

registerCommand({
  id: "COPY",
  names: { cs: ["kopie", "kopírovat", "kopirovat"], en: ["copy"], de: ["kopieren"] },
  alias: ["CO", "CP"],
  group: "modify",
  desc: () => tr("zkopíruje vybrané entity: základní bod a libovolně mnoho cílových bodů (Pole = n kopií v řadě, Režim jednou / vícekrát, Zpět)"),
  usage: () => tr("kopie e3 0,0 50,0 100,0 | kopie e3 0,0 pole 5 20,0 | kopie e3 posunutí 0,30"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty ke kopírování")));
    if (!ids.length) return nothing(c);
    let multiple = true;
    let base: Vec2 | null = null;
    while (!base) {
      const b = yield { k: "point", msg: tr("Zadejte základní bod"), kw: [EK.displacement, EK.mode] };
      if (b.k === "point") base = b.p;
      else if (b.k === "kw" && b.id === "mode") {
        const m: Input = yield* askKw(tr("Režim kopírování"), [EK.single, EK.multiple], multiple ? "multiple" : "single");
        if (m.k === "kw") multiple = m.id === "multiple";
      } else if (b.k === "kw" && b.id === "displacement") {
        const v = yield { k: "point", msg: tr("Zadejte posunutí dx,dy"), base: [0, 0] };
        if (v.k !== "point") return;
        const out = transformIds(c, ids, xfMove(v.p[0], v.p[1]), true);
        c.log(tr("✓ zkopírováno entit: {0}", out.length));
        return doneSel(c);
      } else return;
    }
    const B = base;
    const steps = new Steps(c);
    let n = 0;
    for (;;) {
      const s = yield { k: "point", msg: tr("Zadejte druhý bod nebo"), base: B, kw: [EK.array, EK.exit, EK.undo], none: true, preview: (p) => previewXf(c, ids, xfMove(p[0] - B[0], p[1] - B[1])) };
      if (s.k === "none" || (s.k === "kw" && s.id === "exit")) break;
      if (s.k === "kw" && s.id === "undo") {
        if (!steps.undo()) c.log(tr("není co vrátit"));
        continue;
      }
      if (s.k === "kw" && s.id === "array") {
        const cnt = yield { k: "int", msg: tr("Zadejte počet položek pole"), min: 2, max: 10000, def: 3 };
        if (cnt.k !== "num") continue;
        const N = cnt.v;
        let fit = false;
        let q = yield { k: "point", msg: tr("Zadejte druhý bod nebo"), base: B, kw: [EK.fit], preview: (p) => arrPreview(c, ids, B, p, N, false) };
        if (q.k === "kw") {
          fit = true;
          q = yield { k: "point", msg: tr("Zadejte poslední bod pole"), base: B, preview: (p) => arrPreview(c, ids, B, p, N, true) };
        }
        if (q.k !== "point") continue;
        const v = sub(q.p, B);
        steps.begin();
        for (let i = 1; i < N; i++) {
          const k = fit ? i / (N - 1) : i;
          for (const id of transformIds(c, ids, xfMove(v[0] * k, v[1] * k), true)) steps.created(id);
          n += ids.length;
        }
        steps.commit();
        if (!multiple) break;
        continue;
      }
      if (s.k !== "point") continue;
      steps.begin();
      for (const id of transformIds(c, ids, xfMove(s.p[0] - B[0], s.p[1] - B[1]), true)) steps.created(id);
      steps.commit();
      n += ids.length;
      if (!multiple) break;
    }
    c.log(tr("✓ zkopírováno entit: {0}", c.tx.created.length));
    void n;
    doneSel(c);
  },
});
function arrPreview(c: CmdCtx, ids: string[], B: Vec2, p: Vec2, N: number, fit: boolean): NewEntity[] {
  const v = sub(p, B);
  const out: NewEntity[] = [];
  for (let i = 1; i < N && out.length < 400; i++) {
    const k = fit ? i / (N - 1) : i;
    out.push(...previewXf(c, ids, xfMove(v[0] * k, v[1] * k)));
  }
  return out;
}

// ---------------------------------------------------------------- OTOČIT

registerCommand({
  id: "ROTATE",
  names: { cs: ["otočit", "otocit", "rotovat"], en: ["rotate"], de: ["drehen"] },
  alias: ["RO"],
  group: "modify",
  desc: () => tr("otočí vybrané entity kolem základního bodu o úhel (+ = proti směru hodin); Kopie = otočená kopie, Reference = z referenčního úhlu na nový"),
  usage: () => tr("otočit e3 0,0 90 | otočit e3 0,0 kopie 45 | otočit e3 0,0 reference 30 90 | otočit e3 e3.start reference e3.start e3.end 0"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty k otočení")));
    if (!ids.length) return nothing(c);
    const b = yield { k: "point", msg: tr("Zadejte základní bod") };
    if (b.k !== "point") return;
    const B = b.p;
    let copy = false;
    let ang: number | null = null;
    while (ang === null) {
      const a = yield { k: "angle", msg: tr("Zadejte úhel otočení nebo"), base: B, kw: [EK.copy, EK.reference], def: 0, preview: (p) => previewXf(c, ids, xfRotate(angleOf(sub(p, B)), B)) };
      if (a.k === "num") ang = a.v;
      else if (a.k === "kw" && a.id === "copy") {
        copy = true;
        c.log(tr("otočí se kopie vybraných objektů"));
      } else if (a.k === "kw" && a.id === "reference") {
        const ref = yield* refAngle(c, tr("Zadejte referenční úhel"));
        if (ref === null) return;
        const nw = yield { k: "angle", msg: tr("Zadejte nový úhel nebo"), base: B, kw: [EK.points], def: 0, preview: (p) => previewXf(c, ids, xfRotate(angleOf(sub(p, B)) - rad(ref), B)) };
        let na: number | null = null;
        if (nw.k === "num") na = nw.v;
        else if (nw.k === "kw") na = yield* refAngle(c, tr("Zadejte první bod nového úhlu"), true);
        if (na === null) return;
        ang = na - ref;
      } else return;
    }
    const m = xfRotate(rad(ang), B);
    const out = transformIds(c, ids, m, copy);
    c.out("angle", ang);
    c.log(tr("✓ otočeno entit: {0} o {1}", out.length, c.fmt.ang(ang)));
    doneSel(c);
  },
});

/** úhel číslem nebo dvěma body */
function* refAngle(c: CmdCtx, msg: string, forcePoints = false): Generator<Prompt, number | null, Input> {
  const a = forcePoints ? yield { k: "point", msg } : yield { k: "angle", msg, def: 0, pt: true };
  if (a.k === "num") return a.v;
  if (a.k !== "point") return null;
  const p1 = a.p;
  const b = yield { k: "point", msg: tr("Zadejte druhý bod"), base: p1, preview: (p) => [{ type: "line", a: p1, b: p }] };
  if (b.k !== "point") return null;
  void c;
  return normDeg(deg(angleOf(sub(b.p, p1))));
}

// ---------------------------------------------------------------- ZMĚNIT MĚŘÍTKO

registerCommand({
  id: "SCALE",
  names: { cs: ["změnit-měřítko", "zmenit-meritko", "měřítko"], en: ["scale"], de: ["varia"] },
  alias: ["SC"],
  group: "modify",
  desc: () => tr("změní velikost vybraných entit vzhledem k základnímu bodu: měřítko, Reference (stávající → nová délka), Kopie"),
  usage: () => tr("změnit-měřítko e3 0,0 2 | změnit-měřítko e3 0,0 reference 40 100 | změnit-měřítko e3 0,0 reference e3.start e3.end 100"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty ke změně měřítka")));
    if (!ids.length) return nothing(c);
    const b = yield { k: "point", msg: tr("Zadejte základní bod") };
    if (b.k !== "point") return;
    const B = b.p;
    let copy = false;
    let k: number | null = null;
    while (k === null) {
      const a = yield { k: "dist", msg: tr("Zadejte měřítko nebo"), base: B, kw: [EK.copy, EK.reference], def: 1, preview: (p) => (dist(p, B) > 1e-12 ? previewXf(c, ids, xfScale(dist(p, B), B)) : []) };
      if (a.k === "num") {
        if (!(a.v > 0)) throw new Error(tr("měřítko musí být kladné"));
        k = a.v;
      } else if (a.k === "kw" && a.id === "copy") {
        copy = true;
        c.log(tr("změní se měřítko kopie vybraných objektů"));
      } else if (a.k === "kw" && a.id === "reference") {
        const ref = yield* refLen(c, tr("Zadejte referenční délku"));
        if (ref === null) return;
        if (!(ref > 0)) throw new Error(tr("referenční délka musí být kladná"));
        const nw = yield { k: "dist", msg: tr("Zadejte novou délku nebo"), base: B, kw: [EK.points], def: 1, preview: (p) => (dist(p, B) > 1e-12 ? previewXf(c, ids, xfScale(dist(p, B) / ref, B)) : []) };
        let nl: number | null = null;
        if (nw.k === "num") nl = nw.v;
        else if (nw.k === "kw") nl = yield* refLen(c, tr("Zadejte první bod nové délky"), true);
        if (nl === null) return;
        if (!(nl > 0)) throw new Error(tr("nová délka musí být kladná"));
        k = nl / ref;
      } else return;
    }
    const out = transformIds(c, ids, xfScale(k, B), copy);
    c.out("factor", k);
    c.log(tr("✓ měřítko {0}: entit {1}", Math.round(k * 1e9) / 1e9, out.length));
    doneSel(c);
  },
});

function* refLen(c: CmdCtx, msg: string, forcePoints = false): Generator<Prompt, number | null, Input> {
  const a = forcePoints ? yield { k: "point", msg } : yield { k: "dist", msg, def: 1, pt: true };
  if (a.k === "num") return a.v;
  if (a.k !== "point") return null;
  const p1 = a.p;
  const b = yield { k: "point", msg: tr("Zadejte druhý bod"), base: p1, preview: (p) => [{ type: "line", a: p1, b: p }] };
  void c;
  return b.k === "point" ? dist(p1, b.p) : null;
}

// ---------------------------------------------------------------- ZRCADLIT

registerCommand({
  id: "MIRROR",
  names: { cs: ["zrcadlit", "zrcadlení"], en: ["mirror"], de: ["spiegeln"] },
  alias: ["MI"],
  group: "modify",
  desc: () => tr("zrcadlí vybrané entity podle osy dané dvěma body; zdroj se ponechá (nebo smaže); text podle MIRRTEXT"),
  usage: () => tr("zrcadlit e3 e5 0,0 0,100 | zrcadlit e3 0,0 100,0 ano (smazat zdroj)"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty k zrcadlení")));
    if (!ids.length) return nothing(c);
    const a = yield { k: "point", msg: tr("Zadejte první bod osy zrcadlení") };
    if (a.k !== "point") return;
    const A = a.p;
    const b = yield { k: "point", msg: tr("Zadejte druhý bod osy zrcadlení"), base: A, preview: (p) => (dist(p, A) > 1e-12 ? [{ type: "line", a: A, b: p }, ...previewXf(c, ids, xfMirror(A, p))] : []) };
    if (b.k !== "point") return;
    if (dist(A, b.p) < 1e-12) throw new Error(tr("body osy zrcadlení jsou totožné"));
    const er = yield* askKw(tr("Smazat zdrojové objekty?"), [EK.yes, EK.no], "no");
    const erase = er.k === "kw" && er.id === "yes";
    const m = xfMirror(A, b.p);
    const out = transformIds(c, ids, m, !erase);
    c.log(erase ? tr("✓ zrcadleno entit: {0} (zdroj nahrazen)", out.length) : tr("✓ zrcadlené kopie: {0}", out.length));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- ZAROVNAT

registerCommand({
  id: "ALIGN",
  names: { cs: ["zarovnat-objekty", "zarovnat"], en: ["align"], de: ["ausrichten"] },
  alias: ["AL"],
  group: "modify",
  desc: () => tr("zarovná entity dvojicemi bodů: 1. zdrojový → 1. cílový (posun), 2. zdrojový → 2. cílový (otočení, volitelně měřítko)"),
  usage: () => tr("zarovnat-objekty e3 0,0 50,50 100,0 50,150 ne | zarovnat-objekty e3 s1 d1 s2 d2 ano (i měřítko)"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty k zarovnání")));
    if (!ids.length) return nothing(c);
    const s1 = yield { k: "point", msg: tr("Zadejte první zdrojový bod") };
    if (s1.k !== "point") return;
    const d1 = yield { k: "point", msg: tr("Zadejte první cílový bod"), base: s1.p, preview: (p) => [{ type: "line", a: s1.p, b: p }] };
    if (d1.k !== "point") return;
    const s2 = yield { k: "point", msg: tr("Zadejte druhý zdrojový bod nebo <pokračovat>"), none: true };
    let m: Affine = xfMove(d1.p[0] - s1.p[0], d1.p[1] - s1.p[1]);
    if (s2.k === "point") {
      const d2 = yield { k: "point", msg: tr("Zadejte druhý cílový bod"), base: s2.p, preview: (p) => [{ type: "line", a: s2.p, b: p }] };
      if (d2.k !== "point") return;
      const ls = dist(s1.p, s2.p);
      const ld = dist(d1.p, d2.p);
      if (ls < 1e-12 || ld < 1e-12) throw new Error(tr("zarovnávací body jsou totožné"));
      const sc = yield* askKw(tr("Změnit měřítko objektů podle zarovnávacích bodů?"), [EK.yes, EK.no], "no");
      const k = sc.k === "kw" && sc.id === "yes" ? ld / ls : 1;
      const ang = angleOf(sub(d2.p, d1.p)) - angleOf(sub(s2.p, s1.p));
      // x' = d1 + R·k·(x − s1)
      m = xfMul(xfMove(d1.p[0], d1.p[1]), xfMul(xfRotate(ang), xfMul(xfScale(k), xfMove(-s1.p[0], -s1.p[1]))));
      c.out("angle", normDeg(deg(ang)));
      c.out("factor", k);
    }
    const out = transformIds(c, ids, m, false);
    c.log(tr("✓ zarovnáno entit: {0}", out.length));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- PROTÁHNOUT

/** protažení jedné entity: body uvnitř oblasti se posunou o d */
export function stretchEntity(c: CmdCtx, e: DraftEntity, inside: (p: Vec2) => boolean, d: Vec2): DraftEntity | null {
  const mv = (p: Vec2): Vec2 => (inside(p) ? add(p, d) : p);
  const move = () => xfEntity(c, e, xfMove(d[0], d[1]));
  switch (e.type) {
    case "point":
    case "text":
      return inside(e.p) ? move() : null;
    case "xline":
    case "ray":
      return inside(e.p) ? move() : null;
    case "circle":
    case "ellipse":
      return inside(e.c) ? move() : null;
    case "line": {
      const a = mv(e.a);
      const b = mv(e.b);
      return a === e.a && b === e.b ? null : { ...e, a, b };
    }
    case "polyline": {
      let ch = false;
      const pts = e.pts.map((p) => {
        const q = mv(p);
        if (q !== p) ch = true;
        return q;
      });
      return ch ? { ...e, pts } : null;
    }
    case "spline": {
      if (e.fit?.length) {
        let ch = false;
        const fit = e.fit.map((p) => {
          const q = mv(p);
          if (q !== p) ch = true;
          return q;
        });
        return ch ? ({ ...e, ...splineFromFit(fit, !!e.closed) } as DraftEntity) : null;
      }
      let ch = false;
      const ctrl = e.ctrl.map((p) => {
        const q = mv(p);
        if (q !== p) ch = true;
        return q;
      });
      return ch ? { ...e, ctrl } : null;
    }
    case "arc": {
      const ar = e as DArc;
      const A0 = rad(ar.a0);
      const S = rad(normDeg(ar.a1 - ar.a0)) || Math.PI * 2;
      const s = [ar.c[0] + ar.r * Math.cos(A0), ar.c[1] + ar.r * Math.sin(A0)] as Vec2;
      const t = [ar.c[0] + ar.r * Math.cos(A0 + S), ar.c[1] + ar.r * Math.sin(A0 + S)] as Vec2;
      const si = inside(s);
      const ti = inside(t);
      if (si && ti) return move();
      if (!si && !ti) return null;
      // výška oblouku (vzepětí) zůstane, posune se jen koncový bod uvnitř
      const L = dist(s, t);
      const h = Math.tan(S / 4) * (L / 2);
      const s2 = si ? add(s, d) : s;
      const t2 = ti ? add(t, d) : t;
      const L2 = dist(s2, t2);
      if (L2 < 1e-12) return null;
      const bu = h / (L2 / 2);
      const r = bulgeArc(s2, t2, bu);
      return { ...ar, c: r.c, r: r.r, a0: normDeg(deg(r.a0)), a1: normDeg(deg(r.a0 + r.sweep)) };
    }
    default: {
      const k = kindOf(e);
      if (!k) return null;
      const g = k.grips(e, kc(c));
      if (g.length && g.every(inside)) return move();
      if (k.moveGrip) {
        let n: DraftEntity | null = e;
        g.forEach((p, i) => {
          if (n && inside(p)) n = (k.moveGrip!(n, i, add(p, d), kc(c)) as DraftEntity | null) ?? n;
        });
        return n === e ? null : n;
      }
      return g[0] && inside(g[0]) ? move() : null;
    }
  }
}

registerCommand({
  id: "STRETCH",
  names: { cs: ["protáhnout", "protahnout"], en: ["stretch"], de: ["strecken"] },
  alias: ["S"],
  group: "modify",
  desc: () => tr("protáhne entity křížícím oknem (nebo mnohoúhelníkem): body uvnitř se posunou, entity celé uvnitř se přesunou; oblouky drží vzepětí"),
  usage: () => tr("protáhnout 90,-10 120,60 0,0 @20,0 | protáhnout mnohoúhelník p1 p2 p3 hotovo 0,0 @0,10"),
  run: function* (c): CmdGen {
    const a = yield { k: "point", msg: tr("Zadejte první roh křížícího okna nebo"), kw: [EK.cpolygon] };
    let inside: (p: Vec2) => boolean;
    let ids: string[];
    const m = c.tx.model;
    const list = spaceEntities(m, c.session.space) ?? m.entities;
    const idx = spatialIndex(list, { model: m });
    if (a.k === "kw") {
      const poly: Vec2[] = [];
      for (;;) {
        const p = yield { k: "point", msg: poly.length < 3 ? tr("Zadejte bod mnohoúhelníku") : tr("Zadejte bod mnohoúhelníku nebo"), kw: poly.length >= 3 ? [EK.done] : [], none: poly.length >= 3, ...(poly.length ? { base: poly[poly.length - 1] } : {}), preview: (q) => [{ type: "polyline", pts: [...poly, q], closed: true }] };
        if (p.k !== "point") break;
        poly.push(p.p);
      }
      if (poly.length < 3) return;
      inside = (p) => pointInPoly(p, poly);
      const xs = poly.map((p) => p[0]);
      const ys = poly.map((p) => p[1]);
      const box: Box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      ids = windowSelect(m, idx, box, true).filter((id) => {
        const e = list.find((x) => x.id === id)!;
        const g = kindOf(e)?.grips(e, { model: m }) ?? [];
        return g.some(inside);
      });
    } else if (a.k === "point") {
      const A = a.p;
      const b = yield { k: "point", msg: tr("Zadejte protější roh"), base: A, preview: (p) => [{ type: "polyline", pts: [A, [p[0], A[1]], p, [A[0], p[1]]], closed: true }] };
      if (b.k !== "point") return;
      const box = boxFrom2(A, b.p);
      inside = (p) => inBox(p, box);
      ids = windowSelect(m, idx, box, true);
    } else return;
    if (c.interactive && c.session.sel.length) {
      const pre = new Set(c.session.sel);
      const both = ids.filter((id) => pre.has(id));
      if (both.length) ids = both;
    }
    ids = unlocked(c, ids);
    if (!ids.length) return nothing(c);
    const ins = inside;
    const d = yield* stretchDisp(c, ids, ins);
    if (!d) return;
    let n = 0;
    for (const id of ids) {
      const e = c.tx.get(id)!;
      const s = stretchEntity(c, e, ins, d);
      if (s) {
        c.tx.put({ ...s, id: e.id, layer: e.layer } as DraftEntity);
        n++;
      }
    }
    c.out("displacement", d);
    c.log(tr("✓ protaženo entit: {0} o {1}", n, fmtV(c, d)));
    doneSel(c);
  },
});

function* stretchDisp(c: CmdCtx, ids: string[], inside: (p: Vec2) => boolean): Generator<Prompt, Vec2 | null, Input> {
  const prev = (p: Vec2, B: Vec2): NewEntity[] => {
    const d = sub(p, B);
    const out: NewEntity[] = [];
    for (const id of ids.slice(0, 300)) {
      const e = c.tx.get(id);
      if (!e) continue;
      const s = stretchEntity(c, e, inside, d);
      out.push(asNew(s ?? e));
    }
    return out;
  };
  const b = yield { k: "point", msg: tr("Zadejte základní bod"), kw: [EK.displacement] };
  if (b.k === "kw") {
    const v = yield { k: "point", msg: tr("Zadejte posunutí dx,dy"), base: [0, 0] };
    return v.k === "point" ? v.p : null;
  }
  if (b.k !== "point") return null;
  const B = b.p;
  const s = yield { k: "point", msg: tr("Zadejte druhý bod nebo <první bod = posunutí>"), base: B, none: true, preview: (p) => prev(p, B) };
  if (s.k === "point") return sub(s.p, B);
  if (s.k === "none") return B;
  return null;
}

// ---------------------------------------------------------------- ÚCHOP (úprava úchopem)

type GripMode = "stretch" | "move" | "rotate" | "scale" | "mirror";
const MODES: GripMode[] = ["stretch", "move", "rotate", "scale", "mirror"];
const modeLabel = (m: GripMode) => ({ stretch: tr("PROTÁHNOUT"), move: tr("POSUN"), rotate: tr("OTOČIT"), scale: tr("MĚŘÍTKO"), mirror: tr("ZRCADLIT") })[m];

/** úchopy vybraných entit v bodě P (horký úchop – i více entit se společným bodem) */
export function gripsAt(c: CmdCtx, ids: string[], P: Vec2, tol: number): { id: string; i: number; p: Vec2 }[] {
  const out: { id: string; i: number; p: Vec2 }[] = [];
  for (const id of ids) {
    const e = c.tx.get(id);
    if (!e) continue;
    (kindOf(e)?.grips(e, kc(c)) ?? []).forEach((g, i) => {
      if (dist(g, P) <= tol) out.push({ id, i, p: g });
    });
  }
  return out;
}

/** protažení horkých úchopů do bodu T (kopie = nové entity) */
function stretchGrips(c: CmdCtx, hot: { id: string; i: number }[], T: Vec2, copy: boolean, steps: Steps): number {
  const byId = new Map<string, number[]>();
  for (const h of hot) byId.set(h.id, [...(byId.get(h.id) ?? []), h.i]);
  let n = 0;
  for (const [id, idxs] of byId) {
    const e = c.tx.get(id);
    if (!e) continue;
    const k = kindOf(e);
    if (!k?.moveGrip) continue;
    let ne: DraftEntity | null = e;
    for (const i of idxs) ne = ne ? (k.moveGrip(ne, i, T, kc(c)) as DraftEntity | null) : null;
    if (!ne) continue;
    if (copy) steps.addNew(asNew(ne));
    else steps.put({ ...ne, id: e.id, layer: e.layer } as DraftEntity);
    n++;
  }
  return n;
}

registerCommand({
  id: "GRIPEDIT",
  names: { cs: ["úchop", "uchop", "upravit-úchopem"], en: ["gripedit", "grip"], de: ["griff", "griffbearb"] },
  group: "modify",
  desc: () => tr("úprava úchopem (jako klik na modrý úchop vybrané entity): protáhnout úchop, posun, otočit, měřítko, zrcadlit kolem úchopu; Enter / mezera = další režim, Kopie = více kopií, Základní bod, Zpět"),
  usage: () => tr("úchop e3 100,0 150,20 (protáhnout) | úchop e3 e3.end posun @10,0 | úchop e3 50,50 otočit 90 | úchop e3 0,0 kopie 10,0 20,0"),
  run: function* (c): CmdGen {
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty")));
    if (!ids.length) return nothing(c);
    const g = yield { k: "point", msg: tr("Zadejte úchop (bod úchopu vybraných objektů)") };
    if (g.k !== "point") return;
    const P0 = g.p;
    let hot = gripsAt(c, ids, P0, tolAt(P0, 1e-6));
    if (!hot.length) {
      // nejbližší úchop (zadání textem s malou nepřesností)
      const all = gripsAt(c, ids, P0, Infinity).sort((a, b) => dist(a.p, P0) - dist(b.p, P0));
      if (!all.length) throw new Error(tr("vybrané objekty nemají úchopy"));
      const near = all[0];
      const ext = Math.max(1e-3, 1e-6 * Math.max(Math.abs(P0[0]), Math.abs(P0[1])));
      if (dist(near.p, P0) > ext) throw new Error(tr("v bodě {0} není úchop – nejbližší úchop: {1}", c.fmt.pt(P0), c.fmt.pt(near.p)));
      hot = gripsAt(c, ids, near.p, tolAt(near.p, 1e-9));
    }
    let base = hot[0].p;
    let mode: GripMode = "stretch";
    let copy = false;
    const steps = new Steps(c);
    const kws = () => [EK.base, EK.copy, EK.undo, EK.exit, ...[EK.stretch, EK.move, EK.rotate, EK.scale, EK.mirror].filter((k) => k.id !== mode)];
    const xfFor = (p: Vec2): Affine | null => {
      if (mode === "move") return xfMove(p[0] - base[0], p[1] - base[1]);
      if (mode === "rotate") return xfRotate(angleOf(sub(p, base)), base);
      if (mode === "scale") return dist(p, base) > 1e-12 ? xfScale(dist(p, base), base) : null;
      if (mode === "mirror") return dist(p, base) > 1e-12 ? xfMirror(base, p) : null;
      return null;
    };
    const preview = (p: Vec2): NewEntity[] => {
      if (mode === "stretch") {
        const out: NewEntity[] = [];
        for (const h of hot) {
          const e = c.tx.get(h.id);
          const k = e && kindOf(e);
          const ne = e && k?.moveGrip ? k.moveGrip(e, h.i, p, kc(c)) : null;
          if (ne) out.push(asNew(ne as DraftEntity));
        }
        return out;
      }
      const m = xfFor(p);
      return m ? [...previewXf(c, ids, m), ...(mode === "mirror" ? [{ type: "line", a: base, b: p } as NewEntity] : [])] : [];
    };
    let ops = 0;
    for (;;) {
      const label = `** ${modeLabel(mode)}${copy ? ` (${tr("vícenásobně")})` : ""} **`;
      let inp: Input;
      if (mode === "rotate") inp = yield { k: "angle", msg: tr("{0} Zadejte úhel otočení", label), base, kw: kws(), none: true, preview };
      else if (mode === "scale") inp = yield { k: "dist", msg: tr("{0} Zadejte měřítko", label), base, kw: kws(), none: true, preview };
      else inp = yield { k: "point", msg: mode === "stretch" ? tr("{0} Zadejte bod protažení", label) : mode === "move" ? tr("{0} Zadejte cílový bod", label) : tr("{0} Zadejte druhý bod osy", label), base, kw: kws(), none: true, preview };
      if (inp.k === "none") {
        mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        continue;
      }
      if (inp.k === "kw") {
        if (inp.id === "exit") break;
        if (inp.id === "copy") copy = true;
        else if (inp.id === "undo") {
          if (!steps.undo()) c.log(tr("není co vrátit"));
          else ops--;
        } else if (inp.id === "base") {
          const b = yield { k: "point", msg: tr("Zadejte základní bod") };
          if (b.k === "point") base = b.p;
        } else if ((MODES as string[]).includes(inp.id)) mode = inp.id as GripMode;
        continue;
      }
      steps.begin();
      if (mode === "stretch") {
        if (inp.k !== "point") continue;
        stretchGrips(c, hot, inp.p, copy, steps);
      } else {
        let m: Affine | null = null;
        if (mode === "rotate" && inp.k === "num") m = xfRotate(rad(inp.v), base);
        else if (mode === "scale" && inp.k === "num") {
          if (!(inp.v > 0)) throw new Error(tr("měřítko musí být kladné"));
          m = xfScale(inp.v, base);
        } else if (inp.k === "point") m = xfFor(inp.p);
        if (!m) continue;
        for (const id of ids) {
          const e = c.tx.get(id);
          if (!e) continue;
          const n = xfEntity(c, e, m);
          if (!n) continue;
          if (copy) steps.addNew(asNew(n));
          else steps.put({ ...n, id: e.id, layer: e.layer } as DraftEntity);
        }
      }
      steps.commit();
      ops++;
      if (!copy) break;
    }
    c.log(tr("✓ úprava úchopem: {0} operací", ops));
    // výběr zůstane (úchopy dál viditelné – jako AutoCAD), Esc ho zruší
  },
});

// ---------------------------------------------------------------- PŘENÉST VLASTNOSTI

const MATCH_KW = [
  EK.all,
  EK.none,
  { id: "color", cs: "Barva", en: "Color", de: "Farbe" },
  { id: "layer", cs: "Hladina", en: "Layer", de: "Layer" },
  { id: "linetype", cs: "Typčáry", en: "Linetype", de: "Linientyp" },
  { id: "ltscale", cs: "Měřítkočáry", en: "Ltscale", de: "Ltfaktor" },
  { id: "lineweight", cs: "Tloušťka", en: "Lineweight", de: "Linienstärke" },
  { id: "transparency", cs: "Průhlednost", en: "Transparency", de: "Transparenz" },
  { id: "text", cs: "Text", en: "Text", de: "Text" },
  { id: "polyline", cs: "Křivka", en: "Polyline", de: "Polylinie" },
  { id: "dim", cs: "Kóta", en: "Dimension", de: "Bemaßung" },
  { id: "hatch", cs: "Šrafa", en: "Hatch", de: "Schraffur" },
];

/** přenese nastavené vlastnosti ze zdroje na cíl */
export function matchProps(src: DraftEntity, dst: DraftEntity, on: Record<string, boolean>): DraftEntity {
  const o = { ...dst } as Record<string, unknown>;
  const s = src as unknown as Record<string, unknown>;
  const copyKey = (k: string) => {
    if (s[k] === undefined) delete o[k];
    else o[k] = s[k];
  };
  if (on.layer) o.layer = src.layer;
  if (on.color) copyKey("color");
  if (on.linetype) copyKey("linetype");
  if (on.ltscale) copyKey("ltscale");
  if (on.lineweight) copyKey("lineweight");
  if (on.transparency) copyKey("transparency");
  const textLike = ["text", "mtext", "attdef", "tolerance"];
  if (on.text && textLike.includes(src.type) && textLike.includes(dst.type)) {
    for (const k of ["style", "h"]) if (s[k] !== undefined) o[k] = s[k];
    if (src.type === "text" && dst.type === "text") for (const k of ["wf", "oblique"]) copyKey(k);
  }
  if (on.polyline && src.type === "polyline" && dst.type === "polyline") {
    delete o.widths;
    if (src.width) o.width = src.width;
    else delete o.width;
  }
  if (on.dim && src.type === "dimension" && dst.type === "dimension") {
    copyKey("style");
    copyKey("overrides");
  }
  if (on.hatch && src.type === "hatch" && dst.type === "hatch") for (const k of ["pattern", "solid", "scale", "angle", "double", "gradient", "islandStyle"]) copyKey(k);
  return o as unknown as DraftEntity;
}

registerCommand({
  id: "MATCHPROP",
  names: { cs: ["přenést-vlastnosti", "prenest-vlastnosti"], en: ["matchprop", "painter"], de: ["eigübertrag", "eiguebertrag"] },
  alias: ["MA"],
  group: "modify",
  desc: () => tr("přenese vlastnosti zdrojové entity na cílové: hladina, barva, typ čáry, měřítko čáry, tloušťka, průhlednost, textový styl a výška, šířka křivky, kótovací styl, vzor šrafy (Nastavení = které)"),
  usage: () => tr("přenést-vlastnosti e1 e2 e3 | přenést-vlastnosti nastavení nic hladina \"\" e1 e5"),
  run: function* (c): CmdGen {
    let src: DraftEntity | null = null;
    while (!src) {
      const s = yield { k: "entity", msg: tr("Vyberte zdrojový objekt nebo"), kw: [EK.settings] };
      if (s.k === "ent") src = c.tx.get(s.id) ?? null;
      else if (s.k === "kw") {
        for (;;) {
          const on = Object.entries(editState(c).match).filter(([, v]) => v).map(([k]) => k).join(", ") || tr("nic");
          c.log(tr("přenáší se: {0}", on));
          const k = yield { k: "kw", msg: tr("Přepnout vlastnost (Enter = hotovo)"), kw: MATCH_KW, none: true };
          if (k.k !== "kw") break;
          if (k.id === "all" || k.id === "none") for (const key of Object.keys(editState(c).match)) editState(c).match[key] = k.id === "all";
          else editState(c).match[k.id] = !editState(c).match[k.id];
        }
      } else return;
    }
    const ids = unlocked(c, (yield* pickObjects(c, tr("Vyberte cílové objekty"))).filter((id) => id !== src!.id));
    if (!ids.length) return nothing(c);
    if (editState(c).match.layer && !findLayer(c.tx.model, src.layer)) throw new Error(tr("hladina „{0}“ neexistuje", src.layer));
    for (const id of ids) {
      const e = c.tx.get(id)!;
      c.tx.put({ ...matchProps(src, e, editState(c).match), id } as DraftEntity);
    }
    c.log(tr("✓ vlastnosti z {0} přeneseny na {1} entit", src.id, ids.length));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- POŘADÍ

registerCommand({
  id: "DRAWORDER",
  names: { cs: ["pořadí", "poradi"], en: ["draworder"], de: ["zeichreihenf"] },
  alias: ["DR"],
  group: "modify",
  desc: () => tr("pořadí kreslení vybraných entit: dopředu, dozadu, nad / pod referenční objekty (pořadí v seznamu = pořadí ve výkresu a v DXF)"),
  usage: () => tr("pořadí e3 dopředu | pořadí e3 dozadu | pořadí e3 nad-objekty e7"),
  run: function* (c): CmdGen {
    const preset = c.interactive ? PRESET.draworder : undefined;
    delete PRESET.draworder;
    const ids = unlocked(c, yield* pickObjects(c, tr("Vyberte objekty")));
    if (!ids.length) return nothing(c);
    const k = preset ? ({ k: "kw", id: preset } as const) : yield* askKw(tr("Pořadí kreslení"), [EK.above, EK.under, EK.front, EK.back], "back");
    if (k.k !== "kw") return;
    let ref: string[] = [];
    if (k.id === "above" || k.id === "under") {
      const s = yield { k: "select", msg: tr("Vyberte referenční objekty") };
      ref = s.k === "sel" ? s.ids.filter((id) => !ids.includes(id)) : [];
      if (!ref.length) return nothing(c, tr("nejsou vybrány referenční objekty"));
    }
    const sp = c.tx.space;
    const set = new Set(ids);
    c.tx.setModel((m) => {
      const list = spaceEntities(m, sp) ?? m.entities;
      const moving = list.filter((e) => set.has(e.id));
      const rest = list.filter((e) => !set.has(e.id));
      let out: DraftEntity[];
      if (k.id === "front") out = [...rest, ...moving];
      else if (k.id === "back") out = [...moving, ...rest];
      else {
        const rs = new Set(ref);
        const pos = rest.map((e, i) => (rs.has(e.id) ? i : -1)).filter((i) => i >= 0);
        const at = k.id === "above" ? Math.max(...pos) + 1 : Math.min(...pos);
        out = [...rest.slice(0, at), ...moving, ...rest.slice(at)];
      }
      return withSpaceEntities(m, sp, out);
    });
    c.out("order", (spaceEntities(c.tx.model, sp) ?? []).map((e) => e.id));
    c.log(tr("✓ pořadí změněno: {0} entit", ids.length));
    doneSel(c);
  },
});

