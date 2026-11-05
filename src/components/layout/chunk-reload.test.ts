import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "./chunk-reload";

describe("zastaralé chunky po nasazení", () => {
  it("pozná chybu načtení chunku podle názvu i textu", () => {
    expect(isChunkLoadError({ name: "ChunkLoadError", message: "x" })).toBe(true);
    expect(isChunkLoadError({ name: "Error", message: "Loading chunk 4521 failed." })).toBe(true);
    expect(isChunkLoadError({ name: "TypeError", message: "Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js" })).toBe(true);
    expect(isChunkLoadError("Loading CSS chunk 12 failed")).toBe(true);
  });
  it("běžné chyby nechá být", () => {
    expect(isChunkLoadError(new Error("Nepodařilo se uložit"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError({ code: -32603, message: "Internal JSON-RPC error." })).toBe(false);
  });
});
