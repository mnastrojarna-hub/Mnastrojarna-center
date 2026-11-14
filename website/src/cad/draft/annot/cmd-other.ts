/**
 * BALÍK 2 (annot) – odkazy a značky: MLEADER (odkaz s textem), TOLERANCE (rámeček geometrické tolerance),
 * HATCH (šrafa vnitřním bodem nebo výběrem objektů, vzory, plná, přechod, ostrovy, asociativní), HATCHEDIT,
 * REVCLOUD (revizní obláček) a SURFSYM (značka struktury povrchu ISO 1302).
 */
import { tr } from "../../i18n";
import { kw, registerCommand, type CmdCtx, type CmdGen, type Input, type Prompt } from "../commands";
import { logCreated } from "../cmd-draw";
import { cLength, cPoint, cRange, type Curve } from "../curves";
import { add, angleOf, dist, mul, polyArea, sub, unit } from "../geom";
import { entityCurves, type KindCtx } from "../kinds";
import { spaceEntities, type DraftEntity, type NewEntity, type Vec2 } from "../model";
import { normDeg } from "../units";
import { boundaryAt, noBoundary, objectLoops, type Loop } from "./boundary";
import { askText } from "./cmd-text";
import { noteSizes } from "./dimgeom";
import { ensureDimStyles } from "./dimstyle";
import { buildTolerance, GDT_SYMBOLS, tolerancePlain } from "./gdt";
import { leaderText, parseIsland, parseSurfKind, setHatchField } from "./kinds-annot";
import { findPattern, hatchArea, isSolidName, isUserName, patternLibrary, registerPatterns } from "./patterns";
import type { DHatch, DLeader, DSurfSym, DTolerance } from "./types";

type Gen<T> = Generator<Prompt, T, Input>;
const kctx = (c: CmdCtx): KindCtx => c.kctx();
const list = (c: CmdCtx) => spaceEntities(c.tx.model, c.session.space) ?? c.tx.model.entities;

export const KO = {
  arrow: kw("arrow", "Šipka", "Arrowhead", "Pfeil"),
  size: kw("size", "Velikost", "Size", "Größe"),
  landing: kw("landing", "Zalomení", "Landing", "Abschluss"),
  spline: kw("spline", "Spline", "Spline", "Spline"),
  height: kw("height", "Výška", "Height", "Höhe"),
  vertex: kw("vertex", "Bod", "Vertex", "Punkt"),
  string: kw("string", "Řetězec", "String", "Zeichenfolge"),
  pattern: kw("pattern", "Vzor", "Pattern", "Muster"),
  scale: kw("scale", "Měřítko", "Scale", "Skalierung"),
  angle: kw("angle", "Úhel", "Angle", "Winkel"),
  solid: kw("solid", "Plná", "Solid", "Solid"),
  gradient: kw("gradient", "Přechod", "Gradient", "Verlauf"),
  objects: kw("objects", "Objekty", "Objects", "Objekte"),
  island: kw("island", "Ostrovy", "Islands", "Inseln"),
  assoc: kw("associative", "Asociativní", "Associative", "Assoziativ"),
  origin: kw("origin", "Počátek", "Origin", "Ursprung"),
  undo: kw("undo", "Zpět", "Undo", "Zurück"),
  double: kw("double", "Dvojitá", "Double", "Doppelt"),
  user: kw("user", "Uživatelský", "User", "Benutzer"),
  normal: kw("normal", "Normální", "Normal", "Normal"),
  outer: kw("outer", "Vnější", "Outer", "Außen"),
  ignore: kw("ignore", "Ignorovat", "Ignore", "Ignorieren"),
  yes: kw("yes", "Ano", "Yes", "Ja"),
  no: kw("no", "Ne", "No", "Nein"),
  linear: kw("linear", "Lineární", "Linear", "Linear"),
  cylinder: kw("cylinder", "Válcový", "Cylinder", "Zylinder"),
  invcylinder: kw("invcylinder", "Obrácený", "Invcylinder", "Invzylinder"),
  load: kw("load", "Načíst", "Load", "Laden"),
  boundary: kw("boundary", "Hranice", "Boundary", "Umgrenzung"),
  arclen: kw("arclength", "Délka", "Arclength", "Bogenlänge"),
  object: kw("object", "Objekt", "Object", "Objekt"),
  rect: kw("rectangular", "Obdélník", "Rectangular", "Rechteckig"),
  poly: kw("polygonal", "Mnohoúhelník", "Polygonal", "Polygonal"),
  kind: kw("kind", "Druh", "Type", "Art"),
  process: kw("process", "Postup", "Process", "Verfahren"),
  lay: kw("lay", "Stopy", "Lay", "Rillen"),
  around: kw("around", "Dokola", "Around", "Ringsum"),
  basic: kw("basic", "Základní", "Basic", "Grund"),
  removal: kw("removal", "S-úběrem", "Removal", "Abtrag"),
  noremoval: kw("noremoval", "Bez-úběru", "Noremoval", "Ohne"),
  reverse: kw("reverse", "Obrátit", "Reverse", "Umkehren"),
};

