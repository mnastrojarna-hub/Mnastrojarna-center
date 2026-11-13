/**
 * Barva svarového kovu v 3D okně: plochy těles „Svar k“ / „Podložka k“ (podle historie, stejně jako bodies.ts) dostanou barvu
 * svaru; vlastní barvy ploch (`doc.faceColors`) mají přednost. Bez OCCT.
 */
import { bodiesAt } from "../bodies";
import type { BodyInfo, CadDoc } from "../types";
import { weldBodyNames } from "./weld-bodies";

export const WELD_COLOR = "#a8743a";
export const BACKING_COLOR = "#7d8794";

/** názvy těles svarového kovu a podložek v dokumentu */
export function weldBodySet(doc: Pick<CadDoc, "features">): { weld: Set<string>; backing: Set<string> } {
  const weld = new Set<string>();
  const backing = new Set<string>();
  doc.features.forEach((f, i) => {
    const names = weldBodyNames(doc.features, i, bodiesAt(doc, i).names);
    if (names[0]) weld.add(names[0]);
    if (names[1]) backing.add(names[1]);
  });
  return { weld, backing };
}

const cache = new WeakMap<object, { key: string; out: Record<number, string> | undefined }>();

/** barvy ploch pro 3D okno: plochy svarových těles + vlastní barvy ploch dokumentu */
export function weldFaceColors(doc: CadDoc, bodies: BodyInfo[] | undefined, own: Record<number, string> | undefined): Record<number, string> | undefined {
  if (!bodies || bodies.length < 2 || !doc.features.some((f) => f.type === "ext" && f.ext.startsWith("weld."))) return own;
  const key = JSON.stringify([bodies.map((b) => [b.name, b.faceStart, b.faceCount]), own ?? null]);
  const hit = cache.get(doc.features);
  if (hit && hit.key === key) return hit.out;
  const { weld, backing } = weldBodySet(doc);
  const out: Record<number, string> = {};
  for (const b of bodies) {
    const c = weld.has(b.name) ? WELD_COLOR : backing.has(b.name) ? BACKING_COLOR : null;
    if (c) for (let i = 0; i < b.faceCount; i++) out[b.faceStart + i] = c;
  }
  const res = Object.keys(out).length ? { ...out, ...(own ?? {}) } : own;
  cache.set(doc.features, { key, out: res });
  return res;
}
