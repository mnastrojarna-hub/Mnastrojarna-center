// Připraví snímky obrazovky pro dokumentaci CADu (public/cad/docs/*.webp) ze složky se snímky.
// Použití: node scripts/cad-docs-assets.mjs <složka-se-snímky> [<druhá-složka> ...]
import { readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";

const OUT = resolve("public/cad/docs");
const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("Zadejte složky se snímky.");
  process.exit(1);
}
/** cílový název → přípona zdrojového souboru (hledá se v zadaných složkách) */
const MAP = {
  "start.webp": "uvodni-obrazovka.png",
  "ribbon-tvorba.webp": "pas-tvorba.png",
  "ribbon-plochy.webp": "pas-plochy.png",
  "ribbon-plech.webp": "pas-plech.png",
  "ribbon-svarence.webp": "pas-svařence.png",
  "menu-soubor.webp": "menu-soubor.png",
  "paleta.webp": "paleta-prikazu.png",
  "nastaveni.webp": "nastaveni-obecne.png",
  "skica-pas.webp": "skica-pas.png",
  "skica-kontext.webp": "skica-kontextove-menu.png",
  "mereni.webp": "mereni-entit.png",
  "formy-ukosy.webp": "formy-analyza-ukosu.png",
  "knihovna-ozubene-kolo.webp": "knihovna-ozubene-kolo.png",
  "knihovna-ipe.webp": "knihovna-ipe.png",
  "vykres.webp": "vykres.png",
  "sestava-ram-formy.webp": "sestava-ram-formy.png",
  "sestava-kusovnik.webp": "sestava-kusovnik.png",
  "mini-lista.webp": "mini-lista-plocha.png",
  "zaobleni-plny.webp": "zaobleni-plny.png",
  "pole-vypln.webp": "pole-vypln.png",
  "tazeni.webp": "tazeni-kruznice-krouceni.png",
  "dira.webp": "dira-ukonceni-polohy.png",
  "rovina-pod-uhlem.webp": "rovina-pod-uhlem.png",
  "pomocna-osa.webp": "pomocna-osa.png",
  "volby-bodu.webp": "pomocny-bod-volby-bodu.png",
  "vyber-ze-seznamu.webp": "vyber-ze-seznamu.png",
  "vysunuti.webp": "vysunuti-k-plose-pokrocile.png",
  "skica-zadani.webp": "skica-kresleni-zadani.png",
  "mobil.webp": "mobil-skica-nabidka.png",
};
const files = dirs.flatMap((d) => (existsSync(d) ? readdirSync(d).map((f) => join(d, f)) : []));
let ok = 0;
for (const [out, suffix] of Object.entries(MAP)) {
  const src = files.find((f) => f.endsWith(suffix));
  if (!src) {
    console.log("CHYBÍ", out, "←", suffix);
    continue;
  }
  const img = sharp(src);
  const meta = await img.metadata();
  const width = Math.min(meta.width ?? 1600, 1600);
  await img.resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(join(OUT, out));
  // menší JPEG pro tiskovou verzi / PDF (menší soubor příručky)
  await sharp(src).resize({ width: Math.min(width, 1100), withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toFile(join(OUT, out.replace(/\.webp$/, "-print.jpg")));
  ok++;
}
// náhled pro sociální sítě (OpenGraph) – 1200×630 z úvodního snímku
const og = files.find((f) => f.endsWith("mini-lista-plocha.png"));
if (og) await sharp(og).resize({ width: 1200, height: 630, fit: "cover", position: "centre" }).jpeg({ quality: 84 }).toFile(join(OUT, "og.jpg"));
console.log(`hotovo: ${ok}/${Object.keys(MAP).length} obrázků → ${OUT}`);
