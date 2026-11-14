/**
 * BALÍK 1 (edit) – EKVIDISTANTA (vzdálenost / Bodem, Smazat zdroj, Hladina zdroj / aktuální, Vícekrát, Zpět),
 * ZAOBLIT (poloměr, poloměr 0 = roh, Křivka = všechny vrcholy, Oříznout / Neoříznout, Vícekrát, Shift = roh, Zpět)
 * a ZKOSIT (vzdálenosti, délka + úhel, Metoda, Křivka, Oříznout, Vícekrát, Shift = roh, Zpět).
 */
import { tr } from "../../i18n";
import { kwLabel, registerCommand, type CmdCtx, type CmdGen, type Input } from "../commands";
import { dist } from "../geom";
import { entityCurves, kindLabel } from "../kinds";
import type { DPolyline, DraftEntity, NewEntity, Vec2 } from "../model";
import { chamferByAngle, chamferGeom, cornerPolyline, filletArc, filletGeom, pickCarrier, sharedVertex, trimToPoint, type Pick } from "./fillet";
import { offsetDistTo, offsetEntity, offsetPreview } from "./offset";
import { doneSel, editState, EK, isLocked, kc, MOD, Steps, askKw } from "./shared";

// ---------------------------------------------------------------- EKVIDISTANTA

const offsetable = (e: DraftEntity) => ["line", "xline", "ray", "circle", "arc", "polyline", "ellipse", "spline"].includes(e.type);

registerCommand({
  id: "OFFSET",
  names: { cs: ["ekvidistanta", "odsadit"], en: ["offset"], de: ["versetz", "versetzen"] },
  alias: ["O"],
  group: "modify",
  desc: () => tr("ekvidistanta (rovnoběžná kopie) ve vzdálenosti nebo bodem: úsečka, kružnice, oblouk, křivka s oblouky přesně, elipsa a spline jako spline; Smazat zdroj, Hladina zdroj / aktuální, Vícekrát"),
  usage: () => tr("ekvidistanta 5 e1 0,100 | ekvidistanta bodem e1 50,30 | ekvidistanta 2 e3 0,0 e4 10,10 (strana bodem) | ekvidistanta smazat ano 5 e1 0,10"),
  run: function* (c): CmdGen {
    const st = editState(c);
    c.log(tr("Aktuální nastavení: smazat zdroj = {0}, hladina = {1}", kwLabel(st.offsetErase ? EK.yes : EK.no), st.offsetLayerCurrent ? tr("aktuální") : tr("zdroj")));
    let through = st.offsetThrough;
    let d = st.offsetDist;
    for (;;) {
      const a = yield { k: "dist", msg: tr("Zadejte vzdálenost ekvidistanty nebo"), kw: [EK.through, EK.erase, EK.layer], def: through ? undefined : d, min: 1e-12, none: through };
      if (a.k === "num") {
        d = a.v;
        through = false;
        break;
      }
      if (a.k === "none") break;
      if (a.k !== "kw") return;
      if (a.id === "through") {
        through = true;
        break;
      }
      if (a.id === "erase") {
        const k = yield* askKw(tr("Smazat zdrojový objekt po vytvoření ekvidistanty?"), [EK.yes, EK.no], st.offsetErase ? "yes" : "no");
        if (k.k === "kw") st.offsetErase = k.id === "yes";
      } else if (a.id === "layer") {
        const k = yield* askKw(tr("Hladina ekvidistanty"), [EK.current, EK.source], st.offsetLayerCurrent ? "current" : "source");
        if (k.k === "kw") st.offsetLayerCurrent = k.id === "current";
      }
    }
    st.offsetThrough = through;
    if (!through) st.offsetDist = d;
    const steps = new Steps(c);
    let n = 0;
    const layerFor = (e: DraftEntity) => (st.offsetLayerCurrent ? c.tx.vars.clayer : e.layer);
    const make = (src: DraftEntity, P: Vec2): string | null => {
      const dd = through ? offsetDistTo(src, P, kc(c)) : d;
      if (!(dd > 1e-12)) {
        c.log(tr("bod leží na objektu – ekvidistanta nevznikla"));
        return null;
      }
      let gs: NewEntity[];
      try {
        gs = offsetEntity(src, dd, P, kc(c));
      } catch (err) {
        const m = (err as Error).message;
        c.log(m === "radius" || m === "collapse" ? tr("{0}: ve vzdálenosti {1} by ekvidistanta zanikla", src.id, c.fmt.len(dd)) : tr("{0} ({1}) nelze odsadit", src.id, kindLabel(src.type)));
        return null;
      }
      steps.begin();
      const ids = gs.map((g) => steps.add(src, g, layerFor(src)));
      if (st.offsetErase && !isLocked(c, src)) steps.remove(src.id);
      steps.commit();
      if (ids.length > 1) c.log(tr("{0}: ekvidistanta se zúžením rozdělila na {1} části", src.id, ids.length));
      n++;
      return ids[0];
    };
    for (;;) {
      const s = yield { k: "entity", msg: tr("Vyberte objekt k odsazení nebo"), kw: [EK.exit, EK.undo], filter: offsetable, none: true };
      if (s.k === "kw" && s.id === "undo") {
        if (!steps.undo()) c.log(tr("není co vrátit"));
        continue;
      }
      if (s.k !== "ent") break;
      let src = c.tx.get(s.id)!;
      // objekt na zamčené hladině nejde vybrat (jako AutoCAD) – ani ke kopii, která by vznikla na zamčené hladině
      if (isLocked(c, src)) {
        const msg = tr("entita {0} je na zamčené hladině „{1}“", src.id, src.layer);
        if (!c.interactive) throw new Error(msg);
        c.log(msg);
        continue;
      }
      let multiple = false;
      for (;;) {
        const cur = src;
        const q: Input = yield {
          k: "point",
          msg: through ? tr("Zadejte bod, kterým ekvidistanta prochází, nebo") : tr("Zadejte bod na straně ekvidistanty nebo"),
          kw: [EK.exit, EK.multiple, EK.undo],
          none: multiple,
          preview: (p: Vec2) => offsetPreview(cur, through ? offsetDistTo(cur, p, kc(c)) : d, p, kc(c)),
        };
        if (q.k === "kw" && q.id === "multiple") {
          multiple = true;
          continue;
        }
        if (q.k === "kw" && q.id === "undo") {
          if (!steps.undo()) c.log(tr("není co vrátit"));
          continue;
        }
        if (q.k === "kw" && q.id === "exit") {
          c.log(tr("✓ ekvidistant: {0}", n));
          return doneSel(c);
        }
        if (q.k !== "point") break;
        const id = make(cur, q.p);
        if (!multiple) break;
        if (id) src = c.tx.get(id) ?? src;
      }
    }
    c.log(tr("✓ ekvidistant: {0}", n));
    doneSel(c);
  },
});

