/**
 * S čím stránka CADu přišla (share-entry.ts): sdílený odkaz k otevření, žádost o zadání kódu (…/s bez kódu = ?kod=1),
 * kód s překlepem za # (dialog s vysvětlením místo mlčky otevřeného prázdného CADu) a odložený odkaz, který se po
 * neúspěchu na kartu „nepřilepí“.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearShareStash, readShareEntry, stashForm, stashShare } from "./share-entry";

let store: Map<string, string>;
let url: { pathname: string; search: string; hash: string };
/** napodobí adresu stránky; history.replaceState ji přepíše stejně jako prohlížeč */
function page(pathname: string, search = "", hash = "") {
  url = { pathname, search, hash };
  vi.stubGlobal("location", url);
  vi.stubGlobal("history", {
    replaceState: (_s: unknown, _t: string, to: string) => {
      const u = new URL(to, "https://www.mnastrojarna.cz");
      url.pathname = u.pathname;
      url.search = u.search;
      url.hash = u.hash;
    },
  });
}
const shown = () => url.pathname + url.search + url.hash;

beforeEach(() => {
  store = new Map();
  vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());

describe("vstup stránky CADu se sdíleným odkazem", () => {
  it("odkaz odložený skriptem stránky se otevře; adresa je čistá", () => {
    page("/cad");
    stashShare("#Ab3kZ9xQ2m");
    expect(readShareEntry(true)).toEqual({ kind: "open", parsed: { kind: "code", code: "Ab3kZ9xQ2m" }, hash: "#Ab3kZ9xQ2m" });
    expect(shown()).toBe("/cad");
    // F5: odložený odkaz se otevře znovu
    expect(readShareEntry(true)?.kind).toBe("open");
  });

  it("část za # (skript stránky neběžel): otevře se, odloží se čistý kód a z adresy zmizí i s ?kod=1", () => {
    page("/cad", "?kod=1&utm=a", "#Ab3kZ9xQ2m).");
    expect(readShareEntry(true)).toEqual({ kind: "open", parsed: { kind: "code", code: "Ab3kZ9xQ2m" }, hash: "#Ab3kZ9xQ2m" });
    expect(store.get("mn-cad-share")).toBe("#Ab3kZ9xQ2m");
    expect(shown()).toBe("/cad?utm=a");
    // starší odkaz se odkládá tak, jak přišel
    page("/cad", "", "#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA");
    expect(readShareEntry(true)).toMatchObject({ kind: "open", parsed: { kind: "self" }, hash: "#q=Ab12345678.AAAAAAAAAAAAAAAAAAAAAA" });
    expect(stashForm({ kind: "code", code: "Ab3kZ9xQ2m" }, "#Ab3kZ9xQ2m%22")).toBe("#Ab3kZ9xQ2m");
  });

  it("…/s bez kódu (?kod=1): zeptat se na kód – i v kartě, kde se už pracovalo; dřívější sdílený dokument se znovu neotevírá", () => {
    // (revize: pole pro kód se ukázalo jen na úvodní obrazovce – ne v kartě s rozdělanou prací ani s vypnutou úvodní obrazovkou)
    page("/cad", "?kod=1");
    stashShare("#Zz99999999"); // dříve otevřený odkaz
    expect(readShareEntry(true)).toEqual({ kind: "ask", value: "" });
    expect(shown()).toBe("/cad");
    expect(store.has("mn-cad-share")).toBe(false);
    // po F5 už se neptá
    expect(readShareEntry(true)).toBeNull();
    // parametr musí být právě kod=1
    page("/cad", "?kod=2");
    expect(readShareEntry(true)).toBeNull();
    expect(shown()).toBe("/cad?kod=2");
  });

  it("kód s překlepem za #: dialog s kódem k opravě a s tím, co je špatně; část za # z adresy zmizí", () => {
    // (revize: 0 / O / I / l, jiná délka, VELKÁ PÍSMENA → mlčky úvodní obrazovka, kód zůstal v adrese)
    for (const [hash, value, error] of [
      ["#JycwWofHw0", "JycwWofHw0", /znak „0“/],
      ["#JycwWofHwO", "JycwWofHwO", /znak „O“/],
      ["#JYCWWOFHWW", "JYCWWOFHWW", /znak „O“/],
      ["#JycwWofHw", "JycwWofHw", /zadáno je 9/],
      ["#JycwWofHwWx", "JycwWofHwWx", /zadáno je 11/],
      ["#JycwWofHw%22", "JycwWofHw", /zadáno je 9/],
    ] as const) {
      page("/cad/", "", hash);
      stashShare("#Zz99999999");
      const e = readShareEntry(true);
      expect(e, hash).toMatchObject({ kind: "ask", value });
      expect(e && e.kind === "ask" && e.error, hash).toMatch(error);
      expect(shown(), hash).toBe("/cad/");
      expect(store.has("mn-cad-share")).toBe(false);
    }
    // jiné kotvy stránky nejsou pokus o kód: nic se neděje a adresa zůstává
    for (const hash of ["#app", "#dokumentace-k-cadu", "#x=1"]) {
      page("/cad", "", hash);
      expect(readShareEntry(true), hash).toBeNull();
      expect(shown()).toBe("/cad" + hash);
    }
  });

  it("odkaz vložený do adresy otevřené stránky (změna části za #): otevřít / zeptat se; odložený odkaz ani ?kod=1 se při tom nečtou", () => {
    page("/cad", "", "#Ab3kZ9xQ2m");
    expect(readShareEntry(false)).toMatchObject({ kind: "open", hash: "#Ab3kZ9xQ2m" });
    expect(shown()).toBe("/cad");
    page("/cad", "", "#Ab3kZ9xQ0m");
    expect(readShareEntry(false)?.kind).toBe("ask");
    page("/cad", "?kod=1", "");
    stashShare("#Ab3kZ9xQ2m");
    expect(readShareEntry(false)).toBeNull();
    expect(shown()).toBe("/cad?kod=1");
  });

  it("po neúspěchu se odložený odkaz zahodí – F5 ani nová návštěva …/s ho neopakují", () => {
    // (revize: překlep v kódu zůstal v sessionStorage, F5 ho zkoušel znovu a pole pro kód už nešlo zobrazit)
    page("/cad");
    stashShare("#jycwwofhww");
    expect(readShareEntry(true)?.kind).toBe("open");
    clearShareStash(); // cad-app po „nenalezeno / vypršel / zneplatněn / neplatný“
    expect(readShareEntry(true)).toBeNull();
    page("/cad", "?kod=1");
    expect(readShareEntry(true)).toEqual({ kind: "ask", value: "" });
  });

  it("úložiště prohlížeče nedostupné (soukromý režim): nic nespadne, odkaz z adresy se otevře", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    page("/cad", "", "#Ab3kZ9xQ2m");
    expect(readShareEntry(true)?.kind).toBe("open");
    page("/cad");
    expect(readShareEntry(true)).toBeNull();
  });
});
