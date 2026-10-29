import { describe, it, expect } from "vitest";
import { itemRef, techPatchChanges, techStateOf, techStateText } from "./technology";
import { purchaseOrderEmail, splitItemNote, supplierNoteSegment, supplierNotesOfItems } from "./purchasing";
import { purchaseItemsForStep } from "./production-suggest";

// Technologie položek (feedback majitele 29. 10.): postup / kompletně zadáno / poznámka pro dodavatele → objednávka.
describe("technologie položek", () => {
  const old = { id: "i1", position: 0, drawing_number: "PR-1", name: "Příruba", tech_procedure: null, tech_complete: false, tech_complete_by: null, supplier_note: null };

  it("patch jen se změnami a s textem do historie", () => {
    const r = techPatchChanges(old, { itemId: "i1", procedure: "  1. soustružit\r\n2. kalit  ", supplierNote: " pozor  popsat na čele " });
    expect(r.patch).toEqual({ tech_procedure: "1. soustružit\n2. kalit", supplier_note: "pozor popsat na čele" });
    expect(r.changes.map((c) => c.label)).toEqual(["Technologický postup PR-1", "Poznámka pro dodavatele PR-1"]);
    expect(r.changes[1]).toMatchObject({ field: "item_note", toText: "pozor popsat na čele", fromText: "—" });
    expect(techPatchChanges({ ...old, supplier_note: "x" }, { itemId: "i1", supplierNote: "x" }).changes).toEqual([]);
  });

  it("kompletně zadáno: zapnout s firmou, vypnout smaže firmu", () => {
    const on = techPatchChanges(old, { itemId: "i1", complete: true, completeBy: "Frézy Novák" });
    expect(on.patch).toEqual({ tech_complete: true, tech_complete_by: "Frézy Novák" });
    expect(on.changes[0].toText).toBe("Bez technologie — kompletně zadáno Frézy Novák");
    const off = techPatchChanges({ ...old, tech_complete: true, tech_complete_by: "Frézy Novák" }, { itemId: "i1", complete: false });
    expect(off.patch).toEqual({ tech_complete: false, tech_complete_by: null });
  });

  it("stav a popis", () => {
    expect(techStateOf(null)).toBe("chybi");
    expect(techStateOf({ procedure: "a", complete: false })).toBe("postup");
    expect(techStateOf({ procedure: "a", complete: true })).toBe("kompletne");
    expect(techStateText({ procedure: "a\nb\n\nc", complete: false, completeBy: null })).toBe("Technologický postup (3 řádky)");
    expect(itemRef({ position: 2 })).toBe("položka 3");
  });

  it("poznámka pro dodavatele → položka objednávky „Pozor: …“, PDF ji rozdělí, e-mail ji shrne", () => {
    expect(supplierNoteSegment("pozor popsat na čele")).toBe("Pozor: popsat na čele");
    expect(supplierNoteSegment("Změna materiálu na 1.4301")).toBe("Pozor: Změna materiálu na 1.4301");
    expect(supplierNoteSegment("  ")).toBeNull();
    const built = purchaseItemsForStep({
      step: { kind: "vyroba", orderItemIds: null },
      items: [
        { id: "a", drawingNumber: "PR-1", name: "Příruba", quantity: 10, unit: "ks", materialDesignation: "1.2379", supplierNote: "pozor popsat na čele" },
        { id: "b", drawingNumber: "PR-2", name: "Pouzdro", quantity: 5, unit: "ks" },
      ],
      quote: null,
    });
    expect(built.items[0].note).toBe("Pozor: popsat na čele · 1.2379");
    expect(built.items[1].note ?? "").not.toContain("Pozor");
    expect(splitItemNote(built.items[0].note)).toEqual({ warning: "popsat na čele", rest: "1.2379" });
    expect(splitItemNote(null)).toEqual({ warning: null, rest: null });
    const notes = supplierNotesOfItems([{ drawingNumber: "PR-1", note: built.items[0].note }, { name: "Pouzdro", note: "1.4301" }]);
    expect(notes).toEqual([{ ref: "PR-1", note: "popsat na čele" }]);
    const mail = purchaseOrderEmail({ number: "OV-2026-012", companyName: "Mnástrojárna s.r.o.", itemNotes: notes });
    expect(mail.body).toContain("Prosíme, věnujte pozornost poznámkám u položek:\n– PR-1: popsat na čele");
    expect(purchaseOrderEmail({ number: "OV-1", companyName: "M" }).body).not.toContain("pozornost");
  });
});