// ---------------------------------------------------------------- MLEADER

const ARROW_KW = [kw("", "Plná", "Closedfilled", "Geschlossen"), kw("_OPEN", "Otevřená", "Open", "Offen"), kw("_DOT", "Tečka", "Dot", "Punkt"), kw("_OBLIQUE", "Šikmá", "Oblique", "Schräg"), kw("_CLOSEDBLANK", "Prázdná", "Closedblank", "Leer"), kw("_NONE", "Bez", "None", "Keine")].map((k) => ({ ...k, id: k.id || "_CLOSEDFILLED" }));

registerCommand({
  id: "MLEADER",
  names: { cs: ["odkaz"], en: ["mleader", "leader", "qleader"], de: ["mführung", "führung"] },
  alias: ["MLD", "LE"],
  group: "annotate",
  desc: () => tr("odkaz se šipkou a textem: bod šipky, (Bod = další vrchol), bod zalomení, text; volby Šipka (Plná, Otevřená, Tečka, Šikmá, Prázdná, Bez), Velikost, Zalomení (délka), Spline, Výška textu"),
  usage: () => tr("odkaz 10,10 30,25 \"Sražení 1×45°\" | odkaz šipka tečka 10,10 bod 20,30 40,30 \"Text\" | odkaz 10,10 30,25 \"\" (bez textu)"),
  run: function* (c): CmdGen {
    // anotativní styl: velikosti na papíře (kreslí se × měřítko poznámek), jinak ve výkrese
    const sz = noteSizes(kctx(c));
    let arrow = "";
    let asz = sz.asz;
    let th = sz.txt;
    let dogleg = 2 * sz.asz;
    let spline = false;
    let tip: Vec2 | null = null;
    const option = function* (id: string): Gen<void> {
      if (id === "arrow") {
        const i = yield { k: "kw", msg: tr("Zadejte druh šipky"), kw: ARROW_KW, def: "_CLOSEDFILLED" };
        if (i.k === "kw") arrow = i.id === "_CLOSEDFILLED" ? "" : i.id;
      } else if (id === "size") {
        const i = yield { k: "dist", msg: tr("Zadejte velikost šipky"), def: asz, min: 0 };
        if (i.k === "num") asz = i.v;
      } else if (id === "landing") {
        const i = yield { k: "dist", msg: tr("Zadejte délku zalomení"), def: dogleg, min: 0 };
        if (i.k === "num") dogleg = i.v;
      } else if (id === "spline") spline = !spline;
      else if (id === "height") {
        const i = yield { k: "dist", msg: tr("Zadejte výšku textu"), def: th, min: 1e-9 };
        if (i.k === "num") th = i.v;
      }
    };
    const kws = [KO.arrow, KO.size, KO.landing, KO.spline, KO.height];
    while (!tip) {
      const i = yield { k: "point", msg: tr("Zadejte umístění šipky odkazu"), kw: kws };
      if (i.k === "point") tip = i.p;
      else if (i.k === "kw") yield* option(i.id);
      else return;
    }
    const pts: Vec2[] = [tip];
    const make = (q: Vec2): DLeader => ({ id: "~", layer: "0", type: "leader", pts: [...pts, q], ...(arrow ? { arrow } : {}), arrowSize: asz, textH: th, dogleg, ...(spline ? { spline } : {}), ...(sz.anno ? { annotative: true } : {}) });
    for (;;) {
      const i = yield { k: "point", msg: tr("Zadejte umístění zalomení odkazu"), base: pts[pts.length - 1], kw: [KO.vertex, ...kws], preview: (q) => [make(q) as unknown as NewEntity] };
      if (i.k === "point") {
        pts.push(i.p);
        break;
      }
      if (i.k !== "kw") return;
      if (i.id === "vertex") {
        const v = yield { k: "point", msg: tr("Zadejte další vrchol odkazu"), base: pts[pts.length - 1], preview: (q) => [make(q) as unknown as NewEntity] };
        if (v.k === "point") pts.push(v.p);
        continue;
      }
      yield* option(i.id);
    }
    const last = pts[pts.length - 1];
    const side = last[0] >= pts[0][0] ? 1 : -1;
    const K = sz.kDraw;
    const s = yield* askText(c, tr("Zadejte text odkazu (Enter = bez textu)"), { title: tr("Text odkazu"), init: "", p: add(last, [side * (dogleg + sz.gap) * K, (th * K) / 2]), h: th * K, rot: 0, w: 0, attach: side > 0 ? 1 : 3 });
    ensureDimStyles(c);
    const L: Omit<DLeader, "id" | "layer"> = { type: "leader", pts, ...(arrow ? { arrow } : {}), arrowSize: asz, textH: th, dogleg, ...(spline ? { spline } : {}), ...(s ? { text: s } : {}), ...(sz.anno ? { annotative: true } : {}) };
    // poloha textu se uloží (DWG / DXF ji zapíše a načte beze ztráty); anotativní odkaz ji počítá z měřítka poznámek
    const tp = s && !sz.anno ? leaderText({ ...L, id: "~", layer: "0" } as DLeader, kctx(c))?.p : undefined;
    const id = c.tx.add({ ...L, ...(tp ? { textPos: tp } : {}) } as DLeader);
    logCreated(c, [id]);
  },
});

