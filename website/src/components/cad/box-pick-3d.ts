/**
 * Výběr oknem ve 3D – pravidla nad čistou geometrií `@/cad/box-select` (sdílí je 3D okno i náhled bez WebGL):
 * co se podle filtru výběru vybírá, převod zásahů na `SelItem`, režimy (nahradit / přidat / odebrat), počítadlo u
 * obdélníku, mapování tlačítek myši a volba „i skryté“.
 *
 * Filtr → co okno vybírá:
 * – Vše: v dílu plochy, v sestavě komponenty (bod/hrana/plocha by se v okně přes model navzájem přebíjely);
 * – Prvek: v dílu plochy (aplikace dohledá prvky, které je vytvořily), v sestavě tělesa komponent;
 * – Plocha / Hrana / Bod: plochy / hrany / vrcholy (v sestavě i komponent);
 * – Těleso / tvar: těleso dílu, v sestavě tělesa komponent; Komponenta: komponenty (v dílu těleso); Podsestava:
 *   komponenty nejvyšší úrovně.
 * Formuláře prvků (hrany zaoblení / sražení, plochy skořepiny, úkosu…): hrany, resp. plochy dílu.
 *
 * Modifikátory (stejné jako u kliku, kde Ctrl / Shift + klik přidá nebo ubere jednu entitu): bez klávesy okno výběr
 * nahradí, Ctrl nebo Shift přidá, Ctrl + Shift nebo Alt odebere.
 */
import { useSyncExternalStore } from "react";
import { cadLocale, tr } from "@/cad/i18n";
import { boxSelect, prepareBox, type BoxCamera, type BoxClip, type BoxHits, type BoxKinds, type BoxRect, type BoxScene } from "@/cad/box-select";
import type { EntityInfo, MeasureResult } from "@/cad/inspect";
import type { Vec3 } from "@/cad/types";
import { selKey, type SelFilter, type SelItem } from "./selection";
import type { DisplayMode, MouseScheme, PickMode } from "./viewport";

export type BoxMode = "replace" | "add" | "remove";
/** Levé tlačítko táhne: výběr oknem (výchozí) | otáčení (okno pak jen z prázdného místa). */
export type LeftDrag = "window" | "orbit";

/** Režim podle kláves: Ctrl / Shift / ⌘ přidá, Ctrl + Shift nebo Alt odebere, jinak nahradí. */
export function boxModeOf(e: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean }): BoxMode {
  const ctrl = !!(e.ctrlKey || e.metaKey);
  if (e.altKey || (ctrl && e.shiftKey)) return "remove";
  return ctrl || e.shiftKey ? "add" : "replace";
}

/** Co okno hledá: druhy entit; `items` = celá tělesa (body), komponenty (component) nebo podsestavy (subasm). */
export type BoxSpec = { faces?: boolean; edges?: boolean; vertices?: boolean; items?: "body" | "component" | "subasm" };

/** Co okno vybírá v režimu výběru 3D okna a filtru; null = v tomto režimu se oknem nevybírá. */
export function boxSpecFor(pickMode: PickMode, filter: SelFilter, asm: boolean): BoxSpec | null {
  if (pickMode === "edges") return asm ? null : { edges: true };
  if (pickMode === "faces") return asm ? null : { faces: true };
  if (pickMode !== "select" && pickMode !== "component" && pickMode !== "measure") return null;
  switch (filter) {
    case "face":
      return { faces: true };
    case "edge":
      return { edges: true };
    case "vertex":
      return { vertices: true };
    case "body":
      return { items: "body" };
    case "component":
      return { items: asm ? "component" : "body" };
    case "subasm":
      return { items: asm ? "subasm" : "body" };
    case "feature":
      return asm ? { items: "body" } : { faces: true };
    default:
      return asm ? { items: "component" } : { faces: true };
  }
}

/** druhy pro `boxSelect` */
export const boxKinds = (s: BoxSpec): BoxKinds => ({ faces: !!s.faces, edges: !!s.edges, vertices: !!s.vertices, items: !!s.items });

