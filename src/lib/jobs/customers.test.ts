import { describe, it, expect, vi } from "vitest";
import {
  normalizeIco, normalizeDic, normalizeCustomerName, normalizeCountry, matchCustomer,
  customerColumns, composeAddress, findOrCreateCustomer,
} from "./customers";
import type { JobsDb } from "./events";

const rows = [
  { id: "c1", name: "Strojmetal s.r.o.", ico: "01234567", dic: "CZ01234567" },
  { id: "c2", name: "ACME a.s.", ico: null, dic: "CZ 999 888 77" },
  { id: "c3", name: "Kovo Brno", ico: "55554444", dic: null },
];

describe("normalizace zákazníka", () => {
  it("IČO a DIČ", () => {
    expect(normalizeIco("012 34 567")).toBe("01234567");
    expect(normalizeIco("abc")).toBeNull();
    expect(normalizeDic("cz 012-345-67")).toBe("CZ01234567");
    expect(normalizeDic("nic")).toBeNull();
  });
  it("název a země", () => {
    expect(normalizeCustomerName("  Strojmetal   s. r. o. ")).toBe("strojmetal s.r.o.");
    expect(normalizeCustomerName("ACME, a.s.")).toBe("acme a.s.");
    expect(normalizeCountry("")).toBe("CZ");
    expect(normalizeCountry("de")).toBe("DE");
    expect(normalizeCountry("Česká republika")).toBe("CZ");
    expect(normalizeCountry("Deutschland")).toBe("DE");
    expect(normalizeCountry("Atlantida")).toBe("Atlantida");
  });
  it("sloupce a adresa", () => {
    expect(customerColumns({ name: "x", ico: "1234 5678", email: " A@B.CZ ", city: "" }))
      .toEqual({ ico: "12345678", email: "a@b.cz" });
    expect(composeAddress({ street: "Hlavní 1", zip: "602 00", city: "Brno" })).toBe("Hlavní 1, 602 00 Brno");
    expect(composeAddress({})).toBeNull();
  });
});

describe("matchCustomer", () => {
  it("IČO má přednost (bez úvodních nul a mezer)", () => {
    expect(matchCustomer(rows, { name: "Jiný název", ico: "1234567" })).toEqual({ id: "c1", by: "ico" });
  });
  it("pak DIČ", () => {
    expect(matchCustomer(rows, { name: "x", dic: "CZ99988877" })).toEqual({ id: "c2", by: "dic" });
  });
  it("pak název bez ohledu na velikost písmen", () => {
    expect(matchCustomer(rows, { name: "kovo brno" })).toEqual({ id: "c3", by: "name" });
    expect(matchCustomer(rows, { name: "STROJMETAL s. r. o." })).toEqual({ id: "c1", by: "name" });
  });
  it("stejný název, jiné IČO = jiná firma", () => {
    expect(matchCustomer(rows, { name: "Kovo Brno", ico: "11112222" })).toBeNull();
  });
  it("nic nesedí", () => {
    expect(matchCustomer(rows, { name: "Nová firma" })).toBeNull();
    expect(matchCustomer(rows, { name: "" })).toBeNull();
  });
});

/** Minimální napodobenina dotazovacího řetězce Supabase. */
function fakeDb(existing: Record<string, unknown>[]) {
  const inserted: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const db = {
    from: vi.fn(() => {
      const state: { op: string; payload?: Record<string, unknown>; id?: string } = { op: "select" };
      const chain = {
        select: () => chain,
        order: () => chain,
        range: (from: number, to: number) => Promise.resolve({ data: existing.slice(from, to + 1), error: null }),
        eq: (_c: string, v: string) => {
          state.id = v;
          if (state.op === "update") {
            updated.push({ id: v, ...state.payload });
            return Promise.resolve({ error: null });
          }
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: existing.find((r) => r.id === state.id) ?? null, error: null }),
        insert: (p: Record<string, unknown>) => {
          inserted.push(p);
          state.op = "insert";
          return chain;
        },
        update: (p: Record<string, unknown>) => {
          state.op = "update";
          state.payload = p;
          return chain;
        },
        single: () => Promise.resolve({ data: { id: "new-id" }, error: null }),
      };
      return chain;
    }),
  };
  return { db: db as unknown as JobsDb, inserted, updated };
}

describe("findOrCreateCustomer", () => {
  it("nalezenému doplní jen prázdná pole", async () => {
    const { db, inserted, updated } = fakeDb([{ id: "c3", name: "Kovo Brno", ico: "55554444", dic: null, email: "x@kovo.cz", city: null }]);
    const res = await findOrCreateCustomer(db, { name: "Kovo Brno", dic: "CZ55554444", email: "jiny@kovo.cz", city: "Brno" });
    expect(res).toEqual({ id: "c3", created: false });
    expect(inserted).toHaveLength(0);
    expect(updated).toEqual([{ id: "c3", dic: "CZ55554444", city: "Brno" }]);
  });
  it("nového založí s adresou a zemí CZ", async () => {
    const { db, inserted } = fakeDb([]);
    const res = await findOrCreateCustomer(db, { name: " Nová firma ", ico: "12345678", street: "Dlouhá 5", zip: "110 00", city: "Praha" });
    expect(res).toEqual({ id: "new-id", created: true });
    expect(inserted[0]).toMatchObject({
      name: "Nová firma", ico: "12345678", country: "CZ", street: "Dlouhá 5", address: "Dlouhá 5, 110 00 Praha", owner_id: null,
    });
    expect(inserted[0]).not.toHaveProperty("customer_number");
  });
  it("bez názvu a bez shody nic nezaloží", async () => {
    const { db, inserted } = fakeDb([]);
    expect(await findOrCreateCustomer(db, { name: "  " })).toBeNull();
    expect(inserted).toHaveLength(0);
  });
});