// ---------------------------------------------------------------- TOLERANCE

const symKw = GDT_SYMBOLS.map((g) => kw(g.ch, g.cs, g.en, g.de));

registerCommand({
  id: "TOLERANCE",
  names: { cs: ["tolerance"], en: ["tolerance"], de: ["toleranz"] },
  alias: ["TOL"],
  group: "annotate",
  desc: () => tr("rámeček geometrické tolerance (ISO 1101): charakteristika (poloha, kolmost, rovnoběžnost, rovinnost, kruhovitost, válcovitost, přímost, sklon, souměrnost, soustřednost, házení, celkové-házení, tvar-čáry, tvar-plochy), hodnota (ø0.05M), základny (A,B,C nebo -), bod; Řetězec = zápis DXF"),
  usage: () => tr("tolerance poloha ø0.05M A,B,C 120,40 | tolerance rovinnost 0.01 - 10,10 | tolerance řetězec \"{\\Fgdt;j}%%v0.1%%vA\" 10,10"),
  run: function* (c): CmdGen {
    const sz = noteSizes(kctx(c));
    let h = sz.txt;
    let s: string | null = null;
    const k = yield { k: "kw", msg: tr("Zadejte charakteristiku"), kw: [...symKw, KO.string, KO.height] };
    if (k.k !== "kw") return;
    let sym = k.id;
    if (sym === "height") {
      const i = yield { k: "dist", msg: tr("Zadejte výšku textu"), def: h, min: 1e-9 };
      if (i.k === "num") h = i.v;
      const k2 = yield { k: "kw", msg: tr("Zadejte charakteristiku"), kw: [...symKw, KO.string] };
      if (k2.k !== "kw") return;
      sym = k2.id;
    }
    if (sym === "string") {
      const i = yield { k: "text", msg: tr("Zadejte řetězec tolerance (DXF)") };
      if (i.k !== "text" || !i.s) return;
      s = i.s;
    } else {
      const v = yield { k: "text", msg: tr("Zadejte hodnotu tolerance (ø0.05, M = max. materiál)"), def: "0.05" };
      if (v.k !== "text") return;
      const d = yield { k: "text", msg: tr("Zadejte základny (A,B,C nebo - bez základen)"), def: "-" };
      if (d.k !== "text") return;
      const datums = d.s.trim() === "-" || !d.s.trim() ? [] : d.s.split(/[,;|\s]+/).filter(Boolean);
      s = buildTolerance(sym, v.s, datums);
    }
    const pv = (q: Vec2): NewEntity[] => [{ type: "tolerance", p: q, s: s!, h, ...(sz.anno ? { annotative: true } : {}) } as NewEntity];
    const p = yield { k: "point", msg: tr("Zadejte polohu tolerance"), preview: pv };
    if (p.k !== "point") return;
    const id = c.tx.add({ type: "tolerance", p: p.p, s, h, ...(sz.anno ? { annotative: true } : {}) } as DTolerance);
    c.out("tolerance", { string: s, plain: tolerancePlain(s) });
    logCreated(c, [id]);
  },
});

