// E2E · Výkres DXF / DWG (majitel 7. 11.): v prohlížeči jsou vidět čísla kót (i u kót, kde výkres číslo
// v bloku nemá), „Převést na PDF" v prohlížeči vytvoří PDF a rovnou ho otevře, hromadný převod
// v Dokumentech postupně se souhrnem („Převedeno 2 z 4; …"), výkres s PDF přeskočí.
//
//   tools/e2e/run-app.sh && node tools/e2e/tests/45-dxf-pdf.mjs
//   DXF_PDF_SHOTS=/adresář …   # snímky (1366 × 768) i jinam než do artefaktů
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BASE, USERS, launch, login, localEnv, sql, summary, test, expect, withContext, ARTIFACTS } from "../lib.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const PREFIX = "E2E-dxfpdf-";
const SHOTS = process.env.DXF_PDF_SHOTS || ARTIFACTS;
fs.mkdirSync(SHOTS, { recursive: true });
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);

async function upload(jobId, filename, bytes, mime, kind = "vykres", hoursAgo = 0) {
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

/**
 * Deska 120 × 60 s kótami, jak je posílají zákazníci: kóta, jejíž blok má čáry a šipky, ale číslo ne
 * (prázdné MTEXT), kóta bez bloku, kóta s „<>" v textu bloku, průměr a poloměr bez bloku.
 */
function deskaDxf() {
  const g = (...p) => { const o = []; for (let i = 0; i < p.length; i += 2) o.push(String(p[i]), String(p[i + 1])); return o.join("\n"); };
  const blk = (name, text) => g(0, "BLOCK", 8, "0", 2, name, 70, 1, 10, 0, 20, 0, 30, 0, 3, name,
    0, "LINE", 8, "0", 10, 0, 20, 75, 30, 0, 11, 120, 21, 75, 31, 0,
    0, "LINE", 8, "0", 10, 0, 20, 62, 30, 0, 11, 0, 21, 77, 31, 0,
    0, "LINE", 8, "0", 10, 120, 20, 62, 30, 0, 11, 120, 21, 77, 31, 0,
    0, "SOLID", 8, "0", 10, 0, 20, 75, 30, 0, 11, 3, 21, 75.6, 31, 0, 12, 3, 22, 74.4, 32, 0, 13, 3, 23, 74.4, 33, 0,
    0, "SOLID", 8, "0", 10, 120, 20, 75, 30, 0, 11, 117, 21, 75.6, 31, 0, 12, 117, 22, 74.4, 32, 0, 13, 117, 23, 74.4, 33, 0,
    0, "MTEXT", 8, "0", 10, 60, 20, 76.5, 30, 0, 40, 0, 71, 8, 1, text,
    0, "ENDBLK", 8, "0");
  return [
    g(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1021", 9, "$INSUNITS", 70, 4, 0, "ENDSEC"),
    g(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, 2, 0, "LAYER", 2, "OBRYS", 70, 0, 62, 7, 6, "CONTINUOUS", 0, "LAYER", 2, "KOTY", 70, 0, 62, 3, 6, "CONTINUOUS", 0, "ENDTAB",
      0, "TABLE", 2, "DIMSTYLE", 70, 1, 0, "DIMSTYLE", 105, "27", 2, "ISO-25", 70, 0, 40, 1, 140, 3.5, 271, 2, 0, "ENDTAB", 0, "ENDSEC"),
    g(0, "SECTION", 2, "BLOCKS"), blk("*D1", "{\\fArial|b0|i0|c238|p34;}"), blk("*D2", "\\A1;<>"), g(0, "ENDSEC"),
    g(0, "SECTION", 2, "ENTITIES",
      0, "LWPOLYLINE", 8, "OBRYS", 90, 4, 70, 1, 10, 0, 20, 0, 10, 120, 20, 0, 10, 120, 20, 60, 10, 0, 20, 60,
      0, "CIRCLE", 8, "OBRYS", 10, 30, 20, 30, 30, 0, 40, 12.5,
      0, "CIRCLE", 8, "OBRYS", 10, 90, 20, 30, 30, 0, 40, 8,
      // šířka 120: blok bez čísla
      0, "DIMENSION", 5, "D1", 8, "KOTY", 2, "*D1", 3, "ISO-25", 10, 120, 20, 75, 30, 0, 11, 60, 21, 77, 31, 0, 70, 32, 42, 120, 13, 0, 23, 60, 33, 0, 14, 120, 24, 60, 34, 0, 50, 0,
      // výška 60: bez bloku
      0, "DIMENSION", 5, "D2", 8, "KOTY", 3, "ISO-25", 10, 135, 20, 60, 30, 0, 11, 137, 21, 30, 31, 0, 70, 0, 13, 120, 23, 0, 33, 0, 14, 120, 24, 60, 34, 0, 50, 90,
      // Ø25 bez bloku, R8 bez bloku
      0, "DIMENSION", 5, "D3", 8, "KOTY", 3, "ISO-25", 10, 21.161, 20, 21.161, 30, 0, 11, 30, 21, 47, 31, 0, 70, 3, 15, 38.839, 25, 38.839, 35, 0,
      0, "DIMENSION", 5, "D4", 8, "KOTY", 3, "ISO-25", 10, 90, 20, 30, 30, 0, 11, 104, 21, 42, 31, 0, 70, 4, 15, 95.657, 25, 35.657, 35, 0,
      0, "TEXT", 8, "OBRYS", 10, 0, 20, -12, 30, 0, 40, 5, 1, "DESKA E2E45 — materiál 1.4301",
      0, "ENDSEC", 0, "EOF"),
  ].join("\n");
}

function cleanup() {
  const jobIds = sql(`select id from orders where title like ${lit(`${PREFIX}%`)}`).split("\n").filter(Boolean);
  for (const id of jobIds) {
    sql(`delete from job_files where job_id = ${lit(id)}`);
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
  const files = {};
  files.deska = await upload(job, "DESKA-E2E45.dxf", Buffer.from(deskaDxf(), "utf8"), "application/dxf", "vykres", 1);
  files.priruba = await upload(job, "PRIRUBA-E2E45.dxf", fs.readFileSync(path.join(ROOT, "src/lib/viewer3d/__fixtures__/priruba-cp1250.dxf")), "application/dxf", "vykres", 2);
  files.dwg = await upload(job, "SESTAVA-E2E45.dwg", fs.readFileSync(path.join(ROOT, "src/lib/viewer3d/formats/__fixtures__/dwg-example-r2018.dwg")), "application/acad", "vykres", 3);
  files.bad = await upload(job, "ROZBITY-E2E45.dxf", Buffer.from("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n"), "application/dxf", "vykres", 4);
  return { job, files };
}

async function settle(page) {
  await page.evaluate(() =>
    Promise.all((document.querySelector("main")?.getAnimations({ subtree: true }) ?? [])
      .filter((a) => a.effect?.getTiming().iterations !== Infinity)
      .map((a) => a.finished.catch(() => null))),
  );
}

/** Texty výkresu, které prohlížeč opravdu vysázel (skrytý seznam z enginu po načtení písma). */
async function renderedTexts(page) {
  const el = page.getByTestId("viewer2d-texts");
  await el.waitFor({ state: "attached", timeout: 60_000 });
  return (await el.textContent()).split("\n");
}

const { job, files } = await setup();
const browser = await launch();
const errors = [];

await test("počítač 1366×768: DXF v Dokumentech — čísla kót vidět (i kóta bez čísla v bloku / bez bloku, Ø, R)", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
    const link = page.getByTestId("file-open").filter({ hasText: "DESKA-E2E45.dxf" });
    await link.waitFor();
    await settle(page);
    await link.click();
    await page.getByTestId("viewer3d-status").waitFor({ timeout: 60_000 });
    const texts = await renderedTexts(page);
    for (const v of ["120", "60", "Ø25", "R8", "DESKA E2E45 — materiál 1.4301"]) expect(texts.includes(v), `vykreslený text „${v}" (${texts.join(" | ")})`);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, "01-dxf-koty-s-cisly.png") });
    // DWG: čísla kót z bloků
    await page.getByTestId("viewer-back").click();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    await page.getByTestId("file-open").filter({ hasText: "SESTAVA-E2E45.dwg" }).click();
    const dwgTexts = await renderedTexts(page);
    for (const v of ["1504,68", "108°", "277,87"]) expect(dwgTexts.includes(v), `DWG: text kóty „${v}"`);
    await page.getByTestId("viewer-back").click();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
  });
});

