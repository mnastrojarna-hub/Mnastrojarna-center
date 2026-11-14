/**
 * Lomená čára zadaná textem (`čára …`, EN `polyline`, DE `polylinie`) – kdy je uzavřená. Platí stejně pro obyčejnou čáru
 * i pro čáru se zaoblenými rohy (`čára 0 0 50 0 r 5 50 30 …`), která se rozloží na úsečky a oblouky:
 *
 * 1. `uzavřít` (EN `close`, DE `schließen`) a `otevřená` (EN `open`, DE `offen`) platí vždy.
 * 2. První bod = poslední bod → uzavřená (opakovaný bod se vynechá).
 * 3. Jinak rozhodne celá skica: tvoří-li čára s dalšími entitami uzavřený obrys (její dva konce jsou propojené řetězem
 *    jiných entit – úseček, oblouků, splinů, čar), je OTEVŘENÁ. Jinak se uzavře jako dřív (samostatný obrys) a dostane
 *    značku `autoClose`; protokol to ohlásí. Čára, kterou by uzavírací úsek křížil nebo překrýval (neplatný obrys), zůstane
 *    otevřená. Přidá-li pozdější řádek entity, se kterými obrys vznikne, čára se otevře. U čáry se zaoblenými rohy uzavírá
 *    obrys samostatná úsečka se značkou `autoClose` (při otevření se odebere).
 * 4. Jako DRÁHA (tažení, žebro, pole podél křivky, dělicí čára, plechové žebro) se automatické uzavření nepoužije
 *    (`pathEntities`) – automaticky uzavřená čára je tam otevřená.
 *
 * Čisté funkce bez prohlížeče a jádra (testy v poly-close.test.ts). Skicář v GUI nic z toho nepoužívá – kreslí vždy výslovně;
 * odškrtne-li autor v GUI „Uzavřená“, značka se zahodí a čára zůstane otevřená.
 */
import { getLang, tr } from "./i18n";
import { clusterPoints } from "./point-cluster";
import { prims, type Prim } from "./sketch";
import { intersect } from "./sketch-ops";
import type { SketchConstraint, SketchDim, SketchEntity, Vec2 } from "./types";

/** konce bližší než tato vzdálenost (mm) se pro rozhodnutí otevřená / uzavřená berou jako napojené (malou mezeru pak ohlásí kontrola profilu) */
export const JOIN_TOL = 0.05;

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");
const OPEN_WORDS = new Set(["otevrena", "otevreny", "otevrene", "open", "opened", "offen", "offene", "offener", "offenes"]);
const CLOSED_WORDS = new Set(["uzavrit", "uzavrena", "uzavreny", "uzavrene", "uzavrenou", "close", "closed", "schliessen", "geschlossen", "geschlossene", "geschlossener", "geschlossenes"]);

export type CloseWord = "open" | "closed";
/** slovo `uzavřít` / `otevřená` (i anglicky a německy) → volba, jinak null */
export function closeWordOf(token: string): CloseWord | null {
  const f = fold(token);
  return OPEN_WORDS.has(f) ? "open" : CLOSED_WORDS.has(f) ? "closed" : null;
}
/** Vyjme z tokenů lomené čáry slova `uzavřít` / `otevřená` (smí stát kdekoli). Obě najednou = chyba. */
export function takeCloseWords(tokens: string[]): { rest: string[]; close: CloseWord | null } {
  let close: CloseWord | null = null;
  const rest: string[] = [];
  for (const t of tokens) {
    const w = closeWordOf(t);
    if (!w) rest.push(t);
    else if (close && close !== w) throw new Error(tr("čára nemůže být zároveň „uzavřít“ a „otevřená“ – nechte jen jedno slovo"));
    else close = w;
  }
  return { rest, close };
}

