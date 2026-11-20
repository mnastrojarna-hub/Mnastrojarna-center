/**
 * Vlna 22, body 22e a 22f – jedna bariéra rozepsaných změn (flush-barrier.ts) a jedno pravidlo kroků historie.
 * Repro: hloubka 0,8 → 0,82 a hned název (< 450 ms) – změna se ztratila nebo skončila v jiném dokumentu; formát A2 → A3
 * a přepnutí záložky do 500 ms zapsal list do JINÉHO dokumentu; opuštění pole bez změny přidalo krok Zpět; název prvku
 * přidával krok za každý znak.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentDocKey, discardPending, flushPending, historyRule, lastFlush, MERGE_WINDOW_MS, pendingCount, registerFlush, sameNumber, setDocKeyGetter, setFlushSync } from "./flush-barrier";

setFlushSync((fn) => fn());
let key = "A";
setDocKeyGetter(() => key);
afterEach(() => {
  key = "A";
  flushPending("úklid");
});

describe("bariéra rozepsaných změn", () => {
  it("bez rozepsaných změn nedělá nic", () => {
    expect(pendingCount()).toBe(0);
    expect(flushPending("tab")).toBe(0);
  });

  it("zapíše všechno rozepsané (pole i list výkresu) a odregistruje to – podruhé už nic", () => {
    const field = vi.fn();
    const sheet = vi.fn();
    registerFlush(field);
    registerFlush(sheet, "A");
    expect(pendingCount()).toBe(2);
    expect(flushPending("save")).toBe(2);
    expect(field).toHaveBeenCalledWith({ wrongDoc: false, reason: "save" });
    expect(sheet).toHaveBeenCalledWith({ wrongDoc: false, reason: "save" });
    expect(pendingCount()).toBe(0);
    expect(flushPending("save")).toBe(0);
    expect(lastFlush()?.reason).toBe("save");
  });

  it("změna jiného dokumentu: zapisovač se to dozví (wrongDoc) – nikdy ji nezapíše do zobrazeného dokumentu", () => {
    const doc: Record<string, number> = { A: 0.8, B: 5 };
    // pole „Hloubka“ dokumentu A: zapíše jen do svého dokumentu
    registerFlush(({ wrongDoc }) => {
      if (!wrongDoc) doc[currentDocKey()] = 0.82;
    }, "A");
    key = "B"; // záložka se přepnula, aniž by bariéra proběhla (to se nesmí stát – i tak nic do B)
    flushPending("late");
    expect(doc).toEqual({ A: 0.8, B: 5 });
  });

  it("odregistrovaná změna (potvrzená polem, Esc) se nezapíše", () => {
    const f = vi.fn();
    const off = registerFlush(f);
    off();
    flushPending("tab");
    expect(f).not.toHaveBeenCalled();
  });

  it("chyba jednoho zapisovače nezastaví ostatní", () => {
    const ok = vi.fn();
    registerFlush(() => {
      throw new Error("x");
    });
    registerFlush(ok);
    expect(flushPending("export")).toBe(1);
    expect(ok).toHaveBeenCalled();
  });

  it("Storno formuláře: rozepsaná hodnota pole se zahodí (discard), rozepsaný list výkresu zůstane k zápisu", () => {
    const field = vi.fn();
    const sheet = vi.fn();
    registerFlush(field, "A", "field");
    registerFlush(sheet, "A", "drawing");
    expect(discardPending("field", "cancel")).toBe(1);
    expect(field).toHaveBeenCalledWith({ wrongDoc: false, reason: "cancel", discard: true });
    expect(pendingCount()).toBe(1);
    flushPending("tab");
    expect(sheet).toHaveBeenCalledWith({ wrongDoc: false, reason: "tab" });
  });

  it("vlastník se bere z dokumentu při registraci", () => {
    key = "A";
    const f = vi.fn();
    registerFlush(f);
    key = "B";
    flushPending("tab");
    expect(f).toHaveBeenCalledWith({ wrongDoc: true, reason: "tab" });
  });
});

describe("jedno pravidlo kroků historie", () => {
  it("bez změny → žádný krok (opuštění pole na stejné hodnotě)", () => {
    expect(historyRule({ changed: false })).toBe("unchanged");
    expect(sameNumber(0.82, 0.82)).toBe(true);
    expect(sameNumber(0.8, 0.82)).toBe(false);
    expect(sameNumber(0.1 + 0.2, 0.3)).toBe(true);
  });
  it("psaní názvu po znacích (stejný klíč do 1,5 s) → jeden krok; jiné pole / pauza / bez klíče → nový krok", () => {
    expect(historyRule({ changed: true, key: "name:f1", lastKey: "name:f1", lastAt: 1000, now: 1200 })).toBe("merge");
    expect(historyRule({ changed: true, key: "name:f1", lastKey: "name:f1", lastAt: 1000, now: 1000 + MERGE_WINDOW_MS + 1 })).toBe("step");
    expect(historyRule({ changed: true, key: "name:f2", lastKey: "name:f1", lastAt: 1000, now: 1100 })).toBe("step");
    expect(historyRule({ changed: true, key: null, lastKey: null, lastAt: 1000, now: 1100 })).toBe("step"); // hloubka, list výkresu
  });
});
