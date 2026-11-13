/**
 * Tělesa svarového kovu: každý svar (tupý, děrový, bodový, housenka „jako těleso“) založí vlastní těleso „Svar k“
 * (k = pořadí mezi svary v historii), podložka tupého svaru těleso „Podložka k“. Stejné pravidlo používá jádro (weld-kernel.ts)
 * i statická simulace těles (bodies.ts) – bez OCCT a bez dalších závislostí.
 */
import type { Feature } from "../types";

export const WELD_BODY_EXTS = new Set(["weld.groove", "weld.plug", "weld.spot", "weld.bead"]);
export const WELD_PREFIX = "Svar";
export const BACKING_PREFIX = "Podložka";

/** Prvek zakládá těleso svarového kovu? (housenka jen s volbou „jako těleso“) */
export function makesWeldBody(f: Feature): boolean {
  if (f.type !== "ext" || f.suppressed || !WELD_BODY_EXTS.has(f.ext)) return false;
  if (f.ext === "weld.bead") return !!f.data?.separate;
  return true;
}

/**
 * Názvy těles, která prvek na indexu `index` založí: [svar, podložka?]. Vlastní název `data.weldBody` má přednost;
 * jinak „Svar k“ podle pořadí svarů v historii, posunuté na první volné číslo vůči `used`.
 */
export function weldBodyNames(features: Feature[], index: number, used: Iterable<string> = []): string[] {
  const f = features[index];
  if (!f || f.type !== "ext" || !makesWeldBody(f)) return [];
  const taken = new Set(used);
  let k = 1;
  for (let i = 0; i < index; i++) if (makesWeldBody(features[i])) k++;
  const own = typeof f.data?.weldBody === "string" ? f.data.weldBody.trim() : "";
  let name = own;
  if (!name) {
    while (taken.has(`${WELD_PREFIX} ${k}`)) k++;
    name = `${WELD_PREFIX} ${k}`;
  }
  const out = [name];
  if (f.ext === "weld.groove" && f.data?.backing) {
    let b = own ? `${own} – ${BACKING_PREFIX.toLowerCase()}` : `${BACKING_PREFIX} ${k}`;
    let j = k;
    while (!own && taken.has(b)) b = `${BACKING_PREFIX} ${++j}`;
    out.push(b);
  }
  return out;
}
