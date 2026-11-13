/**
 * Otisky výběru indexy (zaoblení, sražení, skořepina, úkos, přímé úpravy, prvky rozšíření) nad skutečným tělesem – běží ve workeru
 * (stavba, razítkování výběru z UI) i v Node (testy). Zápis v dokumentu popisuje `pick-fields.ts`.
 *
 * Při stavbě (`resolvePicks`, strict): index s otiskem se ověří – sedí-li otisk na uloženém indexu, platí index; jinak se entita najde
 * podle otisku (typ + střed + velikost, stejná pravidla a tolerance jako `entityIndex` / `findBySig` v ref-resolve.ts). Nenajde-li se,
 * použije se původní index s varováním ⚠; je-li index mimo rozsah tělesa, prvek skončí srozumitelnou chybou. Index bez otisku = beze změny.
 * Pro UI (`stampPicks`): stejné znovunalezení bez chyb + nové otisky pro indexy, které je ještě nemají (výběr klikem, ze seznamu, pravidlem).
 */
import { tr } from "./i18n";
import * as r from "replicad";
import { vertexPositions } from "./inspect";
import { sigMatch, tolOf, V } from "./ref-resolve";
import { pickFieldsOf, pickIndices, pickSigs, rekey, getPath, withPath, type PickField, type PickKind, type SigMap } from "./pick-fields";
import type { Sig } from "./refs";
import type { Feature, Vec3 } from "./types";

type Shape = r.Shape3D;
const vt = (v: { x: number; y: number; z: number }): Vec3 => [v.x, v.y, v.z];

/**
 * Otisky entit jednoho druhu nad tělesem: seznam ploch / hran / vrcholů se z jádra načte jednou a otisky se počítají líně – výsledek je
 * totožný se `sigOf` (stejný výpočet), ale bez opakovaného procházení topologie pro každý index (`sigOf` načítá celý seznam při každém volání).
 */
export class SigTable {
  readonly count: number;
  private readonly list: (r.Face | r.Edge)[] | null = null;
  private readonly verts: Float32Array | null = null;
  private readonly cache: (Sig | null | undefined)[] = [];
  private tolCache: number | null = null;
  constructor(readonly body: Shape, readonly kind: PickKind) {
    if (kind === "vertex") {
      this.verts = vertexPositions(body);
      this.count = Math.floor(this.verts.length / 3);
    } else {
      this.list = kind === "face" ? body.faces : body.edges;
      this.count = this.list.length;
    }
  }
  /** otisk entity `i` (null = neexistuje / nelze změřit) */
  at(i: number): Sig | null {
    if (!(i >= 0 && i < this.count)) return null;
    const hit = this.cache[i];
    if (hit !== undefined) return hit;
    let s: Sig | null = null;
    try {
      if (this.kind === "vertex") {
        const v = this.verts!;
        s = { t: "V", c: [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]], s: 0 };
      } else if (this.kind === "face") {
        const f = this.list![i] as r.Face;
        s = { t: f.geomType as string, c: vt(f.center), s: r.measureArea(f) };
      } else {
        const e = this.list![i] as r.Edge;
        s = { t: e.geomType as string, c: vt(e.pointAt(0.5)), s: e.length };
      }
    } catch {
      s = null;
    }
    this.cache[i] = s;
    return s;
  }
  /** tolerance tělesa (jako `tolOf` v ref-resolve.ts) */
  get tol(): number {
    if (this.tolCache === null) this.tolCache = tolOf(this.body);
    return this.tolCache;
  }
  /** entita podle otisku – stejné pravidlo jako `findBySig` (nejbližší střed stejného typu, velikost v toleranci); -1 = nenalezeno */
  find(sig: Sig): number {
    const tol = this.tol * 50;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.count; i++) {
      const s = this.at(i);
      if (!s || s.t !== sig.t) continue;
      const d = V.len(V.sub(s.c, sig.c)) + (Math.abs(s.s - sig.s) / Math.max(1, Math.abs(sig.s))) * tol;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return bestD <= tol ? best : -1;
  }
  /** index s otiskem → aktuální index (jako `entityIndex`): „same“ = sedí na místě, „moved“ = nalezen jinde, „lost“ = nenalezen */
  resolve(index: number, sig: Sig): { index: number; how: "same" | "moved" | "lost" } {
    const cur = this.at(index);
    if (cur && sigMatch(cur, sig, this.tol * 10)) return { index, how: "same" };
    const j = this.find(sig);
    if (j >= 0) return { index: j, how: j === index ? "same" : "moved" };
    return { index, how: "lost" };
  }
}