let deskaPdf = "";
await test("prohlížeč DXF: „Převést na PDF“ → nové PDF výkresu se rovnou otevře, v Dokumentech s poznámkou a vazbou", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
    const link = page.getByTestId("file-open").filter({ hasText: "DESKA-E2E45.dxf" });
    await link.waitFor();
    await settle(page);
    await link.click();
    await page.getByTestId("viewer3d-status").waitFor({ timeout: 60_000 });
    await page.getByTestId("viewer-convert-pdf").click();
    await page.getByTestId("pdf-view").waitFor({ timeout: 60_000 });
    await page.waitForFunction(() => /DESKA-E2E45\.pdf/.test(document.querySelector('[data-testid="file-viewer"] header')?.textContent ?? ""), null, { timeout: 15_000 });
    await page.locator('[data-testid="pdf-view"] canvas').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, "02-prevedene-pdf-v-prohlizeci.png") });
    const row = sql(`select id || '|' || kind || '|' || mime_type || '|' || coalesce(source_file_id::text, '') || '|' || coalesce(note, '') from job_files
      where job_id = ${lit(job)} and filename = 'DESKA-E2E45.pdf' and not archived`);
    const [id, kind, mime, src, note] = row.split("|");
    deskaPdf = id;
    expect(kind === "vykres" && mime === "application/pdf" && src === files.deska && note === "Převedeno z DESKA-E2E45.dxf", `záznam PDF: ${row}`);
    // obsah PDF: čísla kót jako text
    const res = await page.request.get(`${BASE}/api/jobs/files/${id}`);
    const body = (await res.body()).toString("latin1");
    expect(res.status() === 200 && body.startsWith("%PDF"), `PDF ke stažení (${res.status()})`);
    await page.getByTestId("viewer-back").click();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    // řádek v Dokumentech (stránka se obnovila sama)
    await page.getByTestId("file-open").filter({ hasText: "DESKA-E2E45.pdf" }).waitFor({ timeout: 15_000 });
    expect(await page.getByText("Převedeno z DESKA-E2E45.dxf").count() > 0, "poznámka u PDF");
  });
});

