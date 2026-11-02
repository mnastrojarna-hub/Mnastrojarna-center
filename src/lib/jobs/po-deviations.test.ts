import { describe, it, expect } from "vitest";
import {
  activeDeviations, attachmentMailLines, cleanDeviations, collectItemDeviations, deviationLines, deviationMailSection, deviationText,
  pickPoAttachments, poAttachmentPlan, poNeutralName, resolveDeviations,
  type DeviationSources, type PoFileSource, type PoLineRef,
} from "./po-deviations";
import { purchaseOrderChangeEmail, purchaseOrderEmail } from "./purchasing";

const IT = "11111111-1111-4111-8111-111111111111";
const IT2 = "22222222-2222-4222-8222-222222222222";

const src = (over: Partial<DeviationSources> = {}): DeviationSources => ({ mailChanges: [], corrections: [], drawingChanges: [], ...over });

describe("collectItemDeviations", () => {
  it("propsané pokyny zákazníka z e-mailu (nadřazené výkresu) — jen applied, jen té položky", () => {
    const d = collectItemDeviations({ id: IT, revision: "B" }, src({
      mailChanges: [
        { id: "m1", order_item_id: IT, field: "material", status: "applied", kind: "change", value_new: "1.4301", drawing_value: "11 523", created_at: "2026-11-01T08:00:00Z" },
        { id: "m2", order_item_id: IT, field: "heat", status: "superseded", kind: "change", value_new: "kalení", drawing_value: null, created_at: "2026-11-01T08:00:00Z" },
        { id: "m3", order_item_id: IT, field: "tolerance", status: "applied", kind: "change", value_new: "Pokyn z e-mailu 1. 11.: díra Ø12 H7 místo H8", drawing_value: null, created_at: "2026-11-01T09:00:00Z" },
        { id: "m4", order_item_id: IT2, field: "surface", status: "applied", kind: "change", value_new: "zinek", drawing_value: null, created_at: "2026-11-01T09:00:00Z" },
        { id: "m5", order_item_id: IT, field: "quantity", status: "applied", kind: "change", value_new: "150 ks", drawing_value: null, created_at: "2026-11-01T09:00:00Z" },
        { id: "m6", order_item_id: IT, field: "surface", status: "suggested", kind: "change", value_new: "elox", drawing_value: null, created_at: "2026-11-01T09:00:00Z" },
      ],
    }));
    expect(d.map((x) => x.key)).toEqual(["email:m1", "email:m3"]);
    expect(deviationText(d[0])).toBe("Materiál: 1.4301 (na výkresu: 11 523)");
    expect(d[1].value).toBe("díra Ø12 H7 místo H8");
  });

  it("nová revize (aktuální) + revize z e-mailu splyne; stará revize se nehlásí", () => {
    const changes = [
      { id: "c1", order_item_id: IT, rev_from: "A", rev_to: "B", created_at: "2026-10-01T00:00:00Z" },
      { id: "c2", order_item_id: IT, rev_from: "B", rev_to: "C", created_at: "2026-11-01T00:00:00Z" },
    ];
    const d = collectItemDeviations({ id: IT, revision: "C" }, src({
      drawingChanges: changes,
      mailChanges: [{ id: "m", order_item_id: IT, field: "revision", status: "applied", kind: "change", value_new: "C", drawing_value: "B", created_at: "2026-11-01T00:00:00Z" }],
    }));
    expect(d).toEqual([{ key: "rev:C", source: "revize", label: "Revize výkresu", value: "C", was: "B" }]);
    expect(deviationText(d[0])).toBe("Platí revize výkresu C (nahrazuje rev. B)");
    expect(collectItemDeviations({ id: IT, revision: "D" }, src({ drawingChanges: changes }))).toEqual([]);
  });

  it("oprava zakázky: poslední počet kusů položky, jen když sedí s řádkem objednávky; ceny nikdy", () => {
    const corrections = [
      { at: "2026-11-01T08:00:00Z", changes: [{ field: `item:${IT}:quantity`, from: 120, to: 140 }, { field: `item:${IT}:unit_price`, from: 10, to: 12 }] },
      { at: "2026-11-02T08:00:00Z", changes: [{ field: `item:${IT}:quantity`, from: 140, to: 150 }, { field: "due_date", from: "2026-11-10", to: "2026-11-20" }] },
    ];
    const d = collectItemDeviations({ id: IT, unit: "ks" }, src({ corrections }), { quantity: 150 });
    expect(d).toHaveLength(1);
    expect(deviationText(d[0])).toBe("Počet kusů: 150 ks (dříve 140 ks)");
    expect(collectItemDeviations({ id: IT }, src({ corrections }), { quantity: 160 })).toEqual([]);
  });

  it("poznámka Pro dodavatele jen když ji řádek ještě nenese", () => {
    expect(collectItemDeviations({ id: IT, supplier_note: "Pozor: popsat na čele" }, src(), { note: "Pozor: popsat na čele" })).toEqual([]);
    const d = collectItemDeviations({ id: IT, supplier_note: "popsat na čele" }, src(), { note: null });
    expect(d[0]).toMatchObject({ source: "dodavatel", value: "popsat na čele" });
  });
});

