import { describe, expect, it, vi, beforeEach } from "vitest";

// Přímé akce dalšího kroku (#25 review): „Schválit“ z hlavičky karty / řádku Knihy posílá updated_at
// nabídky, jakou uživatel viděl — mezitím upravenou nabídku server odmítne.
const calls: unknown[][] = [];
vi.mock("@/app/actions/flow-status", () => ({
  setQuoteState: vi.fn(async (...args: unknown[]) => { calls.push(args); return { ok: true }; }),
  setInquiryStatus: vi.fn(async () => ({ ok: true })),
  setOrderStatus: vi.fn(async () => ({ ok: true })),
  takeInquiry: vi.fn(async () => ({ ok: true })),
  decideFlowProposal: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/app/actions/jobs", () => ({ newJobQuoteRevision: vi.fn(async () => ({ ok: true })) }));

import { runDirectAction } from "./flow-direct";

describe("runDirectAction — schválení s optimistickým zámkem", () => {
  beforeEach(() => { calls.length = 0; });

  it("quote.approve předá expectedUpdatedAt", async () => {
    await runDirectAction("quote.approve", { jobId: "j1", quoteId: "q1", expectedUpdatedAt: "2026-10-23T08:00:00.123Z" });
    expect(calls).toEqual([["q1", "schvalena", { expectedUpdatedAt: "2026-10-23T08:00:00.123Z" }]]);
  });

  it("bez známého updated_at null (server pak zámek nekontroluje); ostatní přechody beze změny", async () => {
    await runDirectAction("quote.approve", { jobId: "j1", quoteId: "q1" });
    await runDirectAction("quote.accept", { jobId: "j1", quoteId: "q1", expectedUpdatedAt: "x" });
    expect(calls).toEqual([["q1", "schvalena", { expectedUpdatedAt: null }], ["q1", "prijata"]]);
  });
});