// ---------------------------------------------------------------- ZAOBLIT / ZKOSIT

const filletable = (e: DraftEntity) => ["line", "arc", "circle", "polyline"].includes(e.type);
const chamferable = (e: DraftEntity) => ["line", "polyline"].includes(e.type);

/** úsek křivky (index vrcholu, kde začíná) v místě výběru */
const segAt = (c: CmdCtx, e: DraftEntity, pk: Pick) => entityCurves(e, kc(c))[pk.ci]?.seg ?? 0;

type Corner = { kind: "fillet"; r: number } | { kind: "chamfer"; d1: number; d2: number; byAngle?: number };

/** zaoblení / zkosení dvou vybraných objektů; vrací true, když vznikl výsledek */
function doCorner(c: CmdCtx, steps: Steps, a: { id: string; p: Vec2 }, b: { id: string; p: Vec2 }, mode: Corner): boolean {
  const eA = c.tx.get(a.id)!;
  const eB = c.tx.get(b.id)!;
  const trim = editState(c).trimMode;
  if (trim && (isLocked(c, eA) || isLocked(c, eB))) throw new Error(tr("objekt je na zamčené hladině"));
  const pA = pickCarrier(eA, a.p, kc(c));
  const pB = pickCarrier(eB, b.p, kc(c));
  if (!pA || !pB) throw new Error(tr("objekt nelze zaoblit ani zkosit"));
  // dva úseky téže křivky
  if (eA.id === eB.id) {
    if (eA.type !== "polyline") throw new Error(tr("vyberte dva různé objekty (nebo dva sousední úseky křivky)"));
    const s1 = segAt(c, eA, pA);
    const s2 = segAt(c, eA, pB);
    const v = sharedVertex(eA as DPolyline, s1, s2);
    if (v === null) throw new Error(tr("úseky křivky spolu nesousedí"));
    let m = mode;
    // d1 patří k prvnímu vybranému úseku (vrchol v = konec úseku s1, pokud s1 předchází)
    if (m.kind === "chamfer" && (s1 + 1) % (eA as DPolyline).pts.length !== v) m = { ...m, d1: m.d2, d2: m.d1 };
    const r = cornerPolyline(eA as DPolyline, m.kind === "fillet" ? { r: m.r } : m.byAngle !== undefined ? { d1: m.d1, ang: m.byAngle } : { d1: m.d1, d2: m.d2 }, v);
    if (!r.count) throw new Error(tr("úseky jsou na zaoblení / zkosení příliš krátké nebo jsou to oblouky"));
    steps.replace(eA, r.geom);
    return true;
  }
  let T1: Vec2;
  let T2: Vec2;
  let corner: Vec2 | null = null;
  let extra: NewEntity | null = null;
  if (mode.kind === "fillet") {
    const g = filletGeom(pA, pB, mode.r);
    if (!g) throw new Error(tr("objekty nelze zaoblit – rovnoběžné, totožné nebo poloměr nevyhovuje"));
    T1 = g.T1;
    T2 = g.T2;
    corner = g.corner;
    if (g.X && g.r > 0) extra = filletArc(g.X, g.r, T1, T2, g.bulge);
  } else {
    let d2 = mode.d2;
    if (mode.byAngle !== undefined) {
      const x = chamferByAngle(pA, pB, mode.d1, mode.byAngle);
      if (x === null) throw new Error(tr("zkosení s tímto úhlem nevznikne"));
      d2 = x;
    }
    const g = chamferGeom(pA, pB, mode.d1, d2);
    if (!g) throw new Error(tr("zkosit lze jen dvě různoběžné úsečky (nebo přímé úseky křivky)"));
    T1 = g.C1;
    T2 = g.C2;
    corner = g.corner;
    if (dist(T1, T2) > 1e-12) extra = { type: "line", a: T1, b: T2 } as NewEntity;
  }
  if (trim) {
    const nA = trimToPoint(pA, T1, kc(c), corner);
    const nB = trimToPoint(pB, T2, kc(c), corner);
    if (nA) steps.replace(eA, nA);
    if (nB) steps.replace(eB, nB);
  }
  if (extra) {
    if (eA.layer === eB.layer) steps.add(eA, extra);
    else steps.addNew(extra);
  }
  return true;
}

