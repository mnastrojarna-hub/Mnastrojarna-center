import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ACTIVITY_THROTTLE_MS, activityPageLabel, compareLastActive, createActivityThrottle, describeLastActive, sanitizeActivityPath,
} from "./activity";

afterEach(() => {
  vi.useRealTimers();
});

describe("poslední aktivita — omezovač tepů", () => {
  it("první akce hned, další během minuty ne, po minutě znovu", () => {
    const t = createActivityThrottle();
    expect(t.interaction(1_000)).toBe(true);
    expect(t.interaction(2_000)).toBe(false);
    expect(t.interaction(1_000 + ACTIVITY_THROTTLE_MS - 1)).toBe(false);
    expect(t.interaction(1_000 + ACTIVITY_THROTTLE_MS)).toBe(true);
    expect(t.interaction(1_000 + ACTIVITY_THROTTLE_MS + 5)).toBe(false);
  });

  it("skrytí karty dožene akci, která v intervalu neodešla — jen jednou", () => {
    const t = createActivityThrottle();
    expect(t.flush(0)).toBe(false); // bez akce nic (otevřená karta není aktivita)
    expect(t.interaction(0)).toBe(true);
    expect(t.flush(10)).toBe(false); // poslední akce už odešla
    expect(t.interaction(20_000)).toBe(false);
    expect(t.flush(25_000)).toBe(true);
    expect(t.flush(26_000)).toBe(false);
    // dohnaný tep se počítá do intervalu
    expect(t.interaction(30_000)).toBe(false);
  });

  it("návrat na kartu nic nepošle, ale další akce jde hned", () => {
    const t = createActivityThrottle();
    expect(t.interaction(0)).toBe(true);
    t.visible();
    expect(t.flush(1)).toBe(false);
    expect(t.interaction(5_000)).toBe(true);
    expect(t.interaction(6_000)).toBe(false);
  });

  it("vlastní interval", () => {
    const t = createActivityThrottle(100);
    expect(t.interaction(0)).toBe(true);
    expect(t.interaction(99)).toBe(false);
    expect(t.interaction(100)).toBe(true);
  });
});

describe("poslední aktivita — cesta a název stránky", () => {
  it("jen cesta „/…“ bez dotazu, max 200 znaků", () => {
    expect(sanitizeActivityPath("/orders/abc?tab=dokumenty#x")).toBe("/orders/abc");
    expect(sanitizeActivityPath("  /inbox  ")).toBe("/inbox");
    expect(sanitizeActivityPath("https://evil.example/x")).toBeNull();
    expect(sanitizeActivityPath("//evil.example")).toBeNull();
    expect(sanitizeActivityPath("/a\nb")).toBeNull();
    expect(sanitizeActivityPath("/a\\b")).toBeNull();
    expect(sanitizeActivityPath(42)).toBeNull();
    expect(sanitizeActivityPath(null)).toBeNull();
    expect(sanitizeActivityPath(`/${"x".repeat(300)}`)).toHaveLength(200);
  });

  it("název z menu (nejdelší shoda), jinak cesta", () => {
    expect(activityPageLabel("/orders")).toBe("Kniha zakázek");
    expect(activityPageLabel("/orders/123")).toBe("Kniha zakázek");
    expect(activityPageLabel("/settings/audit")).toBe("Audit");
    expect(activityPageLabel("/settings")).toBe("Nastavení");
    expect(activityPageLabel("/sent")).toBe("Pošta");
    expect(activityPageLabel("/neznama")).toBe("/neznama");
    expect(activityPageLabel(null)).toBeNull();
  });
});

describe("poslední aktivita — zobrazení", () => {
  const NOW = new Date("2026-11-09T13:00:00Z").getTime();
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it("relativně česky, přesný čas (Praha), tón podle stáří", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const recent = describeLastActive(ago(5 * 60_000), "/inbox", NOW);
    expect(recent).toMatchObject({ label: "před 5 min", tone: "recent", page: "Pošta" });
    expect(recent.exact).toMatch(/9\. ?11\. ?2026/);
    expect(recent.exact).toMatch(/13:55/);
    expect(describeLastActive(ago(20_000), null, NOW)).toMatchObject({ label: "teď", tone: "recent", page: null });
    expect(describeLastActive(ago(3 * 3_600_000), "/orders", NOW)).toMatchObject({ label: "před 3 h", tone: "normal" });
    expect(describeLastActive(ago(7 * 86_400_000), null, NOW).tone).toBe("normal");
    expect(describeLastActive(ago(8 * 86_400_000), null, NOW)).toMatchObject({ label: "před 8 d", tone: "stale" });
  });

  it("bez aktivity", () => {
    expect(describeLastActive(null)).toEqual({ label: "Zatím žádná aktivita", tone: "never", exact: null, page: null });
    expect(describeLastActive("nesmysl").tone).toBe("never");
  });

  it("řazení: naposledy aktivní první, bez aktivity na konci", () => {
    const list = [null, "2026-11-01T00:00:00Z", "2026-11-09T00:00:00Z", undefined, "2026-10-01T00:00:00Z"];
    expect([...list].sort(compareLastActive)).toEqual(["2026-11-09T00:00:00Z", "2026-11-01T00:00:00Z", "2026-10-01T00:00:00Z", null, undefined]);
  });
});