/** id komponenty sítě (díl: prázdné) */
export type BoxMeta = { compId?: string; topId?: string };

/** Zásahy okna jako položky výběru (u sestavy s id komponenty; podsestava = komponenta nejvyšší úrovně, bez opakování). */
export function hitsToSel(h: BoxHits, metas: BoxMeta[], spec: BoxSpec): SelItem[] {
  const ids = (k: number) => {
    const m = metas[k];
    return m?.compId ? { compId: m.compId, topId: m.topId ?? m.compId } : {};
  };
  const out: SelItem[] = [];
  if (spec.faces) for (const f of h.faces) out.push({ kind: "face", index: f.face, ...ids(f.item) });
  if (spec.edges) for (const e of h.edges) out.push({ kind: "edge", index: e.edge, ...ids(e.item) });
  if (spec.vertices) for (const v of h.vertices) out.push({ kind: "vertex", index: v.index, point: v.point as Vec3, ...ids(v.item) });
  if (spec.items) {
    const seen = new Set<string>();
    for (const k of h.items) {
      const m = metas[k] ?? {};
      if (spec.items === "body" || !m.compId) {
        const it: SelItem = m.compId ? { kind: "body", compId: m.compId, topId: m.topId ?? m.compId } : { kind: "body" };
        if (!seen.has(selKey(it))) out.push(it);
        seen.add(selKey(it));
        continue;
      }
      const top = (m.topId ?? m.compId).split("/")[0];
      const it: SelItem = spec.items === "subasm" ? { kind: "component", compId: top, topId: top } : { kind: "component", compId: m.compId, topId: m.topId ?? m.compId };
      if (seen.has(selKey(it))) continue;
      seen.add(selKey(it));
      out.push(it);
    }
  }
  return out;
}

/** Síť ke scéně výběru oknem: síť dílu / komponenty, topologické vrcholy, matice umístění, id komponenty. */
export type BoxMeshIn = {
  mesh: { vertices: Float32Array; triangles: Uint32Array; faceGroups?: Int32Array | null; lines?: Float32Array | null; edgeGroups?: Int32Array | null };
  points?: Float32Array | null;
  matrix?: ArrayLike<number> | null;
  meta: BoxMeta;
  /** zakrývá ostatní (průhledná / potlačená komponenta ne) */
  occluder?: boolean;
};
export type BoxSceneOf = { scene: BoxScene; metas: BoxMeta[] };

/**
 * Scéna výběru oknem pro 3D okno i náhled bez WebGL: zakrytí podle stylu zobrazení (drátový a průhledný styl
 * zakrytí nemají) a volby „i skryté“; odvrácené stěny se vynechají jako ve vykreslení (bez řezu, mimo styl skryté hrany).
 */
export function buildBoxScene(camera: BoxCamera, meshes: BoxMeshIn[], clip: BoxClip | null, display?: DisplayMode): BoxSceneOf {
  const occlude = !through && display !== "wireframe" && display !== "xray";
  const scene = prepareBox(
    meshes.map((m) => ({ ...m.mesh, points: m.points ?? null, matrix: m.matrix ?? null, occluder: m.occluder !== false })),
    camera,
    { clip, occlude, cull: !clip && display !== "hiddenLine" },
  );
  return { scene, metas: meshes.map((m) => m.meta) };
}

/** Výběr oknem ve scéně jako položky výběru. */
export const queryBox = (sc: BoxSceneOf, rect: BoxRect, crossing: boolean, spec: BoxSpec): SelItem[] => hitsToSel(boxSelect(sc.scene, { rect, crossing, kinds: boxKinds(spec) }), sc.metas, spec);

/** Nový výběr: nahradit, přidat (bez opakování) nebo odebrat. */
export function applyBoxSel(cur: SelItem[], items: SelItem[], mode: BoxMode): SelItem[] {
  if (mode === "replace") {
    const seen = new Set<string>();
    return items.filter((x) => !seen.has(selKey(x)) && !!seen.add(selKey(x)));
  }
  const keys = new Set(items.map(selKey));
  if (mode === "remove") return cur.filter((x) => !keys.has(selKey(x)));
  const have = new Set(cur.map(selKey));
  const out = [...cur];
  for (const x of items) {
    const k = selKey(x);
    if (have.has(k)) continue;
    have.add(k);
    out.push(x);
  }
  return out;
}

