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
// (JS část balí webpack do workeru prohlížeče).
const dwgDir = path.join(root, "node_modules", "@mlightcad", "libredwg-web");
if (fs.existsSync(dwgDir)) {
  const { version: dwgVersion } = JSON.parse(fs.readFileSync(path.join(dwgDir, "package.json"), "utf8"));
  const out = path.join(root, "public", "vendor", `libredwg-${dwgVersion}`);
  fs.mkdirSync(out, { recursive: true });
  const dst = path.join(out, "libredwg-web.wasm");
  const wasm = lowerInitialMemory(fs.readFileSync(path.join(dwgDir, "wasm", "libredwg-web.wasm")), 1024);
  if (!fs.existsSync(dst) || !fs.readFileSync(dst).equals(wasm)) fs.writeFileSync(dst, wasm);
  fs.rmSync(path.join(out, "libredwg-web.js"), { force: true });
  console.log(`[vendor-occt] public/vendor/libredwg-${dwgVersion} připraveno.`);
}

/**
 * Balík je přeložený s počáteční pamětí 1 GB (16384 stránek po 64 kB) — telefony (iOS Safari,
 * Android s málo RAM) takovou alokaci při startu odmítnou. Paměť smí růst (max 4 GB, growMemory),
 * data a zásobník končí kolem 2,1 MB → počáteční velikost se sníží na `pages` (64 MB).
 * Mění se jen „min" v sekci paměti; LEB128 se zapíše se stejným počtem bajtů (wasm dovoluje
 * doplnění nulami), takže zbytek souboru zůstane beze změny.
 */
function lowerInitialMemory(buf, pages) {
  const out = Buffer.from(buf);
  const leb = (i) => {
    let v = 0;
    let shift = 0;
    let b;
    do {
      b = out[i++];
      v += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return [v, i];
  };
  if (out.readUInt32LE(0) !== 0x6d736100) return out;
  let i = 8;
  while (i < out.length) {
    const id = out[i++];
    const [size, start] = leb(i);
    if (id === 5) {
      const [count, j] = leb(start);
      if (count !== 1) return out;
      const minAt = j + 1;
      const [min, after] = leb(minAt);
      const len = after - minAt;
      if (min <= pages) return out;
      // zapsat `pages` na `len` bajtů (poslední bez příznaku pokračování)
      let v = pages;
      for (let k = 0; k < len; k++) {
        const last = k === len - 1;
        out[minAt + k] = (v & 0x7f) | (last ? 0 : 0x80);
        v = Math.floor(v / 128);
      }
      if (v !== 0) return Buffer.from(buf); // nevejde se — nechat původní
      return out;
    }
    i = start + size;
  }
  return out;
}
