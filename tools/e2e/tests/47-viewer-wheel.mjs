// E2E · Prohlížeč na počítači (majitel 10. 11.): „Když otevřu PDF (nebo jiný soubor) a stočím kolečkem dolů,
// prohlížeč se zavře." Kolečko musí jen posouvat obsah — prohlížeč zůstane otevřený, adresa se nezmění,
// a to i na konci dokumentu, při rychlém točení, u obrázku a vodorovně (náklon kolečka / touchpad).
//
//   tools/e2e/run-app.sh && node tools/e2e/tests/47-viewer-wheel.mjs
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { BASE, USERS, launch, login, localEnv, sql, summary, test, expect, withContext } from "../lib.mjs";

const PREFIX = "E2E-wheel-";
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

async function upload(jobId, filename, bytes, mime, kind, hoursAgo = 0) {
  const env = localEnv();
  const storagePath = `${jobId}/${randomUUID()}-${filename.replace(/[^\w.-]+/g, "_")}`;
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/job-files/${storagePath}`, {
    method: "POST",
    headers: { apikey: env.SUPABASE_SECRET_KEY, authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, "content-type": mime, "x-upsert": "true" },
    body: bytes,
  });
  if (!r.ok) throw new Error(`upload ${filename}: ${r.status} ${await r.text()}`);
  const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
  return sql(`insert into job_files (job_id, kind, filename, mime_type, size_bytes, storage_path, version, archived, uploaded_by, anon_status, created_at)
    values (${lit(jobId)}, ${lit(kind)}::job_file_kind, ${lit(filename)}, ${lit(mime)}, ${bytes.length}, ${lit(storagePath)}, 1, false, ${lit(adminId)}, 'skipped',
      now() - interval '${hoursAgo} hours') returning id`).split("\n")[0];
}

/** Několikastránkový PDF na výšku (A4) — na monitoru se musí rolovat. */
async function longPdf(pages) {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`STRANA ${i}`, { x: 60, y: 760, size: 40, font });
  }
  return Buffer.from(await doc.save());
}

function cleanup() {
  for (const id of sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean)) {
    sql(`delete from job_files where job_id = ${lit(id)}`);
    sql(`delete from orders where id = ${lit(id)}`);
  }
  sql(`delete from customers where name like ${lit(`${PREFIX}%`)}`);
}

async function setup() {
  cleanup();
  const adminId = sql(`select id from profiles where email = 'admin@local.test'`);
  const cust = sql(`insert into customers (name, country, owner_id, payment_terms_days) values (${lit(`${PREFIX}Zákazník`)}, 'CZ', ${lit(adminId)}, 14) returning id`).split("\n")[0];
  const job = sql(`insert into orders (number, title, customer_id, owner_id, created_by, status, source, inquiry_date)
    values (next_job_number(), ${lit(`${PREFIX}Zakázka`)}, ${lit(cust)}, ${lit(adminId)}, ${lit(adminId)}, 'poptavka'::job_stage, 'manual', app_today()) returning id`).split("\n")[0];
  await upload(job, "dlouhy-vykres.pdf", await longPdf(4), "application/pdf", "vykres", 2);
  const png = await sharp({ create: { width: 1200, height: 3000, channels: 3, background: "#ddeeff" } }).png().toBuffer();
  await upload(job, "vysoky-obrazek.png", png, "image/png", "ostatni", 1);
  return { job };
}

const layer = (page) => page.getByTestId("file-viewer-layer");

/** Najde rolovací prvek uvnitř prohlížeče (nejvyšší scrollHeight) a vrátí jeho scrollTop. */
async function viewerScroll(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="file-viewer-layer"]');
    if (!root) return null;
    let best = null;
    for (const el of root.querySelectorAll("*")) {
      if (el.scrollHeight > el.clientHeight + 4 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
    }
    return best ? { top: best.scrollTop, max: best.scrollHeight - best.clientHeight } : { top: 0, max: 0 };
  });
}

async function openFile(page, job, name) {
  await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
  const link = page.getByTestId("file-open").filter({ hasText: name });
  await link.waitFor({ timeout: 20_000 });
  await link.click();
  await layer(page).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(1200); // vykreslení stránek
}

const { job } = await setup();
const browser = await launch();
const errors = [];

for (const [label, viewport] of [["PC 1920×1080", { width: 1920, height: 1080 }], ["notebook 1366×768", { width: 1366, height: 768 }]]) {
  await test(`${label}: PDF — kolečko dolů posouvá dokument, prohlížeč zůstane otevřený (i na konci, i rychle, i vodorovně)`, async () => {
    await withContext(browser, errors, async (ctx) => {
      const page = await ctx.newPage();
      await page.setViewportSize(viewport);
      await login(page, USERS.admin);
      await openFile(page, job, "dlouhy-vykres.pdf");
      const url0 = page.url();
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      const before = await viewerScroll(page);
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(500);
      expect(await layer(page).isVisible(), "po točení kolečkem dolů je prohlížeč pořád otevřený");
      const mid = await viewerScroll(page);
      expect(mid && before && mid.top > before.top, `dokument se posunul (${JSON.stringify(before)} → ${JSON.stringify(mid)})`);
      // rychle až za konec dokumentu
      for (let i = 0; i < 40; i++) await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(800);
      expect(await layer(page).isVisible(), "ani za koncem dokumentu se prohlížeč nezavře");
      // vodorovně (náklon kolečka / touchpad) oběma směry
      await page.mouse.wheel(-800, 0);
      await page.mouse.wheel(800, 0);
      await page.waitForTimeout(800);
      expect(await layer(page).isVisible(), "vodorovné kolečko prohlížeč nezavře");
      // zpět nahoru
      for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -1200);
      await page.waitForTimeout(800);
      expect(await layer(page).isVisible(), "kolečko nahoru prohlížeč nezavře");
      expect(page.url() === url0, `adresa beze změny (${url0} → ${page.url()})`);
      // zavřít jde dál normálně
      await page.keyboard.press("Escape");
      await layer(page).waitFor({ state: "hidden", timeout: 10_000 });
    });
  });
}

await test("PC: obrázek — kolečko dolů ho posune, prohlížeč zůstane otevřený", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1600, height: 900 });
    await login(page, USERS.admin);
    await openFile(page, job, "vysoky-obrazek.png");
    await page.mouse.move(800, 450);
    for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 800);
    await page.waitForTimeout(800);
    expect(await layer(page).isVisible(), "obrázek: prohlížeč pořád otevřený");
  });
});

await browser.close();
cleanup();
process.exit(summary(errors) ? 0 : 1);
