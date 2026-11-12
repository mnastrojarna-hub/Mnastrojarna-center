import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Běh fronty v požadavku (runner.ts) s mockem služby: po jednom souboru do termínu, rozvětvení zbytku,
 * soubor s ODLOŽENÝM pokusem se ve stejném běhu znovu nezkouší, soubor převzatý jiným během se přeskočí, termín.
 * Majitel 5. 11. („někdy to musí dělat na třikrát"): soubor, který skončil pending BEZ odkladu (retryNow —
 * přechodná chyba, únik názvu, další dávka stran), vezme tentýž běh hned znovu (krátká pauza, strop), ne až
 * další šťouchnutí / klik; při termínu se zbytek rozvětví.
 * (Skutečný claim / převzetí prošlého zámku / 3 pokusy → auto-start.integration.test.ts.)
 */

const m = vi.hoisted(() => ({
  queue: [] as string[],
  status: new Map<string, string>(),
  claimedElsewhere: new Set<string>(),
  kicks: [] as string[][],
  runs: [] as string[],
  /** Scénář po souborech: výsledky po sobě jdoucích běhů (poslední se opakuje). */
  script: new Map<string, { status: string; retryNow?: boolean; continued?: boolean }[]>(),
}));

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}), hasServiceKey: () => true }));
vi.mock("./service", () => ({
  KICK_CONCURRENCY: 5,
  appOrigin: () => "https://app.example",
  kick: vi.fn(async (o: { ids: string[] }) => { m.kicks.push(o.ids); return { kicked: 0, ids: o.ids, failed: o.ids.length }; }),
  runnableIds: vi.fn(async (_db: unknown, _t: string, o: { exclude?: string[]; limit?: number }) =>
    m.queue.filter((id) => (m.status.get(id) ?? "pending") === "pending" && !(o.exclude ?? []).includes(id)).slice(0, o.limit ?? 5)),
  runClaimed: vi.fn(async (_db: unknown, table: string, ids: string[]) => {
    const id = ids[0];
    if (m.claimedElsewhere.has(id)) return [];
    m.runs.push(id);
    const steps = m.script.get(id);
    if (steps?.length) {
      const step = steps.length > 1 ? steps.shift()! : steps[0];
      m.status.set(id, step.status);
      return [{ id, table, status: step.status, reason: step.status === "pending" ? "Chyba" : null, retryNow: step.retryNow, continued: step.continued, attempt: m.runs.filter((r) => r === id).length }];
    }
    // „bad" selže s ODLOŽENÝM pokusem (pending se zámkem) — ve stejném běhu se nezkouší
    const status = id.startsWith("bad") ? "pending" : "done";
    m.status.set(id, status);
    return [{ id, table, status, reason: status === "pending" ? "Chyba" : null }];
  }),
}));

import { CONTINUE_MIN_LEFT_MS, fileIdsOf, IN_RUN_BACKOFF_MS, MIN_TIME_LEFT_MS, processQueue } from "./runner";

beforeEach(() => {
  m.queue = []; m.status.clear(); m.claimedElsewhere.clear(); m.kicks = []; m.runs = []; m.script.clear();
});
const NO_WAIT = { retryBackoffMs: [0, 0] as const };

