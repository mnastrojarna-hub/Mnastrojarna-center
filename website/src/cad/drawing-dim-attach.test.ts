/**
 * Vlna 22, kolo 4 / 6 (bod 20 – výkres): ztracená ruční kóta dostane v okně výkresu „Vybrat znovu“ (drawing-workspace.tsx);
 * nová kóta z nového výběru nahradí ztracenou přes `rebindDim` – zůstane id (odkazy `aN`), tolerance / přípona, text,
 * počet „n× “, revize. Dřív jen ⚠ „vložte ji znovu“ (smazat a zadat novou kótu = nové id, tolerance pryč).
 */
import { describe, expect, it } from "vitest";
import type { DimAnn } from "./drawing";
import { rebindDim } from "./drawing-dim-attach";

describe("rebindDim – znovu vybraná geometrie ztracené kóty", () => {
  it("nová geometrie, id a údaje uživatele z původní kóty", () => {
    const old = { id: "k1", view: "front", type: "dim", kind: "vertical", a: [60, 0], b: [60, 10], offset: 10, edge: true, suffix: "±0,02", text: "(10)", rev: "B", tolShow: "dev" } as unknown as DimAnn;
    const fresh = { id: "new", view: "front", type: "dim", kind: "vertical", a: [30, 0], b: [30, 10], offset: 12, edge: true } as unknown as DimAnn;
    const r = rebindDim(old, fresh) as Extract<DimAnn, { a: unknown }>;
    expect(r.id).toBe("k1");
    expect([r.a, r.b, r.offset]).toEqual([[30, 0], [30, 10], 12]);
    expect([r.suffix, r.text, r.rev, r.tolShow]).toEqual(["±0,02", "(10)", "B", "dev"]);
  });
  it("počet „2× “ zůstane jen u kóty téhož druhu (průměr → průměr); jinou předponu dá nová geometrie", () => {
    const old = { id: "k2", view: "top", type: "dim", kind: "diameter", c: [15, -15], r: 4, ang: 45, offset: 8, prefix: "2× " } as unknown as DimAnn;
    const dia = { id: "x", view: "top", type: "dim", kind: "diameter", c: [20, -15], r: 4, ang: 45, offset: 8 } as unknown as DimAnn;
    expect((rebindDim(old, dia) as { prefix?: string }).prefix).toBe("2× ");
    const lin = { id: "x", view: "top", type: "dim", kind: "horizontal", a: [0, 0], b: [20, 0], offset: 8 } as unknown as DimAnn;
    expect((rebindDim(old, lin) as { prefix?: string }).prefix).toBeUndefined();
  });
});
