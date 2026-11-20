/**
 * Sítě procesní vrstvy pro zobrazení (vlna 22, bod 4): obrobek po střihu / otisku v každém stavu a oddělený odpad. Výpočet je
 * v jádře (cad/process-kernel.ts, stavy zapamatované podle klíče požadavku); prohlížeč si po výsledku studie vyžádá sítě všech
 * stavů najednou (stavů je nejvýš strop operací) – přehrávání, krokování i export snímků (WebGL i softwarový náhled) pak sítě
 * jen čte, synchronně. Export snímků na načtení počká (`ensureProcessMeshes`).
 */
import { useSyncExternalStore } from "react";
import { placementMatrix } from "@/cad/assembly";
import type { MotionResult } from "@/cad/motion";
import { processOf, processRequest, scrapOffset, scrapPlacement } from "@/cad/motion-process";
import { procKey, type ProcReq, type ProcRes } from "@/cad/process-types";
import type { CadDoc, MeshData, Placement } from "@/cad/types";

type Entry = { body: MeshData | null; scrap: MeshData | null };
const store = new Map<string, Entry>();
const pending = new Map<MotionResult, Promise<void>>();
let ver = 0;
const subs = new Set<() => void>();
const bump = () => {
  ver++;
  subs.forEach((f) => f());
};
/** verze úložiště sítí (překreslení 3D okna, když dorazí) */
export function useProcessMeshVer(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => void subs.delete(f);
    },
    () => ver,
    () => 0,
  );
}

/** krátký klíč požadavku operace (síť ve 3D okně se cachuje podle klíče – musí být jedinečný pro stav) */
function shortKey(req: ProcReq): string {
  const s = procKey(req);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${s.length.toString(36)}`;
}
const reqMemo = new WeakMap<MotionResult, Map<string, string>>();
/** klíč operace výsledku (pamatuje se pro výsledek – požadavek se skládá jen jednou) */
function opKey(res: MotionResult, doc: CadDoc, id: string): string | null {
  let m = reqMemo.get(res);
  if (!m) {
    m = new Map();
    reqMemo.set(res, m);
  }
  const hit = m.get(id);
  if (hit !== undefined) return hit || null;
  const o = processOf(res)?.ops.find((x) => x.id === id);
  const op = doc.motion?.process?.find((x) => x.id === id);
  let k = "";
  if (o && op) {
    try {
      k = shortKey(processRequest(doc, res, op, o.start));
    } catch {
      k = "";
    }
  }
  m.set(id, k);
  return k || null;
}

/**
 * Načte sítě všech stavů všech operací výsledku (jednou na výsledek). `proc` = operace jádra (AsmEnv.process). Chyba jádra
 * = sítě chybí a 3D okno ukáže původní obrobek (protokol a panel stav výrobku hlásí dál).
 */
export function ensureProcessMeshes(res: MotionResult, doc: CadDoc, proc: ((req: ProcReq) => Promise<ProcRes>) | undefined): Promise<void> {
  const pr = processOf(res);
  if (!pr || !proc) return Promise.resolve();
  const hit = pending.get(res);
  if (hit) return hit;
  const p = (async () => {
    for (const o of pr.ops) {
      const op = doc.motion?.process?.find((x) => x.id === o.id);
      if (!op || o.states.length < 2) continue;
      try {
        const req = processRequest(doc, res, op, o.start, o.states.map((_, i) => i).slice(1));
        const key = shortKey(req);
        if (store.has(`${key}#${o.states.length - 1}`)) continue;
        const r = await proc(req);
        r.states.forEach((s, i) => {
          if (i > 0) store.set(`${key}#${i}`, { body: s.mesh ?? null, scrap: s.scrapMesh ?? null });
        });
        if (store.size > 600) for (const k of [...store.keys()].slice(0, store.size - 600)) store.delete(k);
      } catch {
        /* bez sítí: zobrazení zůstane u původního obrobku */
      }
    }
    bump();
  })();
  pending.set(res, p);
  return p;
}

/** síť obrobku a odpad pro zobrazený krok: náhrada sítě listu obrobku + odpad jako samostatné těleso */
export type ProcessView = { replace: Map<string, { key: string; mesh: MeshData }>; scrap: { id: string; topId: string; key: string; mesh: MeshData; matrix: number[] }[] };

/**
 * Co ukázat v kroku `k` (index do `res.steps`): obrobek ve stavu kroku (krok 0 / před záběrem = plný = původní síť dílu) a odpad
 * v poloze podle pravidla (s nástrojem / padá / zůstane). `place` = umístění komponent zobrazené polohy (i mezi kroky).
 */
export function processView(res: MotionResult | null, doc: CadDoc, k: number, place: Record<string, Placement> | null): ProcessView | null {
  const pr = processOf(res);
  if (!res || !pr) return null;
  const out: ProcessView = { replace: new Map(), scrap: [] };
  for (const o of pr.ops) {
    const st = o.steps[k]?.state ?? 0;
    if (!st) continue;
    const key = opKey(res, doc, o.id);
    if (!key) continue;
    const e = store.get(`${key}#${st}`);
    if (!e) continue;
    if (e.body) out.replace.set(o.target, { key: `proc:${key}:${st}`, mesh: e.body });
    const off = scrapOffset(o, res.steps, k);
    const tp = place?.[o.target] ?? res.steps[k]?.place[o.target] ?? doc.components?.find((c) => c.id === o.target)?.placement;
    if (e.scrap && off && tp) out.scrap.push({ id: `${o.target}#scrap:${o.id}`, topId: o.target, key: `proc:${key}:${st}:scrap`, mesh: e.scrap, matrix: placementMatrix(scrapPlacement(tp, off)) });
  }
  return out.replace.size || out.scrap.length ? out : null;
}