function* corner(c: CmdCtx, chamfer: boolean): CmdGen {
  const st = editState(c);
  const steps = new Steps(c);
  let multiple = false;
  let n = 0;
  const settings = () =>
    c.log(
      chamfer
        ? st.chamByAngle
          ? tr("(režim {0}) délka = {1}, úhel = {2}", st.trimMode ? tr("OŘÍZNOUT") : tr("NEOŘÍZNOUT"), c.fmt.len(st.chamLen), c.fmt.ang(st.chamAng))
          : tr("(režim {0}) vzdálenost 1 = {1}, vzdálenost 2 = {2}", st.trimMode ? tr("OŘÍZNOUT") : tr("NEOŘÍZNOUT"), c.fmt.len(st.chamA), c.fmt.len(st.chamB))
        : tr("Aktuální nastavení: režim = {0}, poloměr = {1}", st.trimMode ? tr("OŘÍZNOUT") : tr("NEOŘÍZNOUT"), c.fmt.len(st.filletRad)),
    );
  settings();
  const filt = chamfer ? chamferable : filletable;
  const mode = (zero: boolean): Corner => (chamfer ? (zero ? { kind: "chamfer", d1: 0, d2: 0 } : st.chamByAngle ? { kind: "chamfer", d1: st.chamLen, d2: 0, byAngle: st.chamAng } : { kind: "chamfer", d1: st.chamA, d2: st.chamB }) : { kind: "fillet", r: zero ? 0 : st.filletRad });
  for (;;) {
    const kws = chamfer ? [EK.undo, EK.polyline, EK.distance, EK.angle, EK.trim, EK.method, EK.multiple] : [EK.undo, EK.polyline, EK.radius, EK.trim, EK.multiple];
    const s = yield { k: "entity", msg: chamfer ? tr("Vyberte první úsečku nebo") : tr("Vyberte první objekt nebo"), kw: kws, filter: filt, none: true };
    if (s.k === "none") break;
    if (s.k === "kw") {
      switch (s.id) {
        case "undo":
          if (!steps.undo()) c.log(tr("není co vrátit"));
          break;
        case "multiple":
          multiple = true;
          break;
        case "radius": {
          const r = yield { k: "dist", msg: tr("Zadejte poloměr zaoblení"), def: st.filletRad, min: 0 };
          if (r.k === "num") st.filletRad = r.v;
          settings();
          break;
        }
        case "trim": {
          const k = yield* askKw(tr("Režim ořezávání"), [EK.trim, EK.notrim], st.trimMode ? "trim" : "notrim");
          if (k.k === "kw") st.trimMode = k.id === "trim";
          settings();
          break;
        }
        case "distance": {
          const a = yield { k: "dist", msg: tr("Zadejte první vzdálenost zkosení"), def: st.chamA, min: 0 };
          if (a.k === "num") st.chamA = a.v;
          const b = yield { k: "dist", msg: tr("Zadejte druhou vzdálenost zkosení"), def: st.chamA, min: 0 };
          if (b.k === "num") st.chamB = b.v;
          st.chamByAngle = false;
          settings();
          break;
        }
        case "angle": {
          const a = yield { k: "dist", msg: tr("Zadejte délku zkosení na první úsečce"), def: st.chamLen, min: 0 };
          if (a.k === "num") st.chamLen = a.v;
          const b = yield { k: "angle", msg: tr("Zadejte úhel zkosení od první úsečky"), def: st.chamAng || 45 };
          if (b.k === "num") st.chamAng = b.v;
          st.chamByAngle = true;
          settings();
          break;
        }
        case "method": {
          const k = yield* askKw(tr("Metoda zkosení"), [EK.distance, EK.angle], st.chamByAngle ? "angle" : "distance");
          if (k.k === "kw") st.chamByAngle = k.id === "angle";
          settings();
          break;
        }
        case "polyline": {
          const p = yield { k: "entity", msg: tr("Vyberte 2D křivku"), filter: (e: DraftEntity) => e.type === "polyline" };
          if (p.k !== "ent") break;
          const e = c.tx.get(p.id) as DPolyline;
          if (isLocked(c, e)) throw new Error(tr("entita {0} je na zamčené hladině „{1}“", e.id, e.layer));
          const m = mode(false);
          const r = cornerPolyline(e, m.kind === "fillet" ? { r: m.r } : m.byAngle !== undefined ? { d1: m.d1, ang: m.byAngle } : { d1: m.d1, d2: m.d2 });
          steps.begin();
          if (r.count) steps.replace(e, r.geom);
          steps.commit();
          n += r.count;
          c.log(chamfer ? tr("zkoseno vrcholů: {0}{1}", r.count, r.skipped ? tr(" (příliš krátké úseky: {0})", r.skipped) : "") : tr("zaobleno vrcholů: {0}{1}", r.count, r.skipped ? tr(" (příliš krátké úseky: {0})", r.skipped) : ""));
          if (!multiple) return finish();
          break;
        }
      }
      continue;
    }
    if (s.k !== "ent") break;
    const first = s;
    const s2 = yield { k: "entity", msg: chamfer ? tr("Vyberte druhou úsečku nebo se Shiftem pro roh") : tr("Vyberte druhý objekt nebo se Shiftem pro roh (poloměr 0)"), filter: filt };
    if (s2.k !== "ent") break;
    const zero = c.interactive && MOD.shift;
    steps.begin();
    try {
      if (doCorner(c, steps, first, s2, mode(zero))) n++;
    } catch (err) {
      // v GUI jako AutoCAD: zpráva a nová výzva (dosavadní zaoblení příkazu zůstanou); v textu chyba = nic
      if (!c.interactive) throw err;
      c.log(`⚠ ${(err as Error).message}`);
      steps.commit();
      continue;
    }
    steps.commit();
    if (!multiple) break;
  }
  return finish();
  function finish() {
    c.log(chamfer ? tr("✓ zkosení: {0}", n) : tr("✓ zaoblení: {0}", n));
    doneSel(c);
  }
}

