/**
 * Geometrie odkazů vazeb pro řešič (sdílí aplikace i textové příkazy): plochy, hrany, vrcholy a jemné sítě ploch vaček
 * z jádra do mezipaměti a převod do souřadnic komponenty nejvyšší úrovně.
 */
import { apply3, rotMatrix, transformPoint } from "./assembly";
import type { FaceGeo, PartFace } from "./mates";
import type { Mate, MateRef, Placement, Vec3 } from "./types";

/** Operace jádra pro geometrii entit listového dílu (klíč = otisk dílu). */
export type EntOps = {
  face: (key: string, index: number) => Promise<PartFace | null>;
  /** hrana / vrchol / jemná síť plochy (vačka) */
  ent?: (key: string, index: number, ent: "edge" | "vertex" | "mesh") => Promise<PartFace | null>;
  /** index válcové plochy podle poloměru (normálie) */
  cylFace?: (key: string, radius: number) => Promise<number>;
};

/** Klíč mezipaměti geometrie entity listového dílu: plocha „klíč:12“ (jako dřív), hrana „klíč:e12“, vrchol „klíč:v12“. */
export const entKey = (leafKey: string, ref: Pick<MateRef, "face" | "ent">) => `${leafKey}:${ref.ent === "edge" ? "e" : ref.ent === "vertex" ? "v" : ""}${ref.face}`;

/** Potřebuje odkaz síť plochy? (plocha vačky) */
export const needsMesh = (m: Mate, ref: MateRef) => m.type === "cam" && ref === m.b;

/**
 * Doplní geometrii všech odkazů vazeb do mezipaměti (`cache`): index válcové plochy normálií podle poloměru, plochy, hrany,
 * vrcholy a u vačky jemnou síť plochy. Vrací kopii vazeb (s doplněnými indexy ploch). Chyby jádra (díl se ještě staví) přeskočí.
 */
export async function ensureMateRefs(mates: Mate[], leafKeyOf: (ref: MateRef) => string | null, cache: Map<string, PartFace>, ops: EntOps): Promise<Mate[]> {
  const out = mates.map((m) => ({ ...m, a: { ...m.a }, b: { ...m.b }, ...(m.c ? { c: { ...m.c } } : {}), ...(m.d ? { d: { ...m.d } } : {}) }));
  for (const m of out)
    for (const ref of [m.a, m.b, m.c, m.d]) {
      if (!ref) continue;
      const key = leafKeyOf(ref);
      if (!key) continue;
      if (ref.face < 0 && ref.radius && ops.cylFace && !ref.ent) {
        const idx = await ops.cylFace(key, ref.radius).catch(() => -1);
        if (idx >= 0) ref.face = idx;
      }
      if (ref.face < 0) continue;
      const k = entKey(key, ref);
      const mesh = needsMesh(m, ref);
      const hit = cache.get(k);
      if (hit && (!mesh || hit.tris?.length)) continue;
      try {
        const info = ref.ent ? await ops.ent?.(key, ref.face, ref.ent) : mesh && ops.ent ? await ops.ent(key, ref.face, "mesh") : await ops.face(key, ref.face);
        if (info) cache.set(k, info);
      } catch {
        /* díl se ještě staví */
      }
    }
  return out;
}

const isIdentity = (p: Placement) => p.position.every((v) => Math.abs(v) < 1e-12) && p.rotation.every((v) => Math.abs(v) < 1e-12);

/**
 * Geometrie entity dílu → souřadnice komponenty nejvyšší úrovně (`rel` = poloha listu vůči ní). Plochy, které vazby neumí
 * („other“ bez sítě), vrací null – jako dřív.
 */
export function refGeo(info: PartFace | undefined, rel: Placement): FaceGeo | null {
  if (!info || (info.kind === "other" && !info.tris?.length)) return null;
  if (isIdentity(rel)) return { kind: info.kind, origin: info.origin, normal: info.normal, radius: info.radius, ...(info.pts ? { pts: info.pts } : {}), ...(info.tris ? { tris: info.tris } : {}), ...(info.nrm ? { nrm: info.nrm } : {}) };
  const R = rotMatrix(rel.rotation);
  return {
    kind: info.kind,
    origin: transformPoint(rel, info.origin),
    normal: apply3(R, info.normal),
    radius: info.radius,
    ...(info.pts ? { pts: info.pts.map((p) => transformPoint(rel, p)) } : {}),
    ...(info.tris ? { tris: info.tris } : {}),
    ...(info.nrm ? { nrm: info.nrm.map((n) => apply3(R, n) as Vec3) } : {}),
  };
}
