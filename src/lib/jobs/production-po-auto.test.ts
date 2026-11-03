import { describe, it, expect } from "vitest";
import { decidePurchaseOrderAuto, purchaseOrderScope, purchaseOrderStepKind, type PoAutoFacts } from "./production-po-auto";

const ITEMS = ["i1", "i2"];
const PO: PoAutoFacts["po"] = { id: "po1", supplierId: "s1", supplierName: "Oskar Kremlička", status: "vystavena", kinds: [], itemIds: ["i1", "i2"] };
type Op = PoAutoFacts["ops"][number];
const op = (over: Partial<Op> = {}): Op => ({
  id: "o1", kind: "vyroba", status: "ceka", inHouse: false, supplier: null, supplierName: null, purchaseOrderId: null,
  orderItemIds: null, plannedEnd: null, poMode: null, purchaseOrder: null, ...over,
});
const facts = (over: Partial<PoAutoFacts> = {}): PoAutoFacts => ({ stage: "potvrzeno", ops: [], itemIds: ITEMS, po: PO, ...over });

describe("objednávka dodavateli → předání do výroby (decidePurchaseOrderAuto)", () => {
  it("před výrobou bez postupu: předat — kompletní dodávka (všechny díly), jinak operace / díly objednávky", () => {
    expect(decidePurchaseOrderAuto(facts())).toEqual({ action: "handoff", operationId: null, kind: "kompletni_dodavka", orderItemIds: null, before: [] });
    expect(decidePurchaseOrderAuto(facts({ stage: "objednavka", po: { ...PO, kinds: ["tepelne_zpracovani"], itemIds: ["i1"] } })))
      .toEqual({ action: "handoff", operationId: null, kind: "tepelne_zpracovani", orderItemIds: ["i1"], before: [] });
    expect(purchaseOrderStepKind(["frezovani"], ["i1"])).toBe("frezovani");
    expect(purchaseOrderStepKind([], ["i1"])).toBe("vyroba");
    expect(purchaseOrderStepKind(["frezovani"], null)).toBe("kompletni_dodavka");
    expect(purchaseOrderScope(ITEMS, ["i1", null, "cizí"])).toEqual(["i1"]);
    expect(purchaseOrderScope(ITEMS, [null])).toBeNull();
  });

  it("připravený krok téže firmy / bez firmy se použije; dřívější krok u nás s termínem se spustí první", () => {
    const same = op({ id: "o2", supplier: { id: "s1", name: "Oskar" } });
    expect(decidePurchaseOrderAuto(facts({ ops: [same] }))).toMatchObject({ action: "handoff", operationId: "o2", before: [] });
    expect(decidePurchaseOrderAuto(facts({ ops: [op()] }))).toMatchObject({ action: "handoff", operationId: "o1", before: [] });
    // téže firmě přednost; dřívější krok bez firmy a termínu nejde spustit → jen navázat
    expect(decidePurchaseOrderAuto(facts({ ops: [op(), same] }))).toMatchObject({ action: "plan", operationId: "o2" });
    const usNas = op({ id: "u", inHouse: true, plannedEnd: "2026-11-10", kind: "frezovani" });
    const heat = op({ id: "h", kind: "tepelne_zpracovani" });
    expect(decidePurchaseOrderAuto(facts({ ops: [usNas, heat], po: { ...PO, kinds: ["tepelne_zpracovani"] } })))
      .toEqual({ action: "handoff", operationId: "h", kind: "tepelne_zpracovani", orderItemIds: null, before: ["u"] });
    // dřívější krok nejde spustit sám (bez termínu / u dodavatele bez objednávky) → jen navázat, předá člověk
    const noDate = { ...usNas, plannedEnd: null };
    expect(decidePurchaseOrderAuto(facts({ ops: [noDate, heat], po: { ...PO, kinds: ["tepelne_zpracovani"] } })))
      .toMatchObject({ action: "plan", operationId: "h" });
    // krok jiné firmy se nepřebírá
    const other = op({ id: "x", supplier: { id: "s9", name: "Jiný" } });
    expect(decidePurchaseOrderAuto(facts({ ops: [other] }))).toMatchObject({ action: "plan", operationId: null });
  });

  it("ve výrobě: navázat na krok bez objednávky, jinak přidat krok; už navázaná = nic", () => {
    const running = op({ id: "r", status: "probiha", supplier: { id: "s2", name: "Hrubý" }, purchaseOrderId: "poX", purchaseOrder: { status: "odeslana" } });
    const waiting = op({ id: "w", kind: "tepelne_zpracovani" });
    expect(decidePurchaseOrderAuto(facts({ stage: "ve_vyrobe", ops: [running, waiting], po: { ...PO, kinds: ["tepelne_zpracovani"] } })))
      .toEqual({ action: "link", operationId: "w" });
    expect(decidePurchaseOrderAuto(facts({ stage: "ve_vyrobe", ops: [running] })))
      .toEqual({ action: "add", kind: "kompletni_dodavka", orderItemIds: null, start: false });
    expect(decidePurchaseOrderAuto(facts({ stage: "ve_vyrobe", ops: [] }))).toMatchObject({ action: "add", start: true });
    expect(decidePurchaseOrderAuto(facts({ stage: "ve_vyrobe", ops: [{ ...waiting, purchaseOrderId: "po1" }] }))).toMatchObject({ action: "none" });
  });

  it("nic: před objednávkou zákazníka, uzavřená / dodaná zakázka, návrh nebo zrušená objednávka, bez dodavatele", () => {
    for (const stage of ["poptavka", "nabidka", "dodano_k_nam", "dokonceno", "zruseno"] as const) {
      expect(decidePurchaseOrderAuto(facts({ stage })).action).toBe("none");
    }
    expect(decidePurchaseOrderAuto(facts({ po: { ...PO, status: "navrh" } })).action).toBe("none");
    expect(decidePurchaseOrderAuto(facts({ po: { ...PO, status: "zrusena" } })).action).toBe("none");
    expect(decidePurchaseOrderAuto(facts({ po: { ...PO, supplierId: null } })).action).toBe("none");
  });
});
