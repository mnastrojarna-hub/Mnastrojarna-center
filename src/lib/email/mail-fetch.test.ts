import { describe, it, expect } from "vitest";
import { planImapChunk, planPop3, type ImapFolderState, type MailSyncState } from "./mail-fetch";

/** POP3 schránka s `count` zprávami (UIDL „u1"…). */
const server = (count: number, from = 1) => Array.from({ length: count }, (_, i) => ({ n: i + 1, uid: `u${from + i}` }));

/** Simulace stahování POP3: plán → „zpracováno vše" → nový stav. */
function run(list: { n: number; uid: string }[], state: MailSyncState, limit: number) {
  const plan = planPop3(list, state, limit);
  const next: MailSyncState = { ...state, pop3: { seen: [...plan.baseSeen, ...plan.pick.map((m) => m.uid)], full: true } };
  return { plan, next };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Stáhne celou IMAP složku po dávkách; vrací pořadí UID a počet kol. */
function drainImap(uids: number[], limit: number, start?: ImapFolderState) {
  let state = start;
  const order: number[] = [];
  let rounds = 0;
  for (;;) {
    const plan = planImapChunk(uids, state, "7", limit);
    rounds++;
    order.push(...plan.pick);
    state = plan.stateAfter(plan.pick.length);
    if (!plan.remaining || rounds > 1000) return { order, rounds, state, last: plan };
  }
}

describe("IMAP — stáhnout celou složku po dávkách (kurzor)", () => {
  it("první stažení: VŠE, od nejnovější dolů, po dávkách; zbývá klesá na 0", () => {
    const { order, rounds, state } = drainImap(range(1, 2150), 50);
    expect(order).toHaveLength(2150);
    expect(new Set(order).size).toBe(2150);
    expect(order.slice(0, 3)).toEqual([2150, 2149, 2148]); // čerstvá pošta první
    expect(rounds).toBe(43);
    expect(state).toMatchObject({ uidValidity: "7", lastUid: 2150, backfillBelow: 1 });
  });

  it("průběh: remaining = co ještě čeká", () => {
    const p1 = planImapChunk(range(1, 120), undefined, "7", 50);
    expect(p1.pick).toHaveLength(50);
    expect(p1.remaining).toBe(70);
    const p2 = planImapChunk(range(1, 120), p1.stateAfter(50), "7", 50);
    expect(p2.pick[0]).toBe(70);
    expect(p2.remaining).toBe(20);
  });

  it("nová pošta během dotahování starší má přednost (vzestupně), pak pokračuje starší", () => {
    const p1 = planImapChunk(range(1, 100), undefined, "7", 30);
    const st = p1.stateAfter(30); // 100..71 hotovo
    const p2 = planImapChunk([...range(1, 100), 101, 102], st, "7", 5);
    expect(p2.pick).toEqual([101, 102, 70, 69, 68]);
    expect(p2.remaining).toBe(67);
    const after = p2.stateAfter(5);
    expect(after).toMatchObject({ lastUid: 102, backfillBelow: 68 });
  });

  it("časový limit uprostřed dávky: stav se posune jen o zpracované (nic se neztratí ani nestáhne dvakrát)", () => {
    const p1 = planImapChunk(range(1, 10), { uidValidity: "7", lastUid: 5, backfillBelow: 4 }, "7", 6);
    expect(p1.pick).toEqual([6, 7, 8, 9, 10, 3]);
    expect(p1.stateAfter(2)).toMatchObject({ lastUid: 7, backfillBelow: 4 });
    expect(p1.stateAfter(6)).toMatchObject({ lastUid: 10, backfillBelow: 3 });
    const p2 = planImapChunk(range(1, 10), p1.stateAfter(2), "7", 20);
    expect(p2.pick).toEqual([8, 9, 10, 3, 2, 1]);
  });

  it("změněná UIDVALIDITY = nový začátek; starý stav bez backfillBelow dotáhne starší poštu", () => {
    expect(planImapChunk(range(1, 5), { uidValidity: "1", lastUid: 5, backfillBelow: 1 }, "7", 10).reset).toBe(true);
    const legacy = planImapChunk(range(1, 30), { uidValidity: "7", lastUid: 30 }, "7", 50); // dřív: jen nejnovějších 20
    expect(legacy.pick).toEqual(range(1, 30).reverse());
    expect(legacy.remaining).toBe(0);
  });

  it("prázdná složka i hotová složka: nic ke stažení", () => {
    expect(planImapChunk([], undefined, "7", 50)).toMatchObject({ pick: [], remaining: 0 });
    const { state } = drainImap(range(1, 8), 50);
    expect(planImapChunk(range(1, 8), state, "7", 50)).toMatchObject({ pick: [], remaining: 0 });
  });
});

describe("POP3 — stáhnout vše (UIDL)", () => {
  it("první stažení: všechny zprávy, od nejnovější, po dávkách", () => {
    const { plan, next } = run(server(10), {}, 3);
    expect(plan.pick.map((m) => m.uid)).toEqual(["u10", "u9", "u8"]);
    expect(plan.remaining).toBe(7);
    const p2 = planPop3(server(10), next, 3);
    expect(p2.pick.map((m) => m.uid)).toEqual(["u7", "u6", "u5"]);
    expect(p2.remaining).toBe(4);
  });

  it("starý stav (staré zprávy jen označené jako viděné) → stáhne se celá schránka", () => {
    const legacy: MailSyncState = { pop3: { seen: ["u1", "u2", "u3"] } };
    expect(planPop3(server(3), legacy, 20).pick).toHaveLength(3);
  });

  it("schránka s > 5000 zprávami: po stažení se nic nestahuje znovu dokola", () => {
    const list = server(6000);
    let state: MailSyncState = {};
    for (let i = 0; i < 10; i++) state = run(list, state, 1000).next;
    expect(state.pop3!.seen).toHaveLength(6000);
    for (let round = 0; round < 3; round++) {
      const { plan, next } = run(list, state, 20);
      expect(plan.pick).toHaveLength(0);
      expect(plan.remaining).toBe(0);
      state = next;
    }
    const { plan } = run([...list, { n: 6001, uid: "u-novy" }], state, 20);
    expect(plan.pick.map((m) => m.uid)).toEqual(["u-novy"]);
  });

  it("prořezává jen UIDL zpráv, které už na serveru nejsou", () => {
    const { next } = run(server(5), {}, 5);
    const after = server(3, 3);
    const { plan, next: n2 } = run(after, next, 5);
    expect(plan.pick).toHaveLength(0);
    expect(n2.pop3!.seen.sort()).toEqual(["u3", "u4", "u5"]);
  });
});
