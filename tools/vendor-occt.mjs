// Zkopíruje OpenCascade (occt-import-js — čtení STEP/IGES/BREP ve WebAssembly) do public/vendor,
// odkud ho načítá prohlížeč 3D modelů (web worker). Spouští se po instalaci a před buildem/dev.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules", "occt-import-js");
if (!fs.existsSync(pkgDir)) {
  console.warn("[vendor-occt] occt-import-js není nainstalovaný — přeskakuji.");
  process.exit(0);
}
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const outDir = path.join(root, "public", "vendor", `occt-${version}`);
fs.mkdirSync(outDir, { recursive: true });
for (const f of ["occt-import-js.js", "occt-import-js.wasm"]) {
  const src = path.join(pkgDir, "dist", f);
  const dst = path.join(outDir, f);
  const same = fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(src).size;
  if (!same) fs.copyFileSync(src, dst);
}
console.log(`[vendor-occt] public/vendor/occt-${version} připraveno.`);

// LibreDWG (čtení DWG ve WebAssembly, GPL-3.0) — wasm se načítá za běhu z public/vendor
const dwgDir = path.join(root, "node_modules", "@mlightcad", "libredwg-web");
if (fs.existsSync(dwgDir)) {
  const { version: dwgVersion } = JSON.parse(fs.readFileSync(path.join(dwgDir, "package.json"), "utf8"));
  const out = path.join(root, "public", "vendor", `libredwg-${dwgVersion}`);
  fs.mkdirSync(out, { recursive: true });
  for (const f of ["libredwg-web.wasm", "libredwg-web.js"]) {
    const src = path.join(dwgDir, "wasm", f);
    const dst = path.join(out, f);
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
  }
  console.log(`[vendor-occt] public/vendor/libredwg-${dwgVersion} připraveno.`);
}
