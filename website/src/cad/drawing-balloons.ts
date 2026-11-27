/**
 * Rozmístění pozic (balónků) sestavy na listu (vlna 22, bod 17) – čistý modul bez jádra.
 *
 * Dřív: jedna nebo dvě řady nad / pod hlavním pohledem, souřadnice oříznuté k rámu (`clampX`) → u 30–100 dílů se balónky
 * srazily na jednu hromadu, odkazové čáry se křížily přes celý pohled a nic se nehlásilo. Teď:
 * - každá pozice patří pohledu: ručně (`DrawingOptions.balloonViews`, `výkres pozice pohled horní 1-12`), jinak hlavnímu
 *   pohledu; co se k hlavnímu pohledu nevejde, přeteče do dalších pohledů, kde je komponenta vidět (auto);
 * - sloty po obvodu pohledu (4 strany, víc řad ven), pořadí podle úhlu kotvy ke středu pohledu, nejbližší volný slot,
 *   výměny dvojic proti křížení odkazových čar (2-opt);
 * - balónek se nepoloží přes text, kótu, tabulku, razítko, jiný pohled, rám ani jiný balónek; co se nevejde nikam, zůstane
 *   na nejlepším místě a označí se `lost` (kontrola překryvů listu ho započte – nikdy tichý překryv);
 * - zamčená pozice (`GenEdit.lock`, absolutní střed na listu) a posunutá (`GenEdit.move`, relativně k automatické poloze)
 *   přežijí přepočet; zamčené jsou pevné překážky pro ostatní.
 * Klíče úprav zůstávají `pos:<číslo>` (vlna E, `výkres vygenerované …`).
 */
import type { Vec2, Vec3 } from "./types";

export type BRect = { x: number; y: number; w: number; h: number };
/** pohled pro pozice: klíč, obdélník geometrie na listu, promítnutí bodu modelu na list, místo pro kóty po stranách */
export type BView = { key: string; rect: BRect; project: (p: Vec3) => Vec2; pad?: Partial<Record<"l" | "t" | "r" | "b", number>> };
export type BItem = { pos: number; name?: string; /** obálky výskytů komponenty (svět) – kotva na prvním viditelném */ boxes: [Vec3, Vec3][] };
export type BalloonMode = "auto" | "moved" | "locked";
export type PlacedBalloon = {
  id: string;
  pos: number;
  view: string;
  /** střed kroužku na listu */
  x: number;
  y: number;
  /** kotva (konec odkazové čáry) na listu */
  a: Vec2;
  mode: BalloonMode;
  /** přiřazení pohledu: ručně (`balloonViews`) nebo automaticky */
  assigned: "user" | "auto";
  /** nenašlo se volné místo – leží na nejlepším možném (kontrola překryvů ho započte) */
  lost?: boolean;
};
export type BalloonLayout = { placed: PlacedBalloon[]; lost: number; crossings: number; /** pozice s přiřazeným pohledem, který na listu není */ missingView: number[] };

export type BalloonInput = {
  items: BItem[];
  /** pohledy v pořadí přednosti (hlavní první) */
  views: BView[];
  /** pos → klíč pohledu (ručně přiřazené) */
  assign?: Record<string, string>;
  /** úpravy vygenerovaných objektů (klíče pos:<n>) */
  edit?: { off?: string[]; move?: Record<string, Vec2>; lock?: Record<string, Vec2> };
  /** obsazená místa listu (texty, kóty, tabulky, razítko, izometrie …) */
  obstacles: BRect[];
  /** povolená plocha (vnitřek rámu s odstupem) */
  bounds: BRect;
  /** poloměr kroužku [mm] */
  R?: number;
  /** čáry kót listu (kótovací a pomocné čáry) – odkaz je nemá křížit (kolo 6) */
  lines?: [Vec2, Vec2][];
};

