import { describe, it, expect } from "vitest";
import { jobNumbersIn, overheadCategoryOf, proposeAllocations, purchaseOrderNumbersIn, type MatchJob, type MatchPurchaseOrder } from "./matching";

const refs: Record<"purchaseOrderNumbers" | "jobNumbers" | "customerOrderNumbers" | "deliveryNoteNumbers" | "drawingNumbers", string[]> = {
  purchaseOrderNumbers: [], jobNumbers: [], customerOrderNumbers: [], deliveryNoteNumbers: [], drawingNumbers: [],
};
const PO: MatchPurchaseOrder = {
  id: "po1", number: "OV-2026-014", jobId: "j1", jobNumber: "Z-2026-101", supplierId: "s1", status: "potvrzena", total: 30_000, invoiced: false,
  items: [{ id: "poi1", drawingNumber: "4711-02", name: "Příruba", orderItemId: "oi1" }],
};
const JOBS: MatchJob[] = [
  { id: "j1", number: "Z-2026-101", customerOrderNumber: "PO-4471", closed: false, items: [{ id: "oi1", drawingNumber: "4711-02", name: "Příruba" }] },
  { id: "j2", number: "Z-2026-102", customerOrderNumber: "4500021877", closed: false, items: [{ id: "oi2", drawingNumber: "5500-01", name: "Hřídel" }] },
  { id: "j3", number: "Z-2026-103", customerOrderNumber: null, closed: true, items: [{ id: "oi3", drawingNumber: "9900-01", name: "X" }] },
];
const inv = (items: { id: string; text: string; code?: string; amount: number; refs?: string[] }[], o: Partial<{ supplierId: string | null; totalNet: number; references: typeof refs }> = {}) => ({
  supplierId: o.supplierId ?? "s1", totalNet: o.totalNet ?? items.reduce((s, i) => s + i.amount, 0),
  items: items.map((i) => ({ code: null, refs: [], ...i })), references: o.references ?? refs,
});

describe("čísla v textu", () => {
  it("naše objednávky a zakázky", () => {
    expect(purchaseOrderNumbersIn("Výroba dle obj. OV-2026-014 a OV 2026/15")).toEqual(["OV-2026-014", "OV-2026-15"]);
    expect(jobNumbersIn("k zakázce Z-2026-101")).toEqual(["Z-2026-101"]);
  });
  it("režie podle klíčových slov", () => {
    expect(overheadCategoryOf("Doprava a balné")?.category).toBe("doprava");
    expect(overheadCategoryOf("Elektřina 10/2026")?.category).toBe("energie");
    expect(overheadCategoryOf("Výroba příruby")).toBeNull();
  });
});

