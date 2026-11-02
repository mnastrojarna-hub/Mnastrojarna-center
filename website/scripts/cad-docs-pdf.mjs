// PDF příručka z tiskové stránky /cad/prirucka (Playwright + Chromium). Vyžaduje běžící server (next start / next dev).
// Spuštění: DOCS_URL=http://localhost:3100 node scripts/cad-docs-pdf.mjs
import { statSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

// Playwright je v prostředí nainstalovaný globálně (předinstalované Chromium) – ESM import ho nenajde, require ano.
const { chromium } = createRequire(import.meta.url)("playwright");

const base = process.env.DOCS_URL ?? "http://localhost:3100";
const out = resolve("public/cad/mnastrojarna-cad-prirucka.pdf");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
await page.goto(`${base}/cad/prirucka`, { waitUntil: "networkidle", timeout: 180000 });
await page.emulateMedia({ media: "print" });
// počkat na obrázky
await page.evaluate(() => Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }))));
await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  preferCSSPageSize: true,
  margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
  displayHeaderFooter: true,
  headerTemplate: '<div style="width:100%;font:9px Roboto,Arial,sans-serif;color:#6C6D6F;padding:0 14mm;display:flex;justify-content:space-between"><span>Mnástrojárna CAD – dokumentace</span><span>mnastrojarna.cz/cad</span></div>',
  footerTemplate: '<div style="width:100%;font:9px Roboto,Arial,sans-serif;color:#6C6D6F;padding:0 14mm;display:flex;justify-content:space-between"><span>© Mnástrojárna s.r.o.</span><span>Strana <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log(`PDF: ${out} (${Math.round(statSync(out).size / 1024)} kB)`);
