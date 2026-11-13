/**
 * Provedení příkazů sestavy textem (cad/agent-asm.ts): plochy komponent, vazby a jejich správa, komponenty, pole, zrcadlení,
 * šroubový spoj, podsestavy, úprava v kontextu, kusovník, rám formy a záložky dokumentů.
 *
 * Jádro a stav aplikace dodá volající přes `AsmEnv` (stavba dílů, geometrie ploch, záložky) – modul sám je bez prohlížeče,
 * takže ho lze testovat v Node s náhradním jádrem. Geometrie ploch a řešič vazeb jsou stejné jako v panelu sestavy
 * (seznam ploch: `faceRow` / `sortFaceRows`, vazby: `mateFromPending`, `measureMateIn`, `solveMates`).
 */
import {
  apply3,
  boltStack,
  bomCsv,
  composePlacement,
  computeBom,
  dissolveSubassembly,
  eulerXYZ,
  flattenAssembly,
  invertPlacement,
  makeSubassembly,
  mirrorComponent,
  moldBase,
  partComponent,
  patternComponent,
  rotMatrix,
  rotationBetween,
  sourceKey,
  transformPoint,
  type BomRow,
  type FlatComponent,
} from "./assembly";
import {
  bomPartInfo,
  bomText,
  componentLines,
  faceLine,
  faceRefText,
  findComp,
  findMate,
  fmt,
  materialId,
  mateLines,
  mateText,
  pickFace,
  pt,
  resolveTab,
  type AsmCmd,
  type CompFaceRow,
  type TabInfo,
} from "./agent-asm";
import { tr } from "./i18n";
import { MATERIALS } from "@/lib/mesh-metrics";
import {
  MATE_LABEL,
  faceAreas,
  faceRow,
  hasFixedMate,
  mateFromPending,
  mateNeedsValue,
  measureMateIn,
  patchMate,
  releaseComponent,
  removeMate,
  solveMates,
  sortFaceRows,
  toggleFixedMate,
  type GeoProvider,
  type MateMode,
  type MateStatus,
  type PartFace,
} from "./mates";
import { uid, type AsmComponent, type BuildResult, type CadDoc, type ComponentSource, type Mate, type MateRef, type Vec3 } from "./types";

/** Seznam ploch jednoho dílu (souřadnice dílu) – jako seznam ploch v panelu vazby. */
export type PartFaces = { faces: { face: number; info: PartFace; area?: number }[]; truncated: boolean };

/** Jádro a stav aplikace pro příkazy sestavy. */
export type AsmEnv = {
  /** postaví díly v jádře (klíč = `sourceKey`) a vrátí výsledky stavby; potom fungují `mateFace` / `cylFace` */
  parts: (list: { key: string; source: ComponentSource }[]) => Promise<{ key: string; result: BuildResult | null }[]>;
  /** geometrie plochy dílu (souřadnice dílu) */
  mateFace: (key: string, index: number) => Promise<PartFace | null>;
  /** index válcové plochy dílu s daným poloměrem (−1 = není) */
  cylFace: (key: string, radius: number) => Promise<number>;
  /** je válcová plocha ve skutečnosti kuželová? */
  isCone?: (key: string, index: number) => Promise<boolean>;
  /** mezipaměť geometrie ploch `klíč:index` (sdílená s aplikací) */
  geo: Map<string, PartFace>;
  /** mezipaměť seznamů ploch dílů podle klíče */
  faceLists?: Map<string, PartFaces>;
  /** zásobník úprav dílu v kontextu sestavy (jako v aplikaci) – mění ho `sestava upravit` / `sestava hotovo` */
  stack?: { asm: CadDoc; key: string }[];
  /** záložky dokumentů (jen v aplikaci) */
  tabs?: { list: () => TabInfo[]; activate: (id: string) => Promise<CadDoc>; close: (id: string) => Promise<CadDoc> };
};

export type AsmResult = {
  doc: CadDoc;
  log: string[];
  changed: boolean;
  /** stav vazeb po přepočtu (pro seznam vazeb a textový stav) */
  mateStatus?: Record<string, MateStatus>;
  /** `doc` je nový dokument do nové záložky (rám formy, otevřená komponenta) */
  newTab?: boolean;
  /** přepnuto na jinou záložku – `doc` je dokument nově aktivní záložky */
  switched?: boolean;
  /** změnil se zásobník úprav v kontextu (`env.stack`) */
  stackChanged?: boolean;
};

/* ───────────────────────── díly, plochy, řešič ───────────────────────── */

const leafId = (l: FlatComponent) => l.path.join("/");
/** názvy na cestě listu (komponenta nejvyšší úrovně › … › díl) */
function pathNames(doc: CadDoc, path: string[]): string[] {
  const out: string[] = [];
  let comps = doc.components ?? [];
  for (const id of path) {
    const c = comps.find((x) => x.id === id);
    if (!c) break;
    out.push(c.name);
    comps = c.source.kind === "asm" ? (c.source.doc.components ?? []) : [];
  }
  return out;
}

/** postaví díly listů (jednou na klíč) a vrátí výsledky podle klíče */
async function ensureBuilt(env: AsmEnv, leaves: FlatComponent[]): Promise<Map<string, BuildResult | null>> {
  const need = new Map<string, ComponentSource>();
  for (const l of leaves) need.set(l.key, l.comp.source);
  if (!need.size) return new Map();
  const res = await env.parts([...need].map(([key, source]) => ({ key, source })));
  return new Map(res.map((r) => [r.key, r.result]));
}

async function faceInfo(env: AsmEnv, key: string, index: number): Promise<PartFace | null> {
  const k = `${key}:${index}`;
  const hit = env.geo.get(k);
  if (hit) return hit;
  const f = await env.mateFace(key, index).catch(() => null);
  if (f) env.geo.set(k, f);
  return f;
}

/**
 * Táž plocha v upraveném dílu (po přečíslování): rovina se stejnou normálou ve stejné rovině, válec se stejným poloměrem
 * na stejné ose; z více kandidátů nejbližší střed. null = plocha zmizela.
 */