// ---------------------------------------------------------------- HATCH

/** stav nové šrafy (vzor, měřítko, úhel, styl ostrovů…) – výchozí z proměnných HPNAME / HPSCALE / HPANG */
type HState = { pattern: string; scale: number; angle: number; solid: boolean; gradient?: DHatch["gradient"]; island: 0 | 1 | 2; assoc: boolean; origin?: Vec2; double: boolean };

function* hatchOption(c: CmdCtx, id: string, h: HState): Gen<boolean> {
  switch (id) {
    case "pattern": {
      const i = yield { k: "text", msg: tr("Zadejte název vzoru ({0} … , SOLID, USER)", patternLibrary().slice(0, 6).map((p) => p.name).join(", ")), def: h.pattern };
      if (i.k !== "text") return true;
      const n = i.s.trim().toUpperCase();
      if (isSolidName(n)) {
        h.solid = true;
        h.pattern = "SOLID";
        h.gradient = undefined;
      } else if (isUserName(n)) {
        h.pattern = "_USER";
        h.solid = false;
      } else if (findPattern(n)) {
        h.pattern = n;
        h.solid = false;
        h.gradient = undefined;
      } else throw new Error(tr("vzor šrafy „{0}“ neznám – vzory: {1}", i.s, patternLibrary().map((p) => p.name).join(", ")));
      return true;
    }
    case "scale": {
      const i = yield { k: "dist", msg: isUserName(h.pattern) ? tr("Zadejte rozteč čar") : tr("Zadejte měřítko vzoru"), def: h.scale, min: 1e-9 };
      if (i.k === "num") h.scale = i.v;
      return true;
    }
    case "angle": {
      const i = yield { k: "angle", msg: tr("Zadejte úhel vzoru"), def: h.angle };
      if (i.k === "num") h.angle = normDeg(i.v);
      return true;
    }
    case "solid":
      h.solid = true;
      h.pattern = "SOLID";
      h.gradient = undefined;
      return true;
    case "user":
      h.pattern = "_USER";
      h.solid = false;
      return true;
    case "double":
      h.double = !h.double;
      return true;
    case "gradient": {
      const i = yield { k: "kw", msg: tr("Zadejte druh přechodu"), kw: [KO.linear, KO.cylinder, KO.invcylinder], def: "linear" };
      const name = i.k === "kw" ? i.id.toUpperCase() : "LINEAR";
      const a = yield { k: "text", msg: tr("Zadejte barvu 1 (ACI nebo #rrggbb)"), def: "5" };
      const b = yield { k: "text", msg: tr("Zadejte barvu 2 (Enter = světlejší odstín barvy 1)"), none: true };
      const col = (t: string) => (t.trim().startsWith("#") ? t.trim() : Number(t));
      const c1 = a.k === "text" ? col(a.s) : 5;
      if (typeof c1 === "number" && !(c1 >= 1 && c1 <= 255)) throw new Error(tr("barva přechodu: číslo ACI nebo #rrggbb"));
      h.gradient = { name, color1: c1, ...(b.k === "text" && b.s.trim() ? { color2: col(b.s) } : {}), ...(h.angle ? { angle: h.angle } : {}) };
      h.solid = false;
      return true;
    }
    case "island": {
      const i = yield { k: "kw", msg: tr("Zadejte styl ostrovů"), kw: [KO.normal, KO.outer, KO.ignore], def: ["normal", "outer", "ignore"][h.island] };
      if (i.k === "kw") h.island = parseIsland(i.id);
      return true;
    }
    case "associative": {
      const i = yield { k: "kw", msg: tr("Asociativní šrafa?"), kw: [KO.yes, KO.no], def: h.assoc ? "yes" : "no" };
      if (i.k === "kw") h.assoc = i.id === "yes";
      return true;
    }
    case "origin": {
      const i = yield { k: "point", msg: tr("Zadejte počátek vzoru") };
      if (i.k === "point") h.origin = i.p;
      return true;
    }
  }
  return false;
}
const hatchEntity = (h: HState, loops: Loop[], ids: string[]): Omit<DHatch, "id" | "layer"> => ({
  type: "hatch",
  pattern: h.solid ? "SOLID" : h.pattern,
  ...(h.solid ? { solid: true } : {}),
  scale: h.scale,
  angle: h.angle,
  loops,
  ...(h.island ? { islandStyle: h.island } : {}),
  ...(h.assoc && ids.length ? { boundary: ids } : {}),
  ...(h.origin ? { origin: h.origin } : {}),
  ...(h.double ? { double: true } : {}),
  ...(h.gradient ? { gradient: h.gradient } : {}),
});