describe("potvrzený seznam", () => {
  const auto = collectItemDeviations({ id: IT, revision: "C" }, src({
    drawingChanges: [{ id: "c", order_item_id: IT, rev_from: "B", rev_to: "C", created_at: "2026-11-01T00:00:00Z" }],
    mailChanges: [{ id: "m1", order_item_id: IT, field: "material", status: "applied", kind: "change", value_new: "1.4301", drawing_value: "S235", created_at: "2026-11-01T08:00:00Z" }],
  }));

  it("null = vše ze zdrojů; vypnutá se nevrátí; nová ze zdrojů se přidá; ruční zůstane", () => {
    expect(resolveDeviations(auto, null)).toEqual(auto);
    const stored = cleanDeviations([
      { ...auto[0] },
      { key: "rucne:x", source: "rucne", label: "Sražení hran", value: "0,5×45°" },
      { key: "email:m0", source: "email", label: "Materiál", value: "S355", off: true },
    ])!;
    const r = resolveDeviations(auto, stored);
    expect(r.map((x) => x.key)).toEqual(["rev:C", "rucne:x", "email:m0", "email:m1"]);
    expect(deviationLines(r)).toEqual([
      "Platí revize výkresu C (nahrazuje rev. B)", "Sražení hran: 0,5×45°", "Materiál: 1.4301 (na výkresu: S235)",
    ]);
    expect(activeDeviations(r.map((x) => (x.key === "email:m1" ? { ...x, off: true } : x)))).toHaveLength(2);
  });

  it("cleanDeviations zahodí prázdné / nesmysly, doplní klíč ručním", () => {
    expect(cleanDeviations(null)).toBeNull();
    expect(cleanDeviations("x")).toBeNull();
    const c = cleanDeviations([{ value: "  " }, { label: "Díra", value: "Ø10 H7", source: "xxx" }, 7])!;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ source: "rucne", label: "Díra", value: "Ø10 H7" });
    expect(c[0].key).toMatch(/^rucne:/);
  });
});

describe("e-mail objednávky", () => {
  it("souhrn odchylek a příloh v textu (vystavení i změna)", () => {
    const mail = purchaseOrderEmail({
      number: "OV-2026-010", companyName: "Mnástrojárna s.r.o.", drawingsSeparately: true,
      deviations: [{ ref: "VK-2291", lines: ["Materiál: 1.4301 (na výkresu: S235)"] }],
      attachmentLines: attachmentMailLines([{ role: "drawing", name: "VK-2291_C.pdf" }, { role: "model", name: "VK-2291_C.step" }], [], "vy"),
    });
    expect(mail.body).toContain("Pozor — u těchto položek platí odchylky od výkresu");
    expect(mail.body).toContain("– VK-2291: Materiál: 1.4301 (na výkresu: S235)");
    expect(mail.body).toContain("V příloze dále zasíláme výkresy a 3D modely k objednaným položkám.");
    expect(mail.body).not.toContain("pošleme samostatně");

    const ch = purchaseOrderChangeEmail({
      number: "OV-2026-010", companyName: "Mnástrojárna s.r.o.", revision: 2, reason: "nová revize výkresu VK-2291 rev. C",
      attachmentLines: attachmentMailLines([{ role: "drawing", name: "VK-2291_C.pdf" }], [{ ref: "VK-2291", to: "C", from: "B" }], "vy"),
    });
    expect(ch.body).toContain("Výkres VK-2291: platí nová revize C — revize B je nahrazena a neplatí.");
    expect(deviationMailSection([], "vy")).toEqual([]);
  });
});