/** Totéž pro seznam čísel (hrany zaoblení, plochy skořepiny ve formuláři prvku). */
export function applyBoxIdx(cur: number[], idx: number[], mode: BoxMode): number[] {
  if (mode === "replace") return [...new Set(idx)].sort((a, b) => a - b);
  if (mode === "remove") {
    const del = new Set(idx);
    return cur.filter((x) => !del.has(x));
  }
  return [...new Set([...cur, ...idx])].sort((a, b) => a - b);
}

/** český tvar podle počtu: 1 plocha, 2–4 plochy, 0 a 5+ ploch (0 = jeden, 1 = několik, 2 = mnoho) */
const form = (n: number) => (n === 1 ? 0 : n >= 2 && n <= 4 ? 1 : 2);
const COUNT: [SelItem["kind"], (n: number, t: string) => string][] = [
  ["face", (n, t) => [tr("{0} plocha", t), tr("{0} plochy", t), tr("{0} ploch", t)][form(n)]],
  ["edge", (n, t) => [tr("{0} hrana", t), tr("{0} hrany", t), tr("{0} hran", t)][form(n)]],
  ["vertex", (n, t) => [tr("{0} bod", t), tr("{0} body", t), tr("{0} bodů", t)][form(n)]],
  ["body", (n, t) => [tr("{0} těleso", t), tr("{0} tělesa", t), tr("{0} těles", t)][form(n)]],
  ["component", (n, t) => [tr("{0} komponenta", t), tr("{0} komponenty", t), tr("{0} komponent", t)][form(n)]],
  ["feature", (n, t) => [tr("{0} prvek", t), tr("{0} prvky", t), tr("{0} prvků", t)][form(n)]],
];

/** Počítadlo u obdélníku a v protokolu: „12 ploch · 30 hran“ (nic = „nic“). */
export function boxCountText(items: SelItem[]): string {
  const n = new Map<string, number>();
  for (const it of items) n.set(it.kind, (n.get(it.kind) ?? 0) + 1);
  const parts = COUNT.filter(([k]) => n.get(k)).map(([k, f]) => f(n.get(k)!, n.get(k)!.toLocaleString(cadLocale())));
  return parts.length ? parts.join(" · ") : tr("nic");
}

/** Popisek obdélníku: počet a režim (+ přidá, − odebere). */
export function boxLabel(items: SelItem[], mode: BoxMode): string {
  const c = boxCountText(items);
  return mode === "add" ? tr("+ {0}", c) : mode === "remove" ? tr("− {0}", c) : c;
}

/** Co okno po uvolnění opravdu vybere (filtr Prvek: prvky místo ploch); `pending` = část se ještě dohledává. */
export type BoxResolved = { items: SelItem[]; pending: boolean };
/** Převod zásahů okna na vybírané položky pro počítadlo (synchronně); `changed` = dohledání skončilo, přepočítat popisek. */
export type BoxResolve = (items: SelItem[], changed: () => void) => BoxResolved | null;

/** Text počítadla u obdélníku: zásahy okna, případně převedené na to, co se vybere (filtr Prvek → prvky). */
export function boxPreviewText(raw: SelItem[], mode: BoxMode, resolve: BoxResolve | null | undefined, changed: () => void): string {
  const r = resolve?.(raw, changed);
  if (!r) return boxLabel(raw, mode);
  if (!r.pending) return boxLabel(r.items, mode);
  return r.items.length ? `${boxLabel(r.items, mode)} …` : tr("hledám prvky…");
}

