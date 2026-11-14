/**
 * BALÍK 1 (edit) – OŘÍZNOUT a PRODLOUŽIT (rychlý / standardní režim, řezné hrany, prodloužené hrany, plot, křížení,
 * Shift = opačná operace, smazat, zpět), PŘERUŠIT, PŘERUŠIT-V-BODĚ a PRODLOUŽENÍ (delta, procenta, celkem, dynamicky).
 */
import { tr } from "../../i18n";
import { kw, registerCommand, type CmdCtx, type CmdGen, type Input, type Prompt } from "../commands";
import type { Curve } from "../curves";
import { boxFrom2, boxGrow, dist, inBox, rad, type Box } from "../geom";
import { entityBox, kindLabel } from "../kinds";
import { layerVisible } from "../layers";
import { spaceEntities, type DraftEntity, type Vec2 } from "../model";
import { spatialIndex } from "../spatial";
import { cutParams, curveParams, extendHit, extendTo, keepIntervals, lengthenBy, lengthInfo, nearEnd } from "./cut";
import { editCurve, type EC } from "./param";
import { doneSel, editState, EK, isLocked, kc, MOD, nothing, Steps, askKw } from "./shared";
import { tolAt } from "./tol";

const cuttingEdges = kw("cuttingedges", "Řezné-hrany", "Cutting-edges", "Schnittkanten", ["t"]);
const boundaryEdges = kw("boundaryedges", "Hraniční-hrany", "Boundary-edges", "Grenzkanten");

/** viditelné entity prostoru (hrany v rychlém režimu) */
const visibleList = (c: CmdCtx): DraftEntity[] => {
  const m = c.tx.model;
  return (spaceEntities(m, c.session.space) ?? m.entities).filter((e) => layerVisible(m, e.layer));
};

/** hrany pro entitu: vybrané, nebo všechny viditelné v okolí (při prodloužených hranách všechny) */
function edgesFor(c: CmdCtx, e: DraftEntity, edges: string[] | null): DraftEntity[] {
  if (edges) return edges.map((id) => c.tx.get(id)).filter((x): x is DraftEntity => !!x);
  const m = c.tx.model;
  const list = spaceEntities(m, c.session.space) ?? m.entities;
  if (editState(c).edgeExtend) return visibleList(c);
  const b = entityBox(e, { model: m });
  if (!b) return visibleList(c);
  const idx = spatialIndex(list, { model: m });
  return idx.query(boxGrow(b, 1e-6 * Math.max(1, b.x1 - b.x0, b.y1 - b.y0))).filter((x) => layerVisible(m, x.layer));
}

/** hranice pro prodloužení: vybrané, nebo všechny viditelné */
const boundsFor = (c: CmdCtx, edges: string[] | null): DraftEntity[] => (edges ? edges.map((id) => c.tx.get(id)).filter((x): x is DraftEntity => !!x) : visibleList(c));

/** oříznutí entity: odebere díly, ve kterých leží parametry `picks`; vrací počet změn (0 = nic); quiet = bez zpráv (plot, okno) */
function trimEntity(c: CmdCtx, steps: Steps, e: DraftEntity, ec: EC, picks: number[], edges: string[] | null, quick: boolean, quiet = false): number {
  const cuts = cutParams(e, ec, edgesFor(c, e, edges), kc(c), editState(c).edgeExtend);
  if (!cuts.length) {
    if (quiet) return 0;
    if (quick && !edges) {
      steps.remove(e.id);
      c.log(tr("{0} {1} neprotíná žádnou hranu – smazán", kindLabel(e.type), e.id));
      return 1;
    }
    c.log(tr("{0} neprotíná řeznou hranu", e.id));
    return 0;
  }
  const keep = keepIntervals(ec, cuts, picks);
  if (!keep) {
    if (!quiet) c.log(tr("{0}: uzavřený objekt potřebuje alespoň dva průsečíky s hranami", e.id));
    return 0;
  }
  const pieces = keep.map(([a, b]) => ec.piece(a, b)).filter((x) => !!x);
  if (!pieces.length) steps.remove(e.id);
  else {
    steps.replace(e, pieces[0]!);
    for (const p of pieces.slice(1)) steps.add(e, p!);
  }
  return 1;
}

