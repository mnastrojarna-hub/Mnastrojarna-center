/**
 * Stav sestavy, kusovník a doplňky razítka výkresu bez Reactu (CAD-HEADLESS-NAVRH.md kap. 2.1 a 2.5) – dřív počítala
 * aplikace z mezipaměti, kterou plní efekt po vykreslení (`asmStatusRef`, `drawEnvRef` v cad-app.tsx).
 *
 * `ensureLeaves` postaví všechny listové díly sestavy dřív, než se z nich počítá stav, kusovník, kolize, kontrola nebo
 * souhrn – bez toho byl objem Σ neznámý (P2: Σ = NaN) podle toho, zda aplikace díly zrovna stihla načíst.
 */
import { docStatusText, type AsmStatus, type StaleNote } from "../agent";
import { bomOf, flattenLeaves, matrixToPlacement, type Leaf } from "../asm-flatten";
import { sourceKey, transformPoint } from "../assembly";
import { clashStale } from "../clash-class";
import type { DrawingExtras } from "../drawing-agent";
import type { MateStatus } from "../mates";
import type { AsmComponent, BuildResult, CadDoc, Vec3 } from "../types";
import { fmtNum, MATERIALS, massKg } from "@/lib/mesh-metrics";
import { asmWorldBox } from "./asm-box";
import { makeAsmEnv, type AsmEnvOptions } from "./asm-env";
import type { KernelApi } from "./kernel";
import { geometrySig, mateStatusState, notedResults, setMateStatus } from "./result-key";
import type { Workspace } from "./workspace";

/**
 * volby stavu sestavy: háčky prostředí sestavy + klíč dokumentu (`Workspace.docKey`, výchozí aktivní záložka); `quick` = bez
 * přesné obálky z jádra (obálka z lokálních obálek dílů – cesta zrušení výpočtu, `asmStatusOf`)
 */
export type AsmStatusOptions = AsmEnvOptions & { key?: string; quick?: boolean };

/** Postaví (jednou na klíč) díly všech listů sestavy a vrátí listy. Díl nebo 2D výkres = prázdný seznam. */
export async function ensureLeaves(ws: Workspace, kernel: KernelApi, doc: CadDoc, o: AsmEnvOptions = {}): Promise<Leaf[]> {
  if (doc.kind !== "assembly") return [];
  const leaves = flattenLeaves(doc);
  const need = new Map<string, AsmComponent["source"]>();
  for (const l of leaves) need.set(l.key, l.comp.source);
  if (need.size) await makeAsmEnv(ws, kernel, o).parts([...need].map(([key, source]) => ({ key, source })));
  return leaves;
}

/** materiál a hmotnost komponenty pro kusovník (označení materiálu dílu, jinak třída; hustota třídy) */
export function partInfo(cache: Map<string, BuildResult>, c: AsmComponent): { material: string; massKg?: number } {
  const r = cache.get(sourceKey(c.source));
  const matId = c.source.kind === "part" ? c.source.doc.material : (c.material ?? "ocel");
  const mt = MATERIALS.find((x) => x.id === matId);
  const label = c.source.kind === "part" && c.source.doc.materialName?.trim() ? c.source.doc.materialName.trim() : (mt?.label ?? matId).split(" – ")[0];
  return { material: label, massKg: r?.metrics ? massKg(r.metrics.volume, mt?.density ?? 7.85) : undefined };
}

/** světová obálka listů podle obálek dílů v mezipaměti */
function leavesBox(cache: Map<string, BuildResult>, leaves: Leaf[]): [Vec3, Vec3] | undefined {
  let bb: [Vec3, Vec3] | undefined;
  for (const l of leaves) {
    const m = cache.get(l.key)?.metrics?.bbox;
    if (!m) continue;
    const pl = matrixToPlacement(l.matrix);
    for (const x of [m[0][0], m[1][0]])
      for (const y of [m[0][1], m[1][1]])
        for (const z of [m[0][2], m[1][2]]) {
          const w = transformPoint(pl, [x, y, z]);
          if (!bb) bb = [[...w] as Vec3, [...w] as Vec3];
          else
            for (let k = 0; k < 3; k++) {
              bb[0][k] = Math.min(bb[0][k], w[k]);
              bb[1][k] = Math.max(bb[1][k], w[k]);
            }
        }
  }
  return bb;
}