const same = (p: Vec2, q: Vec2, tol = 1e-9) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol;
const dist = (p: Vec2, q: Vec2) => {
  const dx = p[0] - q[0];
  const dy = p[1] - q[1];
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Body a stav lomené čáry z textu podle pravidel 1–2; bez výslovného slova a se 3+ různými body je čára prozatím uzavřená se
 * značkou `autoClose` (o konečném stavu rozhodne `resolveAutoClose` nad celou skicou).
 */
export function polylineClose(points: Vec2[], close: CloseWord | null): { points: Vec2[]; closed: boolean; autoClose?: true } {
  let pts = points;
  const loop = pts.length >= 4 && same(pts[0], pts[pts.length - 1]);
  if (loop && close !== "open") pts = pts.slice(0, -1); // první = poslední bod: uzavřená, opakovaný bod se vynechá
  if (close === "closed" || loop) return { points: pts, closed: close !== "open" };
  if (close === "open" || pts.length < 3) return { points: pts, closed: false };
  return { points: pts, closed: true, autoClose: true };
}

/** konce entity, na které může navazovat lomená čára (null = entita bez volných konců: kružnice, obdélník, uzavřená čára…) */
export function freeEnds(e: SketchEntity): [Vec2, Vec2] | null {
  switch (e.type) {
    case "line":
      return [e.a, e.b];
    case "arc":
      return [e.a, e.c];
    case "spline":
      return e.closed || e.points.length < 2 ? null : [e.points[0], e.points[e.points.length - 1]];
    case "polyline":
      // automaticky uzavřená čára má dál své původní konce (na ně smí navázat další řádek)
      return e.points.length < 2 || (e.closed && !e.autoClose) ? null : [e.points[0], e.points[e.points.length - 1]];
    default:
      return null;
  }
}

const fmt = (v: number) => {
  const s = String(Math.round(v * 1000) / 1000).replace(/^-0$/, "0");
  return getLang() === "en" ? s : s.replace(".", ",");
};
const pt = (p: Vec2) => `[${fmt(p[0])}; ${fmt(p[1])}]`;

export type AutoCloseResult = {
  entities: SketchEntity[];
  /** řádky protokolu (začínají „ℹ“) */
  notes: string[];
  /** id odebraných uzavíracích úseček */
  removed: string[];
  /** id čar, které se tímto voláním otevřely (byly uzavřené jen automaticky) */
  reopened: string[];
};

/** bez značky `autoClose` */
function unmarked<T extends SketchEntity>(e: T): T {
  const { autoClose: _, ...rest } = e;
  return rest as T;
}

/**
 * Entity skici pro použití jako DRÁHA (tažení, vodicí křivka, žebro, pole podél křivky, dělicí čára, plechové žebro):
 * automatické uzavření se nepoužije – automaticky uzavřená čára je otevřená, uzavírací úsečka čáry se zaoblenými rohy
 * se vynechá. Bez automaticky uzavřených entit vrátí totéž pole.
 */
export function pathEntities(entities: SketchEntity[]): SketchEntity[] {
  if (!entities.some((e) => e.autoClose)) return entities;
  const out: SketchEntity[] = [];
  for (const e of entities) {
    if (!e.autoClose) out.push(e);
    else if (e.type === "polyline") out.push({ ...e, closed: false });
    else if (e.type !== "line") out.push(e);
  }
  return out;
}

const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
/**
 * Společný bod úseček p1–p2 a q1–q2 (křížení, dotyk nebo kolineární překryv delší než JOIN_TOL), jinak null.
 * `shared` = úsečky sdílejí konec p1 = q1 (sousední úseky) – pak se hledá jen překryv (couvnutí zpět po téže přímce).
 */
function segHit(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2, shared: boolean): Vec2 | null {
  const r = sub2(p2, p1);
  const s = sub2(q2, q1);
  const L = Math.hypot(r[0], r[1]);
  if (L < 1e-12) return null;
  const den = cross2(r, s);
  const off = (x: Vec2) => Math.abs(cross2(r, sub2(x, p1))) / L;
  if (off(q1) <= 1e-9 * Math.max(1, L) && off(q2) <= 1e-9 * Math.max(1, L)) {
    // kolineární: překryv průmětů
    const t = (x: Vec2) => ((x[0] - p1[0]) * r[0] + (x[1] - p1[1]) * r[1]) / (L * L);
    const lo = Math.max(0, Math.min(t(q1), t(q2)));
    const hi = Math.min(1, Math.max(t(q1), t(q2)));
    if ((hi - lo) * L <= JOIN_TOL) return null;
    return [p1[0] + r[0] * hi, p1[1] + r[1] * hi];
  }
  if (shared || Math.abs(den) < 1e-15) return null;
  const qp = sub2(q1, p1);
  const t = cross2(qp, s) / den;
  const u = cross2(qp, r) / den;
  const e = 1e-9;
  return t >= -e && t <= 1 + e && u >= -e && u <= 1 + e ? [p1[0] + r[0] * t, p1[1] + r[1] * t] : null;
}
/** kde by uzavírací úsek lomené čáry (poslední → první bod) křížil nebo překrýval čáru samu (null = uzavřená by byla platná) */
export function closingCross(points: Vec2[]): Vec2 | null {
  const n = points.length;
  if (n < 3) return null;
  const a = points[n - 1];
  const b = points[0];
  // první úsek sdílí bod b, poslední bod a – u nich jen překryv; ostatní nesmějí uzavírací úsek ani křížit, ani se ho dotknout
  for (let i = 0; i < n - 1; i++) {
    const hit = i === 0 ? segHit(b, a, points[0], points[1], true) : i === n - 2 ? segHit(a, b, points[n - 1], points[n - 2], true) : segHit(a, b, points[i], points[i + 1], false);
    if (hit) return hit;
  }
  return null;
}

/** mosty grafu (hrany, po jejichž odebrání se jejich konce rozpojí) – iterativní Tarjan; násobné hrany mosty nejsou */
function bridges(nodes: number, edges: { u: number; v: number }[]): Set<number> {
  const adj: [number, number][][] = Array.from({ length: nodes }, () => []);
  edges.forEach((e, i) => {
    if (e.u === e.v) return;
    adj[e.u].push([e.v, i]);
    adj[e.v].push([e.u, i]);
  });
  const tin = new Array<number>(nodes).fill(-1);
  const low = new Array<number>(nodes).fill(0);
  const out = new Set<number>();
  let time = 0;
  for (let s = 0; s < nodes; s++) {
    if (tin[s] >= 0) continue;
    tin[s] = low[s] = time++;
    const stack: { v: number; pe: number; k: number }[] = [{ v: s, pe: -1, k: 0 }];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.k < adj[top.v].length) {
        const [w, ei] = adj[top.v][top.k++];
        if (ei === top.pe) continue;
        if (tin[w] >= 0) low[top.v] = Math.min(low[top.v], tin[w]);
        else {
          tin[w] = low[w] = time++;
          stack.push({ v: w, pe: ei, k: 0 });
        }
      } else {
        stack.pop();
        const up = stack[stack.length - 1];
        if (up) {
          low[up.v] = Math.min(low[up.v], low[top.v]);
          if (low[top.v] > tin[up.v]) out.add(top.pe);
        }
      }
    }
  }
  return out;
}