/** prodloužení konce entity blíž bodu `p` k hranicím */
function extendEntity(c: CmdCtx, steps: Steps, e: DraftEntity, p: Vec2, edges: string[] | null): number {
  const ec = editCurve(e, kc(c));
  if (!ec || !ec.extendable) {
    c.log(tr("{0} ({1}) nelze prodloužit", e.id, kindLabel(e.type)));
    return 0;
  }
  const which = nearEnd(ec, p);
  const hit = extendHit(e, ec, which, boundsFor(c, edges), kc(c), editState(c).edgeExtend);
  if (!hit) {
    c.log(tr("{0}: prodloužení neprotíná žádnou hranici", e.id));
    return 0;
  }
  const g = extendTo(e, which, hit);
  if (!g) return 0;
  steps.replace(e, g);
  return 1;
}

/** plot / křížení: křivky plotu nebo hrany okna */
const fenceCurves = (pts: Vec2[]): Curve[] => pts.slice(1).map((p, i) => ({ k: "line" as const, a: pts[i], b: p }));
const boxCurves = (b: Box): Curve[] => fenceCurves([[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y0]]);

/** parametry výběru plotem / oknem na entitě (průsečíky s plotem; u okna i body dílu uvnitř) */
function regionPicks(c: CmdCtx, e: DraftEntity, ec: EC, curves: Curve[], box: Box | null): number[] {
  const out = curveParams(e, ec, curves, kc(c));
  if (box && Number.isFinite(ec.lo) && Number.isFinite(ec.hi)) {
    for (let i = 0; i <= 64; i++) {
      const u = ec.lo + ((ec.hi - ec.lo) * i) / 64;
      if (inBox(ec.at(u), box)) out.push(u);
    }
  }
  return out;
}

/** kandidáti zasažení plotem / oknem */
function regionCandidates(c: CmdCtx, box: Box): DraftEntity[] {
  const m = c.tx.model;
  const list = spaceEntities(m, c.session.space) ?? m.entities;
  return spatialIndex(list, { model: m }).query(box).filter((e) => layerVisible(m, e.layer));
}