registerCommand({
  id: "HATCH",
  names: { cs: ["šrafa", "šrafovat"], en: ["hatch", "bhatch"], de: ["schraff", "schraffur"] },
  alias: ["H", "BH"],
  group: "annotate",
  desc: () => tr("šrafa: vnitřní bod (najde uzavřenou oblast i z více entit, ostrovy uvnitř) nebo Objekty; volby Vzor (ANSI31, ANSI37, … SOLID, USER), Měřítko, Úhel, Plná, Uživatelský (rozteč), Dvojitá, Přechod, Ostrovy (normální, vnější, ignorovat), Asociativní, Počátek, Zpět; Enter dokončí"),
  usage: () => tr("šrafa 50,25 | šrafa vzor ANSI37 měřítko 2 úhel 0 50,25 | šrafa plná objekty e1 e2 | šrafa uživatelský měřítko 3 úhel 45 dvojitá 50,25"),
  run: function* (c): CmdGen {
    const v = c.tx.vars;
    const name0 = (v.hpname ?? "ANSI31").toUpperCase();
    const h: HState = { pattern: isSolidName(name0) ? "SOLID" : name0, scale: v.hpscale ?? 1, angle: v.hpang ?? 0, solid: isSolidName(name0), island: v.hpisland ?? 0, assoc: v.hpassoc ?? true, double: false };
    const loops: Loop[] = [];
    const ids: string[] = [];
    const picks: number[] = [];
    const kws = [KO.pattern, KO.scale, KO.angle, KO.solid, KO.user, KO.double, KO.gradient, KO.objects, KO.island, KO.assoc, KO.origin, KO.undo];
    for (;;) {
      const i = yield { k: "point", msg: loops.length ? tr("Zadejte další vnitřní bod nebo <dokončit>") : tr("Zadejte vnitřní bod"), kw: kws, none: true, preview: loops.length ? () => [hatchEntity(h, loops, ids) as NewEntity] : undefined };
      if (i.k === "none") break;
      if (i.k === "point") {
        const r = boundaryAt(c.tx.model, list(c), i.p, h.island !== 2);
        if (!r) {
          if (!c.interactive) throw new Error(noBoundary());
          c.log(`✗ ${noBoundary()}`);
          continue;
        }
        picks.push(r.loops.length);
        loops.push(...r.loops);
        ids.push(...r.ids.filter((x) => !ids.includes(x)));
        c.log(tr("hranice: {0} smyček, plocha {1}", r.loops.length, c.fmt.len(hatchArea({ ...hatchEntity(h, r.loops, []), id: "", layer: "0" } as DHatch))));
        continue;
      }
      if (i.k !== "kw") return;
      if (i.id === "objects") {
        const s = yield { k: "select", msg: tr("Vyberte uzavřené objekty hranice"), filter: (e) => ["circle", "polyline", "ellipse", "spline"].includes(e.type) };
        if (s.k !== "sel") continue;
        const ents = s.ids.map((id) => c.tx.get(id)).filter((e): e is DraftEntity => !!e);
        const r = objectLoops(ents, kctx(c));
        if (r.skipped.length) c.log(tr("⚠ neuzavřené objekty vynechány: {0}", r.skipped.join(", ")));
        if (!r.loops.length) {
          if (!c.interactive) throw new Error(tr("žádný z vybraných objektů není uzavřený"));
          continue;
        }
        picks.push(r.loops.length);
        loops.push(...r.loops);
        ids.push(...ents.map((e) => e.id).filter((x) => !r.skipped.includes(x) && !ids.includes(x)));
        continue;
      }
      if (i.id === "undo") {
        const n = picks.pop();
        if (n) loops.splice(loops.length - n, n);
        continue;
      }
      yield* hatchOption(c, i.id, h);
    }
    if (!loops.length) return;
    if (!loops.some((l) => l.outer)) loops[0].outer = true;
    const id = c.tx.add(hatchEntity(h, loops, ids) as NewEntity);
    c.tx.setVars({ hpname: h.solid ? "SOLID" : h.pattern, hpscale: h.scale, hpang: h.angle, hpisland: h.island, hpassoc: h.assoc });
    const area = hatchArea(c.tx.get(id) as DHatch);
    c.out("area", area);
    c.log(tr("✓ Šrafa {0}: {1}, {2} smyček, plocha {3}", id, h.gradient ? tr("přechod") : h.solid ? "SOLID" : h.pattern, loops.length, c.fmt.len(area)));
  },
});

