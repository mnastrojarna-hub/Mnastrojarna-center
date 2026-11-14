/** Výstup procesu `mncad` (main.ts): zápis na stdout/stderr přežije zavřenou rouru (EPIPE) bez pádu a výpisu zásobníku. */
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { streamWriter } from "./main";

describe("streamWriter – EPIPE", () => {
  it("chyba proudu (čtenář zavřel rouru) se zachytí, další zápisy se zahodí, nic se nevyhodí", async () => {
    const got: string[] = [];
    let calls = 0;
    const w = new Writable({
      write(chunk, _enc, cb) {
        calls++;
        got.push(String(chunk));
        if (calls === 2) cb(Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
        else cb();
      },
    });
    const out = streamWriter(w);
    out("a");
    out("b\n");
    await new Promise((r) => setImmediate(r));
    expect(() => out("c")).not.toThrow();
    out("d");
    await new Promise((r) => setImmediate(r));
    expect(got).toEqual(["a\n", "b\n"]);
  });
});