/** odkaz nesmí vést blíž než toto ke kotvě jiné pozice (kontrola listu hlásí pod 1 mm – drawing-overlaps.ts) [mm] */
const ANCHOR_GAP = 1.5;
/** vzdálenost bodu c od úsečky ab */
function segDist(a: Vec2, b: Vec2, c: Vec2): number {
  const ab = sub(b, a);
  const L2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1]) / L2)) : 0;
  return dist([a[0] + ab[0] * t, a[1] + ab[1] * t], c);
}
/** mřížka úseček (čáry kót) pro dotaz „kříží odkaz nějakou čáru“ (buňka 10 mm) */
class LineIndex {
  private cells = new Map<string, number[]>();
  private readonly C = 10;
  constructor(private readonly segs: [Vec2, Vec2][]) {
    segs.forEach(([a, b], i) => {
      for (let gx = Math.floor(Math.min(a[0], b[0]) / this.C); gx <= Math.floor(Math.max(a[0], b[0]) / this.C); gx++)
        for (let gy = Math.floor(Math.min(a[1], b[1]) / this.C); gy <= Math.floor(Math.max(a[1], b[1]) / this.C); gy++) {
          const k = `${gx},${gy}`;
          const l = this.cells.get(k);
          if (l) l.push(i);
          else this.cells.set(k, [i]);
        }
    });
  }
  crosses(p: Vec2, q: Vec2): boolean {
    const seen = new Set<number>();
    for (let gx = Math.floor(Math.min(p[0], q[0]) / this.C); gx <= Math.floor(Math.max(p[0], q[0]) / this.C); gx++)
      for (let gy = Math.floor(Math.min(p[1], q[1]) / this.C); gy <= Math.floor(Math.max(p[1], q[1]) / this.C); gy++)
        for (const i of this.cells.get(`${gx},${gy}`) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          if (segmentsCross(p, q, this.segs[i][0], this.segs[i][1])) return true;
        }
    return false;
  }
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross2 = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];

/** úsečky ab a cd se protínají (vlastní průnik, společný konec se nepočítá) */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross2(sub(b, a), sub(c, a));
  const d2 = cross2(sub(b, a), sub(d, a));
  const d3 = cross2(sub(d, c), sub(a, c));
  const d4 = cross2(sub(d, c), sub(b, c));
  return d1 * d2 < -1e-9 && d3 * d4 < -1e-9;
}

/** úsečka ab prochází kruhem (střed c, poloměr r) */
export function segmentHitsCircle(a: Vec2, b: Vec2, c: Vec2, r: number): boolean {
  const ab = sub(b, a);
  const L2 = ab[0] * ab[0] + ab[1] * ab[1];
  const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((c[0] - a[0]) * ab[0] + (c[1] - a[1]) * ab[1]) / L2)) : 0;
  return dist([a[0] + ab[0] * t, a[1] + ab[1] * t], c) < r - 1e-6;
}

const rectHit = (a: BRect, b: BRect) => a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
const inRect = (a: BRect, b: BRect) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;

/** mřížka obdélníků pro rychlý dotaz na překryv (buňka 20 mm) */
class RectIndex {
  private cells = new Map<string, number[]>();
  private rects: BRect[] = [];
  private readonly C = 20;
  add(r: BRect) {
    const i = this.rects.push(r) - 1;
    for (let gx = Math.floor(r.x / this.C); gx <= Math.floor((r.x + r.w) / this.C); gx++)
      for (let gy = Math.floor(r.y / this.C); gy <= Math.floor((r.y + r.h) / this.C); gy++) {
        const k = `${gx},${gy}`;
        const l = this.cells.get(k);
        if (l) l.push(i);
        else this.cells.set(k, [i]);
      }
  }
  hit(r: BRect): boolean {
    for (let gx = Math.floor(r.x / this.C); gx <= Math.floor((r.x + r.w) / this.C); gx++)
      for (let gy = Math.floor(r.y / this.C); gy <= Math.floor((r.y + r.h) / this.C); gy++) {
        for (const i of this.cells.get(`${gx},${gy}`) ?? []) if (rectHit(this.rects[i], r)) return true;
      }
    return false;
  }
}

/** Kotvy komponenty v pohledu: střed prvního výskytu a body uvnitř jeho průmětu (záložní, když kotva splývá s jinou). */
function anchorsOf(it: BItem, v: BView): Vec2[] {
  const out: Vec2[] = [];
  for (const [lo, hi] of it.boxes.slice(0, 4)) {
    const pts: Vec2[] = [];
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) pts.push(v.project([x, y, z]));
    const x0 = Math.min(...pts.map((p) => p[0]));
    const x1 = Math.max(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1]));
    const y1 = Math.max(...pts.map((p) => p[1]));
    out.push([(x0 + x1) / 2, (y0 + y1) / 2]);
    for (const fx of [0.3, 0.7, 0.5]) for (const fy of [0.3, 0.7, 0.5]) if (fx !== 0.5 || fy !== 0.5) out.push([x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy]);
  }
  return out;
}