registerCommand({
  id: "FILLET",
  names: { cs: ["zaoblit", "zaoblení"], en: ["fillet"], de: ["abrunden"] },
  alias: ["F"],
  group: "modify",
  desc: () => tr("zaoblí roh dvou objektů (úsečka, oblouk, kružnice, úsek křivky) obloukem daného poloměru a objekty ořízne / prodlouží; poloměr 0 = ostrý roh; Křivka = všechny vrcholy; rovnoběžné úsečky = půlkružnice"),
  usage: () => tr("zaoblit poloměr 5 e1@10,0 e2@0,10 | zaoblit poloměr 0 e1 e2 | zaoblit poloměr 3 křivka e4 | zaoblit oříznout neoříznout poloměr 5 e1 e2 (bez oříznutí)"),
  run: (c) => corner(c, false),
});

registerCommand({
  id: "CHAMFER",
  names: { cs: ["zkosit", "zkosení"], en: ["chamfer"], de: ["fase"] },
  alias: ["CHA"],
  group: "modify",
  desc: () => tr("zkosí roh dvou úseček (i přímých úseků křivky): dvě vzdálenosti, nebo délka a úhel; Křivka = všechny vrcholy; vzdálenost 0 = ostrý roh"),
  usage: () => tr("zkosit vzdálenost 5 5 e1@10,0 e2@0,10 | zkosit úhel 5 30 e1 e2 | zkosit vzdálenost 2 2 křivka e4"),
  run: (c) => corner(c, true),
});

