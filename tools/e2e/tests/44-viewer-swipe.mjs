// E2E · Výkresy zakázky v prohlížeči (majitel 7. 11.): swipe / ‹ › / šipky mezi výkresy karty zakázky,
// nahoře počet kusů a materiál z položky, TIFF (i vícestránkový) se „Zpět", 3D model mimo sadu;
// spodní lišta na telefonu se při posunu dolů schová a nepřekrývá konec stránky.
//
//   tools/e2e/run-app.sh && node tools/e2e/tests/44-viewer-swipe.mjs
//   VIEWER_SHOTS=/adresář …   # kopie snímků telefonu jinam (mimo artefakty)
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { BASE, USERS, launch, login, localEnv, sql, summary, test, expect, withContext, ARTIFACTS } from "../lib.mjs";

const PREFIX = "E2E-swipe-";
const SHOTS = process.env.VIEWER_SHOTS || ARTIFACTS;
fs.mkdirSync(SHOTS, { recursive: true });
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

async function upload(jobId, filename, bytes, mime, kind, { itemId = null, hoursAgo = 0 } = {}) {
  const env = localEnv();
  const storagePath = `${jobId}/${randomUUID()}-${filename.replace(/[^\w.-]+/g, "_")}`;
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": mime, "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${filename}: ${r.status} ${await r.text()}`);
  const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
  return sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, version, archived, uploaded_by, anon_status, order_item_id, created_at)
    values (${lit(jobId)}, ${lit(kind)}::job_file_kind, ${lit(filename)}, ${lit(mime)}, ${bytes.length}, ${lit(storagePath)}, 1, false, ${lit(adminId)}, 'skipped',
      ${lit(itemId)}, now() - interval '${hoursAgo} hours') returning id`).split("\n")[0];
}

async function pdf(label) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([842, 595]);
  page.drawText(label, { x: 60, y: 500, size: 40, font: await doc.embedFont(StandardFonts.Helvetica) });
  return Buffer.from(await doc.save());
}

