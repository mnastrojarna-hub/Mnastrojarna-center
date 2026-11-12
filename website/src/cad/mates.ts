/**
 * Trvalé vazby sestavy (Kontakt, Zarovnat, Souosost, Vzdálenost, Úhel, Rovnoběžnost) – sekvenční řešič.
 * Čisté funkce: geometrii ploch dodá volající (`FaceGeo` v souřadnicích komponenty nejvyšší úrovně).
 * Každá vazba posune/natočí pohyblivou komponentu (`a`, pokud není ukotvená; jinak `b`). Projde se dvakrát,
 * aby se dořešily řetězené vazby, a nakonec se zkontrolují zbytky (konflikt = vazbu nelze splnit s ostatními).
 */
import { apply3, eulerXYZ, mul3, rotMatrix, rotationBetween, transformPoint, type Mat3 } from "./assembly";
import { tr } from "./i18n";
import type { AsmComponent, CadDoc, Mate, MateRef, MateType, MeshData, Placement, Vec3 } from "./types";

/** Geometrie plochy v souřadnicích komponenty nejvyšší úrovně. U válce/kužele: `normal` = směr osy, `origin` = bod na ose. */
export type FaceGeo = { kind: "plane" | "cylinder" | "other"; origin: Vec3; normal: Vec3; radius?: number };
export type GeoProvider = (ref: MateRef) => FaceGeo | null;
export type MateStatus = "ok" | "conflict" | "missing" | "suppressed";

export const MATE_LABEL: Record<MateType, string> = {
  mate: "Kontakt",
  flush: "Zarovnat",
  concentric: "Souosost",
  distance: "Vzdálenost",
  angle: "Úhel",
  parallel: "Rovnoběžně",
  fixed: "Ukotvit",
};

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const r6 = (v: number) => Math.round(v * 1e6) / 1e6 || 0; // „|| 0“: žádná −0 v umístěních a popisech
const rv = (v: Vec3): Vec3 => [r6(v[0]), r6(v[1]), r6(v[2])];

/** Plocha ve světových souřadnicích podle umístění komponenty. */
export function worldGeo(pl: Placement, g: FaceGeo): FaceGeo {
  return { ...g, origin: transformPoint(pl, g.origin), normal: norm(apply3(rotMatrix(pl.rotation), g.normal)) };
}

/** Natočení umístění tak, aby lokální směr `local` mířil na světový `target`; otáčí se nejmenší možnou rotací. */
function rotateTo(pl: Placement, local: Vec3, target: Vec3): Placement {
  const R = rotMatrix(pl.rotation);
  const cur = norm(apply3(R, local));
  const Q = rotationBetween(cur, norm(target));
  const R2: Mat3 = mul3(Q, R);
  return { position: pl.position, rotation: eulerXYZ(R2) };
}

/** Řešení jedné vazby: vrátí nové umístění pohyblivé komponenty. */
export function solveOne(mate: Mate, moving: Placement, gA: FaceGeo, worldB: FaceGeo): Placement {
  const nB = norm(worldB.normal);
  switch (mate.type) {
    case "mate":
    case "flush":
    case "distance": {
      const want = mate.type === "flush" ? nB : scale(nB, -1);
      let pl = rotateTo(moving, gA.normal, mate.flip ? scale(want, -1) : want);
      const wA = worldGeo(pl, gA);
      if (mate.center) {
        pl = { ...pl, position: rv(add(pl.position, sub(worldB.origin, wA.origin))) };
      } else {
        const d = dot(sub(worldB.origin, wA.origin), nB) + (mate.type === "distance" ? (mate.value ?? 0) : 0);
        pl = { ...pl, position: rv(add(pl.position, scale(nB, d))) };
      }
      return pl;
    }
    case "concentric": {
      // osa A rovnoběžně s osou B (menší otočení, nebo obráceně při flip), pak bod osy A na osu B
      const R = rotMatrix(moving.rotation);
      const curDir = norm(apply3(R, gA.normal));
      let want = dot(curDir, nB) >= 0 ? nB : scale(nB, -1);
      if (mate.flip) want = scale(want, -1);
      let pl = rotateTo(moving, gA.normal, want);
      const wA = worldGeo(pl, gA);
      const rel = sub(wA.origin, worldB.origin);
      const perp = sub(rel, scale(nB, dot(rel, nB)));
      pl = { ...pl, position: rv(sub(pl.position, perp)) };
      return pl;
    }
    case "parallel": {
      const want = mate.flip ? scale(nB, -1) : nB;
      return rotateTo(moving, gA.normal, want);
    }
    case "angle": {
      const R = rotMatrix(moving.rotation);
      const curDir = norm(apply3(R, gA.normal));
      let axis = cross(nB, curDir);
      if (Math.hypot(...axis) < 1e-9) axis = Math.abs(nB[0]) < 0.9 ? cross(nB, [1, 0, 0]) : cross(nB, [0, 1, 0]);
      axis = norm(axis);
      const ang = (((mate.value ?? 0) * (mate.flip ? -1 : 1)) * Math.PI) / 180;
      // Rodrigues: otočení nB kolem osy o úhel
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      const target: Vec3 = add(add(scale(nB, c), scale(cross(axis, nB), s)), scale(axis, dot(axis, nB) * (1 - c)));
      return rotateTo(moving, gA.normal, target);
    }
    case "fixed":
      return moving;
  }
}