export function sameFace(old: PartFace, faces: PartFaces["faces"], tol = 1e-4): number | null {
  const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]) || 1;
  const nOld: Vec3 = old.normal.map((x) => x / len(old.normal)) as Vec3;
  let best: number | null = null;
  let bestD = Infinity;
  for (const f of faces) {
    const g = f.info;
    if (g.kind !== old.kind) continue;
    const n: Vec3 = g.normal.map((x) => x / len(g.normal)) as Vec3;
    const c = dot3(n, nOld);
    const rel = sub3(g.origin, old.origin);
    if (old.kind === "plane") {
      if (c < 1 - 1e-6 || Math.abs(dot3(rel, nOld)) > tol * 100) continue;
    } else {
      if (Math.abs(c) < 1 - 1e-6 || Math.abs((g.radius ?? 0) - (old.radius ?? 0)) > tol * 100) continue;
      const perp = sub3(rel, nOld.map((x) => x * dot3(rel, nOld)) as Vec3);
      if (Math.hypot(...perp) > tol * 100) continue;
    }
    const dist = Math.hypot(...rel);
    if (dist < bestD) {
      bestD = dist;
      best = f.face;
    }
  }
  return best;
}

/** nejvýš tolik ploch jednoho dílu se načte (jako seznam ploch v panelu) */
const FACE_LIMIT = 400;

/** Plochy dílu použitelné pro vazby (rovinné, válcové, kuželové) v souřadnicích dílu. */
export async function partFaces(env: AsmEnv, key: string, result: BuildResult | null | undefined): Promise<PartFaces> {
  const hit = env.faceLists?.get(key);
  if (hit) return hit;
  const total = result?.metrics?.faces ?? 0;
  const n = Math.min(total, FACE_LIMIT);
  const areas = result?.mesh ? faceAreas(result.mesh) : [];
  const faces: PartFaces["faces"] = [];
  for (let start = 0; start < n; start += 25) {
    const idx = Array.from({ length: Math.min(25, n - start) }, (_, k) => start + k);
    const infos = await Promise.all(idx.map((i) => faceInfo(env, key, i)));
    const cones = await Promise.all(infos.map((f, k) => (f?.kind === "cylinder" && env.isCone ? env.isCone(key, idx[k]).catch(() => false) : Promise.resolve(false))));
    infos.forEach((f, k) => {
      if (f && f.kind !== "other") faces.push({ face: idx[k], info: { ...f, cone: cones[k] || undefined }, area: areas[idx[k]] });
    });
  }
  const out = { faces, truncated: total > n };
  if (result?.metrics) env.faceLists?.set(key, out);
  return out;
}

/** Plochy komponenty nejvyšší úrovně (u podsestavy plochy všech jejích dílů) ve světových souřadnicích sestavy. */
export async function compFaces(doc: CadDoc, compId: string, env: AsmEnv): Promise<{ rows: CompFaceRow[]; truncated: boolean; failed: string[] }> {
  const leaves = flattenAssembly(doc).filter((l) => l.path[0] === compId);
  const built = await ensureBuilt(env, leaves);
  const rows: CompFaceRow[] = [];
  let truncated = false;
  const failed: string[] = [];
  for (const l of leaves) {
    const r = built.get(l.key);
    if (!r?.metrics) failed.push(pathNames(doc, l.path).join(" › "));
    const pf = await partFaces(env, l.key, r);
    truncated ||= pf.truncated;
    const part = l.path.length > 1 ? pathNames(doc, l.path).slice(1).join(" › ") : undefined;
    for (const f of pf.faces) {
      const row = faceRow(f.face, f.info, l.placement, f.area);
      if (row) rows.push({ ...row, leafId: leafId(l), ...(part ? { part } : {}) });
    }
  }
  return { rows, truncated, failed };
}

/** Geometrie ploch vazeb v souřadnicích komponenty nejvyšší úrovně (nezávislá na jejím umístění) – jako `geoProvider` v aplikaci. */
export function geoProvider(doc: CadDoc, env: AsmEnv): GeoProvider {
  const leaves = new Map(flattenAssembly(doc).map((l) => [leafId(l), l]));
  return (ref) => {
    const l = leaves.get(ref.leaf ?? ref.compId);
    if (!l || ref.face < 0) return null;
    const info = env.geo.get(`${l.key}:${ref.face}`);
    if (!info || info.kind === "other") return null;
    const top = doc.components?.find((c) => c.id === ref.compId);
    if (!top) return null;
    const rel = composePlacement(invertPlacement(top.placement), l.placement);
    return { kind: info.kind, origin: transformPoint(rel, info.origin), normal: apply3(rotMatrix(rel.rotation), info.normal), radius: info.radius };
  };
}

/**
 * Přepočet vazeb (jako „Přepočítat vazby“): doplní geometrii ploch (a indexy válcových ploch normálií podle poloměru),
 * vyřeší vazby a vrátí sestavu s novými polohami pohnutých komponent. `anchorId` = komponenta, kterou uživatel právě přesunul.
 */
export async function solveAsm(doc: CadDoc, env: AsmEnv, anchorId?: string | null): Promise<{ doc: CadDoc; status: Record<string, MateStatus>; moved: string[] }> {
  if (doc.kind !== "assembly" || !doc.mates?.length) return { doc, status: {}, moved: [] };
  const flat = flattenAssembly(doc);
  const byLeaf = new Map(flat.map((l) => [leafId(l), l]));
  const mates = doc.mates.map((m) => ({ ...m, a: { ...m.a }, b: { ...m.b } }));
  const used = new Map<string, FlatComponent>();
  for (const m of mates) for (const r of [m.a, m.b]) {
    const l = byLeaf.get(r.leaf ?? r.compId);
    if (l) used.set(leafId(l), l);
  }
  await ensureBuilt(env, [...used.values()]);
  for (const m of mates)
    for (const ref of [m.a, m.b]) {
      const l = byLeaf.get(ref.leaf ?? ref.compId);
      if (!l) continue;
      if (ref.face < 0 && ref.radius) {
        const idx = await env.cylFace(l.key, ref.radius).catch(() => -1);
        if (idx >= 0) ref.face = idx;
      }
      if (ref.face >= 0) await faceInfo(env, l.key, ref.face);
    }
  const withMates = { ...doc, mates };
  const r = solveMates(withMates, geoProvider(withMates, env), anchorId);
  const byId = new Map(r.components.map((c) => [c.id, c.placement]));
  return { doc: { ...withMates, components: (doc.components ?? []).map((c) => (r.moved.includes(c.id) && byId.has(c.id) ? { ...c, placement: byId.get(c.id)! } : c)) }, status: r.status, moved: r.moved };
}

