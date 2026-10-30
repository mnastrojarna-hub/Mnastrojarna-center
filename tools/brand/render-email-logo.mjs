#!/usr/bin/env node
/**
 * Logo Mnástrojárna pro e-mailové podpisy.
 *
 * E-mailoví klienti (Outlook, Gmail, Seznam …) SVG spolehlivě nezobrazují — podpis proto používá PNG
 * ve dvojnásobném rozlišení (zobrazí se 160 × 40 px, ostré i na retina displejích).
 *
 * Zdroj: public/brand/mnastrojarna-logo.svg — originální vektor z logomanuálu
 * (mnastrojarna_logomanual_5_4.pdf, strana 2 „Základní podoba a barevnost loga"), barvy přesně
 * podle logomanuálu: červená #E03930, antracit #272425.
 *
 * Výstupy (stejný rozměr plátna → varianty jsou zaměnitelné bez změny rozložení podpisu):
 *   public/brand/mnastrojarna-email-logo@2x.png              — VÝCHOZÍ: logo na bílém podkladu velikosti
 *        ochranné zóny (logomanuál, „Logo na barevném podkladu": varianta na bílém podkladu). Na bílém
 *        pozadí podklad splyne, v tmavém režimu (Outlook / Gmail / Apple Mail) zůstane čitelná bílá
 *        destička s logem — antracitový nápis nezmizne v tmavém pozadí.
 *   public/brand/mnastrojarna-email-logo-transparent@2x.png  — barevné logo na průhledném pozadí (jen
 *        tam, kde je pozadí jistě světlé — např. PDF, web).
 *   public/brand/mnastrojarna-email-logo-white@2x.png        — negativ (bílé logo) pro tmavé pozadí
 *        (logomanuál: „Jednobarevná varianta loga", bílá negativní verze).
 *   src/lib/email/signature-logo-data.ts                     — výchozí PNG jako base64 (vložené logo
 *        „cid:" v odchozí poště; soubory z public/ nejsou v serverless funkci na Vercelu k dispozici).
 *
 * Použití:
 *   node tools/brand/render-email-logo.mjs             vykreslí PNG + base64 modul ze SVG
 *   node tools/brand/render-email-logo.mjs --extract   nejdřív znovu vytáhne vektor z logomanuálu
 *                                                      (potřebuje pdftocairo z balíku poppler-utils)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PDF = path.join(ROOT, "mnastrojarna_logomanual_5_4.pdf");
const SVG = path.join(ROOT, "public/brand/mnastrojarna-logo.svg");
const OUT_DIR = path.join(ROOT, "public/brand");
const DATA_MODULE = path.join(ROOT, "src/lib/email/signature-logo-data.ts");

const RED = "#E03930";
const ANTHRACITE = "#272425";

/** Plátno 2× (zobrazení 160 × 40 px) a vodorovný okraj (logo se svisle vycentruje). */
const CANVAS_W = 320;
const CANVAS_H = 80;
const PAD_X = 12;
/** Zaoblení bílého podkladu (2×). */
const RADIUS = 12;

// ── 1) Vektor z logomanuálu ───────────────────────────────────────────────────────────────────
// Strana 2 (dvoustrana 1190 × 595 pt): vlevo logo, vpravo text a vzorníky barev. Logo = cesty
// v CMYK červené (0/94/100/0) a CMYK černé (0/0/0/100) na levé půlce stránky; text výkladu je
// šedý (glyfy), vzorníky barev jsou vpravo (x > 595).
function extractFromPdf() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mn-logo-"));
  const out = path.join(tmp, "page2.svg");
  try {
    execFileSync("pdftocairo", ["-svg", "-f", "2", "-l", "2", PDF, out], { stdio: ["ignore", "ignore", "ignore"] });
  } catch (err) {
    throw new Error(`pdftocairo selhal (nainstaluj poppler-utils): ${err instanceof Error ? err.message : err}`);
  }
  const page = fs.readFileSync(out, "utf8");
  fs.rmSync(tmp, { recursive: true, force: true });

  const paths = [];
  const re = /<path ([^>]*?)d="([^"]+)"([^>]*)\/>/g;
  let m;
  while ((m = re.exec(page))) {
    const attrs = `${m[1]} ${m[3]}`;
    const fill = /fill="rgb\(([\d.]+)%, ([\d.]+)%, ([\d.]+)%\)"/.exec(attrs);
    if (!fill || /transform=/.test(attrs)) continue;
    const [r, g, b] = fill.slice(1).map(Number);
    const color = r > 80 && g < 30 && b < 30 ? RED : r < 20 && g < 20 && b < 20 ? ANTHRACITE : null;
    if (!color) continue;
    const nums = m[2].match(/-?\d+(?:\.\d+)?/g).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    if (box.maxX > 595) continue; // pravá strana dvoustrany (vzorníky barev)
    paths.push({ d: m[2].trim(), color, box });
  }
  if (paths.length < 20) throw new Error(`Na straně 2 logomanuálu jsem našel jen ${paths.length} cest loga — změnil se soubor?`);

  const minX = Math.min(...paths.map((p) => p.box.minX));
  const minY = Math.min(...paths.map((p) => p.box.minY));
  const maxX = Math.max(...paths.map((p) => p.box.maxX));
  const maxY = Math.max(...paths.map((p) => p.box.maxY));
  const f = (n) => Number(n.toFixed(2));
  const body = paths
    .map((p) => `  <path fill="${p.color}" d="${p.d}"/>`)
    .join("\n");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Mnástrojárna s.r.o. — logo (symbol frézy + wordmark), originální vektor z logomanuálu
     mnastrojarna_logomanual_5_4.pdf, str. 2 „Základní podoba a barevnost loga".
     Barvy: červená ${RED}, antracit ${ANTHRACITE}. Vygenerováno skriptem tools/brand/render-email-logo.mjs (volba extract). -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(minX)} ${f(minY)} ${f(maxX - minX)} ${f(maxY - minY)}" width="${f(maxX - minX)}" height="${f(maxY - minY)}" role="img" aria-label="Mnástrojárna s.r.o.">