/* ───────────── tlačítka myši ───────────── */
export type DragAction = "orbit" | "pan" | "none";
/** Akce tlačítek bez modifikátorů podle schématu myši a volby „Levé tlačítko táhne“. */
export function mouseButtons(scheme: MouseScheme | undefined, left: LeftDrag | undefined): { left: DragAction; middle: DragAction; right: DragAction } {
  const win = (left ?? "window") === "window";
  const L: DragAction = win ? "none" : "orbit";
  if (scheme === "solidworks") return { left: L, middle: "orbit", right: "pan" };
  if (scheme === "simple") return win ? { left: "none", middle: "pan", right: "orbit" } : { left: "orbit", middle: "pan", right: "pan" };
  return { left: L, middle: "pan", right: "orbit" };
}
/** Akce tažení tlačítkem `button` (0 levé, 1 prostřední, 2 pravé); Ctrl / ⌘ / Shift prohodí otáčení a posun (jako OrbitControls). */
export function dragAction(scheme: MouseScheme | undefined, left: LeftDrag | undefined, button: number, swap: boolean): DragAction {
  const b = mouseButtons(scheme, left);
  const a = button === 0 ? b.left : button === 1 ? b.middle : button === 2 ? b.right : "none";
  if (!swap || a === "none") return a;
  return a === "orbit" ? "pan" : "orbit";
}

/** Nápověda ve stavovém řádku: otáčení, posun a výběr oknem podle schématu myši. */
export function mouseHint(scheme: MouseScheme | undefined, left: LeftDrag | undefined): string {
  const win = (left ?? "window") === "window";
  const base =
    scheme === "solidworks"
      ? tr("Otáčení: prostřední · Posun: Ctrl+prostřední")
      : scheme === "simple" && !win
        ? tr("Otáčení: levé · Posun: pravé")
        : tr("Otáčení: pravé tl. · Posun: prostřední");
  return win ? tr("{0} · Okno: levé tl. (← křížení)", base) : tr("{0} · Okno: levé tl. z prázdného místa", base);
}

/** Jak okno funguje (stavový řádek při tažení, mikronávod, popisek). */
export const boxHelpText = () => tr("Výběr oknem: zleva doprava = jen celé uvnitř, zprava doleva = i protnuté · Ctrl/Shift přidá · Ctrl+Shift/Alt odebere · Esc zruší");

/* ───────────── volba „i skryté“ (okno vybere i zakryté entity) ───────────── */
let through = false;
const listeners = new Set<() => void>();
/** Vybírá okno i zakryté entity? (výchozí ne – jen viditelné) */
export const boxThrough = () => through;
export function setBoxThrough(v: boolean) {
  if (through === v) return;
  through = v;
  for (const l of [...listeners]) l();
}
export function useBoxThrough(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => through,
    () => false,
  );
}

/* ───────────── měření oknem (víc než dvě entity) ───────────── */
const fmt = (v: number, d = 3) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString(cadLocale(), { maximumFractionDigits: d });

/**
 * Souhrn entit vybraných oknem v nástroji Měření (víc než dvě entity – vzdálenost dvou se měří jako po kliknutí):
 * počet, celková délka hran a celková plocha ploch. `info` = údaje o entitě (cad.inspect); nejvýš `max` dotazů.
 */
export async function measureMany(items: SelItem[], info: (it: SelItem) => Promise<EntityInfo>, max = 400): Promise<MeasureResult> {
  let len = 0, area = 0, nl = 0, na = 0;
  const list = items.slice(0, max);
  for (const it of list) {
    if (it.kind !== "edge" && it.kind !== "face") continue;
    const e = await info(it);
    if (it.kind === "edge" && e.length != null) {
      len += e.length;
      nl++;
    }
    if (it.kind === "face" && e.area != null) {
      area += e.area;
      na++;
    }
  }
  const rows: [string, string][] = [[tr("Vybráno oknem"), boxCountText(items)]];
  if (nl) rows.push([tr("Celková délka hran"), `${fmt(len)} mm`]);
  if (na) rows.push([tr("Celková plocha ploch"), `${fmt(area)} mm²`]);
  if (items.length > list.length) rows.push([tr("Pozn."), tr("sečteno prvních {0} entit", list.length)]);
  return { rows, gfx: { lines: [], points: [], labels: [] } };
}