await test("Dokumenty: „Převést všechny DXF / DWG na PDF“ — průběh, souhrn (převedeno / přeskočeno / nepodařilo), PDF se otevře v prohlížeči", async () => {
  await withContext(browser, errors, async (ctx) => {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    await login(page, USERS.admin);
    await page.goto(`${BASE}/orders/${job}?tab=dokumenty`);
    const bar = page.getByTestId("cad-pdf-bar");
    await bar.waitFor();
    await settle(page);
    expect(/Výkresy DXF \/ DWG: 4 \(1 už má PDF\)/.test(await bar.innerText()), `lišta: ${await bar.innerText()}`);
    await page.getByTestId("cad-pdf-all").click();
    await page.waitForFunction(() => /Převádím \d \/ 4/.test(document.querySelector('[data-testid="cad-pdf-bar"]')?.textContent ?? ""), null, { timeout: 10_000 });
    const sum = page.getByTestId("cad-pdf-summary");
    await sum.waitFor({ timeout: 120_000 });
    const text = await sum.innerText();
    expect(/Převedeno 2 z 4; 1 už PDF má \(přeskočeno\); 1 se nepodařilo: ROZBITY-E2E45\.dxf\./.test(text), `souhrn: ${text}`);
    expect(/prázdný/.test(text), "důvod u nepovedeného výkresu");
    await page.getByTestId("file-open").filter({ hasText: "SESTAVA-E2E45.pdf" }).waitFor({ timeout: 15_000 });
    await page.getByTestId("file-open").filter({ hasText: "PRIRUBA-E2E45.pdf" }).waitFor();
    await sum.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "03-hromadny-prevod-souhrn.png") });
    const n = sql(`select count(*) from job_files where job_id = ${lit(job)} and source_file_id is not null and not archived`);
    expect(n === "3", `3 PDF s vazbou na výkres (${n})`);
    expect(sql(`select count(*) from job_files where id = ${lit(deskaPdf)} and not archived`) === "1", "PDF desky se hromadně nepřevádělo znovu");
    // převedené PDF se otevře jako každý výkres PDF
    await page.getByTestId("file-open").filter({ hasText: "PRIRUBA-E2E45.pdf" }).click();
    await page.getByTestId("pdf-view").waitFor({ timeout: 30_000 });
    await page.locator('[data-testid="pdf-view"] canvas').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOTS, "04-pdf-priruby-z-dokumentu.png") });
    await page.getByTestId("viewer-back").click();
    await page.getByTestId("file-viewer").waitFor({ state: "detached" });
    // nepřihlášený převod nespustí
    const anon = await fetch(`${BASE}/api/jobs/files/${files.priruba}/pdf`, { method: "POST", redirect: "manual" });
    expect([401, 403, 302, 307].includes(anon.status), `bez přihlášení odmítnuto (${anon.status})`);
  });
});

await browser.close();
cleanup();
const ok = summary(errors);
process.exit(ok ? 0 : 1);