${body}
</svg>
`;
  fs.writeFileSync(SVG, svg);
  console.log(`✓ vektor loga: ${path.relative(ROOT, SVG)} (${paths.length} cest, ${f(maxX - minX)} × ${f(maxY - minY)} pt)`);
}

// ── 2) PNG varianty ───────────────────────────────────────────────────────────────────────────
function viewBoxOf(svg) {
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (!vb) throw new Error("SVG loga nemá viewBox.");
  const [x, y, w, h] = vb[1].trim().split(/\s+/).map(Number);
  return { x, y, w, h };
}

/** Logo vykreslené do plátna CANVAS_W × CANVAS_H (vlevo okraj PAD_X, svisle na střed). */
async function renderLogo(svg, recolor) {
  const vb = viewBoxOf(svg);
  const maxW = CANVAS_W - 2 * PAD_X;
  const scale = Math.min(maxW / vb.w, (CANVAS_H - 2 * PAD_X) / vb.h);
  const w = Math.round(vb.w * scale);
  const h = Math.round(vb.h * scale);
  let src = svg.replace(/\swidth="[\d.]+"\s+height="[\d.]+"/, ` width="${w}" height="${h}"`);
  if (recolor) src = src.replace(/fill="#[0-9A-Fa-f]{6}"/g, `fill="${recolor}"`);
  // 4× převzorkování a zmenšení (Lanczos) → čisté hrany i u drobného „s.r.o."
  const png = await sharp(Buffer.from(src), { density: 72 * 4 })
    .resize(w, h, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  return { png, w, h, left: PAD_X, top: Math.round((CANVAS_H - h) / 2) };
}

async function compose(logo, background) {
  const base = background
    ? sharp(Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}"><rect width="${CANVAS_W}" height="${CANVAS_H}" rx="${RADIUS}" ry="${RADIUS}" fill="${background}"/></svg>`,
      ))
    : sharp({ create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return base
    .composite([{ input: logo.png, left: logo.left, top: logo.top }])
    .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
    .toBuffer();
}

async function main() {
  if (process.argv.includes("--extract") || !fs.existsSync(SVG)) extractFromPdf();
  const svg = fs.readFileSync(SVG, "utf8");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const color = await renderLogo(svg);
  const white = await renderLogo(svg, "#FFFFFF");
  const outputs = [
    ["mnastrojarna-email-logo@2x.png", await compose(color, "#FFFFFF")],
    ["mnastrojarna-email-logo-transparent@2x.png", await compose(color, null)],
    ["mnastrojarna-email-logo-white@2x.png", await compose(white, null)],
  ];
  for (const [name, buf] of outputs) {
    fs.writeFileSync(path.join(OUT_DIR, name), buf);
    console.log(`✓ public/brand/${name} (${CANVAS_W} × ${CANVAS_H} px, ${(buf.length / 1024).toFixed(1)} kB)`);
  }

  const plate = outputs[0][1];
  const source = `// VYGENEROVÁNO: node tools/brand/render-email-logo.mjs — neupravuj ručně.
// Logo pro podpis e-mailu (PNG 2×, ${CANVAS_W} × ${CANVAS_H} px, bílý podklad v ochranné zóně) jako base64 —
// pro vložení do odchozí zprávy jako inline příloha (cid:), bez čtení souborů z public/ za běhu.

export const SIGNATURE_LOGO_PNG_BASE64 =
  "${plate.toString("base64")}";

/** Rozměr PNG (2×); v podpisu se zobrazí v polovině. */
export const SIGNATURE_LOGO_PNG_SIZE = { width: ${CANVAS_W}, height: ${CANVAS_H} } as const;
`;
  fs.writeFileSync(DATA_MODULE, source);
  console.log(`✓ ${path.relative(ROOT, DATA_MODULE)} (${(plate.length / 1024).toFixed(1)} kB PNG → base64)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