registerCommand({
  id: "HATCHEDIT",
  names: { cs: ["upravit-šrafu"], en: ["hatchedit"], de: ["schraffedit"] },
  alias: ["HE"],
  group: "annotate",
  desc: () => tr("upraví šrafu: Vzor, Měřítko, Úhel, Plná, Uživatelský, Dvojitá, Přechod, Ostrovy, Počátek; Hranice = obnovit smyčky z asociativních objektů; Načíst = vzory ze souboru .pat (text v uvozovkách)"),
  usage: () => tr("upravit-šrafu e7 vzor ANSI37 měřítko 2 úhel 30 | upravit-šrafu e7 ostrovy vnější | upravit-šrafu e7 hranice"),
  run: function* (c): CmdGen {
    const i = yield { k: "entity", msg: tr("Vyberte šrafu"), filter: (e) => e.type === "hatch", kw: [KO.load] };
    if (i.k === "kw" && i.id === "load") {
      const t = yield { k: "text", msg: tr("Vložte obsah souboru .pat") };
      if (t.k === "text") c.log(tr("✓ načtené vzory: {0}", registerPatterns(t.s).join(", ")));
      return;
    }
    if (i.k !== "ent") return;
    const e0 = c.tx.get(i.id) as DHatch;
    let e = e0;
    const h: HState = { pattern: e.pattern, scale: e.scale, angle: e.angle, solid: !!e.solid, gradient: e.gradient, island: e.islandStyle ?? 0, assoc: !!e.boundary, origin: e.origin, double: !!e.double };
    const kws = [KO.pattern, KO.scale, KO.angle, KO.solid, KO.user, KO.double, KO.gradient, KO.island, KO.origin, KO.boundary];
    for (;;) {
      const k = yield { k: "kw", msg: tr("Zadejte volbu"), kw: kws, none: true };
      if (k.k !== "kw") break;
      if (k.id === "boundary") {
        const ents = (e.boundary ?? []).map((id) => c.tx.get(id)).filter((x): x is DraftEntity => !!x);
        const r = objectLoops(ents, kctx(c));
        if (!ents.length || r.skipped.length || !r.loops.length) throw new Error(tr("hranici lze obnovit jen z uzavřených asociativních objektů ({0})", (e.boundary ?? []).join(", ") || tr("žádné")));
        e = { ...e, loops: r.loops };
        continue;
      }
      yield* hatchOption(c, k.id, h);
      e = { ...e, ...hatchEntity(h, e.loops, e.boundary ?? []) } as DHatch;
      if (!h.solid && e.solid) e = setHatchField(e, "solid", "0");
      if (!h.gradient && e.gradient) e = setHatchField(e, "gradient", "-");
      if (!h.island) delete (e as Partial<DHatch>).islandStyle;
    }
    if (e !== e0) {
      c.tx.put(e);
      c.log(tr("✓ šrafa {0} upravena: {1}, měřítko {2}, úhel {3}°", e.id, e.gradient ? tr("přechod") : e.solid ? "SOLID" : e.pattern, e.scale, e.angle));
    }
  },
});

// ---------------------------------------------------------------- REVCLOUD