/**
 * Stav vazeb sestavy pod klíčem `key`: chybí-li (sestava otevřená z JSON / relace / jiné záložky, vazby přidané mimo
 * textové příkazy), nezná-li některou nepotlačenou vazbu či u ní chybí plocha, NEBO byl spočítán pro jiný stav sestavy
 * (jiný otisk – krok zpět, posun komponenty, upravený díl, změněná vazba; engine/result-key.ts), vazby se přepočítají
 * (`solveAsm`, jako „sestava vazby“ a efekt aplikace po načtení dílů) – dokument se nemění, uloží se jen stav s razítkem
 * sestavy, kterou popisuje: pohnul-li by řešič komponentami, stav patří polohám po přepočtu a pro dokument dál neplatí
 * (`mateStatusState` → „stale“, textový stav „NEPLATÍ“). Bez vazeb → undefined.
 */
export async function ensureMateStatus(ws: Workspace, kernel: KernelApi, doc: CadDoc, key: string, o: AsmEnvOptions = {}): Promise<Record<string, MateStatus> | undefined> {
  const mates = doc.mates ?? [];
  if (doc.kind !== "assembly" || !mates.length) return ws.asm.mateStatus.get(key);
  const { status: st, state } = mateStatusState(ws, key, doc);
  if (st && state === "ok" && mates.every((m) => m.suppressed || (st[m.id] !== undefined && st[m.id] !== "missing"))) return st;
  try {
    const { solveAsm } = await import("../asm-agent");
    const s = await solveAsm(doc, makeAsmEnv(ws, kernel, o));
    // nic se nepohnulo → stav popisuje dokument, jak je (řešič jen doplnil geometrii ploch); jinak polohy po přepočtu
    return setMateStatus(ws, key, s.moved.length ? s.doc : doc, s.status);
  } catch {
    return st;
  }
}

/**
 * Stav sestavy pro textový stav (`docStatusText`): počty, obálka, objem Σ a hmotnost Σ viditelných dílů, poslední
 * kontrola kolizí a stav vazeb z `ws.asm` pod klíčem dokumentu (`o.key`, výchozí aktivní záložka). Díly se nejdřív
 * postaví (`ensureLeaves`), chybějící stav vazeb se přepočítá (`ensureMateStatus`). Díl → undefined.
 */
export async function asmStatus(ws: Workspace, kernel: KernelApi, doc: CadDoc, o: AsmStatusOptions = {}): Promise<AsmStatus | undefined> {
  if (doc.kind !== "assembly") return undefined;
  const key = o.key ?? ws.docKey();
  const all = await ensureLeaves(ws, kernel, doc, o);
  await ensureMateStatus(ws, kernel, doc, key, o);
  const st = asmStatusOf(ws, doc, key, all);
  if (o.quick) return st;
  // obálka přesně z těles listových dílů v jádře (vlna 15, B10 – natočené díly by rohy lokálních obálek zvětšily; engine/asm-box.ts);
  // velké importy ze sítě (`approx`); jádro bez obálky (chyba, starší hostitel) = obálka z lokálních obálek dílů
  const env = await asmWorldBox(kernel, doc);
  return env ? { ...st, bbox: env.bbox, ...(env.approx ? { bboxApprox: env.approx } : {}) } : st;
}