function* trimExtend(c: CmdCtx, extendCmd: boolean): CmdGen {
  const st = editState(c);
  /** režim tohoto běhu: Řezné-hrany přepnou na standardní jen tento běh, Režim změní i uloženou volbu výkresu */
  let quick = st.quick;
  let edges: string[] | null = null;
  const steps = new Steps(c);
  let n = 0;
  let invertNext = false;
  /** v textu se prázdný token hned po výběru hran (Enter, který výběr ukončil) přeskočí */
  let justSelected = false;
  const settings = () => c.log(tr("Aktuální nastavení: režim {0}, hrany {1}", quick ? tr("rychlý") : tr("standardní"), st.edgeExtend ? tr("prodloužené") : tr("neprodlužovat")));
  settings();
  const chooseEdges = function* (): Generator<Prompt, void, Input> {
    const s = yield { k: "select", msg: extendCmd ? tr("Vyberte hraniční hrany (Enter = všechny objekty)") : tr("Vyberte řezné hrany (Enter = všechny objekty)") };
    edges = s.k === "sel" && s.ids.length ? s.ids : null;
    justSelected = true;
    c.log(edges ? tr("hran: {0}", edges.length) : tr("hrany: všechny objekty"));
  };
  if (!quick) yield* chooseEdges();
  const apply = (id: string, p: Vec2, invert: boolean) => {
    const e = c.tx.get(id);
    if (!e) return;
    if (isLocked(c, e)) return c.log(tr("⚠ {0} je na zamčené hladině", id));
    const doExtend = extendCmd !== invert;
    steps.begin();
    if (doExtend) n += extendEntity(c, steps, e, p, edges);
    else {
      const ec = editCurve(e, kc(c));
      if (!ec) c.log(tr("{0} ({1}) nelze oříznout", id, kindLabel(e.type)));
      else {
        let u = ec.param(p);
        if (Number.isFinite(ec.lo)) u = Math.max(ec.lo, u);
        if (Number.isFinite(ec.hi)) u = Math.min(ec.hi, u);
        n += trimEntity(c, steps, e, ec, [u], edges, quick);
      }
    }
    steps.commit();
  };
  const applyRegion = (curves: Curve[], box: Box) => {
    steps.begin();
    for (const e of regionCandidates(c, box)) {
      if (isLocked(c, e) || (edges && edges.includes(e.id) && !extendCmd)) continue;
      const ec = editCurve(e, kc(c));
      if (!ec) continue;
      const picks = regionPicks(c, e, ec, curves, curves.length === 4 ? box : null);
      if (!picks.length) continue;
      if (extendCmd) {
        // prodlouží se konec blíž místu zásahu
        const p = ec.at(Math.max(ec.lo, Math.min(ec.hi, picks[0])));
        n += extendEntity(c, steps, e, p, edges);
      } else n += trimEntity(c, steps, e, ec, picks, edges, false, true);
    }
    steps.commit();
  };
  for (;;) {
    const kws = [extendCmd ? boundaryEdges : cuttingEdges, EK.fence, EK.crossing, EK.mode, EK.edge, ...(extendCmd ? [] : [EK.erase]), extendCmd ? EK.trim : EK.extend, EK.undo];
    const inp = yield {
      k: "entity",
      // krátce: výzva s 8 volbami se musí vejít do příkazového řádku (tlačítka voleb na konci zůstanou klikatelná)
      msg: extendCmd ? tr("Prodloužit objekt (Shift = oříznout) nebo") : tr("Oříznout objekt (Shift = prodloužit) nebo"),
      kw: kws,
      none: true,
    };
    const fresh = justSelected;
    justSelected = false;
    if (inp.k === "none") {
      if (fresh && !c.interactive) continue;
      break;
    }
    if (inp.k === "ent") {
      const inv = (c.interactive && MOD.shift) || invertNext;
      invertNext = false;
      apply(inp.id, inp.p, inv);
      continue;
    }
    if (inp.k !== "kw") break;
    switch (inp.id) {
      case "cuttingedges":
      case "boundaryedges":
        quick = false;
        yield* chooseEdges();
        break;
      case "mode": {
        const m = yield* askKw(tr("Režim"), [EK.quick, EK.standard], quick ? "quick" : "standard");
        if (m.k === "kw") st.quick = quick = m.id === "quick";
        if (!quick) yield* chooseEdges();
        else edges = null;
        settings();
        break;
      }
      case "edge": {
        const m = yield* askKw(tr("Prodlužovat hrany do zdánlivého průsečíku?"), [EK.extend, EK.noextend], st.edgeExtend ? "extend" : "noextend");
        if (m.k === "kw") st.edgeExtend = m.id === "extend";
        settings();
        break;
      }
      case "fence": {
        const pts: Vec2[] = [];
        for (;;) {
          const p = yield { k: "point", msg: pts.length ? tr("Zadejte další bod plotu nebo") : tr("Zadejte první bod plotu"), ...(pts.length ? { base: pts[pts.length - 1], none: true, kw: [EK.done] } : {}), preview: (q: Vec2) => (pts.length ? [{ type: "polyline", pts: [...pts, q] }] : []) };
          if (p.k !== "point") break;
          pts.push(p.p);
        }
        if (pts.length < 2) break;
        const cs = fenceCurves(pts);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        applyRegion(cs, { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
        break;
      }
      case "crossing": {
        const a = yield { k: "point", msg: tr("Zadejte první roh") };
        if (a.k !== "point") break;
        const A = a.p;
        const b = yield { k: "point", msg: tr("Zadejte protější roh"), base: A, preview: (p: Vec2) => [{ type: "polyline", pts: [A, [p[0], A[1]], p, [A[0], p[1]]], closed: true }] };
        if (b.k !== "point") break;
        const box = boxFrom2(A, b.p);
        applyRegion(boxCurves(box), box);
        break;
      }
      case "erase": {
        const s = yield { k: "select", msg: tr("Vyberte objekty ke smazání") };
        if (s.k === "sel") {
          steps.begin();
          for (const id of s.ids) {
            const e = c.tx.get(id);
            if (e && !isLocked(c, e)) steps.remove(id);
          }
          steps.commit();
        }
        break;
      }
      case "extend":
      case "trim":
        invertNext = true;
        break;
      case "undo":
        if (!steps.undo()) c.log(tr("není co vrátit"));
        break;
    }
  }
  c.log(extendCmd ? tr("✓ prodlouženo: {0}", n) : tr("✓ oříznuto: {0}", n));
  doneSel(c);
}

registerCommand({
  id: "TRIM",
  names: { cs: ["oříznout", "oriznout"], en: ["trim"], de: ["stutzen"] },
  alias: ["TR"],
  group: "modify",
  desc: () => tr("ořízne objekty na průsečících s řeznými hranami (rychlý režim = všechny objekty jsou hrany; Řezné-hrany, Plot, Křížení, Režim, Hrana = prodloužené hrany, Smazat, Prodloužit / Shift = prodloužit, Zpět)"),
  usage: () => tr("oříznout e1@20,0 e1@80,0 | oříznout řezné-hrany e5 e6 e1@50,0 | oříznout plot 0,10 100,10 hotovo"),
  run: (c) => trimExtend(c, false),
});

registerCommand({
  id: "EXTEND",
  names: { cs: ["prodloužit", "prodlouzit"], en: ["extend"], de: ["dehnen"] },
  alias: ["EX"],
  group: "modify",
  desc: () => tr("prodlouží konec objektu (u bodu výběru) k nejbližší hranici (rychlý režim = všechny objekty; Hraniční-hrany, Plot, Křížení, Režim, Hrana = prodloužené hrany, Oříznout / Shift = oříznout, Zpět)"),
  usage: () => tr("prodloužit e1@95,0 | prodloužit hraniční-hrany e5 e1@95,0 e2@0,95"),
  run: (c) => trimExtend(c, true),
});

// ---------------------------------------------------------------- PŘERUŠIT

const breakable = (c: CmdCtx) => (e: DraftEntity) => !!editCurve(e, kc(c));

registerCommand({
  id: "BREAK",
  names: { cs: ["přerušit", "prerusit"], en: ["break"], de: ["bruch"] },
  alias: ["BR"],
  group: "modify",
  desc: () => tr("vyjme část objektu mezi dvěma body (bod výběru = první bod, nebo volba První); u kružnice proti směru hodin; @ = přerušit v bodě"),
  usage: () => tr("přerušit e1@20,0 60,0 | přerušit e1 první 20,0 60,0 | přerušit e3 první 0,10 @"),
  run: function* (c): CmdGen {
    const s = yield { k: "entity", msg: tr("Vyberte objekt"), filter: breakable(c) };
    if (s.k !== "ent") return;
    const e = c.tx.get(s.id)!;
    if (isLocked(c, e)) throw new Error(tr("entita {0} je na zamčené hladině „{1}“", e.id, e.layer));
    const ec = editCurve(e, kc(c))!;
    let p1 = s.p;
    let p2: Vec2;
    for (;;) {
      const q = yield { k: "point", msg: tr("Zadejte druhý bod přerušení nebo"), base: p1, kw: [EK.first] };
      if (q.k === "kw") {
        const a = yield { k: "point", msg: tr("Zadejte první bod přerušení") };
        if (a.k !== "point") return;
        p1 = a.p;
        continue;
      }
      if (q.k !== "point") return;
      p2 = q.p;
      break;
    }
    const clampU = (u: number) => Math.max(Number.isFinite(ec.lo) ? ec.lo : -Infinity, Math.min(Number.isFinite(ec.hi) ? ec.hi : Infinity, u));
    const u1 = clampU(ec.param(p1));
    const u2 = clampU(ec.param(p2));
    const at = dist(ec.at(u1), ec.at(u2)) < tolAt(p1, 1e-9);
    const pieces = breakPieces(ec, u1, u2, at);
    applyPieces(c, e, pieces);
    c.log(at ? tr("✓ {0} přerušen v bodě", e.id) : tr("✓ {0} přerušen", e.id));
    doneSel(c);
  },
});

/** díly po přerušení (at = v jednom bodě bez mezery) */
export function breakPieces(ec: EC, u1: number, u2: number, at: boolean): [number, number][] {
  if (ec.periodic) {
    if (at) throw new Error(tr("uzavřený objekt nelze přerušit v jednom bodě – zadejte dva různé body"));
    const P = ec.hi - ec.lo;
    // odebere se úsek z u1 do u2 ve směru parametru (u kružnice proti směru hodin)
    let b = u1;
    while (b <= u2) b += P;
    if (b - u2 >= P) b -= P;
    return [[u2, b]];
  }
  if (at) {
    if (u1 <= ec.lo || u1 >= ec.hi) throw new Error(tr("bod přerušení je na konci objektu"));
    return [
      [ec.lo, u1],
      [u1, ec.hi],
    ];
  }
  const a = Math.min(u1, u2);
  const b = Math.max(u1, u2);
  const out: [number, number][] = [];
  if (a > ec.lo + 1e-12 || !Number.isFinite(ec.lo)) out.push([ec.lo, a]);
  if (b < ec.hi - 1e-12 || !Number.isFinite(ec.hi)) out.push([b, ec.hi]);
  return out;
}

function applyPieces(c: CmdCtx, e: DraftEntity, iv: [number, number][]) {
  const ec = editCurve(e, kc(c))!;
  const steps = new Steps(c);
  steps.begin();
  const g = iv.map(([a, b]) => ec.piece(a, b)).filter((x) => !!x);
  if (!g.length) steps.remove(e.id);
  else {
    steps.replace(e, g[0]!);
    for (const x of g.slice(1)) steps.add(e, x!);
  }
  steps.commit();
}

registerCommand({
  id: "BREAKATPOINT",
  names: { cs: ["přerušit-v-bodě", "prerusit-v-bode"], en: ["breakatpoint"], de: ["bruchpunkt"] },
  group: "modify",
  desc: () => tr("rozdělí otevřený objekt v bodě na dva (bez mezery)"),
  usage: () => tr("přerušit-v-bodě e1 50,0"),
  run: function* (c): CmdGen {
    const s = yield { k: "entity", msg: tr("Vyberte objekt"), filter: breakable(c) };
    if (s.k !== "ent") return;
    const e = c.tx.get(s.id)!;
    if (isLocked(c, e)) throw new Error(tr("entita {0} je na zamčené hladině „{1}“", e.id, e.layer));
    const q = yield { k: "point", msg: tr("Zadejte bod přerušení") };
    if (q.k !== "point") return;
    const ec = editCurve(e, kc(c))!;
    let u = ec.param(q.p);
    if (Number.isFinite(ec.lo)) u = Math.max(ec.lo, u);
    if (Number.isFinite(ec.hi)) u = Math.min(ec.hi, u);
    applyPieces(c, e, breakPieces(ec, u, u, true));
    c.out("created", c.tx.created);
    c.log(tr("✓ {0} rozdělen v bodě {1}", e.id, c.fmt.pt(ec.at(u))));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- PRODLOUŽENÍ (LENGTHEN)

const lengthenable = (c: CmdCtx) => (e: DraftEntity) => {
  const ec = editCurve(e, kc(c));
  return !!ec && !ec.periodic && Number.isFinite(ec.lo) && Number.isFinite(ec.hi);
};

registerCommand({
  id: "LENGTHEN",
  names: { cs: ["prodloužení", "prodlouzeni"], en: ["lengthen"], de: ["länge", "laenge"] },
  alias: ["LEN"],
  group: "modify",
  desc: () => tr("změní délku otevřeného objektu na konci u bodu výběru: Delta (± délka nebo Úhel u oblouku), Procenta, Celkem (délka nebo úhel), Dynamicky; výběr bez volby vypíše délku"),
  usage: () => tr("prodloužení delta 10 e1@95,0 | prodloužení celkem 120 e1@95,0 | prodloužení procenta 50 e1@95,0 | prodloužení delta úhel 30 e4@x,y | prodloužení e1 (výpis)"),
  run: function* (c): CmdGen {
    const st = editState(c);
    for (;;) {
      const s = yield { k: "entity", msg: tr("Vyberte objekt k měření nebo"), kw: [EK.delta, EK.percent, EK.total, EK.dynamic], filter: lengthenable(c), none: true };
      if (s.k === "ent") {
        const e = c.tx.get(s.id)!;
        const info = lengthInfo(e, editCurve(e, kc(c))!);
        c.out("length", info.length);
        if (info.angle !== undefined) c.out("angle", info.angle);
        c.log(info.angle !== undefined ? tr("Aktuální délka: {0}, úhel: {1}", c.fmt.len(info.length), c.fmt.ang(info.angle)) : tr("Aktuální délka: {0}", c.fmt.len(info.length)));
        continue;
      }
      if (s.k !== "kw") return;
      st.lenMode = s.id as typeof st.lenMode;
      if (s.id === "delta") {
        const v = yield { k: "dist", msg: tr("Zadejte přírůstek délky nebo"), kw: [EK.angle], def: st.lenDelta };
        if (v.k === "kw") {
          const a = yield { k: "angle", msg: tr("Zadejte přírůstek úhlu"), def: st.lenDeltaAngle ?? 30 };
          if (a.k !== "num") return;
          st.lenDeltaAngle = a.v;
        } else if (v.k === "num") {
          st.lenDelta = v.v;
          st.lenDeltaAngle = null;
        } else return;
      } else if (s.id === "percent") {
        const v = yield { k: "dist", msg: tr("Zadejte procento délky"), def: st.lenPercent, min: 1e-9 };
        if (v.k !== "num") return;
        st.lenPercent = v.v;
      } else if (s.id === "total") {
        const v = yield { k: "dist", msg: tr("Zadejte celkovou délku nebo"), kw: [EK.angle], def: st.lenTotal, min: 1e-9 };
        if (v.k === "kw") {
          const a = yield { k: "angle", msg: tr("Zadejte celkový úhel"), def: st.lenTotalAngle ?? 90 };
          if (a.k !== "num") return;
          st.lenTotalAngle = a.v;
        } else if (v.k === "num") {
          st.lenTotal = v.v;
          st.lenTotalAngle = null;
        } else return;
      }
      break;
    }
    const steps = new Steps(c);
    let n = 0;
    for (;;) {
      const s = yield { k: "entity", msg: tr("Vyberte objekt ke změně nebo"), kw: [EK.undo], filter: lengthenable(c), none: true };
      if (s.k === "kw") {
        if (!steps.undo()) c.log(tr("není co vrátit"));
        continue;
      }
      if (s.k !== "ent") break;
      const e = c.tx.get(s.id)!;
      if (isLocked(c, e)) {
        c.log(tr("⚠ {0} je na zamčené hladině", e.id));
        continue;
      }
      const ec = editCurve(e, kc(c))!;
      const which = nearEnd(ec, s.p);
      const L = ec.len(ec.lo, ec.hi);
      let delta = 0;
      if (st.lenMode === "dynamic") {
        const end = ec.at(which === 1 ? ec.hi : ec.lo);
        const q = yield { k: "point", msg: tr("Zadejte nový koncový bod"), base: end, preview: (p: Vec2) => dynPreview(c, e, ec, which, p) };
        if (q.k !== "point") continue;
        delta = dynDelta(e, ec, which, q.p);
      } else if (st.lenMode === "delta") delta = st.lenDeltaAngle !== null ? angleToLen(e, st.lenDeltaAngle) : st.lenDelta;
      else if (st.lenMode === "percent") delta = (L * st.lenPercent) / 100 - L;
      else delta = st.lenTotalAngle !== null ? angleToLen(e, st.lenTotalAngle) - L : st.lenTotal - L;
      let g;
      try {
        g = lengthenBy(e, ec, which, delta);
      } catch (err) {
        const m = (err as Error).message;
        c.log(m === "tooShort" ? tr("{0}: zkrácení je delší než objekt", e.id) : m === "full" ? tr("{0}: oblouk by přesáhl 360°", e.id) : tr("{0} ({1}) nelze prodloužit – jen zkrátit", e.id, kindLabel(e.type)));
        continue;
      }
      if (!g) continue;
      steps.begin();
      steps.replace(e, g);
      steps.commit();
      n++;
      const nec = editCurve(c.tx.get(e.id)!, kc(c));
      if (nec) c.out("length", nec.len(nec.lo, nec.hi));
    }
    c.log(tr("✓ změněna délka: {0} objektů", n));
    doneSel(c);
  },
});

/** úhel [°] na délku oblouku (jen oblouk) */
function angleToLen(e: DraftEntity, angDeg: number): number {
  if (e.type !== "arc") throw new Error(tr("úhel lze zadat jen u oblouku"));
  return rad(angDeg) * e.r;
}

/** dynamicky: nová délka podle průmětu kurzoru na přirozené prodloužení */
function dynDelta(e: DraftEntity, ec: EC, which: 0 | 1, p: Vec2): number {
  const L = ec.len(ec.lo, ec.hi);
  if (e.type === "arc") {
    const u = ec.param(p);
    if (which === 1) return (u - ec.hi) * e.r;
    return (ec.lo - u) * e.r;
  }
  if (e.type === "line") {
    const u = ec.param(p);
    return which === 1 ? (u - 1) * L : -u * L;
  }
  // jiné druhy: vzdálenost bodu k parametru (zkrácení), nebo od konce (prodloužení)
  let u = ec.param(p);
  u = Math.max(ec.lo, Math.min(ec.hi, u));
  const end = ec.at(which === 1 ? ec.hi : ec.lo);
  const inside = which === 1 ? ec.len(u, ec.hi) : ec.len(ec.lo, u);
  if (inside > 1e-9) return -inside;
  return dist(p, end);
}
function dynPreview(c: CmdCtx, e: DraftEntity, ec: EC, which: 0 | 1, p: Vec2) {
  try {
    const g = lengthenBy(e, ec, which, dynDelta(e, ec, which, p));
    return g ? [g] : [];
  } catch {
    void c;
    return [];
  }
}

