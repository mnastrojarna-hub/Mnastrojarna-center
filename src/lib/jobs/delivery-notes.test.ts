import { describe, it, expect } from "vitest";
import {
  currentDeliveryNotes, deliveryCompletes, deliveryLabel, deliveryLines, deliveryNoteNumberOf, deliveryNoteTitle,
  deliveredRows, isDeliveryNoteFile, isOwnDeliveryNote, itemDelivered, qtyInput, remainingQty, remainingRows,
  undocumentedRows, hadUndocumentedBefore, CATCH_UP_LABEL,
} from "./delivery-notes";

const items = [
  { id: "a", quantity: 10, deliveredQuantity: 0, deliveryClosed: false },
  { id: "b", quantity: 4, deliveredQuantity: 0, deliveryClosed: false },
  { id: "c", quantity: 5, deliveredQuantity: 2, deliveryClosed: true },
];

describe("dodací list dodávky — řádky z dodávky", () => {
  it("dílčí dodávka: jen to, co odchází teď (to − from), v pořadí zakázky", () => {
    const lines = deliveryLines(items, [{ itemId: "b", from: 0, to: 1 }, { itemId: "a", from: 0, to: 6 }]);
    expect(lines).toEqual([
      { itemId: "a", quantity: 6, ordered: 10, deliveredTotal: 6 },
      { itemId: "b", quantity: 1, ordered: 4, deliveredTotal: 1 },
    ]);
    expect(deliveryCompletes(items, [{ itemId: "a", from: 0, to: 6 }])).toBe(false);
  });

  it("zbytek: druhý DL nese jen zbývající množství a dodávku uzavře", () => {
    const after = items.map((i) => (i.id === "a" ? { ...i, deliveredQuantity: 6 } : i.id === "b" ? { ...i, deliveredQuantity: 1 } : i));
    const rest = remainingRows(after);
    expect(rest).toEqual([{ itemId: "a", from: 6, to: 10 }, { itemId: "b", from: 1, to: 4 }]);
    const lines = deliveryLines(after, rest);
    expect(lines.map((l) => [l.itemId, l.quantity])).toEqual([["a", 4], ["b", 3]]);
    expect(deliveryCompletes(after, rest)).toBe(true);
  });

  it("snížení (oprava) ani nulová změna na DL nepatří; neznámá položka se ignoruje", () => {
    expect(deliveryLines(items, [{ itemId: "a", from: 5, to: 3 }, { itemId: "b", from: 1, to: 1 }, { itemId: "x", from: 0, to: 2 }])).toEqual([]);
  });

  it("desetinná množství se zaokrouhlí na 3 místa (žádné 0,30000000000000004)", () => {
    const l = deliveryLines([{ id: "m", quantity: 1, deliveredQuantity: 0.1 }], [{ itemId: "m", from: 0.1, to: 0.4 }]);
    expect(l[0].quantity).toBe(0.3);
  });

  it("uzavřená položka je hotová a nezbývá z ní nic", () => {
    expect(itemDelivered(items[2])).toBe(true);
    expect(remainingQty(items[2])).toBe(0);
    expect(remainingQty({ id: "z", quantity: 3, deliveredQuantity: 5 })).toBe(0);
  });
});