/** stav sestavy z mezipaměti bez stavby (díly musí být postavené – `ensureLeaves`); `key` = klíč dokumentu */
export function asmStatusOf(ws: Workspace, doc: CadDoc, key: string, all: Leaf[] = flattenLeaves(doc)): AsmStatus {
  const cache = ws.asm.cache;
  const vis = all.filter((l) => !l.hidden);
  let volume = 0;
  let mass = 0;
  let known = vis.length > 0;
  for (const l of vis) {
    const v = cache.get(l.key)?.metrics?.volume;
    if (v == null) {
      known = false;
      continue;
    }
    volume += v;
    mass += partInfo(cache, l.comp).massKg ?? 0;
  }
  const clash = ws.asm.clash.get(key);
  const compName = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  return {
    components: (doc.components ?? []).length,
    parts: vis.length,
    bbox: leavesBox(cache, vis),
    volume: known ? volume : undefined,
    massKg: known ? mass : undefined,
    clash: clash ? { count: clash.res.length, pairs: clash.res.map((x) => `${compName(x.a)} × ${compName(x.b)} (${fmtNum(x.volume, 1)} mm³)`), at: clash.at, ...(clashStale(clash, doc) ? { stale: true } : {}) } : null,
    mates: ws.asm.mateStatus.get(key),
    // stav vazeb spočítaný pro jiný stav sestavy (nebo pro polohy po přepočtu, které dokument nemá) – nikdy jako platný
    ...((doc.mates ?? []).length && mateStatusState(ws, key, doc).state === "stale" ? { matesStale: true } : {}),
  };
}

/**
 * Uložené výsledky dokumentu, které pro jeho nynější geometrii neplatí (měření, porovnání s referencí – `noteResult`):
 * textový stav je vypíše jako „NEPLATÍ“ a strojová část `measure.stale=1` / `compare.stale=1` (engine/result-key.ts).
 */
export function staleNotes(ws: Workspace, doc: CadDoc, key: string): StaleNote[] {
  if (doc.kind === "draft") return [];
  const geo = geometrySig(doc);
  return notedResults(ws, key)
    .filter((id) => id.sig !== geo)
    .map((id) => ({ kind: id.kind, rev: id.rev, ...(id.line != null ? { line: id.line } : {}), ...(id.at ? { at: id.at } : {}) }));
}

/**
 * Textový stav aktivního dokumentu (`window.mncad.status()`, stav konzole aplikace) – stejný výpočet jako příkaz `stav`:
 * stavba dílu, u sestavy `asmStatus` (díly postavené, stav vazeb, kolize pod klíčem aktivní záložky).
 */
export async function presentStatusText(ws: Workspace, kernel: KernelApi, o: AsmEnvOptions = {}): Promise<string> {
  const d = ws.present();
  const res = d.kind === "draft" ? null : await kernel.build(d).catch(() => null);
  // obálka sestavy přesně – stejně jako příkaz `stav` (asmStatus → engine/asm-box.ts)
  const asm = await asmStatus(ws, kernel, d, { ...o, key: ws.docKey() }).catch(() => undefined);
  return docStatusText(d, res, asm, staleNotes(ws, d, ws.docKey()));
}

/**
 * Doplňky razítka výkresu (hmotnost, kusovník, pozice komponent) jako ve výkresovém prostředí aplikace: sestava =
 * kusovník (plochý / strukturovaný podle `flat`) z postavených dílů a světové obálky komponent po řádcích kusovníku;
 * díl = hmotnost z objemu postaveného dílu a hustoty materiálu.
 */
export async function drawExtras(ws: Workspace, kernel: KernelApi, doc: CadDoc, o: AsmEnvOptions & { flat?: boolean } = {}): Promise<DrawingExtras> {
  if (doc.kind === "draft") return {};
  if (doc.kind !== "assembly") {
    const r = await kernel.build(doc).catch(() => null);
    const mat = MATERIALS.find((m) => m.id === doc.material) ?? MATERIALS[0];
    return { massKg: r?.metrics ? massKg(r.metrics.volume, mat.density) : undefined };
  }
  const leaves = await ensureLeaves(ws, kernel, doc, o);
  const cache = ws.asm.cache;
  const bom = bomOf(doc, o.flat ?? true, (c) => partInfo(cache, c));
  const balloons: { pos: number; name: string; bbox: [Vec3, Vec3] }[] = [];
  for (const r of bom) {
    const bb = leavesBox(
      cache,
      leaves.filter((l) => r.ids.includes(l.topId) && !l.hidden),
    );
    if (bb) balloons.push({ pos: r.pos, name: r.name, bbox: bb });
  }
  return {
    massKg: bom.reduce((sum, r) => sum + (r.massKg ?? 0) * r.qty, 0),
    bom: bom.map((r) => ({ pos: r.pos, name: r.name, number: r.number, qty: r.qty, material: r.material, massKg: r.massKg })),
    balloons,
  };
}