describe("návrh rozdělení", () => {
  it("OV v řádku → objednávka i položka (výkres)", () => {
    const [a] = proposeAllocations(inv([{ id: "i1", text: "Výroba 4711-02 dle obj. OV-2026-014", amount: 30_000 }]), [PO], JOBS);
    expect(a).toMatchObject({ itemId: "i1", target: "job", jobId: "j1", purchaseOrderId: "po1", purchaseOrderItemId: "poi1", orderItemId: "oi1", amount: 30_000 });
    expect(a.reason).toMatch(/OV-2026-014/);
  });
  it("Z-číslo, objednávka zákazníka a výkres", () => {
    const r = proposeAllocations(inv([
      { id: "a", text: "Kalení — zakázka Z-2026-102", amount: 1_000 },
      { id: "b", text: "Broušení vaše obj. 4500021877", amount: 2_000 },
      { id: "c", text: "Soustružení", code: "5500-01", amount: 3_000 },
    ], { supplierId: null }), [], JOBS);
    expect(r.map((x) => [x.itemId, x.jobId])).toEqual([["a", "j2"], ["b", "j2"], ["c", "j2"]]);
    expect(r[2].orderItemId).toBe("oi2");
  });
  it("uzavřená zakázka se podle výkresu nenavrhne", () => {
    expect(proposeAllocations(inv([{ id: "a", text: "Díl 9900-01", amount: 10 }], { supplierId: null }), [], JOBS)).toEqual([]);
  });
  it("odkaz v hlavičce platí pro řádky bez vlastního důkazu; doprava = režie", () => {
    const r = proposeAllocations(inv([
      { id: "a", text: "Výroba", amount: 25_000 },
      { id: "b", text: "Doprava", amount: 500 },
    ], { references: { ...refs, purchaseOrderNumbers: ["OV-2026-014"] } }), [PO], JOBS);
    expect(r.find((x) => x.itemId === "a")).toMatchObject({ jobId: "j1", purchaseOrderId: "po1" });
    expect(r.find((x) => x.itemId === "b")).toMatchObject({ target: "rezie", category: "doprava" });
  });
  it("jediná otevřená objednávka dodavatele se shodnou částkou (±2 %)", () => {
    expect(proposeAllocations(inv([{ id: "a", text: "Práce", amount: 29_700 }]), [PO], JOBS)[0]).toMatchObject({ purchaseOrderId: "po1" });
    expect(proposeAllocations(inv([{ id: "a", text: "Práce", amount: 20_000 }]), [PO], JOBS)).toEqual([]);
    expect(proposeAllocations(inv([{ id: "a", text: "Práce", amount: 30_000 }]), [{ ...PO, invoiced: true }], JOBS)).toEqual([]);
  });
  it("objednávku, na kterou už jde řádek téže faktury, nenavrhne podruhé podle částky", () => {
    // FA-REV-31: ř. 1 „dle Vaší obj. OV-2026-014" (28 000), ř. 2 „Výroba přírub — sdružené zakázky" (30 000 = částka objednávky)
    const r = proposeAllocations(inv([
      { id: "a", text: "Příruby dle Vaší obj. OV-2026-014", amount: 28_000 },
      { id: "b", text: "Výroba přírub — sdružené zakázky", amount: 30_000 },
    ]), [PO], JOBS);
    expect(r).toEqual([expect.objectContaining({ itemId: "a", purchaseOrderId: "po1" })]);
    expect(r.filter((x) => x.purchaseOrderId === "po1")).toHaveLength(1);
  });
  it("fotí se u zakázky → řádky bez důkazu dostanou návrh na ni (s její objednávkou u dodavatele)", () => {
    const r = proposeAllocations(inv([
      { id: "a", text: "Kalení", amount: 4_000 },
      { id: "b", text: "Doprava", amount: 300 },
    ]), [PO], JOBS, { fallbackJobId: "j1" });
    expect(r.find((x) => x.itemId === "a")).toMatchObject({ jobId: "j1", purchaseOrderId: "po1" });
    expect(r.find((x) => x.itemId === "a")?.reason).toMatch(/nahraný u zakázky Z-2026-101/);
    expect(r.find((x) => x.itemId === "b")).toMatchObject({ target: "rezie" });
    // bez objednávky dodavatele na zakázce → jen zakázka
    expect(proposeAllocations(inv([{ id: "a", text: "Kalení", amount: 4_000 }], { supplierId: "s9" }), [PO], JOBS, { fallbackJobId: "j2" })[0])
      .toMatchObject({ jobId: "j2", purchaseOrderId: null });
    // neznámá zakázka → nic
    expect(proposeAllocations(inv([{ id: "a", text: "Kalení", amount: 4_000 }], { supplierId: "s9" }), [], JOBS, { fallbackJobId: "jx" })).toEqual([]);
  });
  it("faktura bez položek → celá částka z hlavičky", () => {
    const r = proposeAllocations(inv([], { totalNet: 30_000, references: { ...refs, purchaseOrderNumbers: ["OV-2026-014"] } }), [PO], JOBS);
    expect(r).toEqual([expect.objectContaining({ itemId: null, amount: 30_000, purchaseOrderId: "po1" })]);
  });
});