/**
 * Obláček z mnohoúhelníku: oblouky délky ~ L vypouklé ven z oblasti (jako REVCLOUD v AutoCADu – hroty mezi oblouky
 * míří dovnitř); `reverse` = obrácený směr (oblouky dovnitř). Mnohoúhelník se převede proti směru hodin, kladné
 * vydutí = oblouk proti směru hodin = vpravo od směru obcházení = ven.
 */
export function cloudFromPolygon(poly: Vec2[], L: number, reverse = false): { pts: Vec2[]; bulges: number[] } {
  let P = poly;
  if (polyArea(P) < 0) P = [...P].reverse();
  const pts: Vec2[] = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i];
    const b = P[(i + 1) % P.length];
    const d = dist(a, b);
    if (d < 1e-12) continue;
    const n = Math.max(1, Math.round(d / L));
    for (let k = 0; k < n; k++) pts.push(add(a, mul(sub(b, a), k / n)));
  }
  return { pts, bulges: pts.map(() => (reverse ? -0.55 : 0.55)) };
}
/** obrys entity jako mnohoúhelník (kružnice, křivka, elipsa, spline) */
function entityPolygon(e: DraftEntity, ctx: KindCtx): Vec2[] | null {
  const cs: Curve[] = entityCurves(e, ctx);
  if (!cs.length) return null;
  const out: Vec2[] = [];
  for (const c of cs) {
    const L = cLength(c);
    const [t0, t1] = cRange(c);
    const n = c.k === "line" ? 1 : Math.max(8, Math.ceil(L / 2));
    for (let i = 0; i < n; i++) out.push(cPoint(c, t0 + ((t1 - t0) * i) / n));
  }
  return out.length >= 3 ? out : null;
}

registerCommand({
  id: "REVCLOUD",
  names: { cs: ["revizní-obláček", "obláček"], en: ["revcloud"], de: ["revwolke"] },
  group: "annotate",
  desc: () => tr("revizní obláček (křivka z oblouků vypouklých ven): Obdélník (dva rohy, výchozí), Mnohoúhelník (body, Enter), Objekt (převede kružnici / uzavřenou křivku); Délka = délka oblouku; Obrátit = oblouky dovnitř"),
  usage: () => tr("revizní-obláček 0,0 100,50 | revizní-obláček délka 8 mnohoúhelník 0,0 50,0 25,40 \"\" | revizní-obláček objekt e3 | revizní-obláček obrátit 0,0 100,50"),
  run: function* (c): CmdGen {
    let L = 0;
    let mode: "rect" | "poly" | "object" = "rect";
    let reverse = false;
    let p1: Vec2 | null = null;
    while (!p1) {
      const i = yield { k: "point", msg: mode === "poly" ? tr("Zadejte první bod obláčku") : tr("Zadejte první roh obláčku"), kw: [KO.arclen, KO.object, KO.rect, KO.poly, KO.reverse] };
      if (i.k === "point") p1 = i.p;
      else if (i.k === "kw") {
        if (i.id === "reverse") {
          reverse = !reverse;
          c.log(reverse ? tr("oblouky obláčku dovnitř") : tr("oblouky obláčku ven"));
        } else if (i.id === "arclength") {
          const d = yield { k: "dist", msg: tr("Zadejte délku oblouku"), def: L || 10, min: 1e-6 };
          if (d.k === "num") L = d.v;
        } else if (i.id === "rectangular") mode = "rect";
        else if (i.id === "polygonal") mode = "poly";
        else if (i.id === "object") {
          mode = "object";
          break;
        }
      } else return;
    }
    let poly: Vec2[];
    let replace: DraftEntity | null = null;
    if (mode === "object") {
      const e = yield { k: "entity", msg: tr("Vyberte objekt"), filter: (x) => ["circle", "polyline", "ellipse", "spline"].includes(x.type) };
      if (e.k !== "ent") return;
      replace = c.tx.get(e.id)!;
      const pp = entityPolygon(replace, kctx(c));
      if (!pp) throw new Error(tr("objekt nejde převést na obláček"));
      poly = pp;
    } else if (mode === "rect") {
      const q = yield { k: "point", msg: tr("Zadejte protější roh"), base: p1!, preview: (x) => [{ type: "polyline", pts: [p1!, [x[0], p1![1]], x, [p1![0], x[1]]], closed: true }] };
      if (q.k !== "point") return;
      poly = [p1!, [q.p[0], p1![1]], q.p, [p1![0], q.p[1]]];
    } else {
      poly = [p1!];
      for (;;) {
        const q = yield { k: "point", msg: tr("Zadejte další bod nebo <uzavřít>"), base: poly[poly.length - 1], none: true, preview: (x) => [{ type: "polyline", pts: [...poly, x], closed: true }] };
        if (q.k !== "point") break;
        poly.push(q.p);
      }
      if (poly.length < 3) throw new Error(tr("obláček potřebuje aspoň 3 body"));
    }
    const per = poly.reduce((s, p, i) => s + dist(p, poly[(i + 1) % poly.length]), 0);
    const cl = cloudFromPolygon(poly, L || Math.max(per / 24, 1e-6), reverse);
    const base = replace ? { layer: replace.layer, ...(replace.color !== undefined ? { color: replace.color } : {}), ...(replace.lineweight !== undefined ? { lineweight: replace.lineweight } : {}) } : {};
    if (replace) c.tx.remove(replace.id);
    const id = c.tx.add({ type: "polyline", pts: cl.pts, bulges: cl.bulges, closed: true, ...base } as NewEntity);
    logCreated(c, [id]);
  },
});

