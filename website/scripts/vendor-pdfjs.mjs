// Zkopíruje čtečku PDF (pdfjs-dist, sestavení „legacy“) do public/vendor, odkud ji CAD líně načítá při vložení
// stránky PDF jako podkladu skici (src/cad/pdfjs.ts). Stejný postup jako u OpenCascade (vendor-occt.mjs).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules", "pdfjs-dist");
if (!fs.existsSync(pkgDir)) {
  console.warn("[vendor-pdfjs] pdfjs-dist chybí — přeskakuji.");
  process.exit(0);
}
const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const outDir = path.join(root, "public", "vendor", `pdfjs-${version}`);
fs.mkdirSync(outDir, { recursive: true });
const copy = (src, dst) => {
  if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst);
};
// knihovna a její worker
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) copy(path.join(pkgDir, "legacy", "build", f), path.join(outDir, f));
// písma pro PDF bez vložených písem, tabulky znaků, dekodéry obrázků (JPEG 2000, JBIG2) a barevné profily
for (const dir of ["standard_fonts", "cmaps", "wasm", "iccs"]) {
  const from = path.join(pkgDir, dir);
  if (!fs.existsSync(from)) continue;
  fs.mkdirSync(path.join(outDir, dir), { recursive: true });
  for (const f of fs.readdirSync(from)) if (fs.statSync(path.join(from, f)).isFile()) copy(path.join(from, f), path.join(outDir, dir, f));
}
console.log(`[vendor-pdfjs] public/vendor/pdfjs-${version} připraveno.`);
