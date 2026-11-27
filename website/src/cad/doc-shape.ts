/**
 * Mezipaměť podle objektu dokumentu, která přežije úpravu NA MÍSTĚ (vlna 22, bod 20 – kolo 7b).
 *
 * Engine mění dokument běhu na místě (`r.doc.features.push(…)` – engine/ops/feature.ts a další), takže mezipaměť klíčovaná jen
 * objektem dokumentu vracela starou hodnotu: po `výkres vydat` a pak `díra …` zůstala revize modelu r·… stejná a `výstupy`
 * psaly „List 1: … odpovídá modelu“ / „Zastaralé výstupy: žádné“, přestože se geometrie změnila (falešná zelená). Uložená
 * hodnota proto platí jen se stejným „tvarem“ dokumentu: tytéž hodnoty vlastností nejvyšší úrovně a tytéž objekty prvků
 * a komponent (porovnání odkazů – levné; prvek nahrazený novým objektem i přidaný / odebraný prvek se pozná).
 */
type Shaped = { features?: readonly unknown[]; components?: readonly unknown[] };

/** odkazy, podle kterých se pozná změna dokumentu na místě */
export function docShape(d: object): unknown[] {
  const x = d as Shaped;
  return [...Object.keys(d), ...Object.values(d), x.features?.length ?? -1, ...(x.features ?? []), x.components?.length ?? -1, ...(x.components ?? [])];
}
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** mezipaměť `key → hodnota` podle objektu, platná jen pro nezměněný tvar dokumentu */
export function shapeMemo<T>(): { get: (d: object) => T | undefined; set: (d: object, v: T) => void } {
  const m = new WeakMap<object, { shape: unknown[]; v: T }>();
  return {
    get: (d) => {
      const hit = m.get(d);
      return hit && same(hit.shape, docShape(d)) ? hit.v : undefined;
    },
    set: (d, v) => void m.set(d, { shape: docShape(d), v }),
  };
}