export type FaceOwnerFn = (face: number, point?: Vec3) => Promise<{ featureId: string; faces: number[] } | null>;

/**
 * Filtr Prvek v dílu: okno najde plochy a vybere prvky, které je vytvořily – počítadlo u obdélníku proto počítá prvky.
 * Vlastníka plochy hledá jádro (cad.faceOwner, asynchronně), proto mezipaměť „plocha → prvek“ pro jeden model (`key`,
 * např. síť výsledku): chybějící plochy se dohledají na pozadí (jedna otázka na prvek – odpověď nese všechny jeho
 * plochy) a po doplnění se počítadlo přepočítá. Tutéž mezipaměť použije výběr po uvolnění (`owner`).
 */
export function featureOwnerCache() {
  let key: unknown = undefined;
  let gen = 0;
  const own = new Map<number, string | null>();
  const queued = new Set<number>();
  let queue: { face: number; point?: Vec3 }[] = [];
  let running = false;
  let notify: (() => void) | null = null;
  const keyed = (k: unknown) => {
    if (k === key) return;
    key = k;
    gen++;
    own.clear();
    queued.clear();
    queue = [];
    running = false;
  };
  const store = (face: number, r: { featureId: string; faces: number[] } | null) => {
    own.set(face, r?.featureId ?? null);
    if (r) for (const f of r.faces) own.set(f, r.featureId);
  };
  const pump = async (ask: FaceOwnerFn) => {
    if (running) return;
    running = true;
    const g = gen;
    while (g === gen && queue.length) {
      const w = queue.shift()!;
      if (own.has(w.face)) continue;
      const r = await ask(w.face, w.point).catch(() => null);
      if (g !== gen) return;
      store(w.face, r);
      notify?.();
    }
    if (g === gen) running = false;
  };
  return {
    /** vlastník plochy s mezipamětí (výběr po uvolnění, `featureFacesOf`) */
    owner: (k: unknown, ask: FaceOwnerFn): FaceOwnerFn => async (face, point) => {
      keyed(k);
      const g = gen;
      const id = own.get(face);
      if (id !== undefined) return null === id ? null : { featureId: id, faces: [...own].flatMap(([f, x]) => (x === id ? [f] : [])).sort((a, b) => a - b) };
      const r = await ask(face, point);
      if (g === gen) store(face, r);
      return r;
    },
    /** prvky ploch z okna pro počítadlo; chybějící vlastníky začne dohledávat */
    resolve: (k: unknown, items: SelItem[], ask: FaceOwnerFn, changed: () => void): BoxResolved => {
      keyed(k);
      notify = changed;
      const ids = new Set<string>();
      let pending = false;
      for (const it of items) {
        if (it.kind !== "face" || it.compId) continue;
        const id = own.get(it.index);
        if (id === undefined) {
          pending = true;
          if (!queued.has(it.index)) {
            queued.add(it.index);
            queue.push({ face: it.index, point: it.point });
          }
        } else if (id) ids.add(id);
      }
      if (pending) void pump(ask);
      return { items: [...ids].map((featureId): SelItem => ({ kind: "feature", featureId })), pending };
    },
  };
}

/**
 * Filtr Prvek: plochy z okna → prvky historie, které je vytvořily (`owner` = cad.faceOwner). Plochy prvku, který už
 * je nalezen, se znovu neptají. Výsledek: id prvku → jeho plochy.
 */
export async function featureFacesOf(items: SelItem[], owner: (face: number, point?: Vec3) => Promise<{ featureId: string; faces: number[] } | null>): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  const done = new Set<number>();
  for (const it of items) {
    if (it.kind !== "face" || it.compId || done.has(it.index)) continue;
    const own = await owner(it.index, it.point);
    if (!own) continue;
    out[own.featureId] = own.faces;
    for (const f of own.faces) done.add(f);
    done.add(it.index);
  }
  return out;
}