// ---------------------------------------------------------------- SURFSYM

registerCommand({
  id: "SURFSYM",
  names: { cs: ["drsnost", "značka-drsnosti"], en: ["surfsym", "surfacefinish"], de: ["rauheit", "oberflächenzeichen"] },
  group: "annotate",
  desc: () => tr("značka struktury povrchu (ISO 1302 / 21920): bod na povrchu, směr povrchu, požadavek (Ra 1,6); volby Druh (základní, s-úběrem, bez-úběru), Postup (např. broušeno), Stopy (=, ⊥, X, M, C, R, P), Dokola, Výška"),
  usage: () => tr("drsnost 50,0 0 \"Ra 1,6\" | drsnost druh s-úběrem postup \"broušeno\" 50,0 90 \"Ra 0,8\""),
  run: function* (c): CmdGen {
    const sz = noteSizes(kctx(c));
    const s: Partial<DSurfSym> = { kind: "removal", h: sz.txt, ...(sz.anno ? { annotative: true } : {}) };
    let p: Vec2 | null = null;
    while (!p) {
      const i = yield { k: "point", msg: tr("Zadejte bod na povrchu"), kw: [KO.kind, KO.process, KO.lay, KO.around, KO.height], preview: (q) => [{ type: "surfsym", p: q, ...s } as NewEntity] };
      if (i.k === "point") p = i.p;
      else if (i.k === "kw") {
        if (i.id === "kind") {
          const k = yield { k: "kw", msg: tr("Zadejte druh značky"), kw: [KO.basic, KO.removal, KO.noremoval], def: s.kind };
          if (k.k === "kw") s.kind = parseSurfKind(k.id);
        } else if (i.id === "process") {
          const t = yield { k: "text", msg: tr("Zadejte výrobní postup") };
          if (t.k === "text") s.process = t.s;
        } else if (i.id === "lay") {
          const t = yield { k: "text", msg: tr("Zadejte směr stop (=, ⊥, X, M, C, R, P)") };
          if (t.k === "text") s.lay = t.s;
        } else if (i.id === "around") s.allAround = !s.allAround;
        else if (i.id === "height") {
          const d = yield { k: "dist", msg: tr("Zadejte výšku písma"), def: s.h, min: 1e-9 };
          if (d.k === "num") s.h = d.v;
        }
      } else return;
    }
    const a = yield { k: "angle", msg: tr("Zadejte směr povrchu"), base: p, def: 0, preview: (q) => [{ type: "surfsym", p: p!, ...s, rot: normDeg((angleOf(unit(sub(q, p!))) * 180) / Math.PI) } as NewEntity] };
    if (a.k !== "num") return;
    const t = yield { k: "text", msg: tr("Zadejte požadavek (např. Ra 1,6; Enter = bez)"), none: true };
    const id = c.tx.add({ type: "surfsym", ...s, p, ...(a.v ? { rot: normDeg(a.v) } : {}), ...(t.k === "text" && t.s ? { text: t.s } : {}) } as NewEntity);
    logCreated(c, [id]);
  },
});
