/**
 * Kontrola profilu skici – PROČ z entit nevznikl platný uzavřený obrys, slovy, podle kterých může agent (i člověk) skicu opravit:
 * otevřený konec e5 v [x; y], mezera N mm mezi e3 a e4, e2 kříží e7 v [x; y], e3 kříží sama sebe, překrývající se nebo
 * duplicitní entity, větvení (3+ konce v jednom bodě), konec uprostřed jiné entity, automaticky uzavřená čára (poly-close.ts),
 * jejíž uzavírací úsek kříží jiné entity.
 *
 * Čisté funkce bez jádra (testy v profile-check.test.ts). Používá je textový stav (`stav` – agent-sketch.ts) a stavba prvků
 * vysunutí / rotace / tažení (build.ts): při chybě prvku se důvod připíše k chybě, při úspěchu s vadným profilem jako ⚠.
 */
import { getLang, tr } from "./i18n";
import { clusterPoints } from "./point-cluster";
import { findLoops, prims, type Prim } from "./sketch";
import { intersect, nearestOnPrim, primPoint } from "./sketch-ops";
import type { Feature, SketchEntity, Vec2 } from "./types";

type SketchF = Extract<Feature, { type: "sketch" }>;

/** shoda bodů (stejná tolerance, s jakou se entity řetězí do obrysu – sketch.ts findLoops) */
const TOL = 1e-3;
/** nejvíc úseků, u kterých se hledají průsečíky (velké importované skici jen bez průsečíků) */
const MAX_PRIMS = 4000;
/** nejvíc vypsaných problémů */
const MAX_ISSUES = 24;
/** po tolika problémech se počítání zastaví (souhrn „500+“) – mřížka křížících se čar jinak počítá statisíce průsečíků */
export const MAX_COUNT = 500;
/** nejvíc obrysů / id vypsaných v řádku stavu */
const MAX_LIST = 12;

export type ProfileIssue =
  /** `on` = konec leží na entitě uzavřeného obrysu (entita do obrysu nepatří); `reopen` = `on` je výslovně uzavřená čára a konec je v jejím krajním bodě */
  | { kind: "open"; id: string; at: Vec2; on?: string; reopen?: boolean }
  | { kind: "gap"; a: string; b: string; pa: Vec2; pb: Vec2; dist: number }
  | { kind: "cross"; a: string; b: string; at: Vec2 }
  | { kind: "touch"; a: string; b: string; at: Vec2 }
  | { kind: "self"; id: string; at: Vec2 }
  | { kind: "overlap"; a: string; b: string; from: Vec2; to: Vec2 }
  | { kind: "duplicate"; a: string; b: string }
  | { kind: "branch"; at: Vec2; ids: string[] }
  | { kind: "autoClosed"; id: string; other: string; at: Vec2 };

export type ProfileReport = {
  /** počet křivek (bez pomocných a bodů) */
  curves: number;
  /** uzavřené obrysy (id entit; vnoření se nepočítá – u stovek obrysů by stálo sekundy, stavba ho počítá sama) */
  loops: { ids: string[] }[];
  /** otevřené entity, které nejsou v žádném obrysu */
  openIds: string[];
  issues: ProfileIssue[];
  /** problémů celkem (vypsáno nejvýš MAX_ISSUES; počítá se nejvýš do MAX_COUNT – pak `capped`) */
  total: number;
  capped?: boolean;
  /** průsečíky se nehledaly (příliš mnoho úseků) */
  truncated?: boolean;
};

const fmt = (v: number) => {
  const s = String(Math.round(v * 1000) / 1000).replace(/^-0$/, "0");
  return getLang() === "en" ? s : s.replace(".", ",");
};
const pt = (p: Vec2) => `[${fmt(p[0])}; ${fmt(p[1])}]`;
/** vzdálenost bodů (sqrt – Math.hypot je u statisíců volání znatelně pomalejší) */
const d2 = (a: Vec2, b: Vec2) => {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
};
const near = (a: Vec2, b: Vec2, tol = TOL) => d2(a, b) <= tol;
/** „e1–e4“ pro souvislou řadu, jinak výčet */
export const idList = (ids: string[]) => {
  const nums = ids.map((x) => Number(/^e(\d+)$/.exec(x)?.[1] ?? NaN));
  const run = ids.length > 2 && nums.every((v, i) => Number.isFinite(v) && (i === 0 || v === nums[i - 1] + 1));
  return run ? `${ids[0]}–${ids[ids.length - 1]}` : ids.join(", ");
};