/* ───────────────────────── provedení ───────────────────────── */

const STATUS_WORD = (s?: MateStatus) => (s === "ok" ? "ok" : s === "conflict" ? tr("konflikt") : s === "missing" ? tr("chybí plocha") : s === "suppressed" ? tr("potlačeno") : "?");
const posText = (c: AsmComponent) => `${tr("poloha {0}", pt(c.placement.position))}${c.placement.rotation.some((x) => Math.abs(x) > 1e-9) ? ` · ${tr("natočení {0}", pt(c.placement.rotation))}` : ""}`;
/** „„Čep“ poloha […] · „Deska“ …“ pro pohnuté komponenty */
const movedText = (doc: CadDoc, ids: string[]) =>
  ids
    .map((id) => doc.components?.find((c) => c.id === id))
    .filter((c): c is AsmComponent => !!c)
    .map((c) => `„${c.name}“ ${posText(c)}`)
    .join(" · ");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Provede příkaz sestavy nad dokumentem `d` (kopie – nemění se); vrátí nový dokument, protokol a stav vazeb. */
export async function applyAsmCmd(d: CadDoc, cmd: AsmCmd, env: AsmEnv): Promise<AsmResult> {
  const log: string[] = [];
  const done = (doc: CadDoc, changed: boolean, extra: Partial<AsmResult> = {}): AsmResult => ({ doc, log, changed, ...extra });
  const asmOnly = () => {
    if (d.kind !== "assembly") throw new Error(tr("otevřený dokument „{0}“ není sestava – nejdřív „nová sestava“, „záložka \"…\"“ nebo „sestava hotovo“ (při úpravě dílu v kontextu)", d.name));
  };
  const resolve = (doc: CadDoc, anchorId?: string | null) => solveAsm(doc, env, anchorId);
  switch (cmd.k) {
    case "list": {
      asmOnly();
      const s = d.mates?.length ? await resolve(d) : null;
      log.push(...componentLines(d, s?.status));
      return done(d, false, s ? { mateStatus: s.status } : {});
    }
    case "faces": {
      asmOnly();
      const c = findComp(d, cmd.comp);
      const f = await compFaces(d, c.id, env);
      const rows = sortFaceRows(f.rows.filter((r) => !cmd.kind || r.kind === cmd.kind));
      const planes = f.rows.filter((r) => r.kind === "plane").length;
      log.push(tr("Plochy komponenty „{0}“ (souřadnice sestavy, {1}) – rovinné: {2}, válcové/kuželové: {3}{4}", c.name, posText(c), planes, f.rows.length - planes, cmd.kind ? tr(" – vypsány {0}", cmd.kind === "plane" ? tr("rovinné") : tr("válcové")) : ""));
      const MAX = 200;
      for (const r of rows.slice(0, MAX)) log.push(` ${faceLine(r)}`);
      if (rows.length > MAX) log.push(tr(" … dalších {0} – upřesněte: sestava plochy \"{1}\" rovinné|válcové", rows.length - MAX, c.name));
      if (f.truncated) log.push(tr(" (načteno prvních {0} ploch dílu)", FACE_LIMIT));
      if (f.failed.length) log.push(tr("⚠ díl se nepostavil (bez ploch): {0}", f.failed.join(", ")));
      if (!rows.length) log.push(tr(" (žádná plocha, kterou by vazby uměly použít)"));
      return done(d, false);
    }
    case "mate": {
      asmOnly();
      const A = findComp(d, cmd.a);
      if (cmd.kind === "fixed") {
        if (hasFixedMate(d, A.id)) {
          log.push(tr("✓ „{0}“ už má vazbu Ukotvit – beze změny", A.name));
          return done(d, false);
        }
        const s = await resolve(toggleFixedMate(d, A.id, uid()));
        log.push(tr("✓ vazba Ukotvit „{0}“ – komponenta je ukotvená, ostatní vazby hýbou druhou komponentou", A.name));
        return done(s.doc, true, { mateStatus: s.status });
      }
      const B = findComp(d, cmd.b!);
      if (A.id === B.id) throw new Error(tr("vazba potřebuje dvě různé komponenty – „{0}“ je A i B", A.name));
      const need = cmd.kind === "concentric" ? "cylinder" : "plane";
      const fa = pickFace(cmd.faceA, (await compFaces(d, A.id, env)).rows, need, A.name, "A: ");
      const fb = pickFace(cmd.faceB, (await compFaces(d, B.id, env)).rows, need, B.name, "B: ");
      const ref = (c: AsmComponent, r: CompFaceRow): MateRef => ({ compId: c.id, ...(r.leafId !== c.id ? { leaf: r.leafId } : {}), face: r.face });
      const a = ref(A, fa.row);
      const b = ref(B, fb.row);
      const mode: MateMode = cmd.kind as MateMode;
      let value: number | undefined;
      let flip = cmd.flip;
      if (mateNeedsValue(mode)) {
        // bez hodnoty = naměřená (komponenty zůstanou, kde jsou), jako předvyplněné pole v panelu; orientace podle naměření
        const meas = measureMateIn(d, geoProvider(d, env), mode, a, b);
        value = cmd.value ?? meas.value ?? 0;
        flip = !!meas.flip !== cmd.flip;
      }
      const m = mateFromPending({ mode, compId: A.id, a, b, value, flip }, uid())!;
      if (cmd.name) m.name = cmd.name;
      const s = await resolve({ ...d, mates: [...(d.mates ?? []), m] });
      const st = s.status[m.id];
      const picks = [fa.note, fb.note].filter(Boolean);
      log.push(
        tr("{0} vazba {1}: {2}{3} · {4}", st === "ok" ? "✓" : "⚠", mateText(s.doc, s.doc.mates!.find((x) => x.id === m.id)!), STATUS_WORD(st), picks.length ? tr(" (vybrána {0})", picks.join("; ")) : "", s.moved.length ? movedText(s.doc, s.moved) : tr("poloha beze změny")),
      );
      if (st === "conflict") log.push(tr("⚠ vazbu nelze splnit spolu s ostatními – sestava vazby (výpis), sestava vazba {0} potlačit|smazat|obráceně", s.doc.mates!.length));
      if (st === "missing") log.push(tr("⚠ plochu vazby se nepodařilo načíst z jádra – sestava vazby po dostavění dílů vazbu přepočítá"));
      return done(s.doc, true, { mateStatus: s.status });
    }
    case "mates": {
      asmOnly();
      const s = d.mates?.length ? await resolve(d) : null;
      log.push(...mateLines(d, s?.status));
      return done(d, false, s ? { mateStatus: s.status } : {});
    }
    case "mateEdit": {
      asmOnly();
      const m = findMate(d, cmd.ref);
      const no = (d.mates ?? []).indexOf(m) + 1;
      let next: CadDoc;
      const what: string[] = [];
      if (cmd.del) {
        next = removeMate(d, m.id);
        what.push(tr("smazána"));
      } else {
        const patch: Partial<Pick<Mate, "value" | "flip" | "suppressed" | "name">> = {};
        if (cmd.value !== undefined) {
          if (!mateNeedsValue(m.type)) throw new Error(tr("vazba {0} ({1}) nemá hodnotu – hodnotu má jen Vzdálenost a Úhel", no, tr(MATE_LABEL[m.type])));
          patch.value = cmd.value;
          what.push(tr("hodnota {0}", `${fmt(cmd.value)}${m.type === "angle" ? "°" : " mm"}`));
        }
        if (cmd.flip) {
          if (m.type === "fixed") throw new Error(tr("vazbu Ukotvit nelze otočit"));
          patch.flip = !m.flip;
          what.push(patch.flip ? tr("obráceně") : tr("původní orientace"));
        }
        if (cmd.suppress !== undefined) {
          patch.suppressed = cmd.suppress;
          what.push(cmd.suppress ? tr("potlačena") : tr("zapnuta"));
        }
        if (cmd.name !== undefined) {
          patch.name = cmd.name;
          what.push(tr("název „{0}“", cmd.name));
        }
        next = patchMate(d, m.id, patch);
      }
      const s = await resolve(next);
      const after = s.doc.mates?.find((x) => x.id === m.id);
      log.push(tr("✓ vazba {0} ({1}): {2}{3}", no, after ? mateText(s.doc, after) : tr(MATE_LABEL[m.type]), what.join(", "), after ? ` · ${STATUS_WORD(s.status[m.id])}` : ""));
      if (s.moved.length) log.push(tr("  pohnuto: {0}", movedText(s.doc, s.moved)));
      if (Object.values(s.status).some((x) => x === "conflict")) log.push(tr("⚠ v sestavě je konflikt vazeb – sestava vazby"));
      return done(s.doc, true, { mateStatus: s.status });
    }
    case "comp": {
      asmOnly();
      const c0 = findComp(d, cmd.comp);
      const p = cmd.patch;
      if (!Object.keys(p).length) {
        const i = (d.components ?? []).indexOf(c0);
        log.push(componentLines(d).slice(1)[i].trim());
        return done(d, false);
      }
      let doc = d;
      if (p.fixed === false) doc = releaseComponent(doc, c0.id); // uvolnit zruší i vazbu Ukotvit (jinak by komponentu dál držel řešič)
      let c: AsmComponent = { ...doc.components!.find((x) => x.id === c0.id)!, placement: { position: [...c0.placement.position] as Vec3, rotation: [...c0.placement.rotation] as Vec3 } };
      const what: string[] = [];
      const moved = !!(p.at || p.move || p.rotation || p.turn);
      if (p.at) c.placement.position = [...p.at] as Vec3;
      if (p.move) c.placement.position = c.placement.position.map((v, k) => Math.round((v + p.move![k]) * 1e6) / 1e6) as Vec3;
      if (p.rotation) c.placement.rotation = [...p.rotation] as Vec3;
      if (p.turn) c.placement.rotation[p.turn.axis] = (c.placement.rotation[p.turn.axis] + p.turn.deg) % 360; // jako tlačítka +90° v panelu
      if (moved) what.push(posText(c));
      if (p.fixed === true) {
        c.fixed = true;
        what.push(tr("ukotvená"));
      } else if (p.fixed === false) what.push(tr("uvolněná"));
      if (p.hidden !== undefined) {
        c.hidden = p.hidden || undefined;
        what.push(p.hidden ? tr("skrytá") : tr("zobrazená"));
      }
      if (p.color) {
        c.color = p.color;
        what.push(tr("barva {0}", p.color));
      }
      if (p.name !== undefined) {
        if (!p.name) throw new Error(tr("název komponenty nesmí být prázdný"));
        c.name = p.name;
        what.push(tr("název „{0}“", p.name));
      }
      if (p.number !== undefined) {
        c.number = p.number || undefined;
        what.push(tr("číslo „{0}“", p.number));
      }
      if (p.group !== undefined) {
        c.group = p.group || undefined;
        what.push(tr("skupina „{0}“", p.group));
      }
      if (p.material !== undefined) {
        const id = materialId(p.material);
        if (c.source.kind === "asm") throw new Error(tr("materiál podsestavy nelze nastavit – nastavte ho jejím dílům (sestava upravit \"{0}\")", c.name));
        if (c.source.kind === "file") {
          if (!id) throw new Error(tr("materiál importované komponenty: jen třída hustoty – {0}", MATERIALS.map((m) => m.id).join(", ")));
          c.material = id;
        } else {
          const sd = { ...c.source.doc };
          // známá třída = hustota (a kusovník ukáže třídu); jiný text = označení do razítka a kusovníku, hustota zůstává
          if (id) {
            sd.material = id;
            delete sd.materialName;
          } else sd.materialName = p.material;
          c = { ...c, source: { kind: "part", doc: sd } };
        }
        what.push(tr("materiál {0}", id ? (MATERIALS.find((m) => m.id === id)?.label ?? id) : `„${p.material}“`));
      }
      doc = { ...doc, components: (doc.components ?? []).map((x) => (x.id === c.id ? c : x)) };
      let st: Record<string, MateStatus> | undefined;
      let movedOthers: string[] = [];
      if (moved && doc.mates?.length) {
        // jako v panelu: přesunutá komponenta je pro řešič pevná, vazby dorovnají ostatní
        const s = await resolve(doc, c.id);
        doc = s.doc;
        st = s.status;
        movedOthers = s.moved.filter((id) => id !== c.id);
      }
      log.push(tr("✓ komponenta „{0}“: {1}", c0.name, what.join(" · ")));
      if (movedOthers.length) log.push(tr("  vazby pohnuly: {0}", movedText(doc, movedOthers)));
      if (st && Object.values(st).some((x) => x === "conflict")) log.push(tr("⚠ v sestavě je konflikt vazeb – sestava vazby"));
      return done(doc, true, st ? { mateStatus: st } : {});
    }
    case "remove": {
      asmOnly();
      let doc = d;
      const names: string[] = [];
      let lost = 0;
      for (const ref of cmd.comps) {
        const c = findComp(doc, ref);
        const before = doc.mates?.length ?? 0;
        doc = { ...doc, components: (doc.components ?? []).filter((x) => x.id !== c.id), mates: (doc.mates ?? []).filter((m) => m.a.compId !== c.id && m.b.compId !== c.id) };
        lost += before - (doc.mates?.length ?? 0);
        names.push(`„${c.name}“`);
      }
      log.push(tr("✓ odebráno ze sestavy: {0}{1} · zbývá komponent: {2}", names.join(", "), lost ? tr(" (a jejich vazby: {0})", lost) : "", doc.components?.length ?? 0));
      return done(doc, true);
    }
    case "duplicate": {
      asmOnly();
      const c = findComp(d, cmd.comp);
      // stejný název jako v panelu (Duplikovat) – v kusovníku se kopie sečtou; textem ji lze zadat pořadím #N
      const copy: AsmComponent = { ...clone(c), id: uid(), placement: { ...c.placement, position: c.placement.position.map((v, k) => Math.round((v + cmd.offset[k]) * 1e6) / 1e6) as Vec3 } };
      log.push(tr("✓ kopie „{0}“ → #{1} {2}", c.name, (d.components?.length ?? 0) + 1, posText(copy)));
      return done({ ...d, components: [...(d.components ?? []), copy] }, true);
    }
    case "isolate": {
      asmOnly();
      const c = findComp(d, cmd.comp);
      log.push(tr("✓ izolováno: zobrazena jen „{0}“ (ostatní skryté – sestava zobrazit vše)", c.name));
      return done({ ...d, components: (d.components ?? []).map((x) => ({ ...x, hidden: x.id !== c.id || undefined })) }, true);
    }
    case "showAll": {
      asmOnly();
      log.push(tr("✓ zobrazeny všechny komponenty ({0})", d.components?.length ?? 0));
      return done({ ...d, components: (d.components ?? []).map((x) => ({ ...x, hidden: undefined })) }, true);
    }
    case "pattern": {
      asmOnly();
      const c = findComp(d, cmd.comp);
      const doc = patternComponent(d, c.id, cmd.pattern);
      const i = (doc.components ?? []).findIndex((x) => x.id === c.id);
      const copies = (doc.components ?? []).slice(i + 1, i + cmd.pattern.count);
      const p = cmd.pattern;
      log.push(tr("✓ pole „{0}“: {1} ks ({2}) – kopie {3}", c.name, p.count, p.kind === "linear" ? tr("lineární, rozteč {0} mm, směr {1}", fmt(p.spacing), pt(p.direction, 3)) : tr("kruhové, úhel {0}°, osa {1}, střed {2}", fmt(p.angle), Array.isArray(p.axis) ? pt(p.axis, 3) : p.axis, pt(p.center)), copies.map((x) => `„${x.name}“ ${pt(x.placement.position)}`).join(", ")));
      return done(doc, true);
    }
    case "mirror": {
      asmOnly();
      const c = findComp(d, cmd.comp);
      const doc = mirrorComponent(d, c.id, cmd.plane, cmd.offset);
      const copy = doc.components![(doc.components ?? []).findIndex((x) => x.id === c.id) + 1];
      log.push(tr("✓ zrcadlení „{0}“ podle {1}{2} → „{3}“ {4} (zrcadlí se poloha a natočení, geometrie dílu se nezrcadlí)", c.name, cmd.plane, cmd.offset ? ` +${fmt(cmd.offset)}` : "", copy.name, posText(copy)));
      return done(doc, true);
    }
    case "bolt":
      return bolt(d, cmd, env, log, asmOnly);
    case "sub": {
      asmOnly();
      const ids = [...new Set(cmd.comps.map((r) => findComp(d, r).id))];
      const name = cmd.name ?? tr("Podsestava {0}", (d.components ?? []).filter((x) => x.source.kind === "asm").length + 1);
      const picked = new Set(ids);
      const wasFixed = (d.components ?? []).some((c) => picked.has(c.id) && c.fixed) || (d.mates ?? []).some((m) => m.type === "fixed" && picked.has(m.a.compId) && !m.suppressed);
      const made = makeSubassembly(d, ids, name);
      const subId = made.id;
      // vazby: obě plochy v podsestavě → do podsestavy (tuhá), jedna → odkaz přes cestu listu, Ukotvit → ukotví celou podsestavu
      const remap = (r: MateRef): MateRef => (picked.has(r.compId) ? { ...r, compId: subId, leaf: `${subId}/${r.leaf ?? r.compId}` } : r);
      const inner: Mate[] = [];
      const outer: Mate[] = [];
      for (const m of d.mates ?? []) {
        const inA = picked.has(m.a.compId);
        const inB = picked.has(m.b.compId);
        if (m.type === "fixed") {
          if (!inA) outer.push(m);
        } else if (inA && inB) inner.push(m);
        else outer.push(inA || inB ? { ...m, a: remap(m.a), b: remap(m.b) } : m);
      }
      const comps = (made.doc.components ?? []).map((c) => (c.id === subId && c.source.kind === "asm" ? { ...c, ...(wasFixed ? { fixed: true } : {}), source: { kind: "asm" as const, doc: { ...c.source.doc, mates: inner } } } : c));
      const doc = { ...made.doc, components: comps, mates: outer };
      const s = await resolve(doc);
      log.push(tr("✓ podsestava „{0}“: {1}{2}{3}", name, ids.map((id) => `„${d.components!.find((c) => c.id === id)!.name}“`).join(", "), inner.length ? tr(" · vazby uvnitř: {0}", inner.length) : "", wasFixed ? tr(" · ukotvená") : ""));
      return done(s.doc, true, s.doc.mates?.length ? { mateStatus: s.status } : {});
    }
    case "dissolve": {
      asmOnly();
      const P = findComp(d, cmd.comp);
      if (P.source.kind !== "asm") throw new Error(tr("„{0}“ není podsestava – rozpustit lze jen podsestavu", P.name));
      const innerComps = P.source.doc.components ?? [];
      const i = (d.components ?? []).indexOf(P);
      const next = dissolveSubassembly(d, P.id);
      const kids = (next.components ?? []).slice(i, i + innerComps.length);
      const idMap = new Map(innerComps.map((c, k) => [c.id, kids[k]?.id ?? c.id]));
      const fixed = !!P.fixed || hasFixedMate(d, P.id);
      /** cesta listu uvnitř podsestavy („dítě/…“) → odkaz v sestavě o úroveň výš */
      const lift = (r: MateRef, path: string): MateRef => {
        const [first, ...rest] = path.split("/");
        const id = idMap.get(first) ?? first;
        const out: MateRef = { ...r, compId: id };
        if (rest.length) out.leaf = [id, ...rest].join("/");
        else delete out.leaf;
        return out;
      };
      const mates: Mate[] = [];
      let dropped = 0;
      for (const m of d.mates ?? []) {
        if (m.type === "fixed" && m.a.compId === P.id) continue;
        const fix = (r: MateRef): MateRef | null => (r.compId !== P.id ? r : r.leaf?.startsWith(`${P.id}/`) ? lift(r, r.leaf.slice(P.id.length + 1)) : null);
        const a = fix(m.a);
        const b = fix(m.b);
        if (!a || !b) dropped++;
        else mates.push({ ...m, a, b });
      }
      for (const m of P.source.doc.mates ?? []) mates.push({ ...m, a: lift(m.a, m.a.leaf ?? m.a.compId), b: lift(m.b, m.b.leaf ?? m.b.compId) });
      const doc = { ...next, mates, components: (next.components ?? []).map((c) => (fixed && kids.includes(c) ? { ...c, fixed: true } : c)) };
      const s = await resolve(doc);
      log.push(tr("✓ podsestava „{0}“ rozpuštěna – o úroveň výš: {1}{2}", P.name, kids.map((c) => `„${c.name}“`).join(", "), dropped ? tr(" · vazby, které nešlo převést (odebrány): {0}", dropped) : ""));
      return done(s.doc, true, s.doc.mates?.length ? { mateStatus: s.status } : {});
    }
    case "edit": {
      asmOnly();
      if (!env.stack) throw new Error(tr("úprava v kontextu je dostupná jen v aplikaci"));
      const c = findComp(d, cmd.comp);
      if (c.source.kind === "file") throw new Error(tr("„{0}“ je importovaný soubor – otevřete ho jako díl: sestava otevřít \"{0}\" (přesné těleso v nové záložce)", c.name));
      const key = sourceKey(c.source);
      const n = (d.components ?? []).filter((x) => x.source.kind !== "file" && sourceKey(x.source) === key).length;
      env.stack.push({ asm: d, key });
      const doc: CadDoc = c.source.kind === "asm" ? { ...clone(c.source.doc), kind: "assembly" } : { ...clone(c.source.doc), kind: "part" };
      log.push(tr("✓ úprava {0} „{1}“ v kontextu sestavy „{2}“{3} – další příkazy pracují s ním; návrat: sestava hotovo", c.source.kind === "asm" ? tr("podsestavy") : tr("dílu"), c.name, d.name, n > 1 ? tr(" (změna platí pro všechny stejné komponenty: {0})", n) : ""));
      return done(doc, true, { stackChanged: true });
    }
    case "done": {
      const top = env.stack?.[env.stack.length - 1];
      if (!top || !env.stack) throw new Error(tr("sestava hotovo: žádná rozpracovaná úprava dílu v kontextu – začněte příkazem sestava upravit \"…\""));
      env.stack.pop();
      const sub = d.kind === "assembly";
      const src: ComponentSource = sub ? { kind: "asm", doc: { ...d } } : { kind: "part", doc: { ...d, kind: "part" } };
      let n = 0;
      const comps = (top.asm.components ?? []).map((c) => {
        if (c.source.kind === "file" || sourceKey(c.source) !== top.key) return c;
        n++;
        return { ...c, source: src };
      });
      // upravený díl: stavba (objem, chyby prvků) a převod čísel ploch vazeb podle geometrie (úprava může plochy přečíslovat)
      const newKey = sourceKey(src);
      const res = (await env.parts([{ key: newKey, source: src }]))[0]?.result ?? null;
      const oldLeaves = new Map(flattenAssembly(top.asm).map((l) => [leafId(l), l.key]));
      const mates = (top.asm.mates ?? []).map((m) => ({ ...m, a: { ...m.a }, b: { ...m.b } }));
      let renumbered = 0;
      let lost = 0;
      if (!sub && mates.length) {
        const fresh = await partFaces(env, newKey, res);
        for (const m of mates)
          for (const ref of [m.a, m.b]) {
            if (ref.face < 0 || oldLeaves.get(ref.leaf ?? ref.compId) !== top.key) continue;
            const old = await faceInfo(env, top.key, ref.face);
            const hit = old ? sameFace(old, fresh.faces) : null;
            if (hit == null) lost++;
            else if (hit !== ref.face) {
              ref.face = hit;
              renumbered++;
            }
          }
      }
      const s = await resolve({ ...top.asm, components: comps, mates });
      const failed = (res?.status ?? []).filter((x) => x.ok === false);
      log.push(
        tr("✓ „{0}“ vrácen do sestavy „{1}“ (změnu převzalo komponent: {2}){3}{4}", d.name, top.asm.name, n, res?.metrics ? tr(" · objem dílu {0} cm³", fmt(res.metrics.volume / 1000, 2)) : "", s.doc.mates?.length ? tr(" · vazby {0}", Object.values(s.status).filter((x) => x === "ok").length + "/" + s.doc.mates.length + " ok") : ""),
      );
      for (const f of failed) log.push(tr("✗ prvek dílu {0}: {1}", (d.features.find((x) => x.id === f.id)?.name ?? f.id), f.error ?? "?"));
      if (renumbered) log.push(tr("  plochy vazeb přečíslovány podle geometrie: {0}", renumbered));
      if (lost) log.push(tr("⚠ plochy vazeb, které po úpravě dílu nejde najít: {0} – sestava vazby", lost));
      if (s.moved.length) log.push(tr("  vazby pohnuly: {0}", movedText(s.doc, s.moved)));
      return done(s.doc, true, { stackChanged: true, ...(s.doc.mates?.length ? { mateStatus: s.status } : {}) });
    }
    case "open": {
      asmOnly();
      const c = findComp(d, cmd.comp);
      const s = c.source;
      const doc: CadDoc =
        s.kind === "file"
          ? { app: "mnastrojarna-cad", version: 2, name: c.name, material: c.material ?? "ocel", kind: "part", color: c.color, features: [{ id: uid(), name: `Import ${s.fileName}`, type: "import", fileName: s.fileName, format: s.format, data: s.data }] }
          : s.kind === "asm"
            ? { ...clone(s.doc), kind: "assembly" }
            : { ...clone(s.doc), kind: "part" };
      log.push(s.kind === "file" ? tr("✓ komponenta „{0}“ otevřena jako díl v nové záložce (přesné těleso k modelování)", c.name) : tr("✓ komponenta „{0}“ otevřena v nové záložce jako kopie – změny se do sestavy nepropíší (úprava v sestavě: sestava upravit \"{0}\")", c.name));
      return done(doc, true, { newTab: true });
    }
    case "bom": {
      asmOnly();
      const b = await bomData(d, env, cmd.structured);
      log.push(b.text);
      if (cmd.csv) log.push(tr("CSV (oddělovač ;):"), b.csv.replace(/^﻿/, "").trimEnd());
      return done(d, false);
    }
    case "moldbase": {
      const p = cmd.params;
      const doc = moldBase(p, cmd.name ?? tr("Rám formy {0}×{1}", p.width, p.length));
      const height = 2 * p.clamp + p.spacer + p.support + p.aPlate + p.bPlate + 10;
      log.push(tr("✓ rám formy „{0}“ – nová záložka: komponent {1}, {2}×{3} mm, výška {4} mm (se středicím kroužkem), dutina {5}, materiál {6}", doc.name, doc.components?.length ?? 0, p.width, p.length, height, p.cavity ? `${p.cavity.w}×${p.cavity.l}×${p.cavity.depth}` : tr("ne"), MATERIALS.find((m) => m.id === p.material)?.label ?? p.material));
      return done(doc, true, { newTab: true });
    }
    case "tabs": {
      const t = needTabs(env);
      const list = t.list();
      log.push(tr("Záložky ({0}):", list.length));
      list.forEach((x, i) => log.push(` ${i + 1}. ${x.title} · ${tabKind(x.kind)}${x.active ? tr(" · aktivní") : ""}`));
      return done(d, false);
    }
    case "tab": {
      const t = needTabs(env);
      const hit = resolveTab(t.list(), cmd.target);
      if (hit.active) {
        log.push(tr("✓ záložka „{0}“ už je aktivní", hit.title));
        return done(d, false);
      }
      const doc = await t.activate(hit.id);
      log.push(tr("✓ záložka „{0}“ ({1}) je aktivní – další příkazy pracují s ní", hit.title, tabKind(hit.kind)));
      return done(doc, false, { switched: true });
    }
    case "closeTab": {
      const t = needTabs(env);
      const list = t.list();
      const hit = cmd.target === undefined ? list.find((x) => x.active) : resolveTab(list, cmd.target);
      if (!hit) throw new Error(tr("není aktivní záložka"));
      const doc = await t.close(hit.id);
      const now = t.list().find((x) => x.active);
      log.push(tr("✓ záložka „{0}“ zavřena – aktivní je „{1}“", hit.title, now?.title ?? doc.name));
      return done(doc, false, { switched: true });
    }
  }
}