/** komponenta je v pohledu vidět (průmět první obálky má nenulovou plochu a leží v obdélníku pohledu) */
function visibleIn(it: BItem, v: BView): boolean {
  const b = it.boxes[0];
  if (!b) return false;
  const c = v.project([(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, (b[0][2] + b[1][2]) / 2]);
  return c[0] >= v.rect.x - 1 && c[0] <= v.rect.x + v.rect.w + 1 && c[1] >= v.rect.y - 1 && c[1] <= v.rect.y + v.rect.h + 1;
}

/** sloty po obvodu pohledu: řady ven od obdélníku (s místem pro kóty), rozteč 2R + 2 */
function slotsOf(v: BView, R: number, rings: number): { p: Vec2; ring: number }[] {
  const out: { p: Vec2; ring: number }[] = [];
  const step = 2 * R + 2;
  for (let k = 0; k < rings; k++) {
    const off = (side: "l" | "t" | "r" | "b") => Math.max(8, (v.pad?.[side] ?? 0) + 3) + R + k * step;
    const x0 = v.rect.x - off("l");
    const x1 = v.rect.x + v.rect.w + off("r");
    const y0 = v.rect.y - off("t");
    const y1 = v.rect.y + v.rect.h + off("b");
    const edge = (a: Vec2, b: Vec2) => {
      const L = dist(a, b);
      const n = Math.max(1, Math.floor(L / step));
      for (let i = 0; i < n; i++) out.push({ p: [a[0] + ((b[0] - a[0]) * (i + 0.5)) / n, a[1] + ((b[1] - a[1]) * (i + 0.5)) / n], ring: k });
    };
    edge([x0, y0], [x1, y0]);
    edge([x1, y0], [x1, y1]);
    edge([x1, y1], [x0, y1]);
    edge([x0, y1], [x0, y0]);
  }
  return out;
}

/** „1-12,15 20“ → [1…12, 15, 20] (čárky, mezery, rozsahy s pomlčkou / en-dash) */
export function parsePositions(s: string): number[] {
  const out: number[] = [];
  for (const part of s.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–…]\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(part);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && out.length < 10000; i++) if (!out.includes(i)) out.push(i);
  }
  return out;
}

