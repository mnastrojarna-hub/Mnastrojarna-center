import { describe, it, expect } from "vitest";
import {
  addDraft, draftsFromDetail, draftsProblem, draftsToInputs, parseRowAmount, patchDraft, sameDrafts, setRowText, splitDraft, type AllocationDraft,
} from "./allocation-model";
import type { SupplierInvoiceDetail } from "@/lib/supplier-invoices/types";

const inv = { totalNet: 31_000, items: [{ id: "i1", amount: 30_000 }, { id: "i2", amount: 1_000 }] };
const J1 = { id: "j1", number: "Z-2026-101", title: "", customerName: null };
const J2 = { id: "j2", number: "Z-2026-102", title: "", customerName: null };

describe("editor rozdělení", () => {
  it("procenta i částky", () => {
    expect(parseRowAmount("30 %", 30_000)).toBe(9_000);
    expect(parseRowAmount("33,3%", 100)).toBe(33.3);
    expect(parseRowAmount("10 000", 30_000)).toBe(10_000);
    expect(parseRowAmount("x", 30_000)).toBeNull();
  });

  it("návrh AI 30 000 → Rozdělit → 10 000 sem, 20 000 tam (2 ťuknutí)", () => {
    let rows: AllocationDraft[] = draftsFromDetail({ allocations: [{
      id: "a1", itemId: "i1", target: "job", job: J1, category: null, amount: 30_000, purchaseOrderId: null, purchaseOrderNumber: null,
      purchaseOrderItemId: null, orderItemId: null, orderItemLabel: null, note: null, aiSuggested: true, aiReason: "x", confirmed: false,
      confirmedAt: null, confirmedByName: null,
    }] } as Pick<SupplierInvoiceDetail, "allocations">);
    rows = splitDraft(rows, "i1", inv);                        // ťuk 1
    expect(rows.map((r) => r.amount)).toEqual([15_000, 15_000]);
    rows = setRowText(rows, "a1", "10 000", inv);               // ťuk 2 (napsat částku)
    expect(rows.map((r) => r.amount)).toEqual([10_000, 20_000]);
    expect(rows[1].text).toBe("20 000");
    rows = rows.map((r, i) => (i === 1 ? { ...r, job: J2 } : r));
    expect(draftsProblem(rows, inv)).toBeNull();
    const out = draftsToInputs(rows, true);
    // člověk změnil částku → řádek už není „návrh AI" (značka ani důvod nezůstanou)
    expect(out).toEqual([
      expect.objectContaining({ id: "a1", jobId: "j1", amount: 10_000, confirmed: true, aiSuggested: false, aiReason: null }),
      expect.objectContaining({ id: null, jobId: "j2", amount: 20_000, confirmed: true }),
    ]);
  });

  it("značka AI zmizí po změně zakázky, částky nebo objednávky; potvrzení beze změny ji nechá", () => {
    const base = draftsFromDetail({ allocations: [{
      id: "a1", itemId: "i1", target: "job", job: J1, category: null, amount: 30_000, purchaseOrderId: "po1", purchaseOrderNumber: "OV-1",
      purchaseOrderItemId: null, orderItemId: null, orderItemLabel: null, note: null, aiSuggested: true,
      aiReason: "částka odpovídá otevřené objednávce OV-1", confirmed: false, confirmedAt: null, confirmedByName: null,
    }] } as Pick<SupplierInvoiceDetail, "allocations">);
    expect(draftsToInputs(base, true)[0]).toMatchObject({ aiSuggested: true, aiReason: "částka odpovídá otevřené objednávce OV-1" });
    expect(patchDraft(base, "a1", { purchaseOrderId: null })[0]).toMatchObject({ aiSuggested: false, aiReason: null });
    expect(patchDraft(base, "a1", { job: J2 })[0]).toMatchObject({ aiSuggested: false, aiReason: null });
    expect(setRowText(base, "a1", "10 000", inv)[0]).toMatchObject({ aiSuggested: false, aiReason: null });
    // poznámka / položka zakázky není změna návrhu
    expect(patchDraft(base, "a1", { note: "x", orderItemId: "oi1" })[0]).toMatchObject({ aiSuggested: true });
  });

  it("režie na celý zbytek, procenta v řádku přepočítají zbytkový řádek", () => {
    let rows = addDraft([], "i2", inv, "rezie");
    expect(rows[0]).toMatchObject({ target: "rezie", category: "ostatni", amount: 1_000 });
    rows = splitDraft(rows, "i2", inv);
    rows = setRowText(rows, rows[0].key, "25 %", inv);
    expect(rows.map((r) => r.amount)).toEqual([250, 750]);
  });

  it("chyby: bez zakázky, přes částku, neplatná částka", () => {
    const rows = addDraft([], "i1", inv, "job");
    expect(draftsProblem(rows, inv)).toMatch(/Vyber zakázku/);
    const over = setRowText([{ ...rows[0], job: J1 }], rows[0].key, "31 000", inv);
    expect(draftsProblem(over, inv)).toMatch(/víc/);
    expect(draftsProblem([{ ...rows[0], job: J1, text: "abc" }], inv)).toMatch(/Oprav částku/);
    expect(sameDrafts(rows, rows)).toBe(true);
  });
});
