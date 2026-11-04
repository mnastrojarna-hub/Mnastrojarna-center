import { describe, expect, it } from "vitest";
import { hasServerActionHeader, isQuiet, stateForOwnWrite } from "./safe-history";

describe("bezpečný zápis adresy (fronta akcí Next)", () => {
  it("pozná volání serverové akce podle hlavičky Next-Action (Headers, objekt, pole)", () => {
    expect(hasServerActionHeader(new Headers({ "Next-Action": "abc" }))).toBe(true);
    expect(hasServerActionHeader({ "next-action": "abc" })).toBe(true);
    expect(hasServerActionHeader([["Next-Action", "abc"]])).toBe(true);
    expect(hasServerActionHeader({ accept: "text/x-component" })).toBe(false);
    expect(hasServerActionHeader(undefined)).toBe(false);
  });
  it("synchronizaci s Next pustí až bez běžící akce a chvíli po poslední", () => {
    expect(isQuiet({ inflight: 1, lastActionEnd: 0 }, 1000)).toBe(false);
    expect(isQuiet({ inflight: 0, lastActionEnd: 950 }, 1000)).toBe(false);
    expect(isQuiet({ inflight: 0, lastActionEnd: 800 }, 1000)).toBe(true);
    expect(isQuiet({ inflight: 0, lastActionEnd: -Infinity }, 0)).toBe(true);
  });
  it("vlastní zápis nese kopii stavu Next (__NA + strom), aby ho Next nebral jako obnovení z historie", () => {
    const tree = ["", {}];
    const st = stateForOwnWrite({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree, x: 1 });
    expect(st).toEqual({ __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: tree, x: 1 });
    expect(stateForOwnWrite(null)).toEqual({});
  });
});
