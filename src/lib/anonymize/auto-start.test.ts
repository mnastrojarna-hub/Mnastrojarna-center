import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appOrigin, anonRunnerStatus, describeKickFailure, kick, lastKickFailure, probeRunner } from "./queue";
import { NudgeLimiter, nudgeKey } from "./nudge-limit";
import { fileAnonLabel, jobAnonBadge } from "@/components/anonymize/anon-status";

/**
 * Automatické spuštění anonymizace (oprava „výkresy nahrané dodatečně se točí navždy"):
 * poctivý kick (401 chráněné nasazení / 404 / nedostupná adresa = selhání, ne „rozběhnuto"), adresa
 * aplikace na Vercelu, stav pro Nastavení, omezovač šťouchnutí a stavy UI (bez nekonečného spinneru).
 * Běh fronty (claim, převzetí, pokusy) → runner.test.ts a auto-start.integration.test.ts.
 */

const ENV = ["APP_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_URL", "VERCEL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "CRON_SECRET", "SUPABASE_SECRET_KEY", "VERCEL_AUTOMATION_BYPASS_SECRET"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
beforeEach(() => {
  for (const k of ENV) delete process.env[k];
  process.env.SUPABASE_SECRET_KEY = "test-service-key";
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const ID = "11111111-1111-4111-8111-111111111111";
const respond = (status: number, body: string) => (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("kick počítá poctivě (dřív: každý fetch = „rozběhnuto“, i 401)", () => {
  it("401 z chráněného nasazení (HTML) → selhání s radou, poslední chyba pro Nastavení", async () => {
    const k = await kick({ origin: "https://app-abc123.vercel.app", ids: [ID], fetchImpl: respond(401, "<!doctype html>Authentication Required") });
    expect(k.kicked).toBe(0);
    expect(k.failed).toBe(1);
    expect(k.reason).toMatch(/chráněná.*Deployment Protection.*APP_URL/);
    expect(lastKickFailure()?.message).toMatch(/chráněná/);
  });
  it("401 s JSON (jiné tajemství), 404, 503 → selhání", async () => {
    expect((await kick({ origin: "https://x", ids: [ID], fetchImpl: respond(401, '{"error":"Neautorizováno."}') })).reason).toMatch(/odmítla tajemství/);
    expect((await kick({ origin: "https://x", ids: [ID], fetchImpl: respond(404, "Not found") })).reason).toMatch(/HTTP 404/);
    expect((await kick({ origin: "https://x", ids: [ID], fetchImpl: respond(503, "{}") })).failed).toBe(1);
  });
  it("nedostupná adresa → selhání; timeout (funkce běží dál) → rozběhnuto; 200 → rozběhnuto a chyba se smaže", async () => {
    const refused = (async () => { throw new TypeError("fetch failed (ECONNREFUSED)"); }) as unknown as typeof fetch;
    const r = await kick({ origin: "http://127.0.0.1:9", ids: [ID], fetchImpl: refused });
    expect(r).toMatchObject({ kicked: 0, failed: 1 });
    expect(r.reason).toMatch(/nedostupná/);
    const slow = (async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
    expect((await kick({ origin: "https://x", ids: [ID], fetchImpl: slow })).kicked).toBe(1);
    expect((await kick({ origin: "https://x", ids: [ID, "22222222-2222-4222-8222-222222222222"], fetchImpl: respond(200, "{}") })).kicked).toBe(2);
    expect(lastKickFailure()).toBeNull();
  });
  it("skutečně nedostupná adresa (bez mocku)", async () => {
    const r = await kick({ origin: "http://127.0.0.1:9", ids: [ID], waitMs: 3_000 });
    expect(r.kicked).toBe(0);
    expect(r.failed).toBe(1);
  });
  it("describeKickFailure: 403 bez JSON = ochrana", () => {
    expect(describeKickFailure(403, "Forbidden", "https://a")).toMatch(/Protection Bypass/);
  });
});

describe("adresa aplikace na Vercelu", () => {
  it("localhost z .env.example se na Vercelu přeskočí (další kandidát)", () => {
    process.env.VERCEL = "1";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.VERCEL_URL = "app-abc.vercel.app";
    expect(appOrigin(null)).toBe("https://app-abc.vercel.app");
    expect(anonRunnerStatus().warning).toMatch(/localhost/);
  });
  it("v produkci má produkční doména přednost před chráněnou adresou nasazení", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_ENV = "production";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "mnastrojarna.vercel.app";
    process.env.VERCEL_URL = "mnastrojarna-git-x-team.vercel.app";
    expect(appOrigin(null)).toBe("https://mnastrojarna.vercel.app");
    process.env.APP_URL = "https://crm.mnastrojarna.cz/";
    expect(appOrigin(null)).toBe("https://crm.mnastrojarna.cz");
  });
  it("mimo Vercel zůstává localhost (lokální vývoj)", () => {
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3500";
    expect(appOrigin(null)).toBe("http://localhost:3500");
  });
});

describe("Nastavení: stav zpracování na pozadí", () => {
  it("bez servisního klíče = neběží vůbec; bez CRON_SECRET / APP_URL = jasná věta", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    expect(anonRunnerStatus().warning).toMatch(/SUPABASE_SECRET_KEY — anonymizace výkresů vůbec neběží/);
    process.env.SUPABASE_SECRET_KEY = "k";
    const w = anonRunnerStatus().warning!;
    expect(w).toMatch(/APP_URL/);
    expect(w).toMatch(/CRON_SECRET/);
    process.env.CRON_SECRET = "c";
    process.env.APP_URL = "https://app.example";
    expect(anonRunnerStatus().warning).toBeNull();
  });
  it("probeRunner: 200 = ok, 401 HTML = chráněná adresa (výsledek v paměti 5 min, force obejde)", async () => {
    process.env.APP_URL = "https://probe.example";
    expect(await probeRunner({ fetchImpl: respond(200, '{"ok":true}'), force: true })).toEqual({ ok: true, message: null });
    expect((await probeRunner({ fetchImpl: respond(401, "<html>"), force: false })).ok).toBe(true);
    const bad = await probeRunner({ fetchImpl: respond(401, "<html>"), force: true });
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/chráněná/);
  });
});

describe("omezovač šťouchnutí", () => {
  it("stejný klíč 1× za 8 s, nejvýš 4 souběžné běhy", () => {
    const l = new NudgeLimiter(8_000, 2);
    const k = nudgeKey("u", "job_files", ["B", "a"]);
    expect(k).toBe(nudgeKey("u", "job_files", ["A", "b"]));
    expect(l.acquire(k, 1_000)).toBe("ok");
    expect(l.acquire(k, 5_000)).toBe("throttled");
    expect(l.acquire("x", 5_000)).toBe("ok");
    expect(l.acquire("y", 5_000)).toBe("busy");
    l.release();
    expect(l.acquire("y", 5_000)).toBe("ok");
    l.release(); l.release();
    expect(l.acquire(k, 9_500)).toBe("ok");
    expect(l.running).toBe(1);
  });
});

describe("stavy v UI (žádný nekonečný spinner)", () => {
  it("starý výkres, zaseknutí, opakování po chybě", () => {
    expect(fileAnonLabel({ status: "pending", backfill: true })).toMatchObject({ label: "Starší výkres", tone: "muted" });
    expect(fileAnonLabel({ status: "processing", stalled: true })).toMatchObject({ label: "Čeká déle než obvykle", tone: "warn" });
    const retry = fileAnonLabel({ status: "pending", reason: "Cannot read properties of undefined (reading 'x')" });
    expect(retry.label).toBe("Zkouší se znovu…");
    expect(retry.hint).not.toMatch(/Cannot read/);
    expect(fileAnonLabel({ status: "pending" }).tone).toBe("busy");
  });
  it("odznak zakázky: staré výkresy nesvítí jako „Čeká…“", () => {
    const b = { total: 2, done: 0, review: 0, failed: 0, pending: 2, unsupported: 0, skipped: 0, sendWaiting: 0 };
    expect(jobAnonBadge({ ...b, waitingLegacy: 2 })!.parts[0]).toEqual({ text: "Starší výkresy", tone: "muted" });
    expect(jobAnonBadge({ ...b, waitingLegacy: 1 })!.parts[0]).toEqual({ text: "Čeká…", tone: "busy" });
  });
});

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn(); } }));