/** Dvoustránkový TIFF (sken výkresu), vygenerovaný sharpem. */
async function tiff() {
  const sheet = (n) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850">
    <rect width="1200" height="850" fill="#fff"/><rect x="20" y="20" width="1160" height="810" fill="none" stroke="#000" stroke-width="6"/>
    <text x="80" y="200" font-size="90" font-family="sans-serif">SKEN TIFF list ${n}</text></svg>`)).png().toBuffer();
  const pages = await Promise.all([sheet(1), sheet(2)]);
  return sharp(pages, { join: { animated: true } }).tiff({ compression: "lzw" }).toBuffer();
}

function cleanup() {
  const jobIds = sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  for (const id of jobIds) {
    sql(`delete from job_files where job_id = ${lit(id)}`);
    sql(`delete from order_items where order_id = ${lit(id)}`);
    sql(`delete from orders where id = ${lit(id)}`);
  }
  sql(`delete from customers where name like ${lit(`${PREFIX}%`)} and not exists (select 1 from orders o where o.customer_id = customers.id)`);
}

async function setup() {
  cleanup();
  const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
  const cust = sql(`insert into customers (name, country, owner_id, payment_terms_days) values (${lit(`${PREFIX}Zákazník`)}, 'CZ', ${lit(adminId)}, 14) returning id`).split("\n")[0];
  const job = sql(`insert into orders (number, title, customer_id, owner_id, created_by, status, source, inquiry_date)
    values (next_job_number(), ${lit(`${PREFIX}Zakázka`)}, ${lit(cust)}, ${lit(adminId)}, ${lit(adminId)}, 'poptavka'::job_stage, 'manual', app_today()) returning id`).split("\n")[0];
  const item = (pos, dn, name, material, qty) => sql(`insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price)
    values (${lit(job)}, ${pos}, ${lit(dn)}, 'B', ${lit(name)}, ${lit(material)}, ${qty}, 'ks', 1234) returning id`).split("\n")[0];
  const itemA = item(0, "E2E44-A", "Hřídel", "1.4301", 25);
  const itemB = item(1, "E2E44-B", "Příruba", "S235", 4);
  const files = {};
  // pořadí v Dokumentech (nejnovější nahoře): TIFF, příruba (vazba na položku), hřídel (číslo v názvu)
  files.a = await upload(job, "E2E44-A_hridel.pdf", await pdf("VYKRES E2E44-A"), "application/pdf", "vykres", { hoursAgo: 3 });
  files.b = await upload(job, "vykres-priruba.pdf", await pdf("VYKRES E2E44-B"), "application/pdf", "vykres", { itemId: itemB, hoursAgo: 2 });
  files.tif = await upload(job, "SKEN-E2E44.tif", await tiff(), "image/tiff", "vykres", { hoursAgo: 1 });
  // mimo sadu: 3D model a obchodní doklad
  files.step = await upload(job, "E2E44-A.step", fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../src/lib/viewer3d/__fixtures__/rounded-cube.step")), "application/octet-stream", "model_3d", { hoursAgo: 4 });
  files.order = await upload(job, "objednavka-E2E44.pdf", await pdf("OBJEDNAVKA"), "application/pdf", "objednavka", { hoursAgo: 5 });
  // dost dokumentů, ať karta na telefonu roluje
  for (let i = 1; i <= 8; i++) await upload(job, `poznamka-${i}.txt`, Buffer.from(`poznámka ${i}\n`), "text/plain", "ostatni", { hoursAgo: 6 + i });
  return { job, files, itemA, itemB };
}

/** Swipe prstem (CDP dotyk): z fromX do toX ve výšce y, ~200 ms. */
async function swipe(cdp, fromX, toX, y) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: fromX, y, id: 1 }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(fromX + ((toX - fromX) * i) / 8), y, id: 1 }] });
    await new Promise((r) => setTimeout(r, 20));
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

const counter = (page) => page.getByTestId("viewer-counter").innerText();
const infoText = (page) => page.getByTestId("viewer-drawing-info").innerText();

async function waitCounter(page, text) {
  await page.waitForFunction((t) => document.querySelector('[data-testid="viewer-counter"]')?.textContent?.trim() === t, text, { timeout: 15_000 });
}

/** Počká na dojezd úvodní animace obsahu (posouvá stránku). */
async function settle(page) {
  await page.evaluate(() =>
    Promise.all((document.querySelector("main")?.getAnimations({ subtree: true }) ?? [])
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => null))),
  );
}

const { job, files } = await setup();
const browser = await launch();
const errors = [];

await test("telefon 390×844: karta zakázky — spodní lišta se při posunu dolů schová, konec Dokumentů je celý vidět, nahoru ji vrátí", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
    await page.getByTestId("file-open").filter({ hasText: "poznamka-8.txt" }).waitFor();
    await settle(page);
    const nav = page.getByTestId("mobile-nav");
    expect(!(await nav.getAttribute("data-hidden")), "nahoře je lišta vidět");
    // výška aplikace = viditelná výška okna (dvh), ne víc
    const shell = await page.evaluate(() => ({ h: document.querySelector("main")?.parentElement?.parentElement?.getBoundingClientRect().height, vh: window.innerHeight }));
    expect(Math.abs((shell.h ?? 0) - shell.vh) <= 1, `výška aplikace ${shell.h} = okno ${shell.vh}`);
    // spodní okraj <main> ≥ výška lišty (i bez schování nic nezůstane pod ní)
    const pad = await page.evaluate(() => ({ pb: parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom), nav: document.querySelector('[data-testid="mobile-nav"]').getBoundingClientRect().height }));
    expect(pad.pb >= pad.nav + 16, `odsazení konce stránky ${pad.pb} px ≥ lišta ${pad.nav} px + 16`);

    // posun dolů po krocích (jako prst) až na konec
    for (let i = 0; i < 40; i++) {
      const done = await page.evaluate(() => {
        const m = document.querySelector("main");
        m.scrollBy(0, 120);
        return m.scrollTop + m.clientHeight >= m.scrollHeight - 1;
      });
      await page.waitForTimeout(30);
      if (done) break;
    }
    await page.waitForTimeout(400);
    expect((await nav.getAttribute("data-hidden")) === "1", "po posunu dolů je lišta schovaná");
    const navBox = await nav.boundingBox();
    expect(!navBox || navBox.y >= 844 - 2, `lišta je pod okrajem (y=${navBox?.y})`);
    // poslední řádek posledního seznamu Dokumentů celý nad spodním okrajem
    const last = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("main section ul > li")];
      const r = rows[rows.length - 1]?.getBoundingClientRect();
      return r ? { top: r.top, bottom: r.bottom, n: rows.length } : null;
    });
    expect(last && last.bottom <= 844 && last.top >= 0, `poslední dokument vidět celý (${JSON.stringify(last)})`);
    await page.screenshot({ path: path.join(SHOTS, "01-karta-dole-lista-schovana.png") });

    // posun nahoru → lišta zpět; i s ní poslední řádek nepřekrývá
    await page.evaluate(() => document.querySelector("main").scrollBy(0, -40));
    await page.waitForTimeout(350);
    expect(!(await nav.getAttribute("data-hidden")), "po posunu nahoru je lišta zpět");
    const navTop = (await nav.boundingBox())?.y ?? 844;
    const lastNow = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("main section ul > li")];
      return rows[rows.length - 1]?.getBoundingClientRect().bottom ?? 0;
    });
    expect(lastNow <= navTop + 1, `poslední dokument (spodek ${lastNow}) nad lištou (${navTop})`);
    await page.screenshot({ path: path.join(SHOTS, "02-karta-dole-lista-zpet.png") });
    await page.evaluate(() => document.querySelector("main").scrollTo(0, 0));
    await page.waitForTimeout(350);
    expect(!(await nav.getAttribute("data-hidden")), "nahoře lišta vidět");
  }, { mobile: true });
});

await test("telefon: výkres v Dokumentech → počet kusů + materiál nahoře, swipe na další výkres, TIFF se stranami, 3D model a doklady mimo sadu, jedno Zpět zavře", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
    const link = page.getByTestId("file-open").filter({ hasText: "vykres-priruba.pdf" });
    await link.waitFor();
    await settle(page);
    const urlBefore = page.url();
    await link.tap();
    await page.getByTestId("file-viewer").waitFor();
    await page.getByTestId("pdf-view").waitFor();
    await waitCounter(page, "2 / 3");
    const info = await infoText(page);
    expect(/E2E44-B rev\. B/.test(info) && /Příruba/.test(info) && /4 ks/.test(info) && /S235/.test(info), `hlavička příruby: ${info}`);
    expect(!/1\s?234|Kč/.test(info), `žádná cena v hlavičce: ${info}`);
    // spodní lišta je pod prohlížečem schovaná
    expect((await page.getByTestId("mobile-nav").getAttribute("data-hidden")) === "1", "lišta pod prohlížečem schovaná");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, "03-prohlizec-hlavicka.png") });

    // swipe prstem doleva → další výkres (hřídel, číslo v názvu souboru)
    const cdp = await ctx.newCDPSession(page);
    await swipe(cdp, 320, 80, 480);
    await waitCounter(page, "3 / 3");
    await page.getByTestId("pdf-view").waitFor();
    const infoA = await infoText(page);
    expect(/E2E44-A/.test(infoA) && /Hřídel/.test(infoA) && /25 ks/.test(infoA) && /1\.4301/.test(infoA), `hlavička hřídele: ${infoA}`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, "04-prohlizec-po-swipu.png") });

    // svislý tah (posun stránek) nic nepřepne
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 200, y: 600, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 180, y: 300, id: 1 }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(300);
    expect((await counter(page)) === "3 / 3", "svislý tah nepřepnul");

    // další swipe → v kruhu na TIFF (bez vazby na položku → bez pruhu údajů), strany tlačítky
    await swipe(cdp, 320, 80, 480);
    await waitCounter(page, "1 / 3");
    await page.getByTestId("raster-view").locator("img").waitFor({ timeout: 30_000 });
    expect(!(await page.getByTestId("viewer-drawing-info").count()), "TIFF bez vazby: žádné údaje položky");
    await page.getByText("Strana 1 / 2").waitFor();
    await page.getByRole("button", { name: "Další strana" }).tap();
    await page.getByText("Strana 2 / 2").waitFor();
    await page.getByTestId("raster-view").locator("img").waitFor({ timeout: 30_000 });
    expect(await page.getByTestId("viewer-back").isVisible(), "TIFF má Zpět");
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "05-prohlizec-tiff.png") });

    // ‹ zpět na hřídel, jedno Zpět zavře prohlížeč na stejném místě
    await page.getByTestId("viewer-prev").tap();
    await waitCounter(page, "3 / 3");
    await page.getByTestId("viewer-back").tap();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    expect(page.url() === urlBefore, `po Zpět stejná adresa (${page.url()})`);
    expect(!(await page.getByTestId("mobile-nav").getAttribute("data-hidden")), "lišta zpět po zavření");

    // 3D model a doklad se otevřou samostatně (bez listování)
    await page.getByTestId("file-open").filter({ hasText: "objednavka-E2E44.pdf" }).tap();
    await page.getByTestId("pdf-view").waitFor();
    expect(!(await page.getByTestId("viewer-counter").count()), "doklad bez listování");
    await page.getByTestId("viewer-back").tap();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    await page.getByTestId("file-open").filter({ hasText: "E2E44-A.step" }).tap();
    await page.getByTestId("viewer3d-status").waitFor({ timeout: 60_000 });
    expect(!(await page.getByTestId("viewer-counter").count()), "3D model bez listování");
    await page.goBack();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
  }, { mobile: true });
});

await test("počítač: šipky ← → a tlačítka ‹ › listují výkresy, přímý odkaz na TIFF i jeho náhled hlídá přístup", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
    const link = page.getByTestId("file-open").filter({ hasText: "E2E44-A_hridel.pdf" });
    await link.waitFor();
    await settle(page);
    await link.click();
    await waitCounter(page, "3 / 3");
    await page.keyboard.press("ArrowLeft");
    await waitCounter(page, "2 / 3");
    expect(/4 ks/.test(await infoText(page)), "šipka vlevo → příruba");
    await page.keyboard.press("ArrowRight");
    await waitCounter(page, "3 / 3");
    await page.getByTestId("viewer-next").click();
    await waitCounter(page, "1 / 3");
    await page.getByTestId("raster-view").locator("img").waitFor({ timeout: 30_000 });
    await page.keyboard.press("Escape");
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });

    // náhled TIFF jako PNG (s počtem stran), PDF převod odmítne, bez přihlášení nic
    const r = await page.request.get(`${BASE}/api/jobs/files/${files.tif}?view=image&page=2`);
    expect(r.status() === 200 && r.headers()["content-type"] === "image/png" && r.headers()["x-page-count"] === "2", `náhled TIFF ${r.status()} ${r.headers()["content-type"]} ${r.headers()["x-page-count"]}`);
    const meta = await sharp(await r.body()).metadata();
    expect(meta.width === 1200 && meta.height === 850, `rozměr náhledu ${meta.width}×${meta.height}`);
    const pdfAsImage = await page.request.get(`${BASE}/api/jobs/files/${files.a}?view=image`);
    expect(pdfAsImage.status() === 415, `PDF jako obrázek → 415 (${pdfAsImage.status()})`);
    const anon = await fetch(`${BASE}/api/jobs/files/${files.tif}?view=image`, { redirect: "manual" });
    expect(anon.status === 401 || anon.status === 307 || anon.status === 302 || anon.status === 403, `bez přihlášení odmítnuto (${anon.status})`);
  });
});

await browser.close();
cleanup();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
