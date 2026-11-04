import { describe, expect, it } from "vitest";
import {
  forgetPageSearch, isDefaultValues, memorableSearch, pageMemoryKey, readUrlValues, recallPageSearch, rememberPageSearch, rememberedHref,
  writeUrlValues,
} from "./url-state";

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

describe("stav stránky v adrese", () => {
  const defaults = { q: "", filtr: "vse", razeni: "date" };

  it("čte hodnoty z adresy, chybějící a prázdné = výchozí", () => {
    expect(readUrlValues("?q=abc&filtr=moje", defaults)).toEqual({ q: "abc", filtr: "moje", razeni: "date" });
    expect(readUrlValues("q=&razeni=priority", defaults)).toEqual({ q: "", filtr: "vse", razeni: "priority" });
    expect(readUrlValues(new URLSearchParams("filtr=x"), defaults)).toEqual({ q: "", filtr: "x", razeni: "date" });
  });

  it("zapisuje jen nevýchozí hodnoty, cizí parametry nechává, čárky čitelné", () => {
    expect(writeUrlValues("?schranka=1&q=old", defaults, { q: "nov", filtr: "vse", razeni: "date" })).toBe("schranka=1&q=nov");
    expect(writeUrlValues("q=x", defaults, { q: "", filtr: "vse", razeni: "date" })).toBe("");
    expect(writeUrlValues("", { stav: "" }, { stav: "a,b" })).toBe("stav=a,b");
  });

  it("pozná výchozí stav", () => {
    expect(isDefaultValues(defaults, { q: "", filtr: "vse", razeni: "date" })).toBe(true);
    expect(isDefaultValues(defaults, { q: "x", filtr: "vse", razeni: "date" })).toBe(false);
  });
});

describe("paměť stránky pro menu", () => {
  it("vynechá jednorázové parametry (otevření dialogu, akce)", () => {
    expect(memorableSearch("?segment=vse&capture=1&q=a&new=1&akce=x&nastaveni=podpis")).toBe("segment=vse&q=a");
    expect(memorableSearch("capture=1")).toBe("");
    expect(memorableSearch("?stav=a,b&radku=260", ["radku"])).toBe("stav=a,b");
  });

  it("pamatuje a vrací poslední stav podle cesty; prázdný stav zapomene", () => {
    const store = memStore();
    rememberPageSearch("/orders", "?segment=vse&q=Z", store);
    expect(recallPageSearch("/orders", store)).toBe("segment=vse&q=Z");
    expect(pageMemoryKey("/orders/")).toBe(pageMemoryKey("/orders"));
    rememberPageSearch("/orders", "capture=1", store);
    expect(recallPageSearch("/orders", store)).toBeNull();
    rememberPageSearch("/inbox", "slozka=jobs&vlakno=t1&detail=1", store, ["vlakno", "detail"]);
    expect(recallPageSearch("/inbox", store)).toBe("slozka=jobs");
    forgetPageSearch("/inbox", store);
    expect(recallPageSearch("/inbox", store)).toBeNull();
  });

  it("odkaz z menu dostane poslední stav, odkaz s vlastními parametry ne", () => {
    const store = memStore();
    rememberPageSearch("/orders", "segment=vse&q=Z", store);
    expect(rememberedHref("/orders", store)).toBe("/orders?segment=vse&q=Z");
    expect(rememberedHref("/orders?capture=1", store)).toBe("/orders?capture=1");
    expect(rememberedHref("/inbox", store)).toBe("/inbox");
  });

  it("bez úložiště (soukromé okno) pracuje tiše", () => {
    expect(() => rememberPageSearch("/orders", "q=1", null)).not.toThrow();
    expect(recallPageSearch("/orders", null)).toBeNull();
    expect(rememberedHref("/orders", null)).toBe("/orders");
  });
});