/** konce otevřené entity (uzavřené tvary a uzavřené čáry konce nemají) */
function openEnds(e: SketchEntity): [Vec2, Vec2] | null {
  if (e.type === "line") return [e.a, e.b];
  if (e.type === "arc") return [e.a, e.c];
  if ((e.type === "polyline" || e.type === "spline") && !e.closed && e.points.length >= 2) return [e.points[0], e.points[e.points.length - 1]];
  return null;
}

/** podpis geometrie entity pro hledání duplicit (nezávislý na směru úsečky / oblouku) */
function signature(e: SketchEntity): string | null {
  const n = (v: number) => (Math.round(v / TOL) * TOL).toFixed(3);
  const p = (q: Vec2) => `${n(q[0])},${n(q[1])}`;
  const pair = (a: Vec2, b: Vec2) => [p(a), p(b)].sort().join("|");
  switch (e.type) {
    case "line":
      return `l:${pair(e.a, e.b)}`;
    case "arc":
      return `a:${pair(e.a, e.c)}:${p(e.b)}`;
    case "circle":
      return `c:${n(e.cx)},${n(e.cy)},${n(e.r)}`;
    case "rect":
      return `r:${n(e.cx)},${n(e.cy)},${n(e.w)},${n(e.h)},${n(e.r)},${n(e.angle)}`;
    case "polygon":
      return `g:${n(e.cx)},${n(e.cy)},${n(e.r)},${e.sides},${n(e.angle)}`;
    case "slot":
      return `s:${n(e.cx)},${n(e.cy)},${n(e.length)},${n(e.width)},${n(e.angle)}`;
    case "ellipse":
      return `e:${n(e.cx)},${n(e.cy)},${n(e.rx)},${n(e.ry)},${n(e.angle)}`;
    case "polyline":
    case "spline": {
      const fw = e.points.map(p).join(";");
      const bw = [...e.points].reverse().map(p).join(";");
      return `${e.type[0]}${e.closed ? "c" : "o"}:${fw < bw ? fw : bw}`;
    }
    default:
      return null;
  }
}

type P = Prim & { auto: boolean; idx: number; box: [number, number, number, number] };
const primEnds = (p: Prim): Vec2[] => (p.kind === "line" ? [p.a, p.b] : p.sweep >= Math.PI * 2 - 1e-9 ? [] : [primPoint(p, 0), primPoint(p, 1)]);
const boxOf = (p: Prim): [number, number, number, number] =>
  p.kind === "line" ? [Math.min(p.a[0], p.b[0]), Math.min(p.a[1], p.b[1]), Math.max(p.a[0], p.b[0]), Math.max(p.a[1], p.b[1])] : [p.c[0] - p.r, p.c[1] - p.r, p.c[0] + p.r, p.c[1] + p.r];

