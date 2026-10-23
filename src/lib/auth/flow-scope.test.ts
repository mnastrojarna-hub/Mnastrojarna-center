import { describe, expect, it } from "vitest";
import {
  NOBODY, allScope, inScope, isMineFile, isMineJob, isMinePurchaseOrder, isMineQuote, mineParam, parseFlowWho,
  type FlowScope, type MineJobFacts,
} from "@/lib/auth/flow-scope";

const U = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BOX = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FOREIGN_BOX = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const J1 = "d0000000-0000-4000-8000-000000000001";
const J2 = "d0000000-0000-4000-8000-000000000002";

const none: MineJobFacts = { ownerId: OTHER, assigneeId: null, createdBy: OTHER, emails: [], quotePeople: [] };
const viewer = { userId: U, mailboxIds: [BOX] };

function scope(patch: Partial<FlowScope> = {}): FlowScope {
  return {
    userId: U, all: false, who: "moje", canToggle: false, jobIds: new Set([J1]), mailboxIds: [BOX], mailboxEmails: ["obchod@x.cz"],
    error: false, ...patch,
  };
}

describe("isMineJob — pravidlo „moje“ (a–f)", () => {
  it.each<[string, Partial<MineJobFacts>]>([
    ["(a) obchodník", { ownerId: U }],
    ["(b) zpracovává", { assigneeId: U }],
    ["(c) založil", { createdBy: U }],
    ["(d/e) e-mail přiřazený mně", { emails: [{ ownerId: U, mailboxId: null }] }],
    ["(d/e) e-mail z mé schránky (bez vlastníka)", { emails: [{ ownerId: null, mailboxId: BOX }] }],
    ["(f) moje nabídka", { quotePeople: [null, U] }],
  ])("%s → moje", (_label, patch) => {
    expect(isMineJob({ ...none, ...patch }, viewer)).toBe(true);
  });

  it("nic z toho, cizí schránka, cizí nabídka → není moje", () => {
    expect(isMineJob(none, viewer)).toBe(false);
    expect(isMineJob({ ...none, emails: [{ ownerId: OTHER, mailboxId: FOREIGN_BOX }] }, viewer)).toBe(false);
    expect(isMineJob({ ...none, emails: [{ ownerId: null, mailboxId: null }] }, viewer)).toBe(false);
    expect(isMineJob({ ...none, quotePeople: [OTHER, null] }, viewer)).toBe(false);
  });

  it("jen schránka: e-mail cizího vlastníka v mé schránce je moje; bez schránek ne", () => {
    const facts = { ...none, emails: [{ ownerId: OTHER, mailboxId: BOX }] };
    expect(isMineJob(facts, viewer)).toBe(true);
    expect(isMineJob(facts, { userId: U, mailboxIds: [] })).toBe(false);
  });

  it("bez uživatele nic (ani zakázka bez obchodníka)", () => {
    expect(isMineJob({ ownerId: null, assigneeId: null, createdBy: null, emails: [], quotePeople: [null] }, { userId: "", mailboxIds: [] })).toBe(false);
  });
});

describe("parseFlowWho / mineParam", () => {
  it("ne-admin vždy „moje“; admin „moje“ jen na přání", () => {
    expect(parseFlowWho("vsichni", false)).toBe("moje");
    expect(parseFlowWho(undefined, false)).toBe("moje");
    expect(parseFlowWho(undefined, true)).toBe("vsichni");
    expect(parseFlowWho("moje", true)).toBe("moje");
    expect(parseFlowWho(["MOJE"], true)).toBe("moje");
    expect(parseFlowWho("cokoli", true)).toBe("vsichni");
  });

  it("p_mine: všichni = null, jinak id; bez přístupu nikdo (nikdy null)", () => {
    expect(mineParam({ userId: U, all: true, who: "vsichni", canToggle: true })).toBeNull();
    expect(mineParam({ userId: U, all: false, who: "moje", canToggle: true })).toBe(U);
    expect(mineParam(null)).toBe(NOBODY);
    expect(mineParam(undefined)).toBe(NOBODY);
  });
});

describe("rozsah: zakázky, nabídky, dokumenty, objednávky dodavatelům", () => {
  it("inScope: null a chyba → false (fail closed), všichni → true", () => {
    expect(inScope(null, J1)).toBe(false);
    expect(inScope(scope({ error: true }), J1)).toBe(false);
    expect(inScope(scope(), J1)).toBe(true);
    expect(inScope(scope(), J1.toUpperCase())).toBe(true);
    expect(inScope(scope(), J2)).toBe(false);
    expect(inScope(scope(), null)).toBe(false);
    expect(inScope(allScope(U), J2)).toBe(true);
  });

  it("isMineQuote: moje zakázka nebo moje osoby; nabídka bez zakázky jen přes osoby", () => {
    expect(isMineQuote({ jobId: J1, createdBy: OTHER }, scope())).toBe(true);
    expect(isMineQuote({ jobId: J2, createdBy: OTHER }, scope())).toBe(false);
    expect(isMineQuote({ jobId: J2, createdBy: U }, scope())).toBe(true);
    expect(isMineQuote({ jobId: null, createdBy: OTHER, ownerId: U }, scope())).toBe(true);
    expect(isMineQuote({ jobId: null, createdBy: OTHER, approvalRequestedBy: U }, scope())).toBe(true);
    expect(isMineQuote({ jobId: null, createdBy: OTHER }, scope())).toBe(false);
    expect(isMineQuote({ jobId: null, createdBy: U }, null)).toBe(false);
    expect(isMineQuote({ jobId: null, createdBy: U }, scope({ error: true }))).toBe(false);
    expect(isMineQuote({ jobId: J2, createdBy: OTHER }, allScope(U))).toBe(true);
  });

  it("isMineFile: moje zakázka nebo jsem nahrál", () => {
    expect(isMineFile({ jobId: J1, uploadedBy: OTHER }, scope())).toBe(true);
    expect(isMineFile({ jobId: J2, uploadedBy: U }, scope())).toBe(true);
    expect(isMineFile({ jobId: J2, uploadedBy: OTHER }, scope())).toBe(false);
    expect(isMineFile({ jobId: J1, uploadedBy: U }, null)).toBe(false);
  });

  it("isMinePurchaseOrder: zakázka, vytvořil, odeslal, odešla z mé schránky", () => {
    const po = { jobId: J2, createdBy: OTHER, sentBy: OTHER, sentMailboxId: FOREIGN_BOX };
    expect(isMinePurchaseOrder(po, scope())).toBe(false);
    expect(isMinePurchaseOrder({ ...po, jobId: J1 }, scope())).toBe(true);
    expect(isMinePurchaseOrder({ ...po, createdBy: U }, scope())).toBe(true);
    expect(isMinePurchaseOrder({ ...po, sentBy: U }, scope())).toBe(true);
    expect(isMinePurchaseOrder({ ...po, sentMailboxId: BOX }, scope())).toBe(true);
    expect(isMinePurchaseOrder({ ...po, sentMailboxId: null }, scope())).toBe(false);
    expect(isMinePurchaseOrder(po, allScope(U))).toBe(true);
    expect(isMinePurchaseOrder({ ...po, createdBy: U }, scope({ error: true }))).toBe(false);
  });
});