/** Zbytková chyba vazby (0 = splněno). */
export function residual(mate: Mate, wA: FaceGeo, wB: FaceGeo): number {
  const nA = norm(wA.normal);
  const nB = norm(wB.normal);
  const d = sub(wA.origin, wB.origin);
  switch (mate.type) {
    case "mate":
    case "flush":
    case "distance": {
      const sign = (mate.type === "flush" ? 1 : -1) * (mate.flip ? -1 : 1);
      const ang = Math.abs(dot(nA, nB) - sign);
      const gap = Math.abs(dot(d, nB) - (mate.type === "distance" ? (mate.value ?? 0) : 0));
      const ctr = mate.center ? Math.hypot(...d) : 0;
      return ang * 10 + gap + ctr;
    }
    case "concentric": {
      const ang = Math.hypot(...cross(nA, nB));
      const perp = sub(d, scale(nB, dot(d, nB)));
      return ang * 10 + Math.hypot(...perp);
    }
    case "parallel":
      return Math.abs(dot(nA, nB) - (mate.flip ? -1 : 1)) * 10;
    case "angle": {
      const a = (Math.acos(Math.max(-1, Math.min(1, dot(nA, nB)))) * 180) / Math.PI;
      return Math.abs(a - Math.abs(mate.value ?? 0)) / 10;
    }
    case "fixed":
      return 0;
  }
}

export type SolveResult = { components: AsmComponent[]; status: Record<string, MateStatus>; moved: string[] };

/**
 * Sekvenční řešení všech vazeb. `anchorId` = komponenta, kterou uživatel právě přesunul (bere se jako pevná).
 * Pohybuje se `a`; je-li ukotvená (fixed / anchor / první komponenta bez jiné ukotvené), pohybuje se `b`.
 */
export function solveMates(doc: CadDoc, geo: GeoProvider, anchorId?: string | null, passes = 2): SolveResult {
  const comps = (doc.components ?? []).map((c) => ({ ...c }));
  const byId = new Map(comps.map((c) => [c.id, c]));
  const mates = doc.mates ?? [];
  const status: Record<string, MateStatus> = {};
  const moved = new Set<string>();
  // vazba Ukotvit = komponenta se chová jako ukotvená i bez příznaku `fixed`; uplatní se dřív, než se určí implicitní kotva (první komponenta)
  for (const m of mates) {
    if (m.suppressed) status[m.id] = "suppressed";
    else if (m.type === "fixed") {
      const c = byId.get(m.a.compId);
      if (c) c.fixed = true;
      status[m.id] = c ? "ok" : "missing";
    }
  }
  const anyFixed = comps.some((c) => c.fixed);
  const isFixed = (id: string) => {
    const c = byId.get(id);
    if (!c) return true;
    if (id === anchorId) return true;
    if (c.fixed) return true;
    if (!anyFixed && comps[0]?.id === id && anchorId == null) return true;
    return false;
  };
  for (let pass = 0; pass < passes; pass++) {
    for (const m of mates) {
      if (m.suppressed || m.type === "fixed") continue;
      const gA = geo(m.a);
      const gB = geo(m.b);
      const cA = byId.get(m.a.compId);
      const cB = byId.get(m.b.compId);
      if (!gA || !gB || !cA || !cB) {
        status[m.id] = "missing";
        continue;
      }
      let movingRef = m.a;
      let targetRef = m.b;
      let gMov = gA;
      let gTar = gB;
      let swap = false;
      if (isFixed(m.a.compId) && !isFixed(m.b.compId)) {
        movingRef = m.b;
        targetRef = m.a;
        gMov = gB;
        gTar = gA;
        swap = true;
      }
      const mov = byId.get(movingRef.compId)!;
      const tar = byId.get(targetRef.compId)!;
      if (isFixed(mov.id)) {
        // obě ukotvené – jen kontrola
        status[m.id] = residual(m, worldGeo(cA.placement, gA), worldGeo(cB.placement, gB)) < 1e-3 ? "ok" : "conflict";
        continue;
      }
      const wTar = worldGeo(tar.placement, gTar);
      // při prohození rolí (hýbe se B) se vzdálenost dál měří od roviny B k ploše A: u protilehlých ploch znaménko zachová otočení
      // normály, u souhlasně orientovaných (flip) se musí obrátit – jinak by B skončila na opačné straně a vazba hlásila konflikt
      const mm: Mate = swap && m.type === "distance" && m.flip ? { ...m, value: -(m.value ?? 0) } : m;
      const next = solveOne(mm, mov.placement, gMov, wTar);
      if (JSON.stringify(next) !== JSON.stringify(mov.placement)) {
        mov.placement = next;
        moved.add(mov.id);
      }
      status[m.id] = "ok";
    }
  }
  // kontrola zbytků po všech průchodech (konflikty)
  for (const m of mates) {
    if (m.suppressed || m.type === "fixed" || status[m.id] === "missing") continue;
    const gA = geo(m.a);
    const gB = geo(m.b);
    const cA = byId.get(m.a.compId);
    const cB = byId.get(m.b.compId);
    if (!gA || !gB || !cA || !cB) continue;
    if (residual(m, worldGeo(cA.placement, gA), worldGeo(cB.placement, gB)) > 1e-3) status[m.id] = "conflict";
  }
  return { components: comps, status, moved: [...moved] };
}

