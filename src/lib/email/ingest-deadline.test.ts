import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Časový limit synchronizace pošty (bez databáze):
 * - AI volání (kategorizace, návrh odpovědi) se přeruší signálem — nevisí do limitu platformy,
 * - po uplynutí `stopAt` se nezačne ani první e-mail dávky (dřív se první dávka zpracovala vždy).
 */

vi.mock("@/lib/settings", () => ({
  getAiConfig: async () => ({ apiKey: "sk-ant-test", model: "claude-test" }),
  getSetting: async () => undefined,
  getImapConfig: async () => ({ port: 993 }),
  getGraphConfig: async () => ({}),
}));

let server: http.Server;
let requests = 0;

beforeAll(async () => {
  // „Claude API", které nikdy neodpoví
  server = http.createServer(() => {
    requests++;
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env.ANTHROPIC_BASE_URL;
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
});

const mail = (i: number) => ({
  messageId: `<t${i}@test>`, fromName: "Test", fromEmail: "t@test.cz", subject: `Zpráva ${i}`, body: "Text", receivedAt: new Date().toISOString(),
});

describe("synchronizace pošty — časový limit", () => {
  it("AI kategorizace i návrh odpovědi se přeruší po časovém limitu (žádné nekonečné čekání)", async () => {
    const { categorizeEmail, draftReply } = await import("@/lib/ai/claude");
    const t0 = Date.now();
    await expect(categorizeEmail({ from: "a@b.cz", subject: "x", body: "y", signal: AbortSignal.timeout(300) })).rejects.toThrow();
    await expect(draftReply({ from: "a@b.cz", subject: "x", body: "y", signal: AbortSignal.timeout(300) })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(requests).toBeGreaterThanOrEqual(2); // dotaz opravdu odešel a visel
  });

  it("jeden e-mail (2 AI volání) se vejde do rezervy před koncem synchronizace", async () => {
    const { AI_CALL_TIMEOUT_MS, SYNC_RESERVE_MS } = await import("./ingest");
    expect(2 * AI_CALL_TIMEOUT_MS).toBeLessThan(SYNC_RESERVE_MS);
  });

  it("po uplynutí limitu se nezačne ani první e-mail dávky; stav se posune jen o zpracované", async () => {
    const { ingestEmailsProgress, ingestInChunks } = await import("./ingest");
    const past = Date.now() - 1;
    expect(await ingestEmailsProgress([mail(1), mail(2)], "box", { stopAt: past })).toEqual({ processed: 0, ingested: 0 });
    const progress = await ingestInChunks([1, 2, 3, 4, 5, 6, 7].map(mail), { id: "box", owner_id: null }, undefined, past);
    expect(progress).toEqual({ processed: 0, ingested: 0 }); // dřív: první dávka (5 e-mailů) vždy
  });
});