describe("processQueue", () => {
  it("zpracuje celou frontu po jednom; zbytek se jednou rozvětví (i když kick selže, dojede to tady)", async () => {
    m.queue = ["a", "b", "c", "d", "e", "f", "g"];
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000 });
    expect(m.runs).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(m.kicks).toEqual([["b", "c", "d", "e"]]);
    expect(o).toMatchObject({ remaining: 0, kickFailed: 4, stoppedBy: "empty" });
    expect(o.results.every((r) => r.status === "done")).toBe(true);
  });
  it("soubor s odloženým pokusem (pending se zámkem, bez retryNow) se ve stejném běhu znovu nezkouší, zůstane ve frontě", async () => {
    m.queue = ["bad1", "ok1"];
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000, fanOut: false });
    expect(m.runs).toEqual(["bad1", "ok1"]);
    expect(o.remaining).toBe(1);
    expect(o.retried).toBe(0);
  });
  it("přechodná chyba (retryNow): tentýž běh vezme soubor hned znovu (po krátké pauze) a dokončí ho — bez dalšího šťouchnutí", async () => {
    m.queue = ["r1", "ok1"];
    m.script.set("r1", [{ status: "pending", retryNow: true }, { status: "done" }]);
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000, fanOut: false, ...NO_WAIT });
    expect(m.runs).toEqual(["r1", "r1", "ok1"]);
    expect(o.retried).toBe(1);
    expect(o.remaining).toBe(0);
    expect(o.results.map((r) => `${r.id}:${r.status}`)).toEqual(["r1:pending", "r1:done", "ok1:done"]);
    expect(o.runId).toMatch(/^[0-9a-f]{8}$/);
  });
  it("strop rychlých opakování v běhu = IN_RUN_BACKOFF_MS.length (pak soubor zůstane ve frontě dalšímu běhu — žádná smyčka)", async () => {
    m.queue = ["loop"];
    m.script.set("loop", [{ status: "pending", retryNow: true }]);
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000, fanOut: false, ...NO_WAIT });
    expect(m.runs).toHaveLength(1 + IN_RUN_BACKOFF_MS.length);
    expect(o.retried).toBe(IN_RUN_BACKOFF_MS.length);
    expect(o.remaining).toBe(1);
  });
  it("navazující dávky stran (continued) jdou v témže běhu bez pauzy, dokud soubor nedoběhne", async () => {
    m.queue = ["pdf"];
    m.script.set("pdf", [{ status: "pending", retryNow: true, continued: true }, { status: "pending", retryNow: true, continued: true }, { status: "pending", retryNow: true, continued: true }, { status: "done" }]);
    const t0 = Date.now();
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000, fanOut: false });
    expect(m.runs).toEqual(["pdf", "pdf", "pdf", "pdf"]);
    expect(o.retried).toBe(3);
    expect(Date.now() - t0).toBeLessThan(1_500);
    expect(o.remaining).toBe(0);
  });
  it("bez času na celý další pokus (< CONTINUE_MIN_LEFT_MS) se neopakuje — soubor zůstane pending bez odkladu a zbytek se rozvětví", async () => {
    m.queue = ["r1"];
    m.script.set("r1", [{ status: "pending", retryNow: true }, { status: "done" }]);
    const o = await processQueue({ db: {} as never, deadline: Date.now() + CONTINUE_MIN_LEFT_MS - 5_000, ...NO_WAIT });
    expect(m.runs).toEqual(["r1"]);
    expect(o.retried).toBe(0);
    expect(o.remaining).toBe(1);
    // zbytek k okamžitému zpracování se rozvětví (best effort) — další funkce pokračuje hned
    expect(m.kicks).toEqual([["r1"]]);
  });
  it("soubor převzatý jiným během (claim prázdný) se přeskočí", async () => {
    m.queue = ["x", "y"];
    m.claimedElsewhere.add("x");
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000, fanOut: false });
    expect(m.runs).toEqual(["y"]);
    expect(o.results.map((r) => r.id)).toEqual(["y"]);
  });
  it("termín: nový soubor se nezačne, když zbývá míň než rezerva; maxFiles", async () => {
    m.queue = ["a", "b"];
    const late = await processQueue({ db: {} as never, deadline: Date.now() + MIN_TIME_LEFT_MS - 1_000 });
    expect(late).toMatchObject({ stoppedBy: "deadline", results: [] });
    const one = await processQueue({ db: {} as never, deadline: Date.now() + 200_000, maxFiles: 1, fanOut: false });
    expect(one.stoppedBy).toBe("max");
    expect(m.runs).toEqual(["a"]);
  });
  it("fileIdsOf: focení (fileId) i dávka (docs[].fileIds)", () => {
    expect(fileIdsOf({ fileId: "a", docs: [{ fileIds: ["b", "a"] }, { fileIds: [] }] })).toEqual(["a", "b"]);
    expect(fileIdsOf(null)).toEqual([]);
  });
});
