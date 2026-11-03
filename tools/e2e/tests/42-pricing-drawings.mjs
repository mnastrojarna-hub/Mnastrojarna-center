// E2E 42 · Nacenění: výkres u položky (3. 11.). Miniatura u položky otevře výkres v prohlížeči nad stránkou
// (bez navigace — rozepsané ceny zůstanou, adresa se nezmění), „Zpět" vrátí na stejné místo. Na počítači
// „Mít vedle" = panel s výkresem vedle položek, ceny se dál píšou; klik na jinou položku panel přepne.
// Telefon 390 px: prohlížeč přes celou obrazovku, zavření vrátí stejnou pozici posunu. Bez výkresu „Výkres chybí".
//   E2E_BASE_URL=http://localhost:3950 PRICING_SHOTS=<adresář> node tools/e2e/tests/42-pricing-drawings.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { BASE, USERS, expect, launch, localEnv, login, sql, summary, test, withContext } from "../lib.mjs";

const SHOTS = process.env.PRICING_SHOTS || path.join(os.tmpdir(), "pricing-shots");
fs.mkdirSync(SHOTS, { recursive: true });
const env = localEnv();
const TAG = Date.now().toString(36).toUpperCase();
const PREFIX = "Z-E2E42-";
const q = (s) => String(s).replace(/'/g, "''");
const browser = await launch();
const errors = [];
const T = (name, fn, opts) => test(name, () => withContext(browser, errors, fn, opts));

console.log(`42 · Nacenění — výkres u položky (značka ${TAG})`);

async function drawingPdf(number) {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([842, 595]);
  p.drawRectangle({ x: 20, y: 20, width: 802, height: 555, borderColor: rgb(0, 0, 0), borderWidth: 1.2 });
  p.drawRectangle({ x: 220, y: 230, width: 380, height: 140, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  p.drawText(`Cislo vykresu: ${number}`, { x: 520, y: 40, size: 16, font: helv });
  p.drawText("420 +-0,1", { x: 360, y: 205, size: 14, font: helv });
  return new Uint8Array(await doc.save());
}

async function storagePut(p, bytes, type) {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${p}`, {
    method: "POST", headers: { authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, apikey: env.SUPABASE_SECRET_KEY, "content-type": type, "x-upsert": "true" }, body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${p}: ${r.status} ${await r.text()}`);
}

function cleanup() {
  const ids = sql(`select id from orders where number like '${PREFIX}%'`).split("\n").filter(Boolean);
  if (!ids.length) return;
  const list = ids.map((i) => `'${i}'`).join(",");
  sql(`delete from anon_send_queue where job_id in (${list})`);
  sql(`delete from job_files where job_id in (${list})`);
  sql(`delete from order_items where order_id in (${list})`);
  sql(`delete from orders where id in (${list})`);
}
cleanup();

const adminId = sql(`select id from profiles where email='${USERS.admin.email}'`);
const NUMBER = `${PREFIX}${TAG}`;
const jobId = sql(`insert into orders (number, title, source, status, owner_id, created_by, inquiry_date, priority)
  values ('${NUMBER}', 'Nacenění s výkresy ${TAG}', 'manual', 'poptavka', '${adminId}', '${adminId}', current_date, 'stredni') returning id`).split("\n")[0];
// pět položek (telefon: posun stránky), 1 a 3 s výkresem (1 vazbou, 3 podle čísla v názvu), ostatní bez
const items = [0, 1, 2, 3, 4].map((i) => sql(`insert into order_items (order_id, position, drawing_number, name, quantity, unit)
  values ('${jobId}', ${i}, 'E42-${TAG}-${i}', 'Díl ${i + 1}', ${i + 2}, 'ks') returning id`).split("\n")[0]);
const files = [];
for (const [i, linked] of [[0, true], [2, false]]) {
  const bytes = await drawingPdf(`E42-${TAG}-${i}`);
  const sp = `zakazky/${jobId}/${randomUUID()}-E42-${TAG}-${i}.pdf`;
  await storagePut(sp, bytes, "application/pdf");
  files.push(sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, origin, issuer, uploaded_by${linked ? ", order_item_id" : ""})
    values ('${jobId}', 'vykres', 'E42-${TAG}-${i}.pdf', 'application/pdf', ${bytes.length}, '${q(sp)}', 'upload', 'zakaznik', '${adminId}'${linked ? `, '${items[0]}'` : ""}) returning id`).split("\n")[0]);
}

const priceInput = (page, n) => page.getByLabel(`Položka ${n}: prodejní cena za kus`);
const thumb = (page, n) => page.getByRole("button", { name: new RegExp(`^Položka ${n}: zobrazit výkres`) });

async function openPricing(page) {
  await page.goto(`${BASE}/pricing?job=${jobId}`);
  await thumb(page, 1).waitFor({ timeout: 30_000 });
  // hydratace: miniatura PDF se vykreslí až na klientu
  await page.waitForFunction(() => document.querySelector("[data-testid=pricing-drawing-thumb] img"), null, { timeout: 30_000 }).catch(() => undefined);
}

await T("počítač 1366×768: miniatura → prohlížeč nad stránkou, Zpět → rozepsaná cena zůstane, adresa stejná", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, USERS.admin);
  await page.evaluate(() => localStorage.removeItem("mn:pricing:drawing-dock"));
  await openPricing(page);
  expect(await page.getByRole("img", { name: "Položka 2: výkres chybí" }).count() === 1, "položka 2 bez výkresu → „Výkres chybí“");
  expect(await thumb(page, 3).count() === 1, "položka 3: výkres podle čísla v názvu souboru");
  expect(await page.locator("[data-testid=pricing-drawing-thumb] img").count() >= 1, "miniatura PDF vykreslená");
  const url = page.url();
  await priceInput(page, 1).fill("1234,5");
  await priceInput(page, 2).fill("77");
  await page.screenshot({ path: path.join(SHOTS, "desktop-1-polozky.png") });

  await thumb(page, 1).click();
  const layer = page.getByTestId("file-viewer-layer");
  await layer.waitFor({ timeout: 15_000 });
  await layer.locator("canvas").first().waitFor({ timeout: 30_000 });
  expect((await layer.textContent()).includes(`E42-${TAG}-0.pdf`), "prohlížeč ukazuje výkres položky 1");
  await page.screenshot({ path: path.join(SHOTS, "desktop-2-vykres-cela-obrazovka.png") });
  await page.getByTestId("viewer-back").click();
  await layer.waitFor({ state: "detached", timeout: 10_000 });
  expect(page.url() === url, `adresa beze změny (${page.url()})`);
  expect(await priceInput(page, 1).inputValue() === "1234,5", "cena položky 1 zůstala");
  expect(await priceInput(page, 2).inputValue() === "77", "cena položky 2 zůstala");
  expect(await page.getByText("Neuložené změny").count() >= 1, "pořád „Neuložené změny“");
});

await T("počítač: „Mít vedle“ → panel vedle položek, psaní cen, přepnutí na jinou položku, Zavřít", async (context) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1366, height: 768 });
  await login(page, USERS.admin);
  await page.evaluate(() => localStorage.removeItem("mn:pricing:drawing-dock"));
  await openPricing(page);
  await priceInput(page, 1).fill("500");
  await thumb(page, 1).click();
  await page.getByTestId("file-viewer-layer").waitFor({ timeout: 15_000 });
  await page.getByTestId("pricing-drawing-pin").click();
  await page.getByTestId("file-viewer-layer").waitFor({ state: "detached", timeout: 10_000 });
  const dock = page.getByTestId("pricing-drawing-dock");
  await dock.waitFor({ timeout: 10_000 });
  await dock.locator("canvas").first().waitFor({ timeout: 30_000 });
  expect((await dock.textContent()).includes("Položka 1"), "panel: položka 1");
  // psaní cen s otevřeným panelem
  await priceInput(page, 1).fill("512");
  await priceInput(page, 3).fill("99");
  expect(await dock.isVisible(), "panel zůstal při psaní");
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, "desktop-3-vykres-vedle.png") });
  // jiná položka → panel přepne (bez prohlížeče přes celou obrazovku)
  await thumb(page, 3).click();
  await page.waitForFunction(() => document.querySelector("[data-testid=pricing-drawing-dock]")?.textContent?.includes("Položka 3"), null, { timeout: 10_000 });
  expect(await page.getByTestId("file-viewer-layer").count() === 0, "s panelem se prohlížeč přes celou obrazovku neotevírá");
  await dock.locator("canvas").first().waitFor({ timeout: 30_000 });
  await page.screenshot({ path: path.join(SHOTS, "desktop-4-vedle-polozka-3.png") });
  expect(await priceInput(page, 1).inputValue() === "512" && await priceInput(page, 3).inputValue() === "99", "ceny po přepnutí panelu zůstaly");
  // reload: „Mít vedle" zapamatované → panel s prvním výkresem rozbalené zakázky
  await page.reload();
  await page.getByTestId("pricing-drawing-dock").waitFor({ timeout: 30_000 });
  await page.getByTestId("pricing-drawing-dock").getByTestId("viewer-back").click();
  await page.getByTestId("pricing-drawing-dock").waitFor({ state: "detached", timeout: 10_000 });
  expect(await page.evaluate(() => localStorage.getItem("mn:pricing:drawing-dock")) === null, "Zavřít vypne „Mít vedle“");
});

await T("telefon 390 px: výkres přes celou obrazovku, zavření vrátí stejnou pozici a ceny", async (context) => {
  const page = await context.newPage();
  await login(page, USERS.admin);
  await page.evaluate(() => localStorage.setItem("mn:pricing:drawing-dock", "1")); // na telefonu se panel nepoužije
  await openPricing(page);
  await thumb(page, 3).scrollIntoViewIfNeeded();
  await priceInput(page, 3).fill("321");
  const before = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
  expect(before > 0, `stránka je posunutá (${before})`);
  await page.screenshot({ path: path.join(SHOTS, "mobil-1-polozky.png") });
  await thumb(page, 3).click();
  const layer = page.getByTestId("file-viewer-layer");
  await layer.waitFor({ timeout: 15_000 });
  await layer.locator("canvas").first().waitFor({ timeout: 30_000 });
  expect(await page.getByTestId("pricing-drawing-pin").isVisible() === false, "„Mít vedle“ na telefonu není");
  await page.screenshot({ path: path.join(SHOTS, "mobil-2-vykres.png") });
  await page.getByTestId("viewer-back").click();
  await layer.waitFor({ state: "detached", timeout: 10_000 });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
  expect(Math.abs(after - before) < 4, `stejná pozice posunu (${before} → ${after})`);
  expect(await priceInput(page, 3).inputValue() === "321", "cena zůstala");
  expect(await page.getByTestId("pricing-drawing-dock").isVisible().catch(() => false) === false, "panel vedle na telefonu není");
  await page.screenshot({ path: path.join(SHOTS, "mobil-3-zpet.png") });
}, { mobile: true });

cleanup();
await browser.close();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
