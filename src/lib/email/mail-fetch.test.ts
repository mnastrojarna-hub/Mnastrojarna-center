import { describe, it, expect } from "vitest";
import { planPop3, type MailSyncState } from "./mail-fetch";

/** POP3 schránka s `count` zprávami (UIDL „u1"…). */
const server = (count: number, from = 1) => Array.from({ length: count }, (_, i) => ({ n: i + 1, uid: `u${from + i}` }));

/** Simulace stahování: plán → „zpracováno vše" → nový stav. */
function run(list: { n: number; uid: string }[], state: MailSyncState, limit: number) {
  const plan = planPop3(list, state, limit);
  const next: MailSyncState = { ...state, pop3: { seen: [...plan.baseSeen, ...plan.pick.map((m) => m.uid)] } };
  return { plan, next };
}

describe("POP3 — co stáhnout (UIDL)", () => {
  it("první stažení: jen nejnovějších N, ostatní označené jako viděné bez stahování", () => {
    const { plan } = run(server(10), {}, 3);
    expect(plan.pick.map((m) => m.uid)).toEqual(["u8", "u9", "u10"]);
    expect(plan.baseSeen).toHaveLength(7);
    expect(plan.remaining).toBe(0);
  });

  it("schránka s > 5000 zprávami: staré zprávy se NEstahují znovu dokola (žádné prořezávání podle počtu)", () => {
    const list = server(6000);
    let { next: state } = run(list, {}, 20);
    expect(state.pop3!.seen).toHaveLength(6000);
    for (let round = 0; round < 3; round++) {
      const { plan, next } = run(list, state, 20);
      expect(plan.pick).toHaveLength(0); // dřív: .slice(-5000) zahodil UIDL 1000 starých zpráv → stahovaly se znovu
      expect(plan.remaining).toBe(0);
      state = next;
    }
    // přijde nová zpráva → stáhne se jen ta
    const withNew = [...list, { n: 6001, uid: "u-novy" }];
    const { plan } = run(withNew, state, 20);
    expect(plan.pick.map((m) => m.uid)).toEqual(["u-novy"]);
  });

  it("prořezává jen UIDL zpráv, které už na serveru nejsou", () => {
    const { next } = run(server(5), {}, 5);
    // Outlook smazal u1 a u2 ze serveru; čísla zpráv se posunula
    const after = server(3, 3);
    const { plan, next: n2 } = run(after, next, 5);
    expect(plan.pick).toHaveLength(0);
    expect(n2.pop3!.seen.sort()).toEqual(["u3", "u4", "u5"]);
  });

  it("limit dávky: zbytek nových zpráv příště, nic se neztratí", () => {
    const { next } = run(server(2), {}, 20);
    const list = server(12); // 10 nových
    const first = planPop3(list, next, 4);
    expect(first.pick.map((m) => m.uid)).toEqual(["u3", "u4", "u5", "u6"]);
    expect(first.remaining).toBe(6);
  });
});
