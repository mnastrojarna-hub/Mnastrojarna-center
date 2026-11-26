import { describe, expect, it } from "vitest";
import { inPeriod, matchesDl, parseDlPeriod, toDlRows } from "./model";

describe("dodací listy dodavatelů (19. 11.)", () => {
  const files = [
    { id: "f1", job_id: "j1", filename: "DL-7781.pdf", title: null, created_at: "2026-11-18T09:00:00Z", dl_no: "DL 7781", dl_date: "2026-11-17", sup_name: null, po_no: "OV2026/098-1",
      job: { number: "Z-2026-098", title: "Hřídele", customer: { name: "Hitachi" } } },
    { id: "f2", job_id: "j2", filename: "sken.pdf", title: "Dodací list", created_at: "2026-10-02T09:00:00Z", dl_no: null, dl_date: null, sup_name: "Kalírna Brno", po_no: null,
      job: { number: "Z-2026-050", title: null, customer: null } },
  ];
  const pos = [{ id: "po1", job_id: "j1", number: "OV2026/098-1", supplier: { name: "Frézy Novák" } }];
  const rows = toDlRows(files, pos);
  it("řádky: datum z dokladu, jinak den nahrání; dodavatel z DL, jinak z objednávky; objednávka spárovaná", () => {
    expect(rows.map((r) => [r.fileId, r.date, r.supplierName, r.purchaseOrderId])).toEqual([
      ["f1", "2026-11-17", "Frézy Novák", "po1"],
      ["f2", "2026-10-02", "Kalírna Brno", null],
    ]);
  });
  it("období a hledání", () => {
    const nov = parseDlPeriod("2026-11", "2026-11-19");
    expect(rows.filter((r) => inPeriod(r.date, nov)).map((r) => r.fileId)).toEqual(["f1"]);
    expect(rows.filter((r) => inPeriod(r.date, parseDlPeriod("vse", "2026-11-19")))).toHaveLength(2);
    expect(parseDlPeriod(null, "2026-11-19")).toEqual({ kind: "month", year: 2026, month: 11 });
    expect(rows.filter((r) => matchesDl(r, "7781")).map((r) => r.fileId)).toEqual(["f1"]);
    expect(rows.filter((r) => matchesDl(r, "2026 098")).map((r) => r.fileId)).toEqual(["f1"]);
    expect(rows.filter((r) => matchesDl(r, "kalirna")).map((r) => r.fileId)).toEqual(["f2"]);
  });
});

describe("naše dodací listy do knihy dodavatelů nepatří (26. 11.)", () => {
  const base = { job_id: "j1", filename: "dl.pdf", title: null, created_at: "2026-11-20T10:00:00Z" };
  const pos = [{ id: "p1", job_id: "j1", number: "OV2026/025-1", supplier: { name: "Kovo s.r.o." } }];
  it("vyřadí naše DL: vystavili jsme ho my, naše číslo DL, naše firma jako dodavatel; dodavatelův DL zůstane", () => {
    const rows = toDlRows([
      { ...base, id: "a", issuer: "my", dl_no: "DL-2026-010" },
      { ...base, id: "b", dl_no: "DL 2026/011" },
      { ...base, id: "c", sup_name: "Mnástrojárna s.r.o.", dl_no: "123" },
      { ...base, id: "d", sup_name: "Kovo s.r.o.", dl_no: "K-77" },
      { ...base, id: "e", issuer: "my", po_no: "OV2026/025-1", dl_no: "K-78" },
    ], pos, ["DL-2026-011"]);
    expect(rows.map((r) => r.fileId).sort()).toEqual(["d", "e"]);
  });
});
