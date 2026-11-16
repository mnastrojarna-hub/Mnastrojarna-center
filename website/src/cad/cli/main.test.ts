/**
 * Hostitel `mncad` (main.ts): zápis na stdout/stderr přežije zavřenou rouru (EPIPE) bez pádu a výpisu zásobníku; WASM jádra
 * pro vlákno běhu (`wasmFile` → `JobInit.wasm` → `locateFile`, kap. 3.6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UsageError } from "./args";
import { jobInit, streamWriter, wasmFile, type Io } from "./main";

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

describe("wasmFile – WASM jádra od hostitele (locateFile; hash v názvu, MNCAD_WASM)", () => {
  let dir: string;
  let entry: string;
  const touch = (name: string, mtime?: number) => {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "wasm");
    if (mtime) fs.utimesSync(p, mtime, mtime);
    return p;
  };
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-wasm-"));
    entry = touch("mncad.mjs");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const io = (env: Record<string, string> = {}): Io => ({ stdout: () => undefined, stderr: () => undefined, readStdin: async () => "", cwd: dir, env, entry: pathToFileURL(entry).href });

  it("nic nenalezeno → undefined (hledá emscripten); jiné názvy se nepočítají; jobInit bez pole wasm", () => {
    touch("other.wasm");
    touch("replicad_single.wasm.bak");
    touch("sub/replicad_single.wasm");
    expect(wasmFile(entry, {}, dir)).toBeUndefined();
    expect(jobInit(io(), "cs")).not.toHaveProperty("wasm");
  });

  it("obsahový hash v názvu vedle svazku (nejnovější); replicad_single.wasm má přednost; vstup i jako file: URL", () => {
    const old = touch("replicad_single.0c88f94d.wasm", 1_700_000_000);
    const fresh = touch("replicad_single.9dea84ed.wasm", 1_800_000_000);
    expect(wasmFile(entry, {}, dir)).toBe(fresh);
    expect(wasmFile(pathToFileURL(entry).href, {}, dir)).toBe(fresh);
    fs.rmSync(fresh);
    expect(wasmFile(entry, {}, dir)).toBe(old);
    const plain = touch("replicad_single.wasm");
    expect(wasmFile(entry, {}, dir)).toBe(plain);
    expect(jobInit(io(), "en")).toMatchObject({ lang: "en", wasm: plain });
  });

  it("MNCAD_WASM: cesta (i relativní k pracovní složce) má přednost; neexistující soubor = chyba použití (kód 3)", () => {
    const own = touch("k/jadro.wasm");
    expect(wasmFile(entry, { MNCAD_WASM: "k/jadro.wasm" }, dir)).toBe(own);
    expect(wasmFile(entry, { MNCAD_WASM: ` ${own} ` }, "/")).toBe(own);
    expect(jobInit(io({ MNCAD_WASM: own }), "cs").wasm).toBe(own);
    expect(() => wasmFile(entry, { MNCAD_WASM: "k/chybi.wasm" }, dir)).toThrow(UsageError);
    expect(() => wasmFile(entry, { MNCAD_WASM: "k" }, dir)).toThrow(/MNCAD_WASM: soubor jádra „.*k“ neexistuje/);
    expect(() => jobInit(io({ MNCAD_WASM: "k/chybi.wasm" }), "cs")).toThrow(UsageError);
  });
});
