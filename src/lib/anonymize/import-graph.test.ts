import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Server action NIKDY nevykresluje (B4): statický importní graf src/app/actions/** nesmí vést do
 * rendereru anonymizace (pdf.js, canvas, sharp — pdf-node, pdf-text, pdf-raster, pdf-pipeline, image,
 * vision, photo-pipeline) ani do service.ts. Dynamické `await import()` se nepočítají (běží jen v routách).
 */

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "src");
const FORBIDDEN = [
  "lib/anonymize/pdf-node", "lib/anonymize/pdf-text", "lib/anonymize/pdf-raster", "lib/anonymize/pdf-pipeline",
  "lib/anonymize/image", "lib/anonymize/vision", "lib/anonymize/photo-pipeline", "lib/anonymize/service",
  "lib/anonymize/pdf-prepare",
];
const FORBIDDEN_PKGS = ["pdfjs-dist", "@napi-rs/canvas", "sharp"];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx", ""]) {
    const f = base + ext;
    if (existsSync(f) && !f.endsWith("/")) {
      try {
        readFileSync(f);
        return f;
      } catch {
        // adresář
      }
    }
  }
  return null;
}

/** Statické importy (import … from / export … from / import "x"), bez `import(` a `import type`. */
function staticImports(src: string): string[] {
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const m of src.matchAll(re)) out.push(m[1]);
  return out;
}

function graph(entry: string): { files: Set<string>; pkgs: Set<string> } {
  const files = new Set<string>();
  const pkgs = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    const src = readFileSync(f, "utf8");
    for (const spec of staticImports(src)) {
      const r = resolveImport(f, spec);
      if (r) stack.push(r);
      else pkgs.add(spec);
    }
  }
  return { files, pkgs };
}

describe("importní graf server actions", () => {
  const actions = readdirSync(path.join(SRC, "app/actions")).filter((f) => /\.tsx?$/.test(f) && !f.includes(".test."));
  it.each(actions)("%s neimportuje renderer anonymizace", (file) => {
    const g = graph(path.join(SRC, "app/actions", file));
    const rel = [...g.files].map((f) => path.relative(SRC, f).replace(/\.tsx?$/, ""));
    for (const bad of FORBIDDEN) expect(rel, `${file} → ${bad}`).not.toContain(bad);
    for (const p of FORBIDDEN_PKGS) expect([...g.pkgs].some((x) => x === p || x.startsWith(`${p}/`)), `${file} → ${p}`).toBe(false);
  });

  it("akce anonymizace existuje a používá frontu (queue.ts), ne službu", () => {
    const g = graph(path.join(SRC, "app/actions/drawing-anon.ts"));
    const rel = [...g.files].map((f) => path.relative(SRC, f));
    expect(rel).toContain("lib/anonymize/queue.ts");
  });

  it("renderer se ve službě načítá jen dynamicky", () => {
    const src = readFileSync(path.join(SRC, "lib/anonymize/service.ts"), "utf8");
    const stat = staticImports(src);
    for (const bad of ["./pdf-pipeline", "./photo-pipeline", "./pdf-node", "./pdf-raster", "./image", "./vision"]) expect(stat).not.toContain(bad);
    expect(src).toMatch(/await import\("\.\/pdf-pipeline"\)/);
  });
});