/** společný úsek dvou kolineárních úseček (null = nejsou kolineární nebo se nepřekrývají) */
function lineOverlap(p: Extract<Prim, { kind: "line" }>, q: Extract<Prim, { kind: "line" }>): [Vec2, Vec2] | null {
  const dx = p.b[0] - p.a[0];
  const dy = p.b[1] - p.a[1];
  const L = Math.hypot(dx, dy);
  if (L < TOL) return null;
  const off = (s: Vec2) => Math.abs((s[0] - p.a[0]) * dy - (s[1] - p.a[1]) * dx) / L;
  if (off(q.a) > TOL || off(q.b) > TOL) return null;
  const t = (s: Vec2) => ((s[0] - p.a[0]) * dx + (s[1] - p.a[1]) * dy) / (L * L);
  const lo = Math.max(0, Math.min(t(q.a), t(q.b)));
  const hi = Math.min(1, Math.max(t(q.a), t(q.b)));
  if ((hi - lo) * L <= TOL) return null;
  return [
    [p.a[0] + dx * lo, p.a[1] + dy * lo],
    [p.a[0] + dx * hi, p.a[1] + dy * hi],
  ];
}
/** společný úsek dvou oblouků téže kružnice */
function arcOverlap(p: Extract<Prim, { kind: "arc" }>, q: Extract<Prim, { kind: "arc" }>): [Vec2, Vec2] | null {
  if (!near(p.c, q.c) || Math.abs(p.r - q.r) > TOL) return null;
  const TAU = Math.PI * 2;
  const nrm = (x: number) => ((x % TAU) + TAU) % TAU;
  // průnik intervalů [a0, a0+sweep] na kružnici: zkusí se posun q o celé otáčky
  const s0 = nrm(q.a0 - p.a0);
  for (const s of [s0, s0 - TAU]) {
    const lo = Math.max(0, s);
    const hi = Math.min(p.sweep, s + q.sweep);
    if ((hi - lo) * p.r > TOL) return [primPoint(p, lo / p.sweep), primPoint(p, hi / p.sweep)];
  }
  return null;
}
/** dotyk (tečnost) místo křížení: přímka tečná ke kružnici, kružnice tečné navzájem */
function tangent(p: Prim, q: Prim): boolean {
  if (p.kind === "line" && q.kind === "line") return false;
  if (p.kind === "arc" && q.kind === "arc") {
    const d = d2(p.c, q.c);
    return Math.abs(d - (p.r + q.r)) < 1e-6 || Math.abs(d - Math.abs(p.r - q.r)) < 1e-6;
  }
  const l = (p.kind === "line" ? p : q) as Extract<Prim, { kind: "line" }>;
  const a = (p.kind === "arc" ? p : q) as Extract<Prim, { kind: "arc" }>;
  const dx = l.b[0] - l.a[0];
  const dy = l.b[1] - l.a[1];
  const L = Math.hypot(dx, dy) || 1;
  const dist = Math.abs((a.c[0] - l.a[0]) * dy - (a.c[1] - l.a[1]) * dx) / L;
  return Math.abs(dist - a.r) < 1e-6;
}