/** Otisky entit tělesa podle indexů (pro razítkování výběru; null = index v tělese není). */
export function sigsOf(body: Shape, kind: PickKind, indices: number[]): (Sig | null)[] {
  const t = new SigTable(body, kind);
  return indices.map((i) => t.at(i));
}

const lostMsg = (kind: PickKind, list: number[]) => {
  const n = list.map((i) => i + 1).join(", ");
  if (list.length > 1) return kind === "edge" ? tr("Hrany {0} se po změně modelu nenašly podle otisku – použity původní indexy.", n) : kind === "face" ? tr("Plochy {0} se po změně modelu nenašly podle otisku – použity původní indexy.", n) : tr("Vrcholy {0} se po změně modelu nenašly podle otisku – použity původní indexy.", n);
  return kind === "edge" ? tr("Hrana {0} se po změně modelu nenašla podle otisku – použit původní index.", n) : kind === "face" ? tr("Plocha {0} se po změně modelu nenašla podle otisku – použit původní index.", n) : tr("Vrchol {0} se po změně modelu nenašel podle otisku – použit původní index.", n);
};
const goneMsg = (kind: PickKind, index: number, count: number) =>
  kind === "edge"
    ? tr("Hrana {0} se po změně modelu nenašla podle otisku a těleso ji už nemá (hran: {1}) – vyberte ji znovu.", index + 1, count)
    : kind === "face"
      ? tr("Plocha {0} se po změně modelu nenašla podle otisku a těleso ji už nemá (ploch: {1}) – vyberte ji znovu.", index + 1, count)
      : tr("Vrchol {0} se po změně modelu nenašel podle otisku a těleso ho už nemá (vrcholů: {1}) – vyberte ho znovu.", index + 1, count);

type FieldResult = { fd: PickField; indices: number[]; sigs: SigMap; remap: Map<number, number>; lost: Set<number>; matched: Map<number, number>; changed: boolean };

/** znovunalezení jednoho pole výběru; `strict` = index mimo rozsah bez nalezeného otisku je chyba (stavba) */
function resolveField(f: Feature, fd: PickField, tables: Map<PickKind, SigTable>, body: Shape, strict: boolean): FieldResult | null {
  const idx = pickIndices(f, fd);
  if (!idx) return null;
  const sigs = pickSigs(f, fd);
  const res: FieldResult = { fd, indices: [], sigs, remap: new Map(), lost: new Set(), matched: new Map(), changed: false };
  let table = tables.get(fd.kind);
  for (const i of idx) {
    const sig = sigs[String(i)];
    let j = i;
    if (sig) {
      if (!table) tables.set(fd.kind, (table = new SigTable(body, fd.kind)));
      const hit = table.resolve(i, sig);
      if (hit.how === "lost") {
        if (strict && !(i < table.count)) throw new Error(goneMsg(fd.kind, i, table.count));
        res.lost.add(i);
      } else {
        j = hit.index;
        res.matched.set(i, j);
      }
    }
    if (j !== i) res.remap.set(i, j);
    if (res.indices.includes(j)) res.changed = true; // dvě vybrané entity se po přečíslování našly jako jedna
    else res.indices.push(j);
  }
  if (res.remap.size) res.changed = true;
  return res;
}

/** výsledné indexy pole a mapy klíčované indexem (poloměry, tloušťky) do kopie prvku */
function applyField(f: Feature, r0: FieldResult): Feature {
  let out = withPath(f, r0.fd.path, r0.indices);
  for (const p of r0.fd.keyed ?? []) {
    const m = getPath(f, p) as Record<string, unknown> | undefined;
    if (m && typeof m === "object") out = withPath(out, p, rekey(m, r0.remap));
  }
  return out;
}

