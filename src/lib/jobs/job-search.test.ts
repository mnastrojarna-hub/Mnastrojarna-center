import { describe, expect, it } from "vitest";
import { compactSearch, filterJobs, jobSearchScore, rankBySearch } from "./mapping";
import type { JobListItem } from "./types";

const job = (id: string, number: string, extra: Partial<JobListItem> = {}): JobListItem => ({
  id, number, title: "", stage: "poptavka", priority: "normal", customer: null, customerOrderNumber: null, customerInquiryNumber: null,
  drawingNumbers: [], itemCount: 0, totalQuantity: 0, value: null, purchaseCost: null, currency: "CZK", inquiryDate: null, orderDate: null,
  customerRequiredDate: null, dueDate: null, expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null, receivedAt: null,
  deliveredAt: null, owner: null, assignee: null, createdBy: null, supplier: null, quoteCount: 0, fileCount: 0, aiFilled: false, source: "manual",
  createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", stageChangedAt: null, ...extra,
} as JobListItem);

describe("hledání v Knize (16. 11.)", () => {
  const a = job("a", "Z-2026-026");
  const b = job("b", "Z-2026-140", { drawingNumbers: ["VK-026-1"] });
  const c = job("c", "Z-2026-099", { customerOrderNumber: "PO 2026/026" });
  it("část čísla i s oddělovači a mezerami", () => {
    expect(compactSearch("Z-2026/026")).toBe("z2026026");
    expect(filterJobs([a, b, c], { q: "2026 026" }).map((j) => j.id)).toContain("a");
    expect(filterJobs([a, b, c], { q: "2026/026" }).map((j) => j.id)).toEqual(expect.arrayContaining(["a", "c"]));
    expect(filterJobs([a, b, c], { q: "026" }).map((j) => j.id).sort()).toEqual(["a", "b", "c"]);
  });
  it("relevance: číslo zakázky > číslo dokladu > výkres", () => {
    expect(jobSearchScore(a, "026")).toBeGreaterThan(jobSearchScore(c, "026"));
    expect(jobSearchScore(c, "026")).toBeGreaterThan(jobSearchScore(b, "026"));
    expect(rankBySearch([b, c, a], null, "026").map((j) => j.id)).toEqual(["a", "c", "b"]);
  });
  it("výsledek z DB (položky, doklady, poznámky) projde i bez shody v seznamu", () => {
    expect(filterJobs([a, b], { q: "kaleni", searchHits: new Map([["b", 20]]) }).map((j) => j.id)).toEqual(["b"]);
  });
});