/** Klíč pro mezipaměť geometrie plochy. */
export const mateRefKey = (ref: MateRef) => `${ref.leaf ?? ref.compId}:${ref.face}`;

/** Vazby, které se týkají dané komponenty. */
export const matesOf = (doc: CadDoc, compId: string) => (doc.mates ?? []).filter((m) => m.a.compId === compId || m.b.compId === compId);

// ---------------- rozpracovaná vazba (panel vazeb): typy, výchozí hodnota, ukotvení ----------------

/** Typ vazby v UI; „center“ = Kontakt se ztotožněním středů ploch. */
export type MateMode = "mate" | "flush" | "center" | "concentric" | "distance" | "angle" | "parallel";
/**
 * Rozpracovaná vazba (stav UI): `a` = plocha pohyblivé komponenty `compId`, `b` = plocha cílové komponenty. U Vzdálenosti / Úhlu
 * se po výběru obou ploch čeká na potvrzení hodnoty (`value` = předvyplněná naměřená, `flip` = orientace, při které díl zůstane, kde je).
 * Režim „dir“ není vazba: jde o výběr plochy v modelu pro směr pole komponenty (`dir` = převzatý směr ve světových souřadnicích).
 */
export type PendingMate = { mode: MateMode | "dir"; compId: string; a?: MateRef; b?: MateRef; value?: number; flip?: boolean; dir?: Vec3 };

/** Druh plochy, kterou vazba potřebuje: Souosost válcovou (nebo kuželovou), ostatní rovinnou. */
export const mateFaceKind = (mode: PendingMate["mode"]): "plane" | "cylinder" => (mode === "concentric" ? "cylinder" : "plane");
/** Vazby s číselnou hodnotou (potvrzuje se až po výběru obou ploch). */
export const mateNeedsValue = (mode: PendingMate["mode"] | MateType): mode is "distance" | "angle" => mode === "distance" || mode === "angle";