export type PickResolution = { feature: Feature; warnings: string[]; changed: boolean };

/**
 * Stavba: indexy výběru s otiskem znovu najde v tělese PŘED prvkem. Vrací prvek s aktuálními indexy (tentýž objekt, když se nic
 * nezměnilo) a varování pro entity nenalezené podle otisku; index mimo rozsah bez nalezeného otisku = chyba prvku.
 */
export function resolvePicks(f: Feature, body: Shape | null): PickResolution {
  if (!body) return { feature: f, warnings: [], changed: false };
  const fields = pickFieldsOf(f);
  if (!fields.length) return { feature: f, warnings: [], changed: false };
  const tables = new Map<PickKind, SigTable>();
  const warnings: string[] = [];
  let out = f;
  let changed = false;
  for (const fd of fields) {
    const sigs = pickSigs(f, fd);
    if (!Object.keys(sigs).length) continue; // bez otisků přesně jako dřív
    const res = resolveField(f, fd, tables, body, true);
    if (!res) continue;
    if (res.lost.size) warnings.push(lostMsg(fd.kind, [...res.lost]));
    if (res.changed) {
      out = applyField(out, res);
      changed = true;
    }
  }
  return { feature: out, warnings, changed };
}

/**
 * Razítkování výběru (UI, textové příkazy): indexy s otiskem znovu najde (u přečíslovaných entit přepíše index – zvýraznění a další
 * klikání pak sedí na skutečné entity), indexům bez otisku otisk doplní z tělesa před prvkem a vynechá otisky odebraných indexů.
 * Otisk entity, která se nenašla, zůstává původní (varování ve stromu zmizí, až ji uživatel vybere znovu). Bez chyb – neplatný index
 * zůstane, jak je. Vrací `changed` = prvek se liší od vstupu.
 */
export function stampPicks(f: Feature, body: Shape): { feature: Feature; changed: boolean; warnings: string[] } {
  const tables = new Map<PickKind, SigTable>();
  const warnings: string[] = [];
  let out = f;
  let changed = false;
  for (const fd of pickFieldsOf(f)) {
    const res = resolveField(f, fd, tables, body, false);
    if (!res) continue;
    if (res.lost.size) warnings.push(lostMsg(fd.kind, [...res.lost]));
    let table = tables.get(fd.kind);
    const next: SigMap = {};
    for (const j of res.indices) {
      const from = [...res.remap].find(([, b]) => b === j)?.[0] ?? j;
      const old = res.sigs[String(from)];
      if (old && res.lost.has(from)) {
        next[String(j)] = old;
        continue;
      }
      // nalezené na místě: ponechat uložený otisk, je-li shodný (žádná zbytečná změna dokumentu); jinak aktuální otisk entity
      if (!table) tables.set(fd.kind, (table = new SigTable(body, fd.kind)));
      const cur = table.at(j);
      if (old && cur && from === j && sameSig(old, cur)) next[String(j)] = old;
      else if (cur) next[String(j)] = cur;
      else if (old) next[String(j)] = old;
    }
    const prev = getPath(f, fd.sigPath);
    const emptyBefore = !prev || (typeof prev === "object" && !Object.keys(prev as object).length);
    const emptyNow = !Object.keys(next).length;
    if (res.changed) {
      out = applyField(out, res);
      changed = true;
    }
    if (!(emptyBefore && emptyNow) && JSON.stringify(prev ?? null) !== JSON.stringify(next)) {
      out = withPath(out, fd.sigPath, emptyNow ? undefined : next);
      changed = true;
    }
  }
  return { feature: changed ? out : f, changed, warnings };
}

const sameSig = (a: Sig, b: Sig) => a.t === b.t && a.s === b.s && a.c[0] === b.c[0] && a.c[1] === b.c[1] && a.c[2] === b.c[2];
