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
  componentCopy,
  dissolveSubassembly,
  eulerXYZ,
  flattenAssembly,
  invertPlacement,
  makeSubassembly,
  mirrorComponent,
  moldBase,
  partComponent,
  patternComponent,
  removeComponents,
  rotMatrix,
  rotationBetween,
  sourceKey,
  transformPoint,
  type BomRow,
  type FlatComponent,
} from "./assembly";
import {
  aliasProblem,
  renameProblem,
  bomPartInfo,
  bomText,
  bomWarnings,
  componentLines,
  faceLine,
  faceRefText,
  findComp,
  findMate,
  fmt,
  materialId,
  mateLines,
  mateLostArgs,
  mateText,
  refEntText,
  pickFace,
  pt,
  resolveTab,
  type AsmCmd,
  type CompFaceRow,
  type TabInfo,
} from "./agent-asm";
import { tr } from "./i18n";
import { csvCaption, supplyWord } from "./bom-model";
import { copyFieldsText, refreshPlan, staleCopies, staleCopyText } from "./asm-refresh";
import type { MotionSlot } from "./motion-cache";
import { applyKinMate, applyMotionCmd, type MotionSignal } from "./asm-agent-kin";
import { applySpringCmd, refreshSprings } from "./asm-spring-agent";
import { applySpringNew, applySpringPattern, springHelpLines } from "./asm-spring-between";
import { springEffective } from "./asm-spring-geom";
import { springSeatMates } from "./asm-spring";
import { kinHasLimits, kinHasValue } from "./mate-spec";
import { ensureMateRefs, entKey, refGeo } from "./mate-geo";
import { entPrint, facePrint, markLost, matchEnt, matchFace, matchLost, withFace, type EntCand, type RefPrint } from "./mate-remap";
import { isKinMate } from "./mates-kin";
import { conflictText, solveStatic, type StaticConflict } from "./mates-static";
import { isLimitMate } from "./motion-quasi";
import { MATERIALS } from "@/lib/mesh-metrics";
import {
  MATE_LABEL,
  faceAreas,
  faceRow,
  hasFixedMate,
  lostSides,
  mateFromPending,
  mateLost,
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
import { uid, type AsmComponent, type BuildResult, type CadDoc, type ComponentSource, type LostRef, type Mate, type MateRef, type Vec3 } from "./types";
import type { ClashDetail, ClashPair } from "./clash-class";

/** Seznam ploch jednoho dílu (souřadnice dílu) – jako seznam ploch v panelu vazby. */
export type PartFaces = { faces: { face: number; info: PartFace; area?: number }[]; truncated: boolean };

/** Jádro a stav aplikace pro příkazy sestavy. */
export type AsmEnv = {
  /** postaví díly v jádře (klíč = `sourceKey`) a vrátí výsledky stavby; potom fungují `mateFace` / `cylFace` */
  parts: (list: { key: string; source: ComponentSource }[]) => Promise<{ key: string; result: BuildResult | null }[]>;
  /** geometrie plochy dílu (souřadnice dílu) */
  mateFace: (key: string, index: number) => Promise<PartFace | null>;
  /** hrana / vrchol dílu nebo jemná síť plochy (vačka) – pokročilé vazby */
  mateEnt?: (key: string, index: number, ent: "edge" | "vertex" | "mesh") => Promise<PartFace | null>;
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
  /** kontrola kolizí sestavy v jádře (pohybová studie s kolizemi) */
  interference?: (doc: CadDoc) => Promise<{ a: string; b: string; volume: number; aPath?: string[]; bPath?: string[] }[]>;
  /** geometrické zařazení dvojic kolize v jádře (šroub × závit, kap. 6.3 – clash-class.ts) – v pohybu stejné jako `kolize` */
  clashDetail?: (doc: CadDoc, pairs: ClashPair[]) => Promise<ClashDetail[]>;
  /** díl má víc ploch, než se načte (`FACE_LIMIT`) – plochy navíc nejdou vybrat pro vazbu (⚠ asm.faces-truncated, 5.2 č. 30) */
  onFacesTruncated?: (key: string, limit: number) => void;
  /** výsledky pohybové studie podle dokumentu: úložiště pracovního prostoru a klíč dokumentu, se kterým prostředí pracuje (cad/motion-cache.ts) */
  motion?: MotionSlot;
  /** díl otevřený v záložce podle názvu (`Workspace.findPart`) – zastaralé kopie a `sestava obnovit` (asm-refresh.ts, bod 22g) */
  partOf?: (name: string) => CadDoc | null;
};

export type AsmResult = {
  doc: CadDoc;
  log: string[];
  changed: boolean;
  /** stav vazeb po přepočtu (pro seznam vazeb a textový stav) */
  mateStatus?: Record<string, MateStatus>;
  /**
   * sestava, kterou `mateStatus` popisuje, liší-li se od `doc`: výpis (`sestava vazby`, `sestava komponenty`) dokument nemění,
   * ale řešič by komponenty posunul – stav pak platí pro polohy po přepočtu, ne pro dokument (engine/result-key.ts)
   */
  mateDoc?: CadDoc;
  /** `doc` je nový dokument do nové záložky (rám formy, otevřená komponenta) */
  newTab?: boolean;
  /** přepnuto na jinou záložku – `doc` je dokument nově aktivní záložky */
  switched?: boolean;
  /** změnil se zásobník úprav v kontextu (`env.stack`) */
  stackChanged?: boolean;
  /** pohybová studie: pokyn pro panel v aplikaci (přehrát, zastavit, krok, export snímků) */
  motion?: MotionSignal;
  /** záznamy protokolu s kódem (engine/codes.ts) – kolize v pohybu podle tříd (ℹ clash.thread, ⚠ clash.real) */
  codes?: { code: string; args?: unknown[]; text?: string }[];
  /** strojová část výpisu (`= <loc> asm "<sestava>" <kv>`, engine/ops/util.ts `sayKv`) – souhrn pohybové studie na jeden řádek */
  kv?: string;
  /**
   * prvky dílu upraveného v kontextu, které při `sestava hotovo` selhaly (`doc` = název dílu) – engine je ohlásí jedním
   * ✗ feature.failed (ověření dílu na řádku prvku, jinak na řádku `sestava hotovo`), ne druhým obecným řádkem ✗
   */
  failures?: { doc: string; name: string; error: string }[];
};

/* ───────────────────────── díly, plochy, řešič ───────────────────────── */

export const leafId = (l: FlatComponent) => l.path.join("/");
/** názvy na cestě listu (komponenta nejvyšší úrovně › … › díl) */
export function pathNames(doc: CadDoc, path: string[]): string[] {
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
export async function ensureBuilt(env: AsmEnv, leaves: FlatComponent[]): Promise<Map<string, BuildResult | null>> {
  const need = new Map<string, ComponentSource>();
  for (const l of leaves) need.set(l.key, l.comp.source);
  if (!need.size) return new Map();
  const res = await env.parts([...need].map(([key, source]) => ({ key, source })));
  return new Map(res.map((r) => [r.key, r.result]));
}

export async function faceInfo(env: AsmEnv, key: string, index: number): Promise<PartFace | null> {
  const k = `${key}:${index}`;
  const hit = env.geo.get(k);
  if (hit) return hit;
  const f = await env.mateFace(key, index).catch(() => null);
  if (f) env.geo.set(k, f);
  return f;
}

/**
 * Táž plocha v upraveném dílu (po přečíslování) – jen při skutečné geometrické shodě (cad/mate-remap.ts `matchFace`): přesná shoda,
 * nebo jediná plocha na téže rovině / ose; žádná nebo víc možností = null (ztracená reference – nikdy „nejbližší“ jiná plocha).
 */
export function sameFace(old: PartFace, faces: PartFaces["faces"], _tol = 1e-4, oldIndex = -1): number | null {
  void _tol;
  const m = matchFace(facePrint(old), faces, oldIndex);
  return m.state === "lost" ? null : m.face;
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
  if (out.truncated) env.onFacesTruncated?.(key, FACE_LIMIT);
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

/* ───────────────────────── reference vazeb po změně dílu (vlna 22, bod 20) ───────────────────────── */

type Side = "a" | "b" | "c" | "d";
/** Změna jednoho odkazu vazby (nebo dosedací plochy pružiny) při návratu upraveného dílu – cad/mate-remap.ts. */
export type RefChange = { mate?: string; spring?: string; side: Side; from: number; to?: number; ent?: MateRef["ent"]; how?: "exact" | "surface"; lost?: LostRef };
export type RemapReport = { renumbered: RefChange[]; lost: RefChange[]; restored: RefChange[] };

/** geometrie hrany / vrcholu dílu (souřadnice dílu) přes mezipaměť `env.geo` */
async function entInfo(env: AsmEnv, key: string, index: number, ent: "edge" | "vertex"): Promise<PartFace | null> {
  const k = entKey(key, { face: index, ent });
  const hit = env.geo.get(k);
  if (hit) return hit;
  const f = env.mateEnt ? await env.mateEnt(key, index, ent).catch(() => null) : null;
  if (f) env.geo.set(k, f);
  return f;
}

/** hrany / vrcholy dílu po úpravě (jen když je potřebuje odkaz vazby) – nejvýš FACE_LIMIT, vrcholů nejvýš 2× hran */
async function entList(env: AsmEnv, key: string, res: BuildResult | null | undefined, ent: "edge" | "vertex"): Promise<EntCand[]> {
  const edges = res?.metrics?.edges ?? 0;
  const n = Math.min(FACE_LIMIT, ent === "edge" ? edges : edges * 2);
  const out: EntCand[] = [];
  for (let start = 0; start < n; start += 25) {
    const idx = Array.from({ length: Math.min(25, n - start) }, (_, k) => start + k);
    const infos = await Promise.all(idx.map((i) => entInfo(env, key, i, ent)));
    infos.forEach((info, k) => info && out.push({ index: idx[k], info }));
  }
  return out;
}

/**
 * Prověří reference vazeb a dosedacích ploch pružin sestavy `next` do listových dílů, které se oproti `prev` změnily (jiný klíč
 * dílu = jiná historie, nebo list zmizel): každá se porovná podle geometrie (cad/mate-remap.ts) – skutečná shoda = přečíslováno,
 * jinak ztracená reference (`MateRef.lost` s otiskem, vazba mimo řešení). Dříve ztracená reference se obnoví jen při přesné shodě.
 * Společné pro text `sestava hotovo` a GUI „Zpět do sestavy“ (`finishContextEdit`); nic jiného v sestavě nemění.
 */
export async function remapAsmRefs(prev: CadDoc, next: CadDoc, env: AsmEnv): Promise<{ doc: CadDoc; report: RemapReport }> {
  const report: RemapReport = { renumbered: [], lost: [], restored: [] };
  const before = new Map(flattenAssembly(prev).map((l) => [leafId(l), l]));
  const after = new Map(flattenAssembly(next).map((l) => [leafId(l), l]));
  type Job = { ref: MateRef; set: (r: MateRef) => void; side: Side; mate?: string; spring?: string; was: FlatComponent; now?: FlatComponent };
  const jobs: Job[] = [];
  const consider = (ref: MateRef | undefined, set: (r: MateRef) => void, side: Side, owner: { mate?: string; spring?: string }) => {
    if (!ref || (ref.face < 0 && !ref.lost)) return; // −1 = doplní se podle poloměru (normálie) / vazba Ukotvit
    const id = ref.leaf ?? ref.compId;
    const was = before.get(id);
    const now = after.get(id);
    if (!was || (now && now.key === was.key)) return; // díl beze změny
    jobs.push({ ref, set, side, ...owner, was, now });
  };
  const mates: Mate[] = (next.mates ?? []).map((m) => ({ ...m }));
  for (const m of mates) for (const k of ["a", "b", "c", "d"] as const) consider(m[k], (r) => (m[k] = r), k, { mate: m.id });
  const comps: AsmComponent[] = (next.components ?? []).map((c) => (c.spring ? { ...c, spring: { ...c.spring } } : c));
  for (const c of comps) if (c.spring) for (const k of ["a", "b"] as const) consider(c.spring[k], (r) => (c.spring![k] = r), k, { spring: c.id });
  if (!jobs.length) return { doc: next, report };
  const need = new Map<string, FlatComponent>();
  for (const j of jobs) for (const l of [j.was, j.now]) if (l) need.set(l.key, l);
  const built = await ensureBuilt(env, [...need.values()]);
  const ents = new Map<string, Promise<EntCand[]>>();
  const entsOf = (key: string, ent: "edge" | "vertex") => {
    const k = `${key}|${ent}`;
    if (!ents.has(k)) ents.set(k, entList(env, key, built.get(key), ent));
    return ents.get(k)!;
  };
  for (const j of jobs) {
    const { ref } = j;
    const change: RefChange = { side: j.side, from: ref.face, ...(ref.ent ? { ent: ref.ent } : {}), ...(j.mate ? { mate: j.mate } : {}), ...(j.spring ? { spring: j.spring } : {}) };
    // otisk původní entity: uložený u dříve ztracené reference, jinak z dílu před úpravou
    let print: RefPrint | null = null;
    if (!ref.lost) {
      if (ref.ent) {
        const info = await entInfo(env, j.was.key, ref.face, ref.ent);
        print = info ? entPrint(info) : null;
      } else {
        const info = await faceInfo(env, j.was.key, ref.face);
        const area = info ? (await partFaces(env, j.was.key, built.get(j.was.key))).faces.find((f) => f.face === ref.face)?.area : undefined;
        print = info ? facePrint(info, area) : null;
      }
    }
    if (!j.now) {
      const r = ref.lost ? ref : markLost(ref, print, "gone");
      j.set(r);
      report.lost.push({ ...change, lost: r.lost });
      continue;
    }
    const faces = ref.ent ? [] : (await partFaces(env, j.now.key, built.get(j.now.key))).faces;
    const list = ref.ent ? await entsOf(j.now.key, ref.ent) : null;
    const m = ref.lost ? matchLost(ref.lost, faces, list, ref.face, ref.ent) : !print ? null : ref.ent ? matchEnt(print, list!, ref.face) : matchFace(print, faces, ref.face);
    if (m && m.state !== "lost") {
      j.set(withFace(ref, m.face));
      if (ref.lost) report.restored.push({ ...change, to: m.face, how: m.how });
      else if (m.state === "renumbered") report.renumbered.push({ ...change, to: m.face, how: m.how });
      continue;
    }
    if (ref.lost) {
      report.lost.push({ ...change, lost: ref.lost }); // zůstává ztracená
      continue;
    }
    const r = markLost(ref, print, m?.state === "lost" ? m.why : "unknown");
    j.set(r);
    report.lost.push({ ...change, lost: r.lost });
  }
  return { doc: { ...next, mates: next.mates ? mates : next.mates, components: comps }, report };
}

/** Výsledek návratu dílu / podsestavy upravené v kontextu do sestavy (text `sestava hotovo`, GUI „Zpět do sestavy“). */
export type ContextEditResult = {
  doc: CadDoc;
  status: Record<string, MateStatus>;
  moved: string[];
  /** komponent, které změnu převzaly */
  count: number;
  result: BuildResult | null;
  report: RemapReport;
  failures: { doc: string; name: string; error: string }[];
};

/**
 * Vrátí upravený díl `d` do sestavy `top.asm` (všechny komponenty se stejným zdrojem `top.key`), prověří reference vazeb
 * podle geometrie (`remapAsmRefs`) a vyřeší vazby – ztracená reference komponentou nepohne. Jedna funkce pro text i GUI.
 */
export async function finishContextEdit(top: { asm: CadDoc; key: string }, d: CadDoc, env: AsmEnv): Promise<ContextEditResult> {
  const sub = d.kind === "assembly";
  const src: ComponentSource = sub ? { kind: "asm", doc: { ...d } } : { kind: "part", doc: { ...d, kind: "part" } };
  let count = 0;
  const comps = (top.asm.components ?? []).map((c) => {
    if (c.source.kind === "file" || sourceKey(c.source) !== top.key) return c;
    count++;
    return { ...c, source: src };
  });
  // upravený díl: stavba (objem, chyby prvků); reference vazeb podle geometrie (úprava mohla plochy přečíslovat nebo odstranit)
  const newKey = sourceKey(src);
  const result = (await env.parts([{ key: newKey, source: src }]))[0]?.result ?? null;
  const { doc: next, report } = await remapAsmRefs(top.asm, { ...top.asm, components: comps }, env);
  const s = await solveAsm(next, env);
  const failures = (result?.status ?? []).filter((x) => x.ok === false).map((f) => ({ doc: d.name, name: d.features.find((x) => x.id === f.id)?.name ?? f.id, error: f.error ?? "?" }));
  return { doc: s.doc, status: s.status, moved: s.moved, count, result, report, failures };
}

/**
 * Text návratu do sestavy (protokol `sestava hotovo` i hláška GUI): souhrn s ✓ jen když jsou všechny vazby splněné, žádná reference
 * se neztratila a díl se postavil celý – jinak „→“ (přijato, stav níže); záznamy s kódem `mate.lost` (✗) / `mate.renumbered` /
 * `mate.restored` (ℹ) za každou dotčenou vazbu. Pružiny se ztracenou dosedací plochou: ✗ `mate.lost` s názvem pružiny.
 */
export function contextEditLines(r: ContextEditResult, d: CadDoc, asmName: string): { log: string[]; codes: { code: string; args?: unknown[]; text?: string }[] } {
  const doc = r.doc;
  const mates = doc.mates ?? [];
  const okN = mates.filter((m) => r.status[m.id] === "ok").length;
  const problem = mates.some((m) => mateLost(m) || r.status[m.id] === "conflict" || r.status[m.id] === "missing");
  const lostMates = mates.filter(mateLost);
  // ztracené reference v sestavě (i dřívější, které úprava neobnovila) + dosedací plochy pružin ztracené touto úpravou
  const lostN = lostMates.reduce((n, m) => n + lostSides(m).length, 0) + r.report.lost.filter((x) => x.spring).length;
  const clean = !problem && !lostN && !r.failures.length;
  const vol = r.result?.metrics ? tr(" · objem dílu {0} cm³", fmt(r.result.metrics.volume / 1000, 2)) : "";
  const mv = mates.length ? tr(" · vazby {0}", `${okN}/${mates.length} ok`) : "";
  const log = [
    clean
      ? tr("✓ „{0}“ vrácen do sestavy „{1}“ (změnu převzalo komponent: {2}){3}{4}", d.name, asmName, r.count, vol, mv)
      : tr("→ „{0}“ vrácen do sestavy „{1}“ (změnu převzalo komponent: {2}){3}{4}{5} – stav vazeb níže", d.name, asmName, r.count, vol, mv, lostN ? tr(" · ztracené reference: {0}", lostN) : ""),
  ];
  if (mates.some((m) => r.status[m.id] === "conflict")) log.push(tr("⚠ v sestavě je konflikt vazeb – sestava vazby"));
  if (r.moved.length) log.push(tr("  vazby pohnuly: {0}", movedText(doc, r.moved)));
  const codes: { code: string; args?: unknown[]; text?: string }[] = [];
  const no = (id?: string) => mates.findIndex((m) => m.id === id) + 1;
  for (const m of lostMates) codes.push({ code: "mate.lost", args: mateLostArgs(doc, m) });
  for (const c of r.report.lost.filter((x) => x.spring)) {
    // dosedací plocha pružiny: délka pružiny se z ní nepočítá (geometrie ztracené reference se nenačítá); oprava = nové dosedací plochy
    const name = doc.components?.find((x) => x.id === c.spring)?.name ?? "?";
    codes.push({ code: "mate.lost", text: tr("pružina „{0}“ – ztracená dosedací plocha {1} {2}: délka pružiny se z ní nepočítá; zadejte dosedací plochy znovu (sestava pružina \"{0}\" mezi \"A\" <plocha> \"B\" <plocha>)", name, c.side.toUpperCase(), refEntText({ compId: "", face: c.from, ...(c.ent ? { ent: c.ent } : {}) })) });
  }
  const ent = (c: RefChange, f: number) => refEntText({ compId: "", face: f, ...(c.ent ? { ent: c.ent } : {}) });
  for (const c of r.report.renumbered) codes.push({ code: "mate.renumbered", args: [c.mate ? no(c.mate) : tr("pružina „{0}“", doc.components?.find((x) => x.id === c.spring)?.name ?? "?"), `${c.side.toUpperCase()} ${ent(c, c.from)} → ${ent(c, c.to!)}`, c.how === "exact" ? tr("táž plocha, nové číslo") : tr("táž rovina / osa, plocha změnila velikost")] });
  for (const c of r.report.restored) codes.push({ code: "mate.restored", args: [c.mate ? no(c.mate) : tr("pružina „{0}“", doc.components?.find((x) => x.id === c.spring)?.name ?? "?"), `${c.side.toUpperCase()} ${ent(c, c.from)}`, ent(c, c.to!)] });
  return { log, codes };
}

/** Geometrie ploch vazeb v souřadnicích komponenty nejvyšší úrovně (nezávislá na jejím umístění) – jako `geoProvider` v aplikaci. */
export function geoProvider(doc: CadDoc, env: AsmEnv): GeoProvider {
  const leaves = new Map(flattenAssembly(doc).map((l) => [leafId(l), l]));
  return (ref) => {
    const l = leaves.get(ref.leaf ?? ref.compId);
    if (!l || ref.face < 0 || ref.lost) return null; // ztracená reference: žádná geometrie – nikdy jiná plocha se starým číslem
    const top = doc.components?.find((c) => c.id === ref.compId);
    if (!top) return null;
    return refGeo(env.geo.get(entKey(l.key, ref)), composePlacement(invertPlacement(top.placement), l.placement));
  };
}

/**
 * Přepočet vazeb (jako „Přepočítat vazby“): doplní geometrii ploch (a indexy válcových ploch normálií podle poloměru),
 * vyřeší vazby a vrátí sestavu s novými polohami pohnutých komponent. `anchorId` = komponenta, kterou uživatel právě přesunul.
 * Řešič je společný s aplikací (cad/mates-static.ts `solveStatic`): při konfliktu se kompromis NEZAPÍŠE (`conflict` – vazby, odchylky,
 * nejbližší dosažitelná hodnota upravené vazby `o.focus`); `o.equilibrium` (úpravy, ne zjišťování stavu) = díly volné v mezi do
 * rovnováhy pružin a preferovaných stran mezí (`eqMoved`).
 */
export async function solveAsm(doc: CadDoc, env: AsmEnv, anchorId?: string | null, o: { equilibrium?: boolean; focus?: string } = {}): Promise<{ doc: CadDoc; status: Record<string, MateStatus>; moved: string[]; conflict?: StaticConflict; eqMoved?: string[] }> {
  if (doc.kind !== "assembly") return { doc, status: {}, moved: [] };
  // bez vazeb: jen délky pružin podle aktuálních poloh (přesun dosedací komponenty)
  if (!doc.mates?.length) return { doc: await refreshSprings(doc, env), status: {}, moved: [] };
  const flat = flattenAssembly(doc);
  const byLeaf = new Map(flat.map((l) => [leafId(l), l]));
  const used = new Map<string, FlatComponent>();
  for (const m of doc.mates) for (const r of [m.a, m.b, m.c, m.d]) {
    const l = r && byLeaf.get(r.leaf ?? r.compId);
    if (l) used.set(leafId(l), l);
  }
  await ensureBuilt(env, [...used.values()]);
  // plochy, hrany, vrcholy, sítě vaček a indexy válcových ploch normálií (cad/mate-geo.ts – stejně jako v aplikaci)
  const mates = await ensureMateRefs(doc.mates, (ref) => byLeaf.get(ref.leaf ?? ref.compId)?.key ?? null, env.geo, { face: env.mateFace, ent: env.mateEnt, cylFace: env.cylFace });
  let withMates = { ...doc, mates };
  // rovnováha pružin potřebuje i geometrii dosedacích ploch
  if (o.equilibrium && springSeatMates(withMates).length) await ensureSeatGeoOf(withMates, env);
  const r = solveStatic(withMates, geoProvider(withMates, env), anchorId, { equilibrium: o.equilibrium, ...(o.focus ? { focus: o.focus } : {}) });
  if (r.mates) withMates = { ...withMates, mates: r.mates }; // zachycený výchozí stav pokročilých vazeb
  const byId = new Map(r.components.map((c) => [c.id, c.placement]));
  const solved = { ...withMates, components: (doc.components ?? []).map((c) => (r.moved.includes(c.id) && byId.has(c.id) ? { ...c, placement: byId.get(c.id)! } : c)) };
  // pružiny: délka podle nových poloh dosedacích ploch (cad/asm-spring-agent.ts)
  return { doc: await refreshSprings(solved, env), status: r.status, moved: r.moved, ...(r.conflict ? { conflict: r.conflict } : {}), ...(r.eqMoved.length ? { eqMoved: r.eqMoved } : {}) };
}
/** záznam s kódem ⚠ mate.conflict (polohy beze změny) – AsmResult.codes */
export const conflictCode = (c: StaticConflict) => ({ code: "mate.conflict", args: [conflictText(c)], text: tr("vazby nelze splnit spolu – polohy komponent zůstaly beze změny (žádný kompromis); {0}", conflictText(c)) });

/** geometrie dosedacích ploch pružin (pomocné „vazby“, do dokumentu se nevrací) – rovnováha pružin ve statickém přepočtu */
async function ensureSeatGeoOf(doc: CadDoc, env: AsmEnv): Promise<void> {
  const seats = springSeatMates(doc);
  const flat = flattenAssembly(doc);
  const byLeaf = new Map(flat.map((l) => [leafId(l), l]));
  const used = new Map<string, FlatComponent>();
  for (const m of seats) for (const r of [m.a, m.b]) {
    const l = byLeaf.get(r.leaf ?? r.compId);
    if (l) used.set(leafId(l), l);
  }
  await ensureBuilt(env, [...used.values()]);
  await ensureMateRefs(seats, (ref) => byLeaf.get(ref.leaf ?? ref.compId)?.key ?? null, env.geo, { face: env.mateFace, ent: env.mateEnt, cylFace: env.cylFace });
}

/**
 * Řádky protokolu statického přepočtu: konflikt (vazby, odchylky, nejbližší dosažitelná hodnota – polohy beze změny, žádný
 * kompromis) a díly, které posunula rovnováha pružin / preference.
 */
export function solveNotes(doc: CadDoc, s: { conflict?: StaticConflict; eqMoved?: string[] }): string[] {
  const out: string[] = [];
  if (s.eqMoved?.length) out.push(tr("  rovnováha pružin a preferovaných stran mezí posunula: {0}", movedText(doc, s.eqMoved)));
  return out;
}
/** záznam s kódem ⚠ mate.conflict (polohy beze změny) – AsmResult.codes */
export const conflictCode = (c: StaticConflict) => ({ code: "mate.conflict", args: [conflictText(c)], text: tr("vazby nelze splnit spolu – polohy komponent zůstaly beze změny (žádný kompromis); {0}", conflictText(c)) });

/* ───────────────────────── provedení ───────────────────────── */

export const STATUS_WORD = (s?: MateStatus) => (s === "ok" ? "ok" : s === "conflict" ? tr("konflikt") : s === "missing" ? tr("chybí plocha") : s === "suppressed" ? tr("potlačeno") : s === "lost" ? tr("ztracená reference") : "?");

/**
 * `sestava vazba N plocha [a|b] <plocha>`: nová plocha strany vazby (oprava ztracené reference – vlna 22, bod 20). Bez strany =
 * ztracená strana. Plocha se vybírá jako u nové vazby (F-číslo, pravidlo, válcová Ø…); hrana / vrchol číslem E3 / V2.
 */
async function repickMateRef(d: CadDoc, m: Mate, no: number, face: NonNullable<Extract<AsmCmd, { k: "mateEdit" }>["face"]>, env: AsmEnv, what: string[]): Promise<CadDoc> {
  const side = face.side ?? lostSides(m)[0];
  if (!side) throw new Error(tr("vazba {0}: žádná ztracená reference – zadejte stranu: sestava vazba {0} plocha a|b <plocha>", no));
  const old = m[side];
  if (!old || m.type === "fixed") throw new Error(tr("vazba {0} nemá stranu {1}", no, side.toUpperCase()));
  const comp = d.components?.find((c) => c.id === old.compId);
  if (!comp) throw new Error(tr("vazba {0}: komponenta strany {1} v sestavě není", no, side.toUpperCase()));
  let ref: MateRef;
  if (face.spec.ent || old.ent) {
    if (face.spec.index === undefined || face.spec.ent !== old.ent) throw new Error(tr("vazba {0}: strana {1} je {2} – zadejte ji číslem {3}", no, side.toUpperCase(), old.ent === "vertex" ? tr("vrchol") : old.ent === "edge" ? tr("hrana") : tr("plocha"), old.ent === "vertex" ? "V3" : old.ent === "edge" ? "E3" : "F3"));
    const leaf = flattenAssembly(d).find((l) => leafId(l) === (old.leaf ?? old.compId));
    const info = leaf ? await entInfo(env, leaf.key, face.spec.index, old.ent!) : null;
    if (!info) throw new Error(tr("vazba {0}: komponenta „{1}“ nemá {2}", no, comp.name, face.spec.raw));
    ref = { compId: old.compId, ...(old.leaf ? { leaf: old.leaf } : {}), face: face.spec.index, ent: old.ent };
  } else {
    const k = old.lost?.kind;
    const need = k === "cylinder" || k === "cone" || (!k && m.type === "concentric") ? "cylinder" : k === "plane" || (!k && !isKinMate(m.type)) ? "plane" : null;
    const rows = (await compFaces(d, comp.id, env)).rows;
    const pick = pickFace(face.spec, rows, need, comp.name, `${side.toUpperCase()}: `);
    ref = { compId: comp.id, ...(pick.row.leafId !== comp.id ? { leaf: pick.row.leafId } : {}), face: pick.row.face };
  }
  what.push(tr("plocha {0} → {1}", `${side.toUpperCase()} ${refEntText(old)}`, refEntText(ref)));
  return { ...d, mates: (d.mates ?? []).map((x) => (x.id === m.id ? { ...x, [side]: ref } : x)) };
}
const posText = (c: AsmComponent) => `${tr("poloha {0}", pt(c.placement.position))}${c.placement.rotation.some((x) => Math.abs(x) > 1e-9) ? ` · ${tr("natočení {0}", pt(c.placement.rotation))}` : ""}`;
/** „„Čep“ poloha […] · „Deska“ …“ pro pohnuté komponenty */
export const movedText = (doc: CadDoc, ids: string[]) =>
  ids
    .map((id) => doc.components?.find((c) => c.id === id))
    .filter((c): c is AsmComponent => !!c)
    .map((c) => `„${c.name}“ ${posText(c)}`)
    .join(" · ");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
/** výpis vazeb nad dokumentem, jehož polohy vazbám neodpovídají: stav platí až pro polohy po přepočtu (žádné tiché „ok“) */
const unsolvedNote = (solved: CadDoc, moved: string[]) => tr("⚠ polohy v dokumentu vazbám neodpovídají – uvedený stav vazeb platí až po přepočtu, který by posunul: {0}", movedText(solved, moved));

/** Provede příkaz sestavy nad dokumentem `d` (kopie – nemění se); vrátí nový dokument, protokol a stav vazeb. */
export async function applyAsmCmd(d: CadDoc, cmd: AsmCmd, env: AsmEnv): Promise<AsmResult> {
  const log: string[] = [];
  const done = (doc: CadDoc, changed: boolean, extra: Partial<AsmResult> = {}): AsmResult => ({ doc, log, changed, ...extra });
  const asmOnly = () => {
    if (d.kind !== "assembly") throw new Error(tr("otevřený dokument „{0}“ není sestava – nejdřív „nová sestava“, „záložka \"…\"“ nebo „sestava hotovo“ (při úpravě dílu v kontextu)", d.name));
  };
  // zjišťování stavu (výpis vazeb / komponent): jen vazby; úpravy: navíc rovnováha pružin a preferencí (deterministický dokument,
  // vlna 22, bod 2) a u upravené vazby nejbližší dosažitelná hodnota při konfliktu (bod 8)
  const resolve = (doc: CadDoc, anchorId?: string | null) => solveAsm(doc, env, anchorId);
  const resolveEdit = (doc: CadDoc, anchorId?: string | null, focus?: string) => solveAsm(doc, env, anchorId, { equilibrium: true, ...(focus ? { focus } : {}) });
  switch (cmd.k) {
    case "list": {
      asmOnly();
      const s = d.mates?.length ? await resolve(d) : null;
      log.push(...componentLines(d, s?.status));
      if (s?.moved.length) log.push(unsolvedNote(s.doc, s.moved));
      return done(d, false, s ? { mateStatus: s.status, ...(s.moved.length ? { mateDoc: s.doc } : {}) } : {});
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
      if (cmd.kind !== "center" && isKinMate(cmd.kind)) return applyKinMate(d, cmd, env);
      const A = findComp(d, cmd.a);
      if (cmd.kind === "fixed") {
        if (hasFixedMate(d, A.id)) {
          log.push(tr("✓ „{0}“ už má vazbu Ukotvit – beze změny", A.name));
          return done(d, false);
        }
        const s = await resolveEdit(toggleFixedMate(d, A.id, uid()));
        log.push(tr("✓ vazba Ukotvit „{0}“ – komponenta je ukotvená, ostatní vazby hýbou druhou komponentou", A.name));
        log.push(...solveNotes(s.doc, s));
        return done(s.doc, true, { mateStatus: s.status, ...(s.conflict ? { codes: [conflictCode(s.conflict)] } : {}) });
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
      const s = await resolveEdit({ ...d, mates: [...(d.mates ?? []), m] }, null, m.id);
      const st = s.status[m.id];
      const picks = [fa.note, fb.note].filter(Boolean);
      log.push(
        tr("{0} vazba {1}: {2}{3} · {4}", st === "ok" ? "✓" : "⚠", mateText(s.doc, s.doc.mates!.find((x) => x.id === m.id)!), STATUS_WORD(st), picks.length ? tr(" (vybrána {0})", picks.join("; ")) : "", s.moved.length ? movedText(s.doc, s.moved) : tr("poloha beze změny")),
      );
      if (st === "conflict") log.push(tr("⚠ vazbu nelze splnit spolu s ostatními – sestava vazby (výpis), sestava vazba {0} potlačit|smazat|obráceně", s.doc.mates!.length));
      if (st === "missing") log.push(tr("⚠ plochu vazby se nepodařilo načíst z jádra – sestava vazby po dostavění dílů vazbu přepočítá"));
      log.push(...solveNotes(s.doc, s));
      return done(s.doc, true, { mateStatus: s.status, ...(s.conflict ? { codes: [conflictCode(s.conflict)] } : {}) });
    }
    case "mates": {
      asmOnly();
      const s = d.mates?.length ? await resolve(d) : null;
      log.push(...mateLines(d, s?.status));
      if (s?.moved.length) log.push(unsolvedNote(s.doc, s.moved));
      return done(d, false, s ? { mateStatus: s.status, ...(s.moved.length ? { mateDoc: s.doc } : {}) } : {});
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
        const patch: Partial<Pick<Mate, "value" | "flip" | "suppressed" | "name" | "min" | "max">> = {};
        if (cmd.value !== undefined) {
          if (!mateNeedsValue(m.type) && !kinHasValue(m.type) && m.type !== "slot") throw new Error(tr("vazba {0} ({1}) nemá hodnotu – hodnotu má Vzdálenost, Úhel, Ozubení (poměr), Šroub (stoupání), Hřeben (mm/ot) a Drážka (poloha)", no, tr(MATE_LABEL[m.type])));
          if ((m.type === "gear" || m.type === "screw" || m.type === "rack") && !(cmd.value > 0)) throw new Error(tr("hodnota musí být kladná"));
          patch.value = cmd.value;
          what.push(tr("hodnota {0}", `${fmt(cmd.value, 4)}${m.type === "angle" ? "°" : m.type === "gear" ? "" : " mm"}`));
        }
        for (const k of ["min", "max"] as const)
          if (cmd[k] !== undefined) {
            if (!kinHasLimits(m.type)) throw new Error(tr("vazba {0} ({1}) nemá meze – meze má Mez vzdálenosti a Mez úhlu", no, tr(MATE_LABEL[m.type])));
            patch[k] = cmd[k];
            what.push(`${k} ${fmt(cmd[k]!)}`);
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
        if (cmd.face) next = await repickMateRef(next, m, no, cmd.face, env, what);
        if (cmd.prefer !== undefined) {
          // preferovaná strana meze (vlna 22, bod 2): drží díl u meze, když ho vazby neurčují – nikdy proti pevné vazbě či motoru
          if (!isLimitMate(m)) throw new Error(tr("vazba {0} ({1}) není mez – preferovanou stranu má Mez vzdálenosti, Mez úhlu a Drážka bez polohy", no, tr(MATE_LABEL[m.type])));
          const pref = cmd.prefer;
          next = {
            ...next,
            mates: (next.mates ?? []).map((x) => {
              if (x.id !== m.id) return x;
              const y = { ...x };
              if (pref) y.prefer = pref;
              else delete y.prefer;
              return y;
            }),
          };
          what.push(cmd.prefer ? tr("preferovaná strana {0}", cmd.prefer) : tr("bez preferované strany"));
        }
      }
      const s = await resolveEdit(next, null, cmd.del ? undefined : m.id);
      const after = s.doc.mates?.find((x) => x.id === m.id);
      // ✓ jen pro vazbu, která po změně platí v geometrii (ztracená reference / konflikt = výsledek bez ✓ – vlna 22, bod 20 a 22i);
      // konflikt = ⚠ a polohy beze změny (žádný kompromis v dokumentu – bod 8)
      const okNow = !s.conflict && (!after || s.status[m.id] === "ok" || s.status[m.id] === "suppressed");
      log.push(tr("{0} vazba {1} ({2}): {3}{4}", okNow ? "✓" : "⚠", no, after ? mateText(s.doc, after) : tr(MATE_LABEL[m.type]), what.join(", "), after ? ` · ${STATUS_WORD(s.status[m.id])}` : ""));
      if (s.moved.length) log.push(tr("  pohnuto: {0}", movedText(s.doc, s.moved)));
      else if (s.conflict) log.push(tr("  polohy komponent beze změny – vazby nelze splnit spolu (kompromis se nezapisuje)"));
      log.push(...solveNotes(s.doc, s));
      if (Object.values(s.status).some((x) => x === "conflict")) log.push(tr("⚠ v sestavě je konflikt vazeb – sestava vazby"));
      return done(s.doc, true, { mateStatus: s.status, ...(s.conflict ? { codes: [conflictCode(s.conflict)] } : {}) });
    }
    case "spring":
    case "springs":
      // nová pružina z tabulky / kopie do děr vzoru (vlna 21, cad/asm-spring-between.ts)
      if (cmd.k === "spring" && cmd.help) return { doc: d, log: springHelpLines(), changed: false };
      if (cmd.k === "spring" && cmd.create) return applySpringNew(d, cmd, env);
      if (cmd.k === "spring" && cmd.holes && !cmd.remove) return applySpringPattern(d, cmd, env);
      return applySpringCmd(d, cmd, env);
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
        const why = renameProblem(doc, p.name, c.id);
        if (why) throw new Error(why);
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
      if (p.supply) {
        // druh položky kusovníku na komponentě (přepis druhu dílu); kind null = zpět na výchozí druh (bom-model.ts)
        const sp = { ...(c.supply ?? {}) };
        if (p.supply.kind === null) delete sp.kind;
        else if (p.supply.kind) sp.kind = p.supply.kind;
        for (const k of ["catalog", "vendor", "size", "grade"] as const) {
          const v = p.supply[k];
          if (v === undefined) continue;
          if (v.trim()) sp[k] = v.trim();
          else delete sp[k];
        }
        if (Object.keys(sp).length) c.supply = sp;
        else delete c.supply;
        if (p.supply.kind !== undefined) what.push(p.supply.kind ? tr("druh {0}", supplyWord(p.supply.kind)) : tr("druh výchozí"));
        if (p.supply.catalog !== undefined) what.push(tr("katalog „{0}“", p.supply.catalog));
        if (p.supply.vendor !== undefined) what.push(tr("výrobce „{0}“", p.supply.vendor));
        if (p.supply.size !== undefined) what.push(tr("rozměr „{0}“", p.supply.size));
        if (p.supply.grade !== undefined) what.push(tr("třída „{0}“", p.supply.grade));
      }
      if (p.alias !== undefined) {
        // přezdívka instance: odkaz ve vazbách místo #k; kusovník ji nepoužívá
        if (!p.alias.trim()) {
          delete c.alias;
          what.push(tr("bez přezdívky"));
        } else {
          const why = aliasProblem(doc, p.alias, c.id);
          if (why) throw new Error(why);
          c.alias = p.alias.trim();
          what.push(tr("přezdívka „{0}“", c.alias));
        }
      }
      doc = { ...doc, components: (doc.components ?? []).map((x) => (x.id === c.id ? c : x)) };
      let st: Record<string, MateStatus> | undefined;
      let movedOthers: string[] = [];
      let conflict: StaticConflict | undefined;
      if (moved && doc.mates?.length) {
        // jako v panelu: přesunutá komponenta je pro řešič pevná, vazby dorovnají ostatní
        const s = await resolveEdit(doc, c.id);
        doc = s.doc;
        st = s.status;
        movedOthers = s.moved.filter((id) => id !== c.id);
        conflict = s.conflict;
      } else if (moved) doc = await refreshSprings(doc, env); // bez vazeb: délka pružin podle nové polohy dosedací komponenty
      log.push(tr("✓ komponenta „{0}“: {1}", c0.name, what.join(" · ")));
      if (movedOthers.length) log.push(tr("  vazby pohnuly: {0}", movedText(doc, movedOthers)));
      if (st && Object.values(st).some((x) => x === "conflict")) log.push(tr("⚠ v sestavě je konflikt vazeb – sestava vazby"));
      return done(doc, true, { ...(st ? { mateStatus: st } : {}), ...(conflict ? { codes: [conflictCode(conflict)] } : {}) });
    }
    case "remove": {
      asmOnly();
      let doc = d;
      const names: string[] = [];
      let lost = 0;
      const springs: string[] = [];
      for (const ref of cmd.comps) {
        const c = findComp(doc, ref);
        const before = doc.mates?.length ?? 0;
        // i definice pružin, které na komponentě dosedaly (pružina zůstane ve volné délce)
        const r = removeComponents(doc, [c.id]);
        springs.push(...r.springs);
        doc = { ...r.doc, mates: (doc.mates ?? []).filter((m) => m.a.compId !== c.id && m.b.compId !== c.id) };
        lost += before - (doc.mates?.length ?? 0);
        names.push(`„${c.name}“`);
      }
      log.push(tr("✓ odebráno ze sestavy: {0}{1} · zbývá komponent: {2}", names.join(", "), lost ? tr(" (a jejich vazby: {0})", lost) : "", doc.components?.length ?? 0));
      if (springs.length) log.push(tr("  pružiny bez dosedací komponenty (definice odebrána, tvar ve volné délce): {0}", [...new Set(springs)].map((n) => `„${n}“${springs.filter((x) => x === n).length > 1 ? ` (${springs.filter((x) => x === n).length}×)` : ""}`).join(", ")));
      return done(doc, true);
    }
    case "duplicate": {
      asmOnly();
      const c = findComp(d, cmd.comp);
      // stejný název jako v panelu (Duplikovat) – v kusovníku se kopie sečtou; textem ji lze zadat pořadím #N
      // kopie bez přezdívky (musí zůstat jednoznačná)
      const copy: AsmComponent = componentCopy(clone(c), { placement: { ...c.placement, position: c.placement.position.map((v, k) => Math.round((v + cmd.offset[k]) * 1e6) / 1e6) as Vec3 } });
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
      // pružiny venku, které dosedají na komponentu v podsestavě: odkaz přes cestu listu (jako vazby)
      const comps = (made.doc.components ?? []).map((c) => (c.id === subId && c.source.kind === "asm" ? { ...c, ...(wasFixed ? { fixed: true } : {}), source: { kind: "asm" as const, doc: { ...c.source.doc, mates: inner } } } : c.spring ? { ...c, spring: { ...c.spring, a: remap(c.spring.a), b: remap(c.spring.b) } } : c));
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
      // pružiny, které dosedaly na díl v podsestavě: odkaz o úroveň výš (jako vazby); bez převodu definice zmizí
      const liftSpring = (c: AsmComponent): AsmComponent => {
        if (!c.spring || (c.spring.a.compId !== P.id && c.spring.b.compId !== P.id)) return c;
        const fx = (r: MateRef): MateRef | null => (r.compId !== P.id ? r : r.leaf?.startsWith(`${P.id}/`) ? lift(r, r.leaf.slice(P.id.length + 1)) : null);
        const a = fx(c.spring.a);
        const b = fx(c.spring.b);
        if (a && b) return { ...c, spring: { ...c.spring, a, b } };
        const { spring: _s, ...rest } = c;
        void _s;
        return rest;
      };
      const doc = { ...next, mates, components: (next.components ?? []).map((c) => liftSpring(fixed && kids.includes(c) ? { ...c, fixed: true } : c)) };
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
      // návrat + prověření referencí vazeb podle geometrie (vlna 22, bod 20) – táž funkce jako GUI „Zpět do sestavy“
      const r = await finishContextEdit(top, d, env);
      const t = contextEditLines(r, d, top.asm.name);
      log.push(...t.log);
      const mateStatus = r.doc.mates?.length ? { mateStatus: r.status } : {};
      return done(r.doc, true, { stackChanged: true, ...mateStatus, ...(r.failures.length ? { failures: r.failures } : {}), ...(t.codes.length ? { codes: t.codes } : {}) });
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
      if (cmd.csv) log.push(csvCaption(), b.csv.replace(/^﻿/, "").trimEnd());
      // kusovník nikdy tiše neukáže údaje kopie, když díl v záložce má jiné (⚠ asm.stale-copy s příkazem obnovy, bod 22g),
      // a řekne, co vyráběným dílům chybí (⚠ bom.make-incomplete – číslo, označení materiálu)
      return done(d, false, { codes: bomCodes(d, b.rows, env) });
    }
    case "refresh":
      asmOnly();
      return refreshCmd(d, cmd, env, log, (doc) => resolve(doc));
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
    case "motion":
      asmOnly();
      return applyMotionCmd(d, cmd.cmd, env);
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
  // řádky podle zdroje (pružina = jedna položka v jakékoli délce), hmotnost z tělesa v sestavě (pružina v aktuální délce, jako stav)
  const rows = computeBom(d, (c) => bomPartInfo(c, built.get(sourceKey(springEffective(c).source)) ?? built.get(sourceKey(c.source))), { structured });
  return { rows, text: bomText(rows, d.name, structured), csv: bomCsv(rows) };
}

/**
 * Záznamy ⚠ ke kusovníku (text, CLI, `window.mncad.bom`): zastaralé kopie dílů (díl v záložce se od vložení změnil –
 * `asm.stale-copy` s příkazem `sestava obnovit`) a vyráběné díly bez čísla / bez označení materiálu (`bom.make-incomplete`).
 */
export function bomCodes(d: CadDoc, rows: BomRow[], env: Pick<AsmEnv, "partOf">): { code: string; text: string }[] {
  const out: { code: string; text: string }[] = [];
  for (const s of staleCopies(d, env.partOf)) out.push({ code: "asm.stale-copy", text: staleCopyText(s) });
  for (const w of bomWarnings(rows)) out.push({ code: "bom.make-incomplete", text: w });
  return out;
}

/**
 * `sestava obnovit "Deska A" | vše [údaje]` – komponenty převezmou díl ze záložky (asm-refresh.ts `refreshPlan`, jedna funkce
 * i pro GUI „Obnovit z dílu“). Změněná geometrie: čísla ploch vazeb se převedou podle geometrie jako po `sestava hotovo`,
 * plocha, kterou nejde najít, se ohlásí (⚠) a vazby se přepočítají.
 */
async function refreshCmd(d: CadDoc, cmd: Extract<AsmCmd, { k: "refresh" }>, env: AsmEnv, log: string[], resolve: (doc: CadDoc) => ReturnType<typeof solveAsm>): Promise<AsmResult> {
  const done = (doc: CadDoc, changed: boolean, extra: Partial<AsmResult> = {}): AsmResult => ({ doc, log, changed, ...extra });
  if (!env.partOf) throw new Error(tr("sestava obnovit: díly v záložkách nejsou dostupné"));
  const comps = d.components ?? [];
  const ids = cmd.comps === "all" ? comps.filter((c) => c.source.kind === "part").map((c) => c.id) : cmd.comps.map((r) => findComp(d, r).id);
  const plan = refreshPlan(d, ids, env.partOf, { metaOnly: cmd.metaOnly });
  for (const x of plan.skipped) log.push(tr("ℹ „{0}“ se neobnovuje: {1}", x.name, x.why));
  const changed = plan.done.filter((x) => x.fields.length || x.geometry);
  for (const x of plan.done) {
    if (!x.fields.length && !x.geometry) log.push(tr("✓ komponenta „{0}“ už odpovídá dílu v záložce", x.name));
    else log.push(tr("✓ komponenta „{0}“ obnovena z dílu ({1}){2}", x.name, copyFieldsText(x.fields) || tr("geometrie"), x.local.length ? tr(" – přepsány úpravy v sestavě: {0}", copyFieldsText(x.local)) : ""));
    if (x.keptNumber) log.push(tr("  číslo komponenty „{0}“ zadané v sestavě zůstává (sestava komponenta \"{1}\" číslo \"\" ho zruší)", x.keptNumber, x.name));
  }
  if (!changed.length) return done(d, false);
  let doc = plan.doc;
  // geometrie: čísla ploch vazeb podle geometrie (jako sestava hotovo) – stará a nová kopie dílu
  const geo = changed.filter((x) => x.geometry).map((x) => x.id);
  if (geo.length && doc.mates?.length) {
    const mates = doc.mates.map((m) => ({ ...m, a: { ...m.a }, b: { ...m.b } }));
    let renumbered = 0;
    let lost = 0;
    for (const id of geo) {
      const oldC = comps.find((c) => c.id === id)!;
      const newC = doc.components!.find((c) => c.id === id)!;
      const oldKey = sourceKey(oldC.source);
      const newKey = sourceKey(newC.source);
      await env.parts([{ key: oldKey, source: oldC.source }]);
      const res = (await env.parts([{ key: newKey, source: newC.source }]))[0]?.result ?? null;
      const fresh = await partFaces(env, newKey, res);
      for (const m of mates)
        for (const ref of [m.a, m.b]) {
          if (ref.compId !== id || ref.leaf || ref.face < 0) continue;
          const old = await faceInfo(env, oldKey, ref.face);
          const hit = old ? sameFace(old, fresh.faces) : null;
          if (hit == null) lost++;
          else if (hit !== ref.face) {
            ref.face = hit;
            renumbered++;
          }
        }
    }
    doc = { ...doc, mates };
    if (renumbered) log.push(tr("  plochy vazeb přečíslovány podle geometrie: {0}", renumbered));
    if (lost) log.push(tr("⚠ plochy vazeb, které po obnově dílu nejde najít: {0} – sestava vazby", lost));
    const s = await resolve(doc);
    return done(s.doc, true, { mateStatus: s.status });
  }
  return done(doc, true);
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