describe("přílohy e-mailu objednávky", () => {
  const lines: PoLineRef[] = [
    { index: 0, orderItemId: IT, drawingNumber: "VK-2291", revision: "C", label: "VK-2291" },
  ];
  const f = (over: Partial<PoFileSource>): PoFileSource => ({
    id: "f", kind: "vykres", filename: "x.pdf", order_item_id: null, archived: false, model: false, status: "ready", ext: "pdf", size: 1000, ...over,
  });
  const files: PoFileSource[] = [
    f({ id: "old", filename: "Strojmetal_VK-2291_B.pdf", order_item_id: IT, archived: true, replaced_by: "cur", created_at: "1" }),
    f({ id: "cur", filename: "Strojmetal_VK-2291_C.pdf", order_item_id: IT, created_at: "2" }),
    f({ id: "step", kind: "model_3d", filename: "VK2291.step", model: true, ext: "step", created_at: "3" }),
    f({ id: "other", filename: "VK-9999.pdf", order_item_id: IT2, created_at: "4" }),
    f({ id: "byname", filename: "VK-9999-copy-VK-2291.pdf", order_item_id: IT2, created_at: "5" }),
    f({ id: "zak", kind: "objednavka", filename: "objednavka_VK-2291.pdf", created_at: "6" }),
    f({ id: "pend", filename: "VK 2291 detail.dxf", ext: "dxf", status: "pending", created_at: "7" }),
  ];

  it("jen soubory dílů objednávky: aktuální výkres + model zaškrtnuté, stará revize nabídnutá, cizí díl ani doklad zákazníka nikdy", () => {
    const plan = poAttachmentPlan(lines, files, { poNumber: "OV-2026-010", drawingChanges: [{ id: "c", order_item_id: IT, rev_from: "B", rev_to: "C", old_file_id: "old", created_at: "x" }] });
    expect(plan.candidates.map((c) => [c.fileId, c.role, c.name, c.checked])).toEqual([
      ["cur", "drawing", "VK-2291_C.pdf", true],
      ["pend", "drawing", "VK-2291_C.dxf", true],
      ["step", "model", "VK-2291_C.step", true],
      ["old", "old", "VK-2291_B-neplatna.pdf", false],
    ]);
    expect(plan.missingDrawing).toEqual([]);
    // názvy nikdy původní (nesou zákazníka)
    expect(plan.candidates.some((c) => /Strojmetal/i.test(c.name))).toBe(false);
    expect(pickPoAttachments(plan, null).map((c) => c.fileId)).toEqual(["cur", "pend", "step"]);
    // výběr z klienta: cizí id neprojde
    expect(pickPoAttachments(plan, ["old", "other", "zak"]).map((c) => c.fileId)).toEqual(["old"]);
  });

  it("položka bez výkresu → varování; změna po nové revizi zaškrtne jen díly se změnou", () => {
    const two: PoLineRef[] = [...lines, { index: 1, orderItemId: IT2, drawingNumber: "VK-9999", revision: null, label: "VK-9999" }];
    const plan = poAttachmentPlan(two, files.filter((x) => x.id !== "other" && x.id !== "byname"), { poNumber: "OV", focusItems: [IT2] });
    expect(plan.missingDrawing).toEqual([{ index: 1, label: "VK-9999" }]);
    expect(plan.candidates.filter((c) => c.checked)).toEqual([]);
  });

  it("neutrální název bez čísla výkresu", () => {
    expect(poNeutralName({ ext: ".PDF", poNumber: "OV-2026-010", index: 2 })).toBe("OV-2026-010-V2.pdf");
    expect(poNeutralName({ drawingNumber: "VK 22/91", revision: "C", ext: "step", poNumber: "x", index: 1 })).toBe("VK_2291_C.step");
  });
});