/**
 * Graf napojení konců (pomocné entity zvlášť): uzly = shluky konců, hrany = entity s volnými konci (automaticky uzavřená
 * čára hranou mezi svými původními konci; uzavírací úsečky zaoblených čar se nepočítají). Hrana, která není mostem, leží
 * v uzavřeném řetězu – tvoří obrys s dalšími entitami.
 */
function joinGraph(ents: SketchEntity[], construction: boolean) {
  const items: { id: string; ends: [Vec2, Vec2] }[] = [];
  for (const e of ents) {
    if (!!e.construction !== construction || (e.autoClose && e.type === "line")) continue;
    const en = freeEnds(e);
    if (en) items.push({ id: e.id, ends: en });
  }
  const pts = items.flatMap((x) => x.ends);
  const node = clusterPoints(pts, JOIN_TOL); // shluky konců do JOIN_TOL (point-cluster.ts)
  let count = 0;
  for (const k of node) if (k + 1 > count) count = k + 1;
  const edges = items.map((x, i) => ({ id: x.id, u: node[2 * i], v: node[2 * i + 1] }));
  const br = bridges(count, edges);
  // 2-hranově souvislé části: sjednocení přes hrany, které nejsou mosty
  const parent = Array.from({ length: count }, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  edges.forEach((e, i) => {
    if (!br.has(i)) parent[root(e.u)] = root(e.v);
  });
  const edgeOf = new Map(edges.map((e, i) => [e.id, i]));
  /** uzel u bodu p (null = žádný konec) */
  const nodeAt = (p: Vec2): number | null => {
    let best = -1;
    let bd = Infinity;
    pts.forEach((q, i) => {
      const d = dist(p, q);
      if (d <= JOIN_TOL && d < bd) {
        bd = d;
        best = i;
      }
    });
    return best < 0 ? null : node[best];
  };
  return {
    /** entita `id` leží v uzavřeném řetězu (její konce spojuje i jiná cesta) */
    inCycle: (id: string) => {
      const i = edgeOf.get(id);
      return i !== undefined && edges[i].u !== edges[i].v && !br.has(i);
    },
    /** body p a q leží ve stejné 2-hranově souvislé části (spojují je dvě cesty bez společné hrany) */
    twoConnected: (p: Vec2, q: Vec2) => {
      const a = nodeAt(p);
      const b = nodeAt(q);
      return a !== null && b !== null && a !== b && root(a) === root(b);
    },
    /** id entit (kromě `skip`) s koncem u bodu p */
    touching: (p: Vec2, skip: string) => items.filter((x) => x.id !== skip && (dist(x.ends[0], p) <= JOIN_TOL || dist(x.ends[1], p) <= JOIN_TOL)).map((x) => x.id),
  };
}

/** konce úsečky / oblouku ve směru zápisu (úsečka a → b, oblouk a → c) */
const dirEnds = (e: SketchEntity): [Vec2, Vec2] | null => (e.type === "line" ? [e.a, e.b] : e.type === "arc" ? [e.a, e.c] : null);
/**
 * Úseky čáry se zaoblenými rohy, kterou uzavírá úsečka `entities[k]`: parser je zapisuje přímo před ni, navazující od
 * prvního bodu (b úsečky) k poslednímu (a úsečky). Null = řetěz už v tomto tvaru ve skice není (smazaná nebo upravená část).
 */
function filletChain(entities: SketchEntity[], k: number): string[] | null {
  const c = entities[k];
  if (c.type !== "line") return null;
  const ids: string[] = [];
  let need = c.a;
  for (let j = k - 1; j >= 0; j--) {
    const e = entities[j];
    const de = dirEnds(e);
    if (!de || e.autoClose || !!e.construction !== !!c.construction || !same(de[1], need, 1e-6)) return null;
    ids.push(e.id);
    if (same(de[0], c.b, 1e-6)) return ids;
    need = de[0];
  }
  return null;
}
/** kde uzavírací úsečka čáry se zaoblenými rohy kříží nebo překrývá úseky své čáry (mimo své konce) */
function closingLineCross(c: Extract<SketchEntity, { type: "line" }>, chain: SketchEntity[]): Vec2 | null {
  const cp: Prim = { kind: "line", a: c.a, b: c.b, id: c.id };
  const at = (p: Vec2) => same(p, c.a, 1e-6) || same(p, c.b, 1e-6);
  for (const e of chain)
    for (const p of prims(e)) {
      if (p.kind === "line") {
        // krajní úsek čáry sdílí s úsečkou konec – u něj jen překryv (couvnutí po téže přímce), jinak i křížení a dotyk
        const s0 = at(p.a) ? p.a : at(p.b) ? p.b : null;
        const hit = s0 ? segHit(s0, same(s0, c.a, 1e-6) ? c.b : c.a, s0, s0 === p.a ? p.b : p.a, true) : segHit(c.a, c.b, p.a, p.b, false);
        if (hit) return hit;
        continue;
      }
      for (const x of intersect(cp, p)) if (dist(x, c.a) > JOIN_TOL && dist(x, c.b) > JOIN_TOL) return x;
    }
  return null;
}

/**
 * Rozhodne o všech čarách se značkou `autoClose` podle celé skici (pravidlo 3). `fresh` = id entit přidaných právě teď –
 * u nich se ohlásí výsledek rozhodnutí, u starších jen změna (automaticky uzavřená čára se otevře, protože s nově přidanými
 * entitami tvoří obrys). Pomocné entity se posuzují jen mezi pomocnými, ostatní jen mezi ostatními.
 */
export function resolveAutoClose(entities: SketchEntity[], fresh: ReadonlySet<string> = new Set()): AutoCloseResult {
  const notes: string[] = [];
  const removed: string[] = [];
  const reopened: string[] = [];
  if (!entities.some((e) => e.autoClose)) return { entities, notes, removed, reopened };
  // čáru, kterou autor otevřel (GUI „Uzavřená“, úprava closed), rozhodl autor – značka se zahodí
  const ents = entities.map((e) => (e.autoClose && e.type === "polyline" && (!e.closed || e.points.length < 3) ? { ...unmarked(e), closed: false } : e));
  const graphs = { plain: joinGraph(ents, false), cons: joinGraph(ents, true) };
  const out: SketchEntity[] = [];
  ents.forEach((e, k) => {
    if (!e.autoClose) {
      out.push(e);
      return;
    }
    const isNew = fresh.has(e.id);
    const g = e.construction ? graphs.cons : graphs.plain;
    if (e.type === "polyline") {
      const a = e.points[0];
      const b = e.points[e.points.length - 1];
      const joined = [...new Set([...g.touching(a, e.id), ...g.touching(b, e.id)])];
      if (g.inCycle(e.id)) {
        out.push({ ...unmarked(e), closed: false });
        if (isNew) notes.push(tr("ℹ čára {0} je otevřená – její konce navazují na {1}", e.id, joined.join(", ")));
        else {
          reopened.push(e.id);
          const by = joined.filter((id) => fresh.has(id));
          notes.push(tr("ℹ čára {0} otevřena – na její konce nově navazuje {1} (uzavřená byla jen automaticky)", e.id, (by.length ? by : joined).join(", ")));
        }
        return;
      }
      const x = closingCross(e.points);
      if (x) {
        out.push({ ...unmarked(e), closed: false });
        if (!isNew) reopened.push(e.id);
        notes.push(tr("ℹ čára {0} je otevřená – uzavírací úsek by ji křížil nebo překrýval v {1} (neplatný obrys); „uzavřít“ ji uzavře", e.id, pt(x)));
        return;
      }
      out.push(e);
      if (isNew) notes.push(joined.length ? tr("ℹ čára {0} uzavřena – navazuje na {1}, ale uzavřený obrys s nimi netvoří; „otevřená“ ji nechá otevřenou", e.id, joined.join(", ")) : tr("ℹ čára {0} uzavřena – konce nebyly napojené; „otevřená“ ji nechá otevřenou", e.id));
      return;
    }
    if (e.type === "line") {
      // uzavírací úsečka čáry se zaoblenými rohy: odebere se, tvoří-li čára obrys s dalšími entitami (konce b → a spojuje
      // i jiná cesta než čára sama) nebo by čáru křížila
      const chain = filletChain(ents, k);
      const own = new Set(chain ?? []);
      const others = (p: Vec2) => g.touching(p, e.id).filter((id) => !own.has(id) && id !== e.id);
      const ta = others(e.a);
      const tb = others(e.b);
      if (g.twoConnected(e.a, e.b)) {
        removed.push(e.id);
        const freshA = ta.filter((id) => fresh.has(id));
        const freshB = tb.filter((id) => fresh.has(id));
        const [at, by] = !isNew && (freshA.length || freshB.length) ? (freshA.length ? [e.a, freshA] : [e.b, freshB]) : ta.length || !tb.length ? [e.a, ta] : [e.b, tb];
        notes.push(isNew ? tr("ℹ čára se zaoblenými rohy je otevřená – její konec {0} navazuje na další entitu", pt(at)) : tr("ℹ uzavírací úsečka {0} čáry se zaoblenými rohy odebrána – na konec {1} nově navazuje {2}", e.id, pt(at), by.join(", ")));
        return;
      }
      const x = chain ? closingLineCross(e, ents.filter((q) => own.has(q.id))) : null;
      if (x) {
        removed.push(e.id);
        notes.push(tr("ℹ čára se zaoblenými rohy je otevřená – uzavírací úsečka by ji křížila nebo překrývala v {0} (neplatný obrys); „uzavřít“ ji uzavře", pt(x)));
        return;
      }
      out.push(e);
      const joined = [...new Set([...ta, ...tb])];
      if (isNew) notes.push(joined.length ? tr("ℹ čára se zaoblenými rohy uzavřena úsečkou {0} – navazuje na {1}, ale uzavřený obrys s nimi netvoří; „otevřená“ ji nechá otevřenou", e.id, joined.join(", ")) : tr("ℹ čára se zaoblenými rohy uzavřena úsečkou {0} – konce nebyly napojené; „otevřená“ ji nechá otevřenou", e.id));
      return;
    }
    out.push(e);
  });
  return { entities: out, notes, removed, reopened };
}

/**
 * Vazby a kóty, které po otevření čáry nebo odebrání uzavírací úsečky odkazují na neexistující geometrii (odebraná úsečka,
 * uzavírací úsek `g{n-1}` otevřené čáry), se odeberou – vrátí zbylé a počet odebraných.
 */
export function dropStaleRefs<T extends SketchConstraint | SketchDim>(items: T[] | undefined, entities: SketchEntity[], r: Pick<AutoCloseResult, "removed" | "reopened">): { items: T[] | undefined; dropped: number } {
  if (!items?.length || (!r.removed.length && !r.reopened.length)) return { items, dropped: 0 };
  const gone = new Set(r.removed);
  const closing = new Map<string, string>();
  for (const id of r.reopened) {
    const e = entities.find((x) => x.id === id);
    if (e?.type === "polyline") closing.set(id, `g${e.points.length - 1}`);
  }
  const kept = items.filter((c) => !c.refs.some((ref) => gone.has(ref.e) || closing.get(ref.e) === ref.k));
  return { items: kept, dropped: items.length - kept.length };
}

/**
 * Přidá entity zadané textem do skici a rozhodne o uzavření lomených čar podle celé skici. Vrátí nové pole entit, přidané
 * entity (bez odebraných uzavíracích úseček), případně vazby / kóty bez neplatných odkazů a řádky protokolu.
 */
export function addWithAutoClose(sk: { entities: SketchEntity[]; constraints?: SketchConstraint[]; dims?: SketchDim[] }, added: SketchEntity[]): { patch: { entities: SketchEntity[]; constraints?: SketchConstraint[]; dims?: SketchDim[] }; added: SketchEntity[]; notes: string[] } {
  const r = resolveAutoClose([...sk.entities, ...added], new Set(added.map((e) => e.id)));
  const byId = new Map(r.entities.map((e) => [e.id, e]));
  const cons = dropStaleRefs(sk.constraints, r.entities, r);
  const dims = dropStaleRefs(sk.dims, r.entities, r);
  const notes = [...r.notes];
  if (cons.dropped + dims.dropped) notes.push(tr("ℹ odebráno vazeb {0} a kót {1}, které odkazovaly na uzavírací úsek otevřené čáry", cons.dropped, dims.dropped));
  return {
    patch: { entities: r.entities, ...(cons.dropped ? { constraints: cons.items } : {}), ...(dims.dropped ? { dims: dims.items } : {}) },
    added: added.filter((e) => byId.has(e.id)).map((e) => byId.get(e.id)!),
    notes,
  };
}