const tabKind = (k: TabInfo["kind"]) => (k === "assembly" ? tr("sestava") : k === "drawing" ? tr("výkres") : tr("díl"));
function needTabs(env: AsmEnv) {
  if (!env.tabs) throw new Error(tr("záložky jsou dostupné jen v aplikaci"));
  return env.tabs;
}

/** Kusovník sestavy (plochý / strukturovaný) – řádky, textová tabulka a CSV jako „Export CSV (Excel)“. */
export async function bomData(d: CadDoc, env: AsmEnv, structured: boolean): Promise<{ rows: BomRow[]; text: string; csv: string }> {
  const built = await ensureBuilt(env, flattenAssembly(d));
  const rows = computeBom(d, (c) => bomPartInfo(c, built.get(sourceKey(c.source))), { structured });
  return { rows, text: bomText(rows, d.name, structured), csv: bomCsv(rows) };
}

/** Šroubový spoj do válcové plochy díry: šroub ISO 4762 + podložka ISO 7089 (+ matice ISO 4032), vazba Souosost – jako v panelu. */
async function bolt(d: CadDoc, cmd: Extract<AsmCmd, { k: "bolt" }>, env: AsmEnv, log: string[], asmOnly: () => void): Promise<AsmResult> {
  asmOnly();
  const C = findComp(d, cmd.comp);
  const { rows } = await compFaces(d, C.id, env);
  const { row, note } = pickFace(cmd.face, rows, "cylinder", C.name, tr("díra: "));
  const leaf = flattenAssembly(d).find((l) => leafId(l) === row.leafId)!;
  const info = env.geo.get(`${leaf.key}:${row.face}`);
  if (!info || info.kind !== "cylinder" || !info.extent || !info.radius) throw new Error(tr("plocha {0} není válcová plocha díry", faceRefText(row)));
  const wp = leaf.placement;
  const n0 = apply3(rotMatrix(wp.rotation), info.normal);
  const l0 = Math.hypot(...n0) || 1;
  const dir: Vec3 = [n0[0] / l0, n0[1] / l0, n0[2] / l0];
  const o = transformPoint(wp, info.origin);
  const [t0, t1] = info.extent;
  const e0: Vec3 = [o[0] + dir[0] * t0, o[1] + dir[1] * t0, o[2] + dir[2] * t0];
  const e1: Vec3 = [o[0] + dir[0] * t1, o[1] + dir[1] * t1, o[2] + dir[2] * t1];
  // hlava „nahoře“: na konci díry dál ve směru kladné hlavní osy (svislá díra → nahoře); obráceně = druhý konec
  const k = [0, 1, 2].reduce((a, b) => (Math.abs(dir[b]) > Math.abs(dir[a]) ? b : a), 0);
  const upper = dir[k] * (t1 - t0) >= 0 ? e1 : e0;
  const head = cmd.flip ? (upper === e1 ? e0 : e1) : upper;
  const bottom = head === e0 ? e1 : e0;
  const ol = Math.hypot(head[0] - bottom[0], head[1] - bottom[1], head[2] - bottom[2]) || 1;
  const out: Vec3 = [(head[0] - bottom[0]) / ol, (head[1] - bottom[1]) / ol, (head[2] - bottom[2]) / ol];
  const stack = boltStack(info.radius * 2, Math.abs(t1 - t0), { washer: cmd.washer, nut: cmd.nut });
  const rotUp = eulerXYZ(rotationBetween([0, 0, 1], out));
  const rotDown = eulerXYZ(rotationBetween([0, 0, 1], [-out[0], -out[1], -out[2]]));
  const at = (p: Vec3, s: number): Vec3 => [p[0] + out[0] * s, p[1] + out[1] * s, p[2] + out[2] * s].map((v) => Math.round(v * 1e6) / 1e6) as Vec3;
  const holeRef: MateRef = { compId: C.id, ...(row.leafId !== C.id ? { leaf: row.leafId } : {}), face: row.face };
  const comps: AsmComponent[] = [];
  const mates: Mate[] = [];
  const dn = Number(stack.size.replace(/\D/g, "")) || 8;
  if (stack.washer) comps.push(partComponent(stack.washer, { position: at(head, 0), rotation: rotUp }, { group: "Normálie", number: stack.washer.props?.number, color: "#9aa7b5" }));
  const screw = partComponent(stack.screw, { position: at(head, stack.washerH), rotation: rotUp }, { group: "Normálie", number: stack.screw.props?.number, color: "#3a3f45" });
  comps.push(screw);
  const mScrew: Mate = { id: uid(), type: "concentric", name: `Souosost ${stack.size}`, a: { compId: screw.id, face: -1, radius: dn / 2 }, b: holeRef };
  mates.push(mScrew);
  if (stack.nut) {
    if (stack.washer) comps.push(partComponent(stack.washer, { position: at(bottom, 0), rotation: rotDown }, { group: "Normálie", number: stack.washer.props?.number, color: "#9aa7b5" }));
    const nut = partComponent(stack.nut, { position: at(bottom, -stack.washerH), rotation: rotDown }, { group: "Normálie", number: stack.nut.props?.number, color: "#3a3f45" });
    comps.push(nut);
    mates.push({ id: uid(), type: "concentric", name: `Souosost matice ${stack.size}`, a: { compId: nut.id, face: -1, radius: (dn * 0.85) / 2 }, b: holeRef });
  }
  const s = await solveAsm({ ...d, components: [...(d.components ?? []), ...comps], mates: [...(d.mates ?? []), ...mates] }, env);
  const st = s.status[mScrew.id];
  const sc = s.doc.components!.find((c) => c.id === screw.id)!;
  log.push(
    tr("{0} šroub „{1}“ ({2}) do díry {3} komponenty „{4}“ (Ø{5}, délka díry {6} mm){7}{8} · vazba Souosost: {9} · {10}{11}", st === "ok" ? "✓" : "⚠", sc.name, stack.screw.props?.number ?? `${stack.size}×${stack.length}`, faceRefText(row), C.name, fmt(info.radius * 2), fmt(Math.abs(t1 - t0)), stack.washer ? tr(" + podložka") : "", stack.nut ? tr(" + matice") : "", STATUS_WORD(st), posText(sc), note ? tr(" (vybrána {0})", note) : ""),
  );
  return { doc: s.doc, log, changed: true, mateStatus: s.status };
}