/** Rozpracovaná vazba → trvalá vazba (null, dokud nejsou vybrané obě plochy). */
export function mateFromPending(p: PendingMate, id: string): Mate | null {
  if (p.mode === "dir" || !p.a || !p.b) return null;
  const m: Mate = { id, type: p.mode === "center" ? "mate" : p.mode, a: p.a, b: p.b };
  if (p.mode === "center") m.center = true;
  if (mateNeedsValue(p.mode)) m.value = typeof p.value === "number" && Number.isFinite(p.value) ? p.value : 0;
  if (p.flip) m.flip = true;
  return m;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 || 0;

/**
 * Aktuálně naměřená hodnota pro novou vazbu Vzdálenost / Úhel (plochy ve světových souřadnicích). S touto hodnotou (a `flip`)
 * zůstanou komponenty po vytvoření vazby tam, kde jsou: vzdálenost = výška plochy A nad rovinou B podél normály B
 * (míří-li normály souhlasně, vazba se obrátí, aby se díl nepřeklopil), úhel = úhel normál 0–180°.
 */
export function measureMate(type: "distance" | "angle", wA: FaceGeo, wB: FaceGeo): { value: number; flip?: boolean } {
  const nA = norm(wA.normal);
  const nB = norm(wB.normal);
  const c = Math.max(-1, Math.min(1, dot(nA, nB)));
  if (type === "angle") return { value: r4((Math.acos(c) * 180) / Math.PI) };
  const value = r4(dot(sub(wA.origin, wB.origin), nB));
  return c > 0 ? { value, flip: true } : { value };
}

/** Výchozí hodnota rozpracované vazby z aktuální polohy komponent (`geo` = geometrie ploch v souřadnicích komponent); u typů bez hodnoty nic. */
export function measureMateIn(doc: CadDoc, geo: GeoProvider, mode: PendingMate["mode"], a: MateRef, b: MateRef): { value?: number; flip?: boolean } {
  if (!mateNeedsValue(mode)) return {};
  const cA = doc.components?.find((c) => c.id === a.compId);
  const cB = doc.components?.find((c) => c.id === b.compId);
  const gA = geo(a);
  const gB = geo(b);
  if (!cA || !cB || !gA || !gB) return { value: 0 };
  return measureMate(mode, worldGeo(cA.placement, gA), worldGeo(cB.placement, gB));
}

const isFixedMateOf = (m: Mate, compId: string) => m.type === "fixed" && m.a.compId === compId;
/** Má komponenta aktivní (nepotlačenou) vazbu Ukotvit? */
export const hasFixedMate = (doc: CadDoc, compId: string) => (doc.mates ?? []).some((m) => isFixedMateOf(m, compId) && !m.suppressed);
/** Příznak `fixed` komponenty podle jejích vazeb Ukotvit (po přidání / smazání / potlačení takové vazby). */
const syncFixed = (doc: CadDoc, compId: string): CadDoc => {
  const on = hasFixedMate(doc, compId);
  return { ...doc, components: (doc.components ?? []).map((c) => (c.id === compId && !!c.fixed !== on ? { ...c, fixed: on } : c)) };
};

/** Přepne vazbu Ukotvit komponenty: přidá ji (a komponentu ukotví), nebo – má-li ji už – odebere (a komponentu uvolní). */
export function toggleFixedMate(doc: CadDoc, compId: string, id: string): CadDoc {
  const mates = doc.mates ?? [];
  const has = mates.some((m) => isFixedMateOf(m, compId));
  const next: Mate[] = has ? mates.filter((m) => !isFixedMateOf(m, compId)) : [...mates, { id, type: "fixed", a: { compId, face: -1 }, b: { compId, face: -1 } }];
  return syncFixed({ ...doc, mates: next }, compId);
}

/** Uvolní komponentu: zruší příznak ukotvení i její vazby Ukotvit. */
export function releaseComponent(doc: CadDoc, compId: string): CadDoc {
  return { ...doc, mates: (doc.mates ?? []).filter((m) => !isFixedMateOf(m, compId)), components: (doc.components ?? []).map((c) => (c.id === compId ? { ...c, fixed: false } : c)) };
}

/** Smaže vazbu; smazáním vazby Ukotvit se komponenta uvolní. */
export function removeMate(doc: CadDoc, mateId: string): CadDoc {
  const m = (doc.mates ?? []).find((x) => x.id === mateId);
  if (!m) return doc;
  const next = { ...doc, mates: (doc.mates ?? []).filter((x) => x.id !== mateId) };
  return m.type === "fixed" ? syncFixed(next, m.a.compId) : next;
}

/** Úprava existující vazby (hodnota, otočení, potlačení, název); potlačení / zapnutí vazby Ukotvit komponentu uvolní / ukotví. */
export function patchMate(doc: CadDoc, mateId: string, patch: Partial<Pick<Mate, "value" | "flip" | "suppressed" | "name">>): CadDoc {
  const m = (doc.mates ?? []).find((x) => x.id === mateId);
  if (!m) return doc;
  const next = { ...doc, mates: (doc.mates ?? []).map((x) => (x.id === mateId ? { ...x, ...patch } : x)) };
  return m.type === "fixed" && "suppressed" in patch ? syncFixed(next, m.a.compId) : next;
}

// ---------------- seznam ploch komponenty (výběr plochy vazby bez klikání do 3D) ----------------

/** Geometrie plochy dílu z jádra v souřadnicích dílu (tvarově `MateFaceInfo` z asm-kernel); `cone` = kuželová plocha. */
export type PartFace = FaceGeo & { extent?: [number, number]; cone?: boolean };
/** Řádek seznamu ploch ve světových souřadnicích sestavy. U válce `origin` = střed osy v rozsahu plochy, `normal` = směr osy. */
export type FaceRow = { face: number; kind: "plane" | "cylinder"; cone?: boolean; origin: Vec3; normal: Vec3; radius?: number; length?: number; area?: number };

/** Plocha dílu → řádek seznamu podle světového umístění dílu (null u ploch, které vazby neumí – koule, torus, volné plochy). */
export function faceRow(face: number, info: PartFace, world: Placement, area?: number): FaceRow | null {
  if (info.kind === "other") return null;
  const w = worldGeo(world, info);
  if (info.kind === "plane") return { face, kind: "plane", origin: rv(w.origin), normal: rv(w.normal), area };
  const [t0, t1] = info.extent ?? [0, 0];
  return { face, kind: "cylinder", cone: info.cone || undefined, origin: rv(add(w.origin, scale(w.normal, (t0 + t1) / 2))), normal: rv(w.normal), radius: info.radius, length: Math.abs(t1 - t0), area };
}

/** Pořadí v seznamu: rovinné plochy od největší, válcové od největšího průměru (pak délky); shodné podle čísla plochy. */
export function sortFaceRows<T extends FaceRow>(rows: T[]): T[] {
  const size = (r: FaceRow) => (r.kind === "plane" ? (r.area ?? 0) : (r.radius ?? 0) * 1e6 + (r.length ?? 0));
  return [...rows].sort((a, b) => (a.kind === b.kind ? size(b) - size(a) || a.face - b.face : a.kind === "plane" ? -1 : 1));
}

/** Plošný obsah jednotlivých ploch tělesa ze sítě (součet trojúhelníků skupiny plochy) – u rovinných ploch přesný až na polygonizaci okrajů. */
export function faceAreas(mesh: Pick<MeshData, "vertices" | "triangles" | "faceGroups">): number[] {
  const { vertices: v, triangles: t, faceGroups: g } = mesh;
  const out: number[] = [];
  for (let i = 0; i + 2 < g.length; i += 3) {
    const face = g[i + 2];
    if (face < 0) continue;
    const end = Math.min(g[i] + g[i + 1], t.length);
    let s = 0;
    for (let k = g[i]; k + 2 < end; k += 3) {
      const a = t[k] * 3;
      const b = t[k + 1] * 3;
      const c = t[k + 2] * 3;
      s += Math.hypot(...cross([v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]], [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]])) / 2;
    }
    out[face] = (out[face] ?? 0) + s;
  }
  return out;
}

