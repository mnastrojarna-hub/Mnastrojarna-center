// Bundles a harness TypeScript entry (imports repo sources via "@/…") into one ESM file runnable with plain Node and
// imports it. Same recipe as the w14 probes: rolldown (already in node_modules through vite), platform node, the heavy
// packages (replicad, OCCT, jspdf, three, pdf.js, acad-ts) stay external and load from website/node_modules at run time.
// The bundle goes to website/node_modules/.cache/cad-harness/ (git-ignored together with node_modules).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

export const HARNESS = path.dirname(fileURLToPath(import.meta.url));
export const WEB = path.resolve(HARNESS, "..", "..");
const CACHE = path.join(WEB, "node_modules", ".cache", "cad-harness");
const EXTERNAL = [/^replicad/, /^jspdf/, /^three/, /^@node-projects/, /^occt-import-js/, /^pdfjs-dist/, /^opentype/, /^node:/];

/** newest mtime under a directory (sources that end up in the bundle) */
function newest(dir, acc = 0) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) acc = newest(p, acc);
    else if (/\.(ts|tsx|mjs|js|json)$/.test(e.name)) acc = Math.max(acc, fs.statSync(p).mtimeMs);
  }
  return acc;
}

/**
 * Bundle `entry` (path relative to scripts/cad-harness or absolute) and return the output path. The file name carries a
 * hash of the entry and of the newest source mtime, so an unchanged tree reuses the previous bundle.
 */
export async function bundle(entry, { quiet = false } = {}) {
  const abs = path.isAbsolute(entry) ? entry : path.join(HARNESS, entry);
  const stamp = `${fs.readFileSync(abs, "utf8")}|${newest(path.join(WEB, "src", "cad"))}|${newest(path.join(WEB, "src", "lib"))}|${newest(HARNESS)}`;
  const hash = crypto.createHash("sha256").update(stamp).digest("hex").slice(0, 12);
  const out = path.join(CACHE, `${path.basename(abs).replace(/\.\w+$/, "")}-${hash}.mjs`);
  if (fs.existsSync(out)) return out;
  fs.mkdirSync(CACHE, { recursive: true });
  // drop bundles of the same entry built from older sources (the hash changed)
  const base = `${path.basename(abs).replace(/\.\w+$/, "")}-`;
  for (const f of fs.readdirSync(CACHE)) if (f.startsWith(base) && /^[0-9a-f]{12}\.mjs$/.test(f.slice(base.length))) fs.rmSync(path.join(CACHE, f), { force: true });
  const require = createRequire(path.join(WEB, "package.json"));
  const { build } = await import(pathToFileURL(require.resolve("rolldown")).href);
  const t0 = Date.now();
  await build({
    input: abs,
    platform: "node",
    cwd: WEB,
    resolve: { alias: { "@": path.join(WEB, "src") } },
    external: EXTERNAL,
    output: { file: out, format: "esm", codeSplitting: false },
    logLevel: "silent",
  });
  if (!quiet) process.stderr.write(`cad-harness: bundled ${path.basename(abs)} in ${Date.now() - t0} ms\n`);
  return out;
}

/** bundle + dynamic import */
export async function load(entry, opts) {
  return import(pathToFileURL(await bundle(entry, opts)).href);
}
