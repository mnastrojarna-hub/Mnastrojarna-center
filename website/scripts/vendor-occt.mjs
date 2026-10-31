// Zkopíruje OpenCascade (occt-import-js, WebAssembly čtečka STEP/IGES) do public/vendor,
// odkud ji líně načítá 3D náhled v poptávkovém formuláři.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules", "occt-import-js");
if (!fs.existsSync(pkgDir)) {
  console.warn("[vendor-occt] occt-import-js chybí — přeskakuji.");
  process.exit(0);
}
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const outDir = path.join(root, "public", "vendor", `occt-${version}`);
fs.mkdirSync(outDir, { recursive: true });
for (const f of ["occt-import-js.js", "occt-import-js.wasm"]) {
  const src = path.join(pkgDir, "dist", f);
  const dst = path.join(outDir, f);
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
}
console.log(`[vendor-occt] public/vendor/occt-${version} připraveno.`);