/** krátký klíč obsahu (cyrb53 + délka) – mezipaměť nedrží megabajtové řetězce velkých skic */
function hashKey(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}:${str.length}`;
}
/** posledních několik rozborů podle obsahu entit – stavba volá kontrolu u každého prvku při každém přepočtu */
const cache = new Map<string, ProfileReport>();
const CACHE_SIZE = 8;

/** Rozbor profilu skici: obrysy, otevřené konce a problémy. Bere jen ne-pomocné křivky. Výsledek se nesmí měnit (sdílí ho mezipaměť). */
export function checkProfile(entities: SketchEntity[]): ProfileReport {
  const key = hashKey(JSON.stringify(entities));
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const r = analyze(entities);
  cache.set(key, r);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return r;
}

function analyze(entities: SketchEntity[]): ProfileReport {
  const curves = entities.filter((e) => !e.construction && e.type !== "point");
  const issues: ProfileIssue[] = [];
  if (!curves.length) return { curves: 0, loops: [], openIds: [], issues, total: 0 };
  const { loops } = findLoops(curves);
  const inLoop = new Set(loops.flatMap((l) => l.sourceIds));
  const report: ProfileReport = {
    curves: curves.length,
    loops: loops.map((l) => ({ ids: l.sourceIds })),
    openIds: curves.filter((e) => openEnds(e) && !inLoop.has(e.id)).map((e) => e.id),
    issues,
    total: 0,
  };
  let total = 0;
  const seen = new Set<string>();
  const add = (key: string, i: ProfileIssue) => {
    if (seen.has(key) || total >= MAX_COUNT) return;
    seen.add(key);
    total++;
    if (issues.length < MAX_ISSUES) issues.push(i);
  };

  // ── duplicitní entity ──
  const sigs = new Map<string, string>();
  const dupPairs = new Set<string>();
  for (const e of curves) {
    const s = signature(e);
    if (!s) continue;
    const prev = sigs.get(s);
    if (prev) {
      dupPairs.add(`${prev}|${e.id}`);
      add(`dup:${prev}|${e.id}`, { kind: "duplicate", a: prev, b: e.id });
    } else sigs.set(s, e.id);
  }

  // ── konce otevřených entit: shluky (spoj = 2 konce, volný konec = 1, větvení = 3+) ──
  type End = { id: string; at: Vec2 };
  const ends: End[] = [];
  for (const e of curves) {
    const en = openEnds(e);
    if (en) ends.push({ id: e.id, at: en[0] }, { id: e.id, at: en[1] });
  }
  // shluky mřížkou (point-cluster.ts) – tisíce konců v jednom bodě ani na jedné svislici nestojí kvadratický čas
  const cluster = clusterPoints(ends.map((x) => x.at), TOL);
  const groups = new Map<number, number[]>();
  ends.forEach((_, i) => {
    const g = groups.get(cluster[i]);
    if (g) g.push(i);
    else groups.set(cluster[i], [i]);
  });
  const free: End[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) free.push(ends[g[0]]);
    else if (g.length >= 3) {
      const ids = [...new Set(g.map((i) => ends[i].id))];
      add(`branch:${ids.join(",")}`, { kind: "branch", at: ends[g[0]].at, ids });
    }
  }
  // úseky všech křivek (pro rozměr skici, konce na obrysech a průsečíky)
  const byId = new Map(curves.map((e) => [e.id, e]));
  const ps: P[] = [];
  for (const e of curves) {
    const pl = e.type === "polyline" ? e : null;
    for (const p of prims(e)) {
      const idx = p.part && /^g\d+$/.test(p.part) ? Number(p.part.slice(1)) : -1;
      const auto = !!e.autoClose && (e.type === "line" || (!!pl && pl.closed && idx === pl.points.length - 1));
      ps.push({ ...p, auto, idx, box: boxOf(p) });
    }
  }
  // volné konce: blízké dvojice = mezera (zamýšlené napojení), ostatní = otevřený konec
  // (rozměr skici smyčkou – Math.max(...pole) by u velkých skic přetekl zásobník)
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ps)
    for (const v of primEnds(p)) {
      if (v[0] < x0) x0 = v[0];
      if (v[0] > x1) x1 = v[0];
      if (v[1] < y0) y0 = v[1];
      if (v[1] > y1) y1 = v[1];
    }
  const diag = x1 >= x0 ? Math.hypot(x1 - x0, y1 - y0) : 0;
  const gapLimit = Math.min(5, Math.max(0.5, 0.03 * diag));
  const pairs: { i: number; j: number; d: number }[] = [];
  if (free.length <= 400)
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++) {
        const d = d2(free[i].at, free[j].at);
        if (d <= gapLimit) pairs.push({ i, j, d });
      }
  pairs.sort((a, b) => a.d - b.d);
  const used = new Set<number>();
  for (const { i, j, d } of pairs) {
    if (used.has(i) || used.has(j)) continue;
    used.add(i);
    used.add(j);
    add(`gap:${i}:${j}`, { kind: "gap", a: free[i].id, b: free[j].id, pa: free[i].at, pb: free[j].at, dist: d });
  }
  // otevřený konec ležící na entitě obrysu: entita měla být částí obrysu (např. obrys z čar a oblouku, kde je jedna čára
  // výslovně uzavřená) – při úspěchu prvku jinak tichá ztráta části profilu
  const loopPs = free.length <= 400 && ps.length <= MAX_PRIMS ? ps.filter((p) => inLoop.has(p.id)) : [];
  const onLoop = (at: Vec2): string | undefined => loopPs.find((p) => at[0] >= p.box[0] - TOL && at[0] <= p.box[2] + TOL && at[1] >= p.box[1] - TOL && at[1] <= p.box[3] + TOL && near(nearestOnPrim(p, at), at))?.id;
  free.forEach((f, i) => {
    if (used.has(i) || total >= MAX_COUNT) return;
    const on = onLoop(f.at);
    const pl = on ? byId.get(on) : undefined;
    const reopen = pl?.type === "polyline" && pl.closed && !pl.autoClose && (near(pl.points[0], f.at) || near(pl.points[pl.points.length - 1], f.at));
    add(`open:${f.id}:${pt(f.at)}`, { kind: "open", id: f.id, at: f.at, ...(on ? { on } : {}), ...(reopen ? { reopen } : {}) });
  });

  // ── průsečíky, dotyky a překryvy úseků (zametání podle x; po MAX_COUNT problémech konec) ──
  if (ps.length > MAX_PRIMS) report.truncated = true;
  else {
    const ord = ps.map((_, i) => i).sort((a, b) => ps[a].box[0] - ps[b].box[0]);
    const active: number[] = [];
    for (const i of ord) {
      const p = ps[i];
      for (let k = active.length - 1; k >= 0; k--) if (ps[active[k]].box[2] < p.box[0] - TOL) active.splice(k, 1);
      for (const j of active) {
        const q = ps[j];
        if (q.box[1] > p.box[3] + TOL || q.box[3] < p.box[1] - TOL) continue;
        pairIssues(p, q);
      }
      if (total >= MAX_COUNT) break;
      active.push(i);
    }
  }
  function pairIssues(p: P, q: P) {
    const [a, b] = p.id < q.id || (p.id === q.id && p.idx < q.idx) ? [p, q] : [q, p];
    if (a.id === b.id) {
      // jen lomená čára může křížit sama sebe; sousední úseky se dotýkají v rohu
      const e = byId.get(a.id);
      if (e?.type !== "polyline") return;
      const n = e.closed ? e.points.length : e.points.length - 1;
      const adjacent = Math.abs(a.idx - b.idx) === 1 || (e.closed && ((a.idx === 0 && b.idx === n - 1) || (b.idx === 0 && a.idx === n - 1)));
      // kříží-li čáru její automatický uzavírací úsek, řekne to hlášení „uzavřena automaticky“ (oprava: „otevřená“)
      const auto = a.auto || b.auto;
      const self = (at: Vec2) => (auto ? add(`auto:${a.id}:${a.id}`, { kind: "autoClosed", id: a.id, other: a.id, at }) : add(`self:${a.id}`, { kind: "self", id: a.id, at }));
      if (a.kind === "line" && b.kind === "line") {
        const ov = lineOverlap(a, b);
        if (ov) return self(ov[0]);
      }
      if (adjacent) return;
      const xs = intersect(a, b);
      if (xs.length) self(xs[0]);
      return;
    }
    if (dupPairs.has(`${a.id}|${b.id}`) || dupPairs.has(`${b.id}|${a.id}`)) return;
    const auto = a.auto ? a : b.auto ? b : null;
    const other = auto === a ? b : a;
    const ov = a.kind === "line" && b.kind === "line" ? lineOverlap(a, b) : a.kind === "arc" && b.kind === "arc" ? arcOverlap(a, b) : null;
    if (ov) {
      if (auto) return add(`auto:${auto.id}:${other.id}`, { kind: "autoClosed", id: auto.id, other: other.id, at: ov[0] });
      return add(`ov:${a.id}:${b.id}`, { kind: "overlap", a: a.id, b: b.id, from: ov[0], to: ov[1] });
    }
    const ea = primEnds(a);
    const eb = primEnds(b);
    for (const x of intersect(a, b)) {
      const atA = ea.some((v) => near(v, x));
      const atB = eb.some((v) => near(v, x));
      if (atA && atB) continue; // spoj konců / roh – v pořádku
      if (auto) return add(`auto:${auto.id}:${other.id}`, { kind: "autoClosed", id: auto.id, other: other.id, at: x });
      if (atA || atB) return add(`touch:${a.id}:${b.id}`, { kind: "touch", a: atA ? a.id : b.id, b: atA ? b.id : a.id, at: x });
      if (tangent(a, b)) return add(`touch:${a.id}:${b.id}`, { kind: "touch", a: a.id, b: b.id, at: x });
      return add(`cross:${a.id}:${b.id}`, { kind: "cross", a: a.id, b: b.id, at: x });
    }
  }
  report.total = total;
  if (total >= MAX_COUNT) report.capped = true;
  return report;
}

/** Problém jako text pro protokol a stav. */
export function issueText(i: ProfileIssue): string {
  switch (i.kind) {
    case "open":
      if (!i.on) return tr("otevřený konec {0} v {1}", i.id, pt(i.at));
      return (
        tr("otevřený konec {0} v {1} leží na obrysu {2} – {0} do žádného obrysu nepatří", i.id, pt(i.at), i.on) +
        (i.reopen ? tr("; {0} je uzavřená čára – má-li být částí obrysu s {1}, napište u ní „otevřená“", i.on, i.id) : "")
      );
    case "gap":
      return i.a === i.b ? tr("mezera {0} mm mezi konci {1} ({2} a {3})", fmt(i.dist), i.a, pt(i.pa), pt(i.pb)) : tr("mezera {0} mm mezi {1} {2} a {3} {4}", fmt(i.dist), i.a, pt(i.pa), i.b, pt(i.pb));
    case "cross":
      return tr("{0} kříží {1} v {2}", i.a, i.b, pt(i.at));
    case "touch":
      return tr("{0} se dotýká {1} v {2} – napojení musí být konec na konec", i.a, i.b, pt(i.at));
    case "self":
      return tr("{0} kříží sama sebe v {1}", i.id, pt(i.at));
    case "overlap":
      return tr("{0} a {1} se překrývají v úseku {2}–{3}", i.a, i.b, pt(i.from), pt(i.to));
    case "duplicate":
      return tr("{0} a {1} jsou duplicitní (stejná geometrie) – jednu smažte", i.a, i.b);
    case "branch":
      return tr("v bodě {0} se stýká {1} konců ({2}) – obrys je nejednoznačný", pt(i.at), i.ids.length, capped(i.ids, ", "));
    case "autoClosed":
      if (i.other === i.id) return tr("{0} byla uzavřena automaticky a její uzavírací úsek kříží samu čáru v {1} – jako profil neplatná; napište „otevřená“ (dráha, dělicí čára) nebo napojte konce", i.id, pt(i.at));
      return tr("{0} byla uzavřena automaticky a její uzavírací úsek kříží {1} v {2} – napište „otevřená“ nebo napojte konce", i.id, i.other, pt(i.at));
  }
}

const loopsWord = (n: number) => (n === 1 ? tr("{0} uzavřený obrys", n) : n >= 2 && n <= 4 ? tr("{0} uzavřené obrysy", n) : tr("{0} uzavřených obrysů", n));

/** výčet nejvýš MAX_LIST položek, zbytek „… +N“ */
const capped = (items: string[], sep: string) => (items.length > MAX_LIST ? `${items.slice(0, MAX_LIST).join(sep)}${sep}… +${items.length - MAX_LIST}` : items.join(sep));
/** id entit obrysu – souvislá řada „e1–e40“, jinak nejvýš MAX_LIST id */
const loopIds = (ids: string[]) => {
  const s = idList(ids);
  return ids.length > MAX_LIST && s.includes(",") ? capped(ids, ", ") : s;
};

/** Řádky profilu pro textový stav skici (`stav`): souhrn a každý problém zvlášť. Kontrola nikdy nezastaví výpis stavu. */
export function profileStatusLines(entities: SketchEntity[], indent = "    "): string[] {
  try {
    return statusLines(entities, indent);
  } catch {
    return [];
  }
}
function statusLines(entities: SketchEntity[], indent: string): string[] {
  const r = checkProfile(entities);
  if (!r.curves) return [];
  const loops = r.loops.length ? `${loopsWord(r.loops.length)} (${capped(r.loops.map((l) => loopIds(l.ids)), "; ")})` : "";
  const opens = r.issues.filter((i) => i.kind === "open") as Extract<ProfileIssue, { kind: "open" }>[];
  const hard = r.issues.filter((i) => i.kind !== "open");
  const skip = r.truncated ? " " + tr("(průsečíky nekontrolovány – víc než {0} úseků)", MAX_PRIMS) : "";
  if (!r.issues.length) return [indent + (loops ? tr("profil: {0} ✓", loops) : tr("profil: žádný uzavřený obrys")) + skip];
  // jedna otevřená křivka bez obrysů (dráha tažení, dělicí čára) – informace, ne chyba
  if (!r.loops.length && !hard.length && opens.length === 2)
    return [indent + tr("profil: žádný uzavřený obrys – otevřená křivka {0} (konce {1} a {2}); k vysunutí ji uzavřete, jako dráha nebo dělicí čára je v pořádku", loopIds(r.openIds), pt(opens[0].at), pt(opens[1].at)) + skip];
  const total = `${r.total}${r.capped ? "+" : ""}`;
  const more = r.total > r.issues.length ? [indent + "  · " + tr("… a dalších {0}", `${r.total - r.issues.length}${r.capped ? "+" : ""}`)] : [];
  return [indent + tr("profil: {0} · ⚠ problémů {1}:", loops || tr("žádný uzavřený obrys"), total) + skip, ...r.issues.map((i) => indent + "  · " + issueText(i)), ...more];
}

/**
 * Důvod pro prvek, který z profilu skici staví (vysunutí, rotace, tažení): při chybě (`failed`) i otevřené konce, při úspěchu
 * jen vady, kvůli kterým výsledek nejspíš neodpovídá záměru (křížení, překryv, duplicita, mezera, větvení, auto-uzavření).
 * Prázdný text = profil je v pořádku (nebo prvek profil nemá).
 */
export function profileNote(f: Feature, sketches: Map<string, SketchF>, failed: boolean): string {
  try {
    return note(f, sketches, failed);
  } catch {
    return ""; // kontrola profilu je jen nápověda – nikdy nesmí shodit stavbu prvku
  }
}
function note(f: Feature, sketches: Map<string, SketchF>, failed: boolean): string {
  const id = f.type === "extrude" || f.type === "revolve" ? f.sketchId : f.type === "sweep" ? f.profileId : "";
  const sk = id ? sketches.get(id) : undefined;
  if (!sk) return "";
  const r = checkProfile(sk.entities);
  const thin = (f.type === "extrude" || f.type === "revolve" || f.type === "sweep") && !!(f as { thin?: unknown }).thin;
  // při úspěchu jen vady, které mění výsledek: křížení / dotyk / překryv / duplicita mezi entitami obrysů (pomocná čára přes
  // kružnici, která v žádném obrysu není, výsledek nemění), mezera, větvení, čára křížící sama sebe, automatické uzavření
  const inLoop = new Set(r.loops.flatMap((l) => l.ids));
  const matters = (i: ProfileIssue) => {
    if (i.kind === "open") return (failed && !thin) || !!i.on; // konec na obrysu = část profilu chybí i při úspěchu
    if (failed) return true;
    return i.kind === "cross" || i.kind === "touch" || i.kind === "overlap" || i.kind === "duplicate" ? inLoop.has(i.a) && inLoop.has(i.b) : true;
  };
  const list = r.issues.filter(matters);
  if (!list.length) return failed && r.curves && !r.loops.length && !thin ? tr("Profil skici „{0}“: žádný uzavřený obrys.", sk.name) : "";
  const shown = list.slice(0, 4).map(issueText).join("; ");
  const rest = list.length > 4 || r.total > r.issues.length ? " " + tr("(další viz stav)") : "";
  return tr("Profil skici „{0}“: {1}.", sk.name, shown) + rest;
}
