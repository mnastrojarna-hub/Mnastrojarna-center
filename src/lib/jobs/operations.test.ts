import { describe, it, expect } from "vitest";
import { DEADLINE_STATE_META, OPERATION_KINDS, OPERATION_KIND_ORDER, OPERATION_TEMPLATES, isDeadlineState, nextOperationStatus, productionLabel, isOperationKind } from "./operations";

describe("výrobní operace", () => {
  it("každý druh má popisek, ikonu a barvy; pořadí pokrývá všechny druhy", () => {
    expect(new Set(OPERATION_KIND_ORDER)).toEqual(new Set(Object.keys(OPERATION_KINDS)));
    for (const k of OPERATION_KIND_ORDER) {
      expect(OPERATION_KINDS[k].label.length).toBeGreaterThan(2);
      expect(OPERATION_KINDS[k].badge).toMatch(/bg-/);
    }
  });
  it("šablony používají jen známé druhy", () => {
    for (const t of OPERATION_TEMPLATES) for (const k of t.kinds) expect(isOperationKind(k)).toBe(true);
  });
  it("jedním klepnutím čeká → probíhá → hotovo", () => {
    expect(nextOperationStatus("ceka")).toBe("probiha");
    expect(nextOperationStatus("probiha")).toBe("hotovo");
    expect(nextOperationStatus("problem")).toBe("hotovo");
    expect(nextOperationStatus("hotovo")).toBeNull();
  });
  it("popisek místa výroby", () => {
    expect(productionLabel("tepelne_zpracovani", "TepKal s.r.o.")).toBe("Tepelné zpracování · TepKal s.r.o.");
    expect(productionLabel("brouseni", "U nás")).toBe("Broušení · U nás");
    expect(productionLabel("hotovo", null)).toBe("Výroba hotová");
    expect(productionLabel(null, null)).toBeNull();
  });
  it("„Výroba“ je první druh (rose), šablona výroba → kalení → výroba, stavy termínu", () => {
    expect(OPERATION_KIND_ORDER[0]).toBe("vyroba");
    expect(OPERATION_KINDS.vyroba).toMatchObject({ label: "Výroba", dot: "bg-rose-500" });
    expect(OPERATION_TEMPLATES.find((t) => t.key === "vyroba_kaleni")?.kinds).toEqual(["vyroba", "tepelne_zpracovani", "vyroba"]);
    expect(productionLabel("vyroba", "Frézy Novák")).toBe("Výroba · Frézy Novák");
    expect(Object.keys(DEADLINE_STATE_META).sort()).toEqual(["dohodnuto", "odhad", "plan", "potvrzeno", "pozadovano", "zmena_ceka"]);
    expect(DEADLINE_STATE_META.potvrzeno.tone).toBe("green");
    expect(DEADLINE_STATE_META.pozadovano.tone).toBe("amber");
    expect(isDeadlineState("odhad")).toBe(true);
    expect(isDeadlineState("dohodnut")).toBe(false);
  });
});
