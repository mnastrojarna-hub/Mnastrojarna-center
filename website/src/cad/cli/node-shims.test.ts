import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fontNameOf, installNodeShims, installWasmGrowHook, makeLocation, publishWasmHeap, sharePageFor, DEFAULT_ORIGIN, type InstalledShims } from "./node-shims";

let shims: InstalledShims | null = null;
afterEach(() => {
  shims?.restore();
  shims = null;
});

describe("location a fetch /fonts/* (Node shim)", () => {
  it("location má origin, pathname /cad, href, protocol, host", () => {
    expect(makeLocation(DEFAULT_ORIGIN)).toMatchObject({ origin: "https://www.mnastrojarna.cz", pathname: "/cad", href: "https://www.mnastrojarna.cz/cad", protocol: "https:", host: "www.mnastrojarna.cz" });
    expect(makeLocation("http://127.0.0.1:8765/x")).toMatchObject({ origin: "http://127.0.0.1:8765", host: "127.0.0.1:8765", href: "http://127.0.0.1:8765/cad" });
    expect(() => makeLocation("file:///etc")).toThrow();
  });
  it("--share-store <URL>: stránka odkazu je web úložiště (prohlížeč hledá #q= v <origin>/cad/share/); MNCAD_ORIGIN má přednost", async () => {
    expect(sharePageFor("http://127.0.0.1:18772/cad/share/")).toEqual({ origin: "http://127.0.0.1:18772", pathname: "/cad" });
    expect(sharePageFor("https://example.com/web/cad/share")).toEqual({ origin: "https://example.com", pathname: "/web/cad" });
    expect(sharePageFor("https://example.com/jinde/")).toEqual({ origin: "https://example.com", pathname: "/cad" });
    expect(sharePageFor("off")).toBeNull();
    expect(sharePageFor(undefined)).toBeNull();
    shims = installNodeShims({ fontsDir: null, version: "t", shareStore: "http://127.0.0.1:18772/cad/share/" });
    const loc = (globalThis as unknown as { location: Location }).location;
    expect([loc.origin, loc.pathname, loc.href]).toEqual(["http://127.0.0.1:18772", "/cad", "http://127.0.0.1:18772/cad"]);
    const { selfStoreBase } = await import("../share");
    expect(selfStoreBase()).toBe("http://127.0.0.1:18772/cad/share/");
    shims.restore();
    shims = installNodeShims({ origin: "https://test.example", fontsDir: null, version: "t", shareStore: "http://127.0.0.1:18772/cad/share/" });
    expect((globalThis as unknown as { location: Location }).location.origin).toBe("https://test.example");
    shims.restore();
    shims = installNodeShims({ fontsDir: null, version: "t", shareStore: "off" });
    expect((globalThis as unknown as { location: Location }).location.origin).toBe(DEFAULT_ORIGIN);
  });
  it("háček grow: velikost haldy WASM (MB) do sdílené paměti hlídače při každém zvětšení, i uprostřed synchronní práce", () => {
    const sab = new SharedArrayBuffer(8);
    installWasmGrowHook(sab);
    installWasmGrowHook(sab); // podruhé nic nezmění
    const m = new WebAssembly.Memory({ initial: 1 });
    expect(m.grow(16 * 10)).toBe(1); // vrací původní počet stránek jako bez háčku
    expect(Atomics.load(new Int32Array(sab), 0)).toBe(11); // 161 stránek × 64 KiB = 10,06 MB → 11
    publishWasmHeap(sab, 5); // menší hodnota maximum nesníží
    expect(Atomics.load(new Int32Array(sab), 0)).toBe(11);
    publishWasmHeap(sab, 300);
    expect(Atomics.load(new Int32Array(sab), 0)).toBe(300);
  });
  it("fontNameOf – jen /fonts/<název> a <origin>/fonts/<název>, bez cest", () => {
    expect(fontNameOf("/fonts/Roboto-Bold.ttf", DEFAULT_ORIGIN)).toBe("Roboto-Bold.ttf");
    expect(fontNameOf(`${DEFAULT_ORIGIN}/fonts/Roboto-Regular.ttf?x=1`, DEFAULT_ORIGIN)).toBe("Roboto-Regular.ttf");
    for (const u of ["/fonts/../package.json", "/fonts/a/b.ttf", "/fonts/.hidden", "https://evil.example/fonts/x.ttf", "/other/x.ttf", "/fonts/%2e%2e%2fx"]) expect(fontNameOf(u, DEFAULT_ORIGIN), u).toBeNull();
  });
  it("písma ze složky vedle svazku; ostatní požadavky na síť s User-Agent mncad/<verze>", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mncad-fonts-"));
    fs.writeFileSync(path.join(dir, "Roboto-Regular.ttf"), "FONT");
    const seen: { url: string; ua: string | null }[] = [];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(u), ua: new Headers(init?.headers).get("user-agent") });
      return new Response("net");
    }) as typeof fetch;
    try {
      shims = installNodeShims({ fontsDir: dir, version: "9.9.9-test", shareStore: "off" });
      expect((globalThis as unknown as { location: { origin: string } }).location.origin).toBe(DEFAULT_ORIGIN);
      expect(process.env.NEXT_PUBLIC_CAD_SHARE_SELF).toBe("off");
      const r1 = await fetch("/fonts/Roboto-Regular.ttf");
      expect(await r1.text()).toBe("FONT");
      const r2 = await fetch(new URL("/fonts/Roboto-Regular.ttf", location.origin).toString());
      expect(r2.status).toBe(200);
      expect((await fetch("/fonts/Roboto-Bold.ttf")).status).toBe(404);
      expect(shims.fontsRead).toEqual(["Roboto-Regular.ttf", "Roboto-Regular.ttf"]);
      await fetch("https://www.mnastrojarna.cz/cad/share/?ping");
      await fetch("https://example.org/x", { headers: { "User-Agent": "own" } });
      expect(seen).toEqual([
        { url: "https://www.mnastrojarna.cz/cad/share/?ping", ua: "mncad/9.9.9-test" },
        { url: "https://example.org/x", ua: "own" },
      ]);
    } finally {
      shims?.restore();
      shims = null;
      globalThis.fetch = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(typeof (globalThis as { location?: unknown }).location).toBe("undefined");
  });
});