describe("označení a číslo dodacího listu", () => {
  it("jediná kompletní dodávka bez označení, jinak pořadí dílčí / konečné dodávky", () => {
    expect(deliveryLabel(1, true)).toBeUndefined();
    expect(deliveryLabel(1, false)).toBe("1. dílčí dodávka");
    expect(deliveryLabel(2, true)).toBe("2. dodávka — konečná");
  });

  it("číslo z názvu dokumentu nebo souboru; název DL dodávky se pozná", () => {
    expect(deliveryNoteNumberOf(null, "Dodaci_list_DL-2026-070.pdf")).toBe("DL-2026-070");
    expect(deliveryNoteNumberOf("Dodací list DL-2026-1001 · 2. dílčí dodávka")).toBe("DL-2026-1001");
    expect(deliveryNoteNumberOf("Faktura FV-2026-001")).toBeNull();
    expect(deliveryNoteTitle("DL-2026-070")).toBe("Dodací list DL-2026-070 · dodávka");
    expect(isDeliveryNoteFile({ kind: "dodaci_list", title: deliveryNoteTitle("DL-2026-070", "1. dílčí dodávka") })).toBe(true);
    expect(isDeliveryNoteFile({ kind: "dodaci_list", title: deliveryNoteTitle("DL-2026-071", "2. dodávka — konečná") })).toBe(true);
    // DL celé zakázky z Dokladů (bez dodávky) ani archivovaná verze se nepočítá
    expect(isDeliveryNoteFile({ kind: "dodaci_list", title: "Dodací list DL-2026-069" })).toBe(false);
    expect(isDeliveryNoteFile({ kind: "dodaci_list", title: deliveryNoteTitle("DL-2026-070"), archived: true })).toBe(false);
  });

  it("aktuální dodací listy zakázky: nejnovější první, bez archivu a jiných druhů", () => {
    const own = { origin: "generated", issuer: "my" };
    const list = currentDeliveryNotes([
      { id: "1", kind: "dodaci_list", title: deliveryNoteTitle("DL-2026-070", "1. dílčí dodávka"), filename: "Dodaci_list_DL-2026-070.pdf", createdAt: "2026-10-29T08:00:00Z", ...own },
      { id: "2", kind: "dodaci_list", title: deliveryNoteTitle("DL-2026-071", "2. dodávka — konečná"), filename: "Dodaci_list_DL-2026-071.pdf", createdAt: "2026-10-29T09:00:00Z", ...own },
      { id: "3", kind: "dodaci_list", title: "Dodací list DL-2026-070", filename: "Dodaci_list_DL-2026-070.pdf", archived: true, createdAt: "2026-10-28T09:00:00Z", ...own },
      { id: "4", kind: "faktura", title: "Faktura FV-2026-001", filename: "Faktura_FV-2026-001.pdf", createdAt: "2026-10-30T09:00:00Z", ...own },
    ]);
    expect(list.map((n) => [n.id, n.number, n.label])).toEqual([
      ["2", "DL-2026-071", "2. dodávka — konečná"],
      ["1", "DL-2026-070", "1. dílčí dodávka"],
    ]);
  });

  it("DL dodavatele (nahraný / z fotky) ani zamčený soubor není náš dodací list — nejde poslat zákazníkovi", () => {
    const base = { kind: "dodaci_list", filename: "DL_dodavatel_4711.pdf", createdAt: "2026-10-29T10:00:00Z" };
    expect(currentDeliveryNotes([
      { id: "s1", ...base, issuer: "dodavatel", origin: "capture" },
      { id: "s2", ...base, issuer: "dodavatel", origin: "generated" },
      { id: "s3", ...base, issuer: null, origin: "upload" },
      { id: "s4", ...base, filename: "Dodaci_list_DL-2026-072.pdf", issuer: "my", origin: "generated", locked: "price" },
    ])).toEqual([]);
    expect(isOwnDeliveryNote({ id: "o", ...base, filename: "Dodaci_list_DL-2026-072.pdf", issuer: "my", origin: "generated", locked: null })).toBe(true);
  });

  it("dodávky bez DL: řádky od 0 do dodáno dosud; pole formuláře s desetinnou čárkou", () => {
    expect(deliveredRows([...items, { id: "d", quantity: 3, deliveredQuantity: 0 }])).toEqual([{ itemId: "c", from: 0, to: 2 }]);
    expect(deliveredRows([{ id: "m", quantity: 20, deliveredQuantity: 12.5 }])).toEqual([{ itemId: "m", from: 0, to: 12.5 }]);
    expect(qtyInput(12.5)).toBe("12,5");
    expect(qtyInput(4)).toBe("4");
    expect(qtyInput(0.1 + 0.2)).toBe("0,3");
  });
});

// ── A2: dodávka bez DL u zakázky, která jiné DL už má ──
describe("dodané zboží bez dodacího listu", () => {
  const items = [
    { id: "a", quantity: 10, deliveredQuantity: 10 },
    { id: "b", quantity: 4, deliveredQuantity: 1 },
    { id: "c", quantity: 2, deliveredQuantity: 0 },
  ];

  it("undocumentedRows: jen to, co žádný DL nepokrývá (od zdokumentovaného do dodaného)", () => {
    expect(undocumentedRows(items, new Map([["a", 6], ["b", 1]]))).toEqual([{ itemId: "a", from: 6, to: 10 }]);
    expect(undocumentedRows(items, new Map([["a", 10], ["b", 1]]))).toEqual([]);
    expect(undocumentedRows(items, new Map())).toEqual([{ itemId: "a", from: 0, to: 10 }, { itemId: "b", from: 0, to: 1 }]);
    // starší DL bez vazby na položky → nejde poznat, nic se nenabízí
    expect(undocumentedRows(items, null)).toEqual([]);
  });

  it("hadUndocumentedBefore: dodávka bez DL před touto se počítá do pořadí", () => {
    // dřív dodáno 6 ks bez DL, teď 6 → 10 s DL
    expect(hadUndocumentedBefore([{ id: "a", quantity: 10, deliveredQuantity: 6 }], [{ itemId: "a", from: 6, to: 10 }], new Map())).toBe(true);
    // první dodávka vůbec
    expect(hadUndocumentedBefore([{ id: "a", quantity: 10, deliveredQuantity: 0 }], [{ itemId: "a", from: 0, to: 4 }], new Map())).toBe(false);
    // předchozí dodávka má DL
    expect(hadUndocumentedBefore([{ id: "a", quantity: 10, deliveredQuantity: 6 }], [{ itemId: "a", from: 6, to: 10 }], new Map([["a", 6]]))).toBe(false);
    expect(hadUndocumentedBefore([{ id: "a", quantity: 10, deliveredQuantity: 6 }], [{ itemId: "a", from: 6, to: 10 }], null)).toBe(false);
  });

  it("DL na dříve dodané zboží je dodací list dodávky (Doklady, karta, čip)", () => {
    expect(isDeliveryNoteFile({ kind: "dodaci_list", title: `Dodací list DL-2026-090 · ${CATCH_UP_LABEL}` })).toBe(true);
  });
});