/** pozice jako krátký text rozsahů: [1,2,3,5,7,8] → „1–3, 5, 7–8“ */
export function rangesText(ps: number[]): string {
  const s = [...new Set(ps)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}–${s[j]}` : String(s[i]));
    i = j + 1;
  }
  return out.join(", ");
}

/** Rozmístí pozice na listu. */
export function layoutBalloons(inp: BalloonInput): BalloonLayout {
  const R = inp.R ?? 4;
  const views = inp.views;
  const vmap = new Map(views.map((v) => [v.key, v]));
  const occ = new RectIndex();
  for (const o of inp.obstacles) occ.add(o);
  // pohledy jsou překážky pro balónky (i vlastní – sloty leží vně)
  for (const v of views) occ.add({ x: v.rect.x - 1, y: v.rect.y - 1, w: v.rect.w + 2, h: v.rect.h + 2 });
  const placed: PlacedBalloon[] = [];
  const box = (p: Vec2): BRect => ({ x: p[0] - R - 0.6, y: p[1] - R - 0.6, w: 2 * R + 1.2, h: 2 * R + 1.2 });
  const free = (p: Vec2) => inRect(box(p), inp.bounds) && !occ.hit(box(p)) && placed.every((b) => dist([b.x, b.y], p) >= 2 * R + 1);
  const lines = new LineIndex(inp.lines ?? []);
  /**
   * odkaz z `p` ke kotvě `a` nevede přes jiný balónek, balónek v `p` neleží na cizím odkazu; odkaz nevede přes kotvu jiné
   * pozice ani cizí odkaz přes kotvu `a` (nešlo by poznat, kam vede – kolo 6), nekříží čáry kót ani odkaz zamčené pozice
   * (ten výměny proti křížení nepřesunou)
   */
  const leaderClear = (p: Vec2, a: Vec2, self?: { x: number; y: number }, anchors = true) =>
    placed.every((b) => b === self || (!segmentHitsCircle(p, a, [b.x, b.y], R + 0.3) && !segmentHitsCircle([b.x, b.y], b.a, p, R + 0.3) && (!anchors || (segDist(p, a, b.a) >= ANCHOR_GAP && segDist([b.x, b.y], b.a, a) >= ANCHOR_GAP)) && (b.mode !== "locked" || !segmentsCross(p, a, [b.x, b.y], b.a)))) && !lines.crosses(p, a);
  /** nejdelší rozumný odkaz pohledu: dál od kotvy je pozice nečitelná (kolo 6 – na A3 byl odkaz 243 mm) */
  const maxLead = (v: BView) => Math.max(40, 0.3 * (v.rect.w + v.rect.h));
  const missingView: number[] = [];
  // klíče úprav (opakovaná pozice → pos:<n>#k jako vlna E)
  const seen = new Map<number, number>();
  const items = inp.items.map((it) => {
    const k = (seen.get(it.pos) ?? 0) + 1;
    seen.set(it.pos, k);
    return { it, id: k > 1 ? `pos:${it.pos}#${k}` : `pos:${it.pos}` };
  });
  const edit = inp.edit ?? {};
  const shown = items.filter((x) => !edit.off?.includes(x.id));
  const usedAnchors = new Map<string, Vec2[]>();
  /** kotva v pohledu: střed prvního výskytu; splývá-li s kotvou jiné pozice, bod uvnitř průmětu nejdál od ostatních */
  const anchorPick = (it: BItem, v: BView): Vec2 => {
    const cands = anchorsOf(it, v);
    const used = usedAnchors.get(v.key) ?? [];
    let best = cands[0] ?? [v.rect.x + v.rect.w / 2, v.rect.y + v.rect.h / 2];
    if (used.some((u) => dist(u, best) < 1.5)) {
      let bd = -1;
      for (const c of cands) {
        const d = used.length ? Math.min(...used.map((u) => dist(u, c))) : Infinity;
        if (d > bd) {
          bd = d;
          best = c;
        }
      }
    }
    return best;
  };
  const anchorUse = (v: BView, a: Vec2) => usedAnchors.set(v.key, [...(usedAnchors.get(v.key) ?? []), a]);
  const anchorFor = (it: BItem, v: BView): Vec2 => {
    const a = anchorPick(it, v);
    anchorUse(v, a);
    return a;
  };
  /**
   * Pohledy pro automatické přiřazení v pořadí vhodnosti: v pohledu, kde průmět komponenty zakrývá méně jiných komponent
   * (pole desek shora × zepředu, kde splývají), je pozice jednoznačná; při shodě pořadí pohledů (hlavní první).
   */
  const rects = new Map<string, [number, number, number, number][]>();
  for (const v of views)
    rects.set(
      v.key,
      shown.map(({ it }) => {
        const b = it.boxes[0];
        if (!b) return [0, 0, -1, -1];
        const pts: Vec2[] = [];
        for (const x of [b[0][0], b[1][0]]) for (const y of [b[0][1], b[1][1]]) for (const z of [b[0][2], b[1][2]]) pts.push(v.project([x, y, z]));
        return [Math.min(...pts.map((q) => q[0])), Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[0])), Math.max(...pts.map((q) => q[1]))];
      }),
    );
  const crowd = (i: number, v: BView) => {
    const rs = rects.get(v.key)!;
    const r = rs[i];
    const c: Vec2 = [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
    let n = 0;
    rs.forEach((q, j) => {
      if (j !== i && c[0] > q[0] + 0.2 && c[0] < q[2] - 0.2 && c[1] > q[1] + 0.2 && c[1] < q[3] - 0.2) n++;
    });
    return n;
  };
  const prefsOf = (i: number, it: BItem) =>
    views
      .map((v, k) => ({ v, k, c: visibleIn(it, v) ? crowd(i, v) : Infinity }))
      .filter((x) => x.c < Infinity)
      .sort((p, q) => p.c - q.c || p.k - q.k)
      .map((x) => x.v);

  // 1) zamčené: absolutní poloha (pevná překážka pro ostatní)
  type Rest = { it: BItem; id: string; prefs: BView[]; assigned: "user" | "auto" };
  const rest: Rest[] = [];
  shown.forEach((x, i) => {
    const want = inp.assign?.[String(x.it.pos)];
    const wv = want ? vmap.get(want) : undefined;
    if (want && !wv) missingView.push(x.it.pos);
    const prefs = wv ? [wv] : prefsOf(i, x.it);
    if (!prefs.length && views[0]) prefs.push(views[0]);
    if (!prefs.length) return;
    const assigned = wv ? "user" : "auto";
    const lk = edit.lock?.[x.id];
    if (lk) {
      placed.push({ id: x.id, pos: x.it.pos, view: prefs[0].key, x: lk[0], y: lk[1], a: anchorFor(x.it, prefs[0]), mode: "locked", assigned });
      return;
    }
    rest.push({ ...x, prefs, assigned });
  });

  // 2) automaticky: nejdřív první řada kolem všech pohledů, pak další řady (odkaz vnější řady by vedl přes vnitřní
  //    balónky); v pohledu pořadí podle úhlu kotvy ke středu pohledu, nejbližší volný slot, odkaz nevede přes balónek
  // nejvýš 5 řad kolem pohledu (~50 mm) – dál od pohledu je pozice nečitelná
  const RINGS = 5;
  const slotsAll = new Map(views.map((v) => [v.key, slotsOf(v, R, RINGS)]));
  const results: PlacedBalloon[] = [];
  const angleIn = (x: Rest) => {
    const v = x.prefs[0];
    const a = anchorPick(x.it, v);
    return Math.atan2(a[1] - (v.rect.y + v.rect.h / 2), a[0] - (v.rect.x + v.rect.w / 2));
  };
  let pending = [...rest].sort((p, q) => views.indexOf(p.prefs[0]) - views.indexOf(q.prefs[0]) || angleIn(p) - angleIn(q));
  /**
   * kotvy k vyzkoušení: zvolená (střed prvního výskytu, nebo bod nejdál od použitých) a body uvnitř průmětu prvního výskytu,
   * které nesplývají s kotvou jiné pozice a neleží na cizím odkazu – kotva se volí spolu s místem balónku tak, aby odkaz
   * nevedl přes kotvu jiné pozice (kolo 6)
   */
  const anchorCands = (it: BItem, v: BView): Vec2[] => {
    const first = anchorPick(it, v);
    const used = usedAnchors.get(v.key) ?? [];
    const okA = (c: Vec2) => used.every((u) => dist(u, c) >= ANCHOR_GAP) && placed.every((b) => b.view !== v.key || segDist([b.x, b.y], b.a, c) >= ANCHOR_GAP);
    const out = [first, ...anchorsOf(it, v).slice(0, 9)].filter((c, i, all) => all.findIndex((d) => dist(c, d) < 1e-6) === i && okA(c));
    return out.length ? out : [first];
  };
  const tryPlace = (x: Rest, lim: number, strict: boolean): boolean => {
    for (const v of x.prefs) {
      const cands = strict ? anchorCands(x.it, v) : [anchorPick(x.it, v)];
      const Lmax = maxLead(v);
      let best: { p: Vec2; a: Vec2; cost: number } | null = null;
      const slots = slotsAll.get(v.key)!.filter((sl) => sl.ring < lim && free(sl.p));
      cands.forEach((a, ai) => {
        for (const sl of slots) {
          const L = dist(sl.p, a);
          if (strict && L > Lmax) continue;
          const cost = L + sl.ring * 6 + ai * 1.5;
          if (best && cost >= best.cost) continue;
          if (strict && !leaderClear(sl.p, a)) continue;
          best = { p: sl.p, a, cost };
        }
      });
      if (best) {
        const { a, p } = best as { p: Vec2; a: Vec2; cost: number };
        anchorUse(v, a);
        const b: PlacedBalloon = { id: x.id, pos: x.it.pos, view: v.key, x: p[0], y: p[1], a, mode: "auto", assigned: x.assigned };
        placed.push(b);
        results.push(b);
        return true;
      }
    }
    return false;
  };
  for (let lim = 1; lim <= RINGS && pending.length; lim++) pending = pending.filter((x) => !tryPlace(x, lim, true));
  // odkaz bez průchodu balónkem nejde: volné místo i tak (kontrola překryvů ho započte)
  pending = pending.filter((x) => !tryPlace(x, RINGS, false));
  // nikde místo: nejbližší slot v rámu (i přes překážky) – kontrola překryvů listu ho započte
  for (const x of pending) {
    const v = x.prefs[0];
    const a = anchorFor(x.it, v);
    const all = slotsAll.get(v.key)!.filter((sl) => inRect(box(sl.p), inp.bounds));
    const p = all.sort((m, n) => dist(m.p, a) - dist(n.p, a))[0]?.p ?? [Math.max(inp.bounds.x + R, Math.min(inp.bounds.x + inp.bounds.w - R, a[0])), inp.bounds.y + R];
    placed.push({ id: x.id, pos: x.it.pos, view: v.key, x: p[0], y: p[1], a, mode: "auto", assigned: x.assigned, lost: true });
  }

  /** jiná kotva pozice `b` uvnitř průmětu její komponenty, se kterou odkaz nevede přes cizí kotvu ani balónek (false = není) */
  const itemOf = new Map(rest.map((x) => [x.id, x.it]));
  const reAnchor = (b: PlacedBalloon): boolean => {
    const it = itemOf.get(b.id);
    const v = vmap.get(b.view);
    if (!it || !v) return false;
    const others = placed.filter((o) => o !== b && o.view === b.view);
    for (const c of anchorsOf(it, v).slice(0, 9)) {
      if (others.some((o) => dist(o.a, c) < ANCHOR_GAP)) continue;
      if (leaderClear([b.x, b.y], c, b)) {
        b.a = c;
        return true;
      }
    }
    return false;
  };
  // 3) výměny proti křížení odkazových čar (jen automaticky umístěné ve stejném pohledu)
  const lead = (b: { x: number; y: number; a: Vec2 }): [Vec2, Vec2] => [[b.x, b.y], b.a];
  for (let pass = 0; pass < 6; pass++) {
    let swapped = false;
    for (let i = 0; i < results.length; i++)
      for (let j = i + 1; j < results.length; j++) {
        const p = results[i];
        const q = results[j];
        if (p.view !== q.view) continue;
        const [p1, p2] = lead(p);
        const [q1, q2] = lead(q);
        if (!segmentsCross(p1, p2, q1, q2)) continue;
        const before = Math.max(dist([p.x, p.y], p.a), dist([q.x, q.y], q.a));
        const [pa, qa] = [p.a, q.a];
        [p.x, q.x] = [q.x, p.x];
        [p.y, q.y] = [q.y, p.y];
        // výměna, po které by odkaz vedl přes jiný balónek, kotvu nebo kótu, nebo by se odkaz nad míru prodloužil, se vrátí;
        // odkaz přes cizí kotvu zkusí nejdřív jinou kotvu uvnitř průmětu téže komponenty (kolo 6)
        const v = vmap.get(p.view);
        const ok = (b: PlacedBalloon) => leaderClear([b.x, b.y], b.a, b) || reAnchor(b);
        const after = () => Math.max(dist([p.x, p.y], p.a), dist([q.x, q.y], q.a));
        if (!ok(p) || !ok(q) || (v && after() > before + 1e-6 && after() > 2 * maxLead(v))) {
          [p.x, q.x] = [q.x, p.x];
          [p.y, q.y] = [q.y, p.y];
          [p.a, q.a] = [pa, qa];
          continue;
        }
        swapped = true;
      }
    if (!swapped) break;
  }

  // 4) ručně posunuté (relativně k automatické poloze)
  for (const b of placed) {
    const mv = b.mode === "locked" ? undefined : edit.move?.[b.id];
    if (mv) {
      b.x += mv[0];
      b.y += mv[1];
      b.mode = "moved";
    }
  }
  return { placed, lost: placed.filter((b) => b.lost).length, crossings: countCrossings(placed), missingView };
}

/** počet křížení odkazových čar (dvojice) */
export function countCrossings(bs: { x: number; y: number; a: Vec2 }[]): number {
  let n = 0;
  for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) if (segmentsCross([bs[i].x, bs[i].y], bs[i].a, [bs[j].x, bs[j].y], bs[j].a)) n++;
  return n;
}
