/**
 * Malý model pro zkoušky balíku M vlny 22 (bez jádra): Rám, Deska A, Přidržovač a Vodítko jako kvádry se syntetickými plochami
 * odvozenými z prvku Kvádr dílu – změna rozměru dílu tak změní i geometrii, kterou vidí řešič (zkoušky zastaralých výsledků).
 * Plochy každého dílu: F1 spodní (−Z, z = 0), F2 horní (+Z, z = výška), F3 svislá osa (válec Ø10 středem dílu).
 */
import { parseAgentText } from "../agent";
import type { AsmCmd } from "../agent-asm";
import { applyAsmCmd, type AsmEnv, type AsmResult } from "../asm-agent";
import { emptyAssembly, partComponent } from "../assembly";
import type { PartFace } from "../mates";
import { emptyDoc, type BuildResult, type CadDoc, type ComponentSource, type Vec3 } from "../types";

export const boxPart = (name: string, size: Vec3): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [{ id: `${name}-b`, name: "Kvádr 1", type: "box", size, position: [0, 0, 0], centered: false, mode: "new" }] });
const sizeOf = (s: ComponentSource | undefined): Vec3 => {
  const f = s && s.kind !== "file" ? s.doc.features.find((x) => x.type === "box") : undefined;
  return f && f.type === "box" ? (f.size as Vec3) : [1, 1, 1];
};
/** plochy dílu podle rozměru kvádru (F1 spodní, F2 horní, F3 osa Z středem) */
export const boxFaces = (size: Vec3): PartFace[] => [
  { kind: "plane", origin: [size[0] / 2, size[1] / 2, 0], normal: [0, 0, -1] },
  { kind: "plane", origin: [size[0] / 2, size[1] / 2, size[2]], normal: [0, 0, 1] },
  { kind: "cylinder", origin: [size[0] / 2, size[1] / 2, 0], normal: [0, 0, 1], radius: 5, extent: [0, size[2]] },
];

/** prostředí sestavy bez jádra; `calls.parts` počítá stavby dílů (klíč = obsah dílu) */
export function fakeEnv(): AsmEnv & { calls: { parts: number } } {
  const src = new Map<string, ComponentSource>();
  const calls = { parts: 0 };
  return {
    calls,
    parts: async (list) =>
      list.map((p) => {
        if (!src.has(p.key)) calls.parts++;
        src.set(p.key, p.source);
        const result: BuildResult = { status: [], mesh: null, metrics: { volume: sizeOf(p.source).reduce((a, b) => a * b, 1), area: 0, bbox: [[0, 0, 0], sizeOf(p.source)], faces: 3, edges: 0 }, ms: 0 };
        return { key: p.key, result };
      }),
    mateFace: async (key, i) => boxFaces(sizeOf(src.get(key)))[i] ?? null,
    mateEnt: async () => null,
    cylFace: async () => 2,
    geo: new Map(),
    faceLists: new Map(),
    stack: [],
  };
}

/** Rám (ukotvený, 100 × 100 × 10) a Deska A 57,5 mm nad ním; volitelně Přidržovač a Vodítko */
export function press(o: { holder?: boolean } = {}): CadDoc {
  const mk = (n: string, size: Vec3, pos: Vec3, fixed = false) => ({ ...partComponent(boxPart(n, size), { position: pos }, fixed ? { fixed: true } : {}), id: n.toLowerCase().replace(/\s+/g, "-") });
  return {
    ...emptyAssembly("Mechanika"),
    components: [mk("Rám", [100, 100, 10], [0, 0, 0], true), mk("Deska A", [100, 100, 10], [0, 0, 67.5]), ...(o.holder ? [mk("Přidržovač", [100, 100, 8], [0, 0, 30])] : [])],
  };
}

/** provede řádky textových příkazů nad sestavou; vrací dokument, protokol, kódy a strojový řádek posledního příkazu */
export async function runLines(d: CadDoc, env: AsmEnv, ...lines: string[]): Promise<{ doc: CadDoc; log: string[]; codes: NonNullable<AsmResult["codes"]>; kv?: string; last: AsmResult }> {
  let doc = d;
  const log: string[] = [];
  const codes: NonNullable<AsmResult["codes"]> = [];
  let last!: AsmResult;
  for (const line of lines) {
    const p = parseAgentText(line);
    if (p.errors.length) throw new Error(`${line}: ${p.errors[0].message}`);
    last = await applyAsmCmd(doc, (p.ops[0] as { cmd: AsmCmd }).cmd, env);
    doc = last.doc;
    log.push(...last.log);
    codes.push(...(last.codes ?? []));
  }
  return { doc, log, codes, kv: last.kv, last };
}
/** změní rozměr kvádru dílu komponenty (jako úprava dílu v kontextu sestavy) – poloha a vazby beze změny */
export function resizePart(d: CadDoc, comp: string, size: Vec3): CadDoc {
  return {
    ...d,
    components: (d.components ?? []).map((c) => (c.name === comp && c.source.kind === "part" ? { ...c, source: { kind: "part" as const, doc: { ...c.source.doc, features: c.source.doc.features.map((f) => (f.type === "box" ? { ...f, size } : f)) } } } : c)),
  };
}
