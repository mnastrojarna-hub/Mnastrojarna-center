import { describe, expect, it } from "vitest";
import {
  SCROLL_STORE_LIMIT, canApply, isApplied, parseScrollStore, restoresOnLoad, scrollEntry, scrollKey, withScrollPos,
} from "./scroll-memory";

describe("paměť posunu", () => {
  it("klíč = cesta + parametry", () => {
    expect(scrollKey("/orders", "")).toBe("/orders");
    expect(scrollKey("/orders", "segment=vse&q=Z")).toBe("/orders?segment=vse&q=Z");
    expect(scrollKey("/orders", "?q=1")).toBe("/orders?q=1");
  });

  it("ukládá pozice prvků pod adresu a vrací je zpět", () => {
    let store = withScrollPos({}, "/orders?q=Z", "main", { t: 512.4, l: 0 });
    store = withScrollPos(store, "/orders?q=Z", "board", { t: 0, l: 300 });
    store = withScrollPos(store, "/inbox", "mail-list", { t: 80, l: 0 });
    expect(scrollEntry(store, "/orders?q=Z")).toEqual({ main: { t: 512, l: 0 }, board: { t: 0, l: 300 } });
    expect(scrollEntry(store, "/inbox")).toEqual({ "mail-list": { t: 80, l: 0 } });
    expect(scrollEntry(store, "/customers")).toBeNull();
    // záporné hodnoty (pružení na iOS) se ořežou
    expect(scrollEntry(withScrollPos({}, "/a", "main", { t: -30, l: -1 }), "/a")).toEqual({ main: { t: 0, l: 0 } });
  });

  it("drží nejvýš SCROLL_STORE_LIMIT adres — nejstarší odpadají, znovu použitá adresa je zase nejnovější", () => {
    let store = {};
    for (let i = 0; i < SCROLL_STORE_LIMIT + 5; i++) store = withScrollPos(store, `/p${i}`, "main", { t: i, l: 0 });
    expect(Object.keys(store)).toHaveLength(SCROLL_STORE_LIMIT);
    expect(scrollEntry(store, "/p0")).toBeNull();
    expect(scrollEntry(store, `/p${SCROLL_STORE_LIMIT + 4}`)).toEqual({ main: { t: SCROLL_STORE_LIMIT + 4, l: 0 } });
    store = withScrollPos(store, "/p10", "main", { t: 1, l: 0 });
    expect(Object.keys(store).at(-1)).toBe("/p10");
  });

  it("čte uložený stav odolně (poškozený JSON = prázdno)", () => {
    expect(parseScrollStore(null)).toEqual({});
    expect(parseScrollStore("{nope")).toEqual({});
    expect(parseScrollStore("[1]")).toEqual({});
    expect(parseScrollStore(JSON.stringify({ "/a": { main: { t: 1, l: 0 } } }))).toEqual({ "/a": { main: { t: 1, l: 0 } } });
  });

  it("nastaví pozici, až má obsah dost výšky; po vypršení okna, co jde", () => {
    const pos = { t: 800, l: 0 };
    expect(canApply(pos, 600, 500, 400, 400, false)).toBe(false); // seznam ještě načítá (max 100)
    expect(canApply(pos, 1300, 500, 400, 400, false)).toBe(true); // max 800
    expect(canApply(pos, 1299, 500, 400, 400, false)).toBe(true); // tolerance 1 px
    expect(canApply(pos, 600, 500, 400, 400, true)).toBe(true); // vypršelo
    expect(canApply({ t: 0, l: 300 }, 500, 500, 800, 400, false)).toBe(true);
    expect(canApply({ t: 0, l: 300 }, 500, 500, 600, 400, false)).toBe(false);
  });

  it("obnova je hotová s tolerancí 2 px", () => {
    expect(isApplied({ t: 800, l: 0 }, 800, 0)).toBe(true);
    expect(isApplied({ t: 800, l: 0 }, 798.5, 0)).toBe(true);
    expect(isApplied({ t: 800, l: 0 }, 790, 0)).toBe(false);
  });

  it("po načtení obnovuje jen obnovení stránky a zpět/vpřed", () => {
    expect(restoresOnLoad("reload")).toBe(true);
    expect(restoresOnLoad("back_forward")).toBe(true);
    expect(restoresOnLoad("navigate")).toBe(false);
    expect(restoresOnLoad(undefined)).toBe(false);
  });
});
