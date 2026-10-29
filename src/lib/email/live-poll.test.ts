import { describe, it, expect } from "vitest";
import { LIVE_INTERVAL_MS, LIVE_MAX_BACKOFF_MS, mailChanged, nextDelay, nextFailures, releaseLease, shouldPoll, tryLease, type LeaseStorage } from "./live-poll";

function memory(): LeaseStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("živá pošta — interval a odstup při chybách", () => {
  it("bez chyb ~60 s, pak 2, 4, 8 … max 10 min", () => {
    expect(nextDelay(0)).toBe(LIVE_INTERVAL_MS);
    expect(nextDelay(1)).toBe(2 * LIVE_INTERVAL_MS);
    expect(nextDelay(3)).toBe(8 * LIVE_INTERVAL_MS);
    expect(nextDelay(50)).toBe(LIVE_MAX_BACKOFF_MS);
    expect(nextDelay(-2)).toBe(LIVE_INTERVAL_MS);
  });
  it("jen viditelná karta, online, s přístupem k poště", () => {
    expect(shouldPoll({ visible: true, online: true, enabled: true })).toBe(true);
    expect(shouldPoll({ visible: false, online: true, enabled: true })).toBe(false);
    expect(shouldPoll({ visible: true, online: false, enabled: true })).toBe(false);
    expect(shouldPoll({ visible: true, online: true, enabled: false })).toBe(false);
  });
});

describe("živá pošta — jedna karta za všechny (single-flight)", () => {
  it("druhá karta nestahuje, dokud zápůjčka první neprošla; pak ji převezme", () => {
    const s = memory();
    expect(tryLease(s, "A", 1000, 55_000)).toBe(true);
    expect(tryLease(s, "B", 2000, 55_000)).toBe(false);
    expect(tryLease(s, "A", 3000, 55_000)).toBe(true); // vlastní obnoví
    expect(tryLease(s, "B", 3000 + 55_001, 55_000)).toBe(true); // prošlá → převezme
    expect(tryLease(s, "A", 3000 + 55_002, 55_000)).toBe(false);
  });
  it("uvolnění jen vlastní zápůjčky; nedostupné / poškozené úložiště = každá karta sama", () => {
    const s = memory();
    tryLease(s, "A", 0, 50_000);
    releaseLease(s, "B");
    expect(tryLease(s, "B", 10, 50_000)).toBe(false);
    releaseLease(s, "A");
    expect(tryLease(s, "B", 20, 50_000)).toBe(true);
    expect(tryLease(null, "X", 0, 1)).toBe(true);
    const broken = memory();
    broken.data.set("mail-live-lease", "{nesmysl");
    expect(tryLease(broken, "X", 0, 1000)).toBe(true);
  });
  it("změna pošty podle razítka (první načtení není změna)", () => {
    expect(mailChanged(null, { stamp: "a" })).toBe(false);
    expect(mailChanged({ stamp: "a" }, { stamp: "a" })).toBe(false);
    expect(mailChanged({ stamp: "a" }, { stamp: "b" })).toBe(true);
    expect(mailChanged({ stamp: "a" }, { stamp: null })).toBe(false);
  });
  it("review #5: první kontrola, která sama stáhla poštu, JE změna (jinak by se nová pošta neukázala)", () => {
    expect(mailChanged(null, { stamp: "a", ingested: 1 })).toBe(true);
    expect(mailChanged(null, { stamp: "a", ingested: 0 })).toBe(false);
    expect(mailChanged({ stamp: "a" }, { stamp: "a", ingested: 2 })).toBe(true);
  });
  it("review #6: odstup jen při HTTP chybě nebo když selžou všechny schránky (ne kvůli jedné rozbité)", () => {
    expect(nextFailures(0, { httpOk: true })).toBe(0);
    expect(nextFailures(3, { httpOk: true, allFailed: false })).toBe(0); // jedna schránka kolegy rozbitá, ostatní OK
    expect(nextFailures(1, { httpOk: true, allFailed: true })).toBe(2);
    expect(nextFailures(2, { httpOk: false })).toBe(3);
    expect(nextDelay(nextFailures(5, { httpOk: true, allFailed: false }))).toBe(LIVE_INTERVAL_MS);
  });
});
