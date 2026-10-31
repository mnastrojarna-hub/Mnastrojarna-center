/**
 * IGES → síť přes occt-import-js (OpenCascade ve WebAssembly, LGPL-2.1).
 * Načítá se líně z /public/vendor (kopíruje scripts/vendor-occt.mjs) – hlavní balík zůstává malý.
 */
import type { TriMesh } from "./mesh-io";

export const OCCT_VERSION = "0.0.23";
const BASE = `/vendor/occt-${OCCT_VERSION}/`;

type OcctMesh = { attributes: { position: { array: ArrayLike<number> } }; index?: { array: ArrayLike<number> } };
export type OcctResult = { success: boolean; meshes: OcctMesh[] };
type Occt = { ReadIgesFile: (buf: Uint8Array, params: object | null) => OcctResult };
type Factory = (o?: { locateFile?: (f: string) => string }) => Promise<Occt>;

let loading: Promise<Occt> | null = null;

function loadOcct(): Promise<Occt> {
  if (!loading) {
    loading = new Promise<Factory>((resolve, reject) => {
      const w = globalThis as unknown as { occtimportjs?: Factory };
      if (w.occtimportjs) return resolve(w.occtimportjs);
      if (typeof document === "undefined") return reject(new Error("IGES lze načíst jen v prohlížeči."));
      const s = document.createElement("script");
      s.src = BASE + "occt-import-js.js";
      s.async = true;
      s.onload = () => (w.occtimportjs ? resolve(w.occtimportjs) : reject(new Error("Převodník IGES se nenačetl.")));
      s.onerror = () => reject(new Error("Převodník IGES se nepodařilo stáhnout."));
      document.head.appendChild(s);
    }).then((factory) => factory({ locateFile: (f) => BASE + f }));
    loading.catch(() => (loading = null));
  }
  return loading;
}

/** Výsledek occt-import-js → jedna síť (mm). */
export function occtToMesh(res: OcctResult): TriMesh {
  if (!res?.success) throw new Error("IGES se nepodařilo přečíst (poškozený soubor nebo nepodporované entity).");
  const pos: number[] = [];
  const idx: number[] = [];
  for (const m of res.meshes) {
    const p = m.attributes.position.array;
    const off = pos.length / 3;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    if (m.index) for (let i = 0; i < m.index.array.length; i++) idx.push(m.index.array[i] + off);
    else for (let i = 0; i < p.length / 3; i++) idx.push(off + i);
  }
  if (!idx.length) throw new Error("IGES neobsahuje plochy ani tělesa (jen křivky?).");
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

export async function igesToMesh(buf: Uint8Array, factory?: Factory): Promise<TriMesh> {
  const occt = factory ? await factory() : await loadOcct();
  const res = occt.ReadIgesFile(buf, { linearUnit: "millimeter", linearDeflectionType: "bounding_box_ratio", linearDeflection: 0.0005, angularDeflection: 0.3 });
  return occtToMesh(res);
}
