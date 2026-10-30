import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Běh fronty v požadavku (runner.ts) s mockem služby: po jednom souboru do termínu, rozvětvení zbytku,
 * soubor selhaný v tomto běhu se znovu nezkouší, soubor převzatý jiným během se přeskočí, termín.
 * (Skutečný claim / převzetí prošlého zámku / 3 pokusy → auto-start.integration.test.ts.)
 */

const m = vi.hoisted(() => ({
  queue: [] as string[],
  status: new Map<string, string>(),
  claimedElsewhere: new Set<string>(),
  kicks: [] as string[][],
  runs: [] as string[],
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
    // „bad" selže a vrátí se do fronty (pending) — pokusy hlídá claim v DB
    const status = id.startsWith("bad") ? "pending" : "done";
    m.status.set(id, status);
    return [{ id, table, status, reason: status === "pending" ? "Chyba" : null }];
  }),
}));

import { fileIdsOf, MIN_TIME_LEFT_MS, processQueue } from "./runner";

beforeEach(() => {
  m.queue = []; m.status.clear(); m.claimedElsewhere.clear(); m.kicks = []; m.runs = [];
});

describe("processQueue", () => {
  it("zpracuje celou frontu po jednom; zbytek se jednou rozvětví (i když kick selže, dojede to tady)", async () => {
    m.queue = ["a", "b", "c", "d", "e", "f", "g"];
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000 });
    expect(m.runs).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(m.kicks).toEqual([["b", "c", "d", "e"]]);
    expect(o).toMatchObject({ remaining: 0, kickFailed: 4, stoppedBy: "empty" });
    expect(o.results.every((r) => r.status === "done")).toBe(true);
  });
  it("selhaný soubor se ve stejném běhu znovu nezkouší (žádná smyčka), zůstane ve frontě", async () => {
    m.queue = ["bad1", "ok1"];
    const o = await processQueue({ db: {} as never, deadline: Date.now() + 200_000, fanOut: false });
    expect(m.runs).toEqual(["bad1", "ok1"]);
    expect(o.remaining).toBe(1);
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
