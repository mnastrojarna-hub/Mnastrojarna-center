import { describe, it, expect } from "vitest";
import {
  canConfirmMerge, cleanMergeQuery, czPlural, drawingKey, drawingLikePattern, mergeCandidateScore, mergeCountLines, mergeOutcomeWarnings,
  mergeSummary, rankMergeCandidates, type MergePreview,
} from "./job-merge-types";
import { mapMergePreview, mapMergeResult, mergeErrorCode } from "./job-merge-store";

describe("sloučení zakázek — pomůcky", () => {
  it("české tvary a shrnutí", () => {
    expect(czPlural(1, ["nabídka", "nabídky", "nabídek"])).toBe("1 nabídka");
    expect(czPlural(3, ["nabídka", "nabídky", "nabídek"])).toBe("3 nabídky");
    expect(czPlural(5, ["nabídka", "nabídky", "nabídek"])).toBe("5 nabídek");
    expect(mergeSummary({ quotes: 1, files: 2, emails: 1, items: 3, events: 9 })).toBe("3 položky, 2 dokumenty, 1 nabídka a 1 další");
    expect(mergeSummary({})).toBe("nic dalšího k přesunu");
    // položka se stejným výkresem se spojila (nepřesunula)
    expect(mergeSummary({ items: 0, itemsMerged: 1, quotes: 1 })).toBe("1 položka spojena, 1 nabídka");
    expect(mergeSummary({ items: 1, itemsMerged: 2, files: 1 })).toBe("1 položka, 2 položky spojeny, 1 dokument");
    expect(mergeCountLines({ files: 0, quotes: 2 }).map((l) => l.text)).toEqual(["2 nabídky"]);
  });

  it("potvrzení: blokace nikdy, force jen super admin s důvodem", () => {
    const base = { ok: true, needsForce: false, canForce: false } as MergePreview;
    expect(canConfirmMerge(base, { enabled: false, reason: "" })).toBe(true);
    expect(canConfirmMerge({ ...base, ok: false }, { enabled: true, reason: "důvod" })).toBe(false);
    expect(canConfirmMerge({ ...base, needsForce: true }, { enabled: true, reason: "důvod" })).toBe(false);
    expect(canConfirmMerge({ ...base, needsForce: true, canForce: true }, { enabled: true, reason: " a " })).toBe(false);
    expect(canConfirmMerge({ ...base, needsForce: true, canForce: true }, { enabled: true, reason: "pobočka" })).toBe(true);
  });

  it("dotaz hledání bez znaků, které rozbijí filtr PostgRESTu; klíč výkresu = drawing_norm", () => {
    expect(cleanMergeQuery("Z-2026-014, (x)*%")).toBe("Z-2026-014 x");
    expect(cleanMergeQuery(42)).toBe("");
    expect(drawingKey("F00N 603.W84")).toBe("F00N603W84");
    // vzor ILIKE najde i jinak zapsaný výkres; jen písmena a číslice (bezpečné do .or())
    expect(drawingLikePattern("F00N 603 W84")).toBe("%F%0%0%N%6%0%3%W%8%4%");
    expect(drawingLikePattern("ab,c)")).toBeNull();
    expect(drawingLikePattern("A-1")).toBeNull();
  });

  it("návrhy: víc silných důvodů první, upozornění po sloučení jen „warn“", () => {
    const list = rankMergeCandidates([
      { id: "recent", reasons: ["recent"], createdAt: "2026-10-28" },
      { id: "cust", reasons: ["customer"], createdAt: "2026-10-27" },
      { id: "twin", reasons: ["drawing", "customer"], createdAt: "2026-10-01" },
      { id: "batch", reasons: ["capture", "drawing", "customer"], createdAt: "2026-09-01" },
    ]);
    expect(list.map((c) => c.id)).toEqual(["batch", "twin", "cust", "recent"]);
    expect(mergeCandidateScore({ reasons: ["recent", "search"] })).toBe(0);
    expect(mergeOutcomeWarnings([
      { code: "STAGE_ADVANCE", level: "info", message: "a" }, { code: "QUOTE_WONT_ACCEPT", level: "warn", message: "b" },
      { code: "CUSTOMER_DIFFERENT", level: "force", message: "c" },
    ]).map((w) => w.code)).toEqual(["QUOTE_WONT_ACCEPT"]);
  });

  it("mapování náhledu, výsledku a chyb RPC", () => {
    const p = mapMergePreview({
      ok: true, needsForce: false, canForce: true,
      target: { id: "t", number: "Z-1", stage: "objednavka" }, source: { id: "s", number: "Z-2", stage: "nabidka" },
      stage: { from: "objednavka", to: "objednavka", source: "nabidka" }, acceptQuote: { id: "q", number: "136/026" },
      counts: { quotes: "1", files: 2 }, fields: [{ field: "note", label: "Poznámka", rule: "append", result: "a\n\nb" }],
      conflicts: [{ code: "PRODUCTION_BOTH", level: "warn", message: "x" }, { code: "X", level: "nonsense", message: "y" }],
    });
    expect(p?.counts.quotes).toBe(1);
    expect(p?.counts.emails).toBe(0);
    expect(p?.fields[0]).toMatchObject({ rule: "append", result: "a\n\nb", target: null });
    expect(p?.conflicts[1].level).toBe("warn");
    expect(mapMergePreview(null)).toBeNull();
    expect(mapMergeResult({ targetId: "t", sourceId: "s", replayed: true, moved: { quotes: 1 } })).toMatchObject({ replayed: true, moved: { quotes: 1 } });
    expect(mapMergeResult({})).toBeNull();
    expect(mergeErrorCode({ message: "x", code: "42501" })).toBe("FORBIDDEN");
    expect(mergeErrorCode({ message: "x", code: "P0001", hint: "NEEDS_FORCE" })).toBe("NEEDS_FORCE");
    expect(mergeErrorCode({ message: "x", code: "P0001", hint: "neco" })).toBe("VALIDATION");
  });
});