const fmt = (v: number, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d || 0).replace(".", ",");
const fmtPt = (p: Vec3) => `${fmt(p[0])}; ${fmt(p[1])}; ${fmt(p[2])}`;

/** Jednotkový směr bez numerického šumu: zaokrouhlení na 6 míst (0,9999999 → 1; −0 → 0). */
export function snapDir(v: Vec3): Vec3 {
  return norm(v).map((x) => Math.round(x * 1e6) / 1e6 || 0) as Vec3;
}

/** Čitelný směr: hlavní osy „+X“ / „−Z“, jinak složky jednotkového vektoru. */
export function dirLabel(v: Vec3): string {
  const n = snapDir(v);
  const k = n.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-4);
  return k >= 0 ? `${n[k] > 0 ? "+" : "−"}${"XYZ"[k]}` : fmtPt(n);
}

/** Čitelný směr osy (bez orientace): „X“ / „Y“ / „Z“, jinak složky vektoru s kladnou první nenulovou složkou. */
export function axisLabel(v: Vec3): string {
  const n = snapDir(v);
  const k = n.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-4);
  if (k >= 0) return "XYZ"[k];
  const lead = n.find((x) => Math.abs(x) > 1e-6) ?? 1;
  return fmtPt(lead < 0 ? (n.map((x) => -x || 0) as Vec3) : n);
}

/** Popis plochy do seznamu: `title` = číslo, typ a směr normály / osy; `detail` = poloha a velikost. */
export function faceLabel(r: FaceRow): { title: string; detail: string } {
  const no = tr("Plocha {0}", r.face + 1);
  if (r.kind === "plane") {
    return { title: `${no} · ${tr("rovinná")} · ${tr("normála {0}", dirLabel(r.normal))}`, detail: `${tr("střed {0}", fmtPt(r.origin))}${r.area != null ? ` · ${fmt(r.area, 1)} mm²` : ""}` };
  }
  const type = r.cone ? tr("kuželová") : `${tr("válcová")} Ø${fmt((r.radius ?? 0) * 2)}`;
  return { title: `${no} · ${type} · ${tr("osa {0}", axisLabel(r.normal))}`, detail: `${tr("střed osy {0}", fmtPt(r.origin))} · ${tr("délka {0} mm", fmt(r.length ?? 0))}` };
}
